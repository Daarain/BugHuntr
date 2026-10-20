import test from "node:test";
import assert from "node:assert/strict";
import { VulnerabilitiesRepository } from "../lib/db/repositories/vulnerabilities.repo";
import { SubmissionsRepository } from "../lib/db/repositories/submissions.repo";
import {
  computeBaseScore,
  parseVectorString,
  vectorToString,
} from "../lib/cvss/cvss-engine";
import {
  computeBugHuntrScore,
  getDefaultScoringFactorsForAsset,
  adjustForExploitability,
} from "../lib/cvss/bughuntr-scoring";
import {
  validateCvssVector,
  diffVectors,
  isSignificantChange,
} from "../lib/cvss/validate-cvss-vector";
import { GET as getVulnerabilitiesHandler, POST as postVulnerabilitiesHandler } from "../app/api/vulnerabilities/route";
import { GET as getVulnByIdHandler, PATCH as patchVulnByIdHandler } from "../app/api/vulnerabilities/[id]/route";
import { POST as approveCvssHandler } from "../app/api/vulnerabilities/[id]/approve-cvss/route";
import { POST as approveCvssFunctionsHandler } from "../app/api/functions/cvss/approveCvss/route";
import { POST as rejectVulnHandler } from "../app/api/vulnerabilities/[id]/reject/route";
import { GET as getCveRequestsHandler, POST as postCveRequestsHandler } from "../app/api/cve-requests/route";
import { GET as getCveRequestByIdHandler, PATCH as patchCveRequestByIdHandler } from "../app/api/cve-requests/[id]/route";
import { POST as requestCveFunctionsHandler } from "../app/api/functions/cve/requestCve/route";
import { createSessionToken } from "../lib/server-auth";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * In-memory Mock MongoDB database for hermetic testing.
 */
function createMockDb() {
  const store = new Map();

  return {
    collection(name) {
      if (!store.has(name)) {
        store.set(name, new Map());
      }
      const colMap = store.get(name);

      return {
        async findOne(filter) {
          for (const doc of colMap.values()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (v && typeof v === "object" && "$in" in v) {
                if (!v.$in.includes(doc[k])) { match = false; break; }
              } else if (v && typeof v === "object" && "$or" in filter) {
                // handled below
              } else if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (filter.$or) {
              const orMatch = filter.$or.some((cond) => {
                for (const [ck, cv] of Object.entries(cond)) {
                  if (ck.includes(".")) {
                    const [p1, p2] = ck.split(".");
                    if (doc[p1]?.[p2] === cv) return true;
                  } else if (doc[ck] === cv) {
                    return true;
                  }
                }
                return false;
              });
              if (!orMatch) match = false;
            }
            if (match) return JSON.parse(JSON.stringify(doc));
          }
          return null;
        },

        find(filter = {}) {
          const results = [];
          for (const doc of colMap.values()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (k === "$or" && Array.isArray(v)) {
                const orMatch = v.some((cond) => {
                  for (const [ck, cv] of Object.entries(cond)) {
                    if (ck.includes(".")) {
                      const [p1, p2] = ck.split(".");
                      if (doc[p1]?.[p2] === cv) return true;
                    } else if (doc[ck] === cv) {
                      return true;
                    }
                  }
                  return false;
                });
                if (!orMatch) match = false;
              } else if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) results.push(JSON.parse(JSON.stringify(doc)));
          }

          let sortKey = null;
          let sortDir = 1;
          let limitCount = Infinity;

          const cursor = {
            sort(s) {
              const [k, d] = Object.entries(s)[0] || [];
              sortKey = k;
              sortDir = d;
              return cursor;
            },
            limit(l) {
              limitCount = l;
              return cursor;
            },
            async toArray() {
              if (sortKey) {
                results.sort((a, b) => {
                  const valA = a[sortKey] instanceof Date ? a[sortKey].getTime() : a[sortKey];
                  const valB = b[sortKey] instanceof Date ? b[sortKey].getTime() : b[sortKey];
                  return (valA > valB ? 1 : -1) * sortDir;
                });
              }
              return results.slice(0, limitCount);
            },
          };
          return cursor;
        },

        async countDocuments(filter = {}) {
          let count = 0;
          for (const doc of colMap.values()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) count++;
          }
          return count;
        },

        async insertOne(doc) {
          const id = doc._id || `id_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const clone = { ...doc, _id: id };
          colMap.set(id, clone);
          return { acknowledged: true, insertedId: id };
        },

        async updateOne(filter, update) {
          const doc = await this.findOne(filter);
          if (!doc) return { matchedCount: 0, modifiedCount: 0 };

          const target = colMap.get(doc._id);
          if (update.$set) {
            for (const [k, v] of Object.entries(update.$set)) {
              if (k.includes(".")) {
                const [p1, p2] = k.split(".");
                if (!target[p1]) target[p1] = {};
                target[p1][p2] = v;
              } else {
                target[k] = v;
              }
            }
          }
          if (update.$push) {
            for (const [k, v] of Object.entries(update.$push)) {
              if (!target[k]) target[k] = [];
              target[k].push(v);
            }
          }
          return { matchedCount: 1, modifiedCount: 1 };
        },

        async deleteOne(filter) {
          const doc = await this.findOne(filter);
          if (!doc) return { deletedCount: 0 };
          colMap.delete(doc._id);
          return { deletedCount: 1 };
        },
      };
    },
  };
}

function makeMockRequest(method, url, options = {}) {
  const { body, token, headers = {} } = options;
  const headerMap = new Map();
  for (const [k, v] of Object.entries(headers)) {
    headerMap.set(k.toLowerCase(), v);
  }
  if (token) {
    headerMap.set("cookie", `bughuntr_session=${token}`);
  }
  if (body) {
    headerMap.set("content-type", "application/json");
  }

  return {
    method,
    url,
    headers: {
      get(k) {
        return headerMap.get(k.toLowerCase()) || null;
      },
    },
    json: async () => body || {},
  };
}

// Global hermetic in-memory mock database
const mockDb = createMockDb();
globalThis._mongoClientPromise = Promise.resolve({
  db() {
    return mockDb;
  },
});
process.env.SESSION_SECRET = TEST_SECRET;

test("VulnerabilitiesRepository: CRUD, listing, triage status, and CVE request tracking", async () => {
  const repo = new VulnerabilitiesRepository(mockDb);

  // 1. Create vulnerability
  const vuln = await repo.createVulnerability({
    _id: "BH-VULN-sub_001",
    submission_id: "sub_001",
    bounty_id: "hunt_001",
    org_id: "AcmeCorp",
    reporter_uid: "hunter_42",
    cvss: {
      vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      baseScore: 9.8,
      severity: "CRITICAL",
    },
    status: "triage_pending",
    created_at: new Date(),
    updated_at: new Date(),
  });
  assert.equal(vuln._id, "BH-VULN-sub_001");
  assert.equal(vuln.submission_id, "sub_001");

  // 2. Query by ID and submission ID
  const byId = await repo.getById("BH-VULN-sub_001");
  assert.equal(byId?._id, "BH-VULN-sub_001");
  const bySubId = await repo.getBySubmissionId("sub_001");
  assert.equal(bySubId?._id, "BH-VULN-sub_001");

  // 3. List and count
  const list = await repo.listVulnerabilities({ orgId: "AcmeCorp" });
  assert.equal(list.length, 1);
  const count = await repo.countVulnerabilities({ orgId: "AcmeCorp" });
  assert.equal(count, 1);

  // 4. Update CVSS score
  const updatedScore = await repo.updateCvssScore(
    "BH-VULN-sub_001",
    {
      vector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N",
      baseScore: 8.1,
      severity: "HIGH",
    },
    { approvedScore: 8.5 },
    "triager_99",
    "Adjusted for required low privileges"
  );
  assert.equal(updatedScore, true);

  const afterScore = await repo.getById("BH-VULN-sub_001");
  assert.equal(afterScore?.cvss.baseScore, 8.1);
  assert.equal(afterScore?.status, "approved");
  assert.equal(afterScore?.triaged_by, "triager_99");

  // 5. Update Status
  const statusUpdated = await repo.updateStatus("BH-VULN-sub_001", "triaged", "Final triage sign-off", "triager_99");
  assert.equal(statusUpdated, true);
  const afterStatus = await repo.getById("BH-VULN-sub_001");
  assert.equal(afterStatus?.status, "triaged");

  // 6. Audit Trail Logging
  const audit = await repo.logAudit({
    _id: "audit_1",
    vuln_id: "BH-VULN-sub_001",
    actor_uid: "triager_99",
    action: "cvss_approved",
    new_vector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N",
    new_score: 8.1,
    created_at: new Date(),
  });
  assert.equal(audit._id, "audit_1");

  const auditLogs = await repo.listAuditLogs("BH-VULN-sub_001");
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "cvss_approved");

  // 7. CVE Request operations
  const cveReq = await repo.createCveRequest({
    _id: "BH-CVE-sub_001-12345",
    vuln_id: "BH-VULN-sub_001",
    org_id: "AcmeCorp",
    requested_by: "triager_99",
    status: "requested",
    disclosure_type: "coordinated",
    disclosure_packet: { title: "SQLi" },
    created_at: new Date(),
    updated_at: new Date(),
  });
  assert.equal(cveReq._id, "BH-CVE-sub_001-12345");

  const byVuln = await repo.getCveRequestByVuln("BH-VULN-sub_001");
  assert.equal(byVuln?._id, "BH-CVE-sub_001-12345");

  const cveList = await repo.listCveRequests({ orgId: "AcmeCorp" });
  assert.equal(cveList.length, 1);

  const statusHistoryUpdated = await repo.updateCveRequest(
    "BH-CVE-sub_001-12345",
    { status: "cve_assigned", cve_id: "CVE-2026-9999" },
    "triager_99",
    "Assigned by MITRE"
  );
  assert.equal(statusHistoryUpdated, true);

  const afterCve = await repo.getCveRequestById("BH-CVE-sub_001-12345");
  assert.equal(afterCve?.status, "cve_assigned");
  assert.equal(afterCve?.cve_id, "CVE-2026-9999");
  assert.equal(afterCve?.status_history?.length, 1);
});

test("CVSS v3.1 Engine & BugHuntr Scoring mathematical verification", async () => {
  // Test NIST vectors
  const critVector = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H";
  const critResult = computeBaseScore(critVector);
  assert.ok(critResult);
  assert.equal(critResult.baseScore, 9.8);
  assert.equal(critResult.severity, "CRITICAL");

  // Test vector parsing and stringification
  const parsed = parseVectorString(critVector);
  assert.ok(parsed);
  assert.equal(parsed.AV, "N");
  assert.equal(parsed.AC, "L");
  assert.equal(parsed.PR, "N");
  assert.equal(parsed.S, "U");
  assert.equal(parsed.C, "H");
  assert.equal(vectorToString(parsed), critVector);

  // Test validation
  assert.equal(validateCvssVector(critVector).valid, true);
  assert.equal(validateCvssVector("INVALID").valid, false);
  assert.equal(validateCvssVector("").valid, false);

  // Test Vector Diffing and Significant Change
  const vector2 = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N";
  const parsed2 = parseVectorString(vector2);
  assert.ok(parsed2);
  const diffs = diffVectors(parsed, parsed2);
  assert.ok(diffs.length > 0);
  assert.equal(isSignificantChange(parsed, parsed2), true);

  // Test BugHuntr Scoring Formula
  const bhScore = computeBugHuntrScore(9.8, {
    exploitabilityModifier: 1.1,
    businessImpactMultiplier: 1.2,
    confidenceFactor: 0.95,
  });
  assert.ok(bhScore.score <= 10.0);
  assert.ok(bhScore.score > 0);
  assert.equal(bhScore.version, "BH-v1.0");

  // Test asset scoring factors
  const factors = getDefaultScoringFactorsForAsset("payment_system");
  assert.equal(factors.businessImpactMultiplier, 2.0);
  const adjusted = adjustForExploitability(factors, true, false);
  assert.equal(adjusted.exploitabilityModifier, 1.1);
});

test("API Routes: Vulnerabilities listing, tenancy, and creation authorization", async () => {
  // Create mock hunt and submission
  const subRepo = new SubmissionsRepository(mockDb);
  await subRepo.createSubmission({
    _id: "sub_test_100",
    bounty_id: "hunt_100",
    org_id: "CyberCorp",
    hunter_id: "hunter_alice",
    title: "SQL Injection in Search",
    description: "Union based SQLi",
    steps_to_reproduce: "1. Search ' OR 1=1",
    severity: "critical",
    category: "web_app",
    status: "pending",
    payout_status: "unpaid",
    created_at: new Date(),
    updated_at: new Date(),
  });

  const vulnRepo = new VulnerabilitiesRepository(mockDb);
  await vulnRepo.createVulnerability({
    _id: "BH-VULN-sub_test_100",
    submission_id: "sub_test_100",
    bounty_id: "hunt_100",
    org_id: "CyberCorp",
    reporter_uid: "hunter_alice",
    cvss: {
      vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      baseScore: 9.8,
      severity: "CRITICAL",
    },
    status: "triage_pending",
    created_at: new Date(),
    updated_at: new Date(),
  });

  const hunterToken = createSessionToken({
    id: "hunter_alice",
    email: "alice@example.com",
    username: "hunter_alice",
    role: "user",
    userType: "hunter",
  });

  const bobHunterToken = createSessionToken({
    id: "hunter_bob",
    email: "bob@example.com",
    username: "hunter_bob",
    role: "user",
    userType: "hunter",
  });

  const companyToken = createSessionToken({
    id: "comp_1",
    email: "admin@cybercorp.com",
    username: "CyberCorp",
    role: "user",
    userType: "company",
  });

  const triagerToken = createSessionToken({
    id: "triager_1",
    email: "triager@bughuntr.io",
    username: "staff_triager",
    role: "triager",
    userType: "company",
  });

  // 1. Unauthenticated GET /api/vulnerabilities -> 401
  const unauthReq = makeMockRequest("GET", "http://localhost/api/vulnerabilities");
  const unauthRes = await getVulnerabilitiesHandler(unauthReq);
  assert.equal(unauthRes.status, 401);

  // 2. Hunter Alice listing -> Sees own vulnerability
  const aliceReq = makeMockRequest("GET", "http://localhost/api/vulnerabilities", { token: hunterToken });
  const aliceRes = await getVulnerabilitiesHandler(aliceReq);
  assert.equal(aliceRes.status, 200);
  const aliceList = await aliceRes.json();
  assert.equal(aliceList.length, 1);
  assert.equal(aliceList[0].id, "BH-VULN-sub_test_100");

  // 3. Hunter Bob listing -> Cannot see Alice's vulnerability (tenancy isolation)
  const bobReq = makeMockRequest("GET", "http://localhost/api/vulnerabilities", { token: bobHunterToken });
  const bobRes = await getVulnerabilitiesHandler(bobReq);
  assert.equal(bobRes.status, 200);
  const bobList = await bobRes.json();
  assert.equal(bobList.length, 0);

  // 4. Triager listing -> Sees all vulnerabilities or filters by org
  const triagerReq = makeMockRequest("GET", "http://localhost/api/vulnerabilities?orgId=CyberCorp", { token: triagerToken });
  const triagerRes = await getVulnerabilitiesHandler(triagerReq);
  assert.equal(triagerRes.status, 200);
  const triagerList = await triagerRes.json();
  assert.equal(triagerList.length, 1);

  // 5. Hunter POST /api/vulnerabilities -> 403 Forbidden
  const hunterPostReq = makeMockRequest("POST", "http://localhost/api/vulnerabilities", {
    token: hunterToken,
    body: { submissionId: "sub_test_100" },
  });
  const hunterPostRes = await postVulnerabilitiesHandler(hunterPostReq);
  assert.equal(hunterPostRes.status, 403);

  // 6. Triager POST /api/vulnerabilities for already existing vuln -> 409 Conflict
  const dupPostReq = makeMockRequest("POST", "http://localhost/api/vulnerabilities", {
    token: triagerToken,
    body: { submissionId: "sub_test_100" },
  });
  const dupPostRes = await postVulnerabilitiesHandler(dupPostReq);
  assert.equal(dupPostRes.status, 409);
});

test("API Routes: CVSS approval, rejection, and role-based enforcement", async () => {
  const subRepo = new SubmissionsRepository(mockDb);
  await subRepo.createSubmission({
    _id: "sub_test_200",
    bounty_id: "hunt_200",
    org_id: "AcmeOrg",
    hunter_id: "hunter_eve",
    title: "IDOR on invoices",
    description: "Direct reference to order_id",
    steps_to_reproduce: "Change ID",
    severity: "high",
    category: "api_endpoint",
    status: "pending",
    payout_status: "unpaid",
    created_at: new Date(),
    updated_at: new Date(),
  });

  const vulnRepo = new VulnerabilitiesRepository(mockDb);
  await vulnRepo.createVulnerability({
    _id: "BH-VULN-sub_test_200",
    submission_id: "sub_test_200",
    bounty_id: "hunt_200",
    org_id: "AcmeOrg",
    reporter_uid: "hunter_eve",
    cvss: {
      vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
      baseScore: 7.5,
      severity: "HIGH",
    },
    status: "triage_pending",
    created_at: new Date(),
    updated_at: new Date(),
  });

  const mongoMod = await import("../lib/db/mongodb");
  mongoMod._setMockDatabase?.(mockDb);

  const hunterToken = createSessionToken({
    id: "hunter_eve",
    email: "eve@example.com",
    username: "hunter_eve",
    role: "user",
    userType: "hunter",
  });

  const triagerToken = createSessionToken({
    id: "triager_lead",
    email: "lead@bughuntr.io",
    username: "triager_lead",
    role: "triager",
    userType: "company",
  });

  // 1. Hunter cannot approve CVSS -> 403 Forbidden
  const hunterApproveReq = makeMockRequest(
    "POST",
    "http://localhost/api/vulnerabilities/BH-VULN-sub_test_200/approve-cvss",
    {
      token: hunterToken,
      body: {
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N",
        finalSignOff: true,
      },
    }
  );
  const hunterApproveRes = await approveCvssHandler(hunterApproveReq, {
    params: Promise.resolve({ id: "BH-VULN-sub_test_200" }),
  });
  assert.equal(hunterApproveRes.status, 403);

  // 2. Malformed CVSS vector rejected with 400 Bad Request
  const badVectorReq = makeMockRequest(
    "POST",
    "http://localhost/api/vulnerabilities/BH-VULN-sub_test_200/approve-cvss",
    {
      token: triagerToken,
      body: {
        cvssVector: "INVALID_CVSS_VECTOR",
        finalSignOff: true,
      },
    }
  );
  const badVectorRes = await approveCvssHandler(badVectorReq, {
    params: Promise.resolve({ id: "BH-VULN-sub_test_200" }),
  });
  assert.equal(badVectorRes.status, 400);

  // 3. Valid CVSS approval by Triager -> 200 OK & status transitions to triaged
  const validApproveReq = makeMockRequest(
    "POST",
    "http://localhost/api/vulnerabilities/BH-VULN-sub_test_200/approve-cvss",
    {
      token: triagerToken,
      body: {
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N",
        triageNotes: "Verified IDOR with low privilege user account",
        finalSignOff: true,
      },
    }
  );
  const validApproveRes = await approveCvssHandler(validApproveReq, {
    params: Promise.resolve({ id: "BH-VULN-sub_test_200" }),
  });
  assert.equal(validApproveRes.status, 200);
  const approveData = await validApproveRes.json();
  assert.equal(approveData.success, true);
  assert.equal(approveData.status, "triaged");
  assert.ok(approveData.cvss.baseScore > 0);
  assert.ok(approveData.bughuntrScore > 0);

  // Verify database record updated
  const updatedVuln = await vulnRepo.getById("BH-VULN-sub_test_200");
  assert.equal(updatedVuln?.status, "triaged");
  assert.equal(updatedVuln?.triaged_by, "triager_lead");

  // Verify audit log created
  const auditLogs = await vulnRepo.listAuditLogs("BH-VULN-sub_test_200");
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "cvss_approved");

  // 4. Test Rejection flow on second vulnerability
  await vulnRepo.createVulnerability({
    _id: "BH-VULN-sub_test_201",
    submission_id: "sub_test_201",
    bounty_id: "hunt_200",
    org_id: "AcmeOrg",
    cvss: {
      vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N",
      baseScore: 0.0,
      severity: "NONE",
    },
    status: "triage_pending",
    created_at: new Date(),
    updated_at: new Date(),
  });

  const rejectReq = makeMockRequest(
    "POST",
    "http://localhost/api/vulnerabilities/BH-VULN-sub_test_201/reject",
    {
      token: triagerToken,
      body: {
        reason: "Out of scope rate limit finding",
        status: "rejected_low_severity",
      },
    }
  );
  const rejectRes = await rejectVulnHandler(rejectReq, {
    params: Promise.resolve({ id: "BH-VULN-sub_test_201" }),
  });
  assert.equal(rejectRes.status, 200);
  const rejectedVuln = await vulnRepo.getById("BH-VULN-sub_test_201");
  assert.equal(rejectedVuln?.status, "rejected_low_severity");
});

test("API Routes: CVE Request workflow, identity binding, and status progression", async () => {
  const vulnRepo = new VulnerabilitiesRepository(mockDb);
  await vulnRepo.createVulnerability({
    _id: "BH-VULN-sub_cve_300",
    submission_id: "sub_cve_300",
    bounty_id: "hunt_300",
    org_id: "EnterpriseOrg",
    reporter_uid: "hunter_dan",
    cvss: {
      vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
      baseScore: 10.0,
      severity: "CRITICAL",
      approvedVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
      approvedBaseScore: 10.0,
    },
    status: "triaged",
    created_at: new Date(),
    updated_at: new Date(),
  });

  const hunterToken = createSessionToken({
    id: "hunter_dan",
    email: "dan@example.com",
    username: "hunter_dan",
    role: "user",
    userType: "hunter",
  });

  const triagerToken = createSessionToken({
    id: "staff_cve_coordinator",
    email: "cve@bughuntr.io",
    username: "staff_cve_coordinator",
    role: "triager",
    userType: "company",
  });

  // 1. Hunter cannot request CVE -> 403 Forbidden
  const hunterCveReq = makeMockRequest("POST", "http://localhost/api/cve-requests", {
    token: hunterToken,
    body: {
      vulnId: "BH-VULN-sub_cve_300",
      disclosureType: "coordinated",
    },
  });
  const hunterCveRes = await postCveRequestsHandler(hunterCveReq);
  assert.equal(hunterCveRes.status, 403);

  // 2. Staff creates CVE request with malicious spoofed requestorUid -> identity binding overrides it!
  const spoofedCveReq = makeMockRequest("POST", "http://localhost/api/cve-requests", {
    token: triagerToken,
    body: {
      vulnId: "BH-VULN-sub_cve_300",
      disclosureType: "coordinated",
      requestorUid: "hacker_spoofed_admin_id", // Client spoof attempt
      notes: "Severe RCE requiring coordinated disclosure",
    },
  });
  const spoofedCveRes = await postCveRequestsHandler(spoofedCveReq);
  assert.equal(spoofedCveRes.status, 201);
  const cveData = await spoofedCveRes.json();
  assert.equal(cveData.success, true);
  assert.ok(cveData.cveRequestId);

  // Verify DB record: requested_by MUST be staff_cve_coordinator, NOT hacker_spoofed_admin_id!
  const savedCve = await vulnRepo.getCveRequestById(cveData.cveRequestId);
  assert.equal(savedCve?.requested_by, "staff_cve_coordinator");
  assert.notEqual(savedCve?.requested_by, "hacker_spoofed_admin_id");

  // Verify vulnerability status updated to cve_requested
  const afterVuln = await vulnRepo.getById("BH-VULN-sub_cve_300");
  assert.equal(afterVuln?.status, "cve_requested");
  assert.equal(afterVuln?.cve_request_id, cveData.cveRequestId);

  // 3. Duplicate request prevention -> 409 Conflict
  const dupReq = makeMockRequest("POST", "http://localhost/api/cve-requests", {
    token: triagerToken,
    body: {
      vulnId: "BH-VULN-sub_cve_300",
      disclosureType: "coordinated",
    },
  });
  const dupRes = await postCveRequestsHandler(dupReq);
  assert.equal(dupRes.status, 409);

  // 4. Update status: CNA acknowledged
  const ackReq = makeMockRequest("PATCH", `http://localhost/api/cve-requests/${cveData.cveRequestId}`, {
    token: triagerToken,
    body: {
      status: "cna_acknowledged",
      cnaContactEmail: "cna@mitre.org",
      notes: "CNA acknowledged receipt of disclosure packet",
    },
  });
  const ackRes = await patchCveRequestByIdHandler(ackReq, {
    params: Promise.resolve({ id: cveData.cveRequestId }),
  });
  assert.equal(ackRes.status, 200);

  // 5. Update status: CVE Assigned
  const assignReq = makeMockRequest("PATCH", `http://localhost/api/cve-requests/${cveData.cveRequestId}`, {
    token: triagerToken,
    body: {
      status: "cve_assigned",
      cveId: "CVE-2026-1337",
      notes: "CVE identifier assigned by CNA",
    },
  });
  const assignRes = await patchCveRequestByIdHandler(assignReq, {
    params: Promise.resolve({ id: cveData.cveRequestId }),
  });
  assert.equal(assignRes.status, 200);

  // Verify CVE ID was propagated to vulnerability document
  const vulnWithCve = await vulnRepo.getById("BH-VULN-sub_cve_300");
  assert.equal(vulnWithCve?.cve_id, "CVE-2026-1337");

  // 6. Hunter viewing CVE requests -> Can only view their own
  const hunterListReq = makeMockRequest("GET", "http://localhost/api/cve-requests", { token: hunterToken });
  const hunterListRes = await getCveRequestsHandler(hunterListReq);
  assert.equal(hunterListRes.status, 200);
  const hunterCveList = await hunterListRes.json();
  // Hunter Dan is not requested_by (staff requested it), so 0
  assert.equal(hunterCveList.length, 0);

  // Triager viewing CVE requests -> filters by org or views all
  const triagerListReq = makeMockRequest("GET", "http://localhost/api/cve-requests?orgId=EnterpriseOrg", { token: triagerToken });
  const triagerListRes = await getCveRequestsHandler(triagerListReq);
  assert.equal(triagerListRes.status, 200);
  const triagerCveList = await triagerListRes.json();
  assert.equal(triagerCveList.length, 1);
  assert.equal(triagerCveList[0].cveId, "CVE-2026-1337");
});

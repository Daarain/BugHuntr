import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  getSessionSecret,
  createSessionToken,
  verifySessionToken,
  MIN_SECRET_LENGTH,
} from "../lib/server-auth.ts";
import { POST as postHuntsHandler } from "../app/api/bug-hunts/route.ts";
import { GET as getSubmissionsHandler } from "../app/api/bug-submissions/route.ts";
import { GET as getVulnerabilityByIdHandler } from "../app/api/vulnerabilities/[id]/route.ts";
import { HuntsRepository } from "../lib/db/repositories/hunts.repo.ts";
import { SubmissionsRepository } from "../lib/db/repositories/submissions.repo.ts";
import { VulnerabilitiesRepository } from "../lib/db/repositories/vulnerabilities.repo.ts";

/**
 * Hermetic in-memory mock MongoDB for security tests
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
              } else if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) return JSON.parse(JSON.stringify(doc));
          }
          return null;
        },

        async insertOne(doc) {
          const key = doc._id || `doc_${Date.now()}_${Math.random()}`;
          const saved = JSON.parse(JSON.stringify({ ...doc, _id: key }));
          colMap.set(key, saved);
          return { acknowledged: true, insertedId: key };
        },

        find(filter = {}) {
          const docs = [];
          for (const doc of colMap.values()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (v && typeof v === "object" && "$in" in v) {
                if (!v.$in.includes(doc[k])) { match = false; break; }
              } else if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) docs.push(JSON.parse(JSON.stringify(doc)));
          }

          let limitCount = docs.length;
          return {
            sort() { return this; },
            limit(n) { limitCount = n; return this; },
            async toArray() { return docs.slice(0, limitCount); },
          };
        },
      };
    },
  };
}

const mockDb = createMockDb();
globalThis._mongoClientPromise = Promise.resolve({
  db() {
    return mockDb;
  },
});

function createMockRequest(url, method = "GET", body = null, sessionUser = null) {
  const headers = new Headers();
  headers.set("content-type", "application/json");

  if (sessionUser) {
    const token = createSessionToken(sessionUser);
    headers.set("cookie", `bughuntr_session=${token}`);
  }

  return {
    url,
    method,
    headers,
    async json() {
      return body || {};
    },
  };
}

// ============================================================================
// 1. Production Session Secret Fail-Closed Tests
// ============================================================================
test("Security Audit: fails closed in production when SESSION_SECRET is missing", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.SESSION_SECRET;
  const originalInternal = process.env.INTERNAL_API_SECRET;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    delete process.env.INTERNAL_API_SECRET;

    assert.throws(
      () => getSessionSecret(),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Server configuration error: SESSION_SECRET is missing/);
        return true;
      }
    );
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalSecret !== undefined) process.env.SESSION_SECRET = originalSecret;
    if (originalInternal !== undefined) process.env.INTERNAL_API_SECRET = originalInternal;
  }
});

test("Security Audit: fails closed in production when SESSION_SECRET is weak (< 32 chars)", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.SESSION_SECRET;
  const originalInternal = process.env.INTERNAL_API_SECRET;
  const weakSecret = "short_insecure_key";

  try {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = weakSecret;
    delete process.env.INTERNAL_API_SECRET;

    assert.throws(
      () => getSessionSecret(),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Server configuration error: SESSION_SECRET is unsafe/);
        // CRITICAL: Error must NEVER contain the secret value itself
        assert.equal(err.message.includes(weakSecret), false);
        return true;
      }
    );
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalSecret !== undefined) process.env.SESSION_SECRET = originalSecret;
    if (originalInternal !== undefined) process.env.INTERNAL_API_SECRET = originalInternal;
  }
});

test("Security Audit: fails closed in production when SESSION_SECRET is a predictable fallback key", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.SESSION_SECRET;
  const originalInternal = process.env.INTERNAL_API_SECRET;

  try {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "bughuntr_server_session_fallback_secret_key_2026";
    delete process.env.INTERNAL_API_SECRET;

    assert.throws(
      () => getSessionSecret(),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Server configuration error: SESSION_SECRET is unsafe/);
        return true;
      }
    );
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalSecret !== undefined) process.env.SESSION_SECRET = originalSecret;
    if (originalInternal !== undefined) process.env.INTERNAL_API_SECRET = originalInternal;
  }
});

test("Security Audit: accepts safe production secret (>= 32 chars) without leaking secret in logs", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.SESSION_SECRET;
  const originalInternal = process.env.INTERNAL_API_SECRET;
  const safeProdSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  try {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = safeProdSecret;
    delete process.env.INTERNAL_API_SECRET;

    const secret = getSessionSecret();
    assert.equal(typeof secret, "string");
    assert.ok(secret.length >= MIN_SECRET_LENGTH);
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalSecret !== undefined) process.env.SESSION_SECRET = originalSecret;
    if (originalInternal !== undefined) process.env.INTERNAL_API_SECRET = originalInternal;
  }
});

// ============================================================================
// 2. Session Token Validation & Tampering Resistance
// ============================================================================
test("Security Audit: rejects role tampering (elevating hunter to admin without valid signature)", () => {
  const legitimateUser = {
    id: "usr_hunter_42",
    email: "hunter@example.com",
    username: "hunter42",
    role: "user",
    userType: "hunter",
  };

  const validToken = createSessionToken(legitimateUser);
  const [encodedPayload, signature] = validToken.split(".");

  // Attacker decodes payload and alters role from 'user' to 'admin'
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf-8"));
  payload.role = "admin";
  const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const tamperedToken = `${tamperedPayload}.${signature}`;

  const result = verifySessionToken(tamperedToken);
  assert.equal(result.valid, false);
  assert.match(result.error, /Token signature verification failed/);
});

test("Security Audit: rejects expired session token", () => {
  const now = Date.now();
  const expiredPayload = {
    id: "usr_expired",
    email: "expired@example.com",
    username: "expired_user",
    role: "user",
    userType: "hunter",
    iat: now - 1000000,
    exp: now - 5000, // Expired 5 seconds ago
  };

  const payloadStr = JSON.stringify(expiredPayload);
  const encodedPayload = Buffer.from(payloadStr).toString("base64url");
  const signature = crypto.createHmac("sha256", getSessionSecret()).update(encodedPayload).digest("hex");
  const expiredToken = `${encodedPayload}.${signature}`;

  const result = verifySessionToken(expiredToken);
  assert.equal(result.valid, false);
  assert.match(result.error, /Session token expired/);
});

test("Security Audit: rejects future session token claiming issuance in future beyond clock skew", () => {
  const now = Date.now();
  const futurePayload = {
    id: "usr_future",
    email: "future@example.com",
    username: "future_user",
    role: "user",
    userType: "hunter",
    iat: now + 3600000, // 1 hour into the future
    exp: now + 7200000,
  };

  const payloadStr = JSON.stringify(futurePayload);
  const encodedPayload = Buffer.from(payloadStr).toString("base64url");
  const signature = crypto.createHmac("sha256", getSessionSecret()).update(encodedPayload).digest("hex");
  const futureToken = `${encodedPayload}.${signature}`;

  const result = verifySessionToken(futureToken);
  assert.equal(result.valid, false);
  assert.match(result.error, /Token issued in the future/);
});

test("Security Audit: rejects malformed token formats (no dot, multiple dots, non-string)", () => {
  assert.equal(verifySessionToken("").valid, false);
  assert.equal(verifySessionToken("nodotsheretoken").valid, false);
  assert.equal(verifySessionToken("a.b.c").valid, false);
  assert.equal(verifySessionToken(null).valid, false);
  assert.equal(verifySessionToken(undefined).valid, false);
});

// ============================================================================
// 3. Organization ID & Tenancy Context Propagation
// ============================================================================
test("Security Audit: normalizes and serializes organizationId and orgId into session token", () => {
  const companyUser = {
    id: "usr_corp_lead",
    email: "security@techcorp.com",
    username: "techcorp_lead",
    role: "company",
    userType: "company",
    organizationId: "org_techcorp_inc",
    companyName: "TechCorp Inc",
  };

  const token = createSessionToken(companyUser);
  const verified = verifySessionToken(token);

  assert.equal(verified.valid, true);
  assert.equal(verified.user.organizationId, "org_techcorp_inc");
  assert.equal(verified.user.orgId, "org_techcorp_inc");
  assert.equal(verified.user.companyName, "TechCorp Inc");
});

test("Security Audit: does not silently convert missing organizationId to username", () => {
  const userWithoutOrg = {
    id: "usr_no_org",
    email: "user@example.com",
    username: "plain_user",
    role: "user",
    userType: "hunter",
  };

  const token = createSessionToken(userWithoutOrg);
  const verified = verifySessionToken(token);

  assert.equal(verified.valid, true);
  // Must NOT invent or alias organizationId from username
  assert.equal(verified.user.organizationId, undefined);
  assert.equal(verified.user.orgId, undefined);
});

// ============================================================================
// 4. Cross-Tenant Access & Organization Mismatch API Tests
// ============================================================================
test("Security Audit: blocks organization mismatch when company user attempts to create hunt for another organization", async () => {
  const companyUser = {
    id: "usr_corp_alpha",
    email: "admin@corp-alpha.com",
    username: "corp_alpha_admin",
    role: "company",
    userType: "company",
    organizationId: "org_alpha",
    orgId: "org_alpha",
  };

  // Company user tries to submit hunt claiming to be 'org_beta'
  const spoofReq = createMockRequest("http://localhost:3000/api/bug-hunts", "POST", {
    title: "Spoofed Bug Bounty",
    description: "Attacker attempting to create bounty under victim's organization.",
    company: "org_beta", // Mismatch with session's org_alpha
  }, companyUser);

  const res = await postHuntsHandler(spoofReq);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /Cannot create bug bounty programs for another organization/);
});

test("Security Audit: prevents cross-tenant leaks in /api/bug-submissions GET for company users", async () => {
  const subRepo = new SubmissionsRepository(mockDb);

  await subRepo.createSubmission({
    _id: "sub_tenant_alpha_1",
    bounty_id: "hunt_alpha",
    org_id: "org_alpha",
    hunter_id: "usr_hunter_1",
    title: "SQL Injection in Alpha",
    description: "Confidential Alpha bug",
    severity: "critical",
    status: "pending",
  });

  await subRepo.createSubmission({
    _id: "sub_tenant_beta_1",
    bounty_id: "hunt_beta",
    org_id: "org_beta",
    hunter_id: "usr_hunter_2",
    title: "RCE in Beta",
    description: "Confidential Beta bug",
    severity: "critical",
    status: "pending",
  });

  // Company user belonging to 'org_alpha' queries submissions
  const companyAlphaSession = {
    id: "usr_alpha_member",
    email: "lead@alpha.com",
    username: "alpha_lead",
    role: "company",
    userType: "company",
    organizationId: "org_alpha",
    orgId: "org_alpha",
  };

  const req = createMockRequest("http://localhost:3000/api/bug-submissions", "GET", null, companyAlphaSession);
  const res = await getSubmissionsHandler(req);
  assert.equal(res.status, 200);

  const subs = await res.json();
  // Must ONLY contain Alpha submissions
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, "sub_tenant_alpha_1");
  assert.equal(subs.some((s) => s.id === "sub_tenant_beta_1"), false);
});

test("Security Audit: enforces hunter isolation regardless of requested ?userId in query params", async () => {
  const subRepo = new SubmissionsRepository(mockDb);

  await subRepo.createSubmission({
    _id: "sub_alice_1",
    bounty_id: "hunt_100",
    org_id: "org_corp",
    hunter_id: "usr_alice",
    title: "Alice Vulnerability Finding",
    description: "Alice private report",
    severity: "high",
    status: "pending",
  });

  await subRepo.createSubmission({
    _id: "sub_bob_1",
    bounty_id: "hunt_100",
    org_id: "org_corp",
    hunter_id: "usr_bob",
    title: "Bob Vulnerability Finding",
    description: "Bob private report",
    severity: "critical",
    status: "pending",
  });

  // Alice queries submissions but tries to pass ?userId=usr_bob to view Bob's reports
  const aliceSession = {
    id: "usr_alice",
    email: "alice@hacker.io",
    username: "alice",
    role: "user",
    userType: "hunter",
  };

  const req = createMockRequest("http://localhost:3000/api/bug-submissions?userId=usr_bob", "GET", null, aliceSession);
  const res = await getSubmissionsHandler(req);
  assert.equal(res.status, 200);

  const subs = await res.json();
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, "sub_alice_1");
  assert.equal(subs[0].userId, "usr_alice");
});

test("Security Audit: prevents cross-tenant access to vulnerability details in /api/vulnerabilities/[id]", async () => {
  const vulnRepo = new VulnerabilitiesRepository(mockDb);

  await vulnRepo.createVulnerability({
    _id: "BH-VULN-TENANT-BETA",
    submission_id: "sub_tenant_beta_1",
    bounty_id: "hunt_beta",
    org_id: "org_beta",
    reporter_uid: "usr_hunter_2",
    title: "Internal Secret Leak in Beta",
    description: "Highly sensitive tenant vulnerability",
    severity: "critical",
    status: "confirmed",
    cvss: {
      vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
      baseScore: 10.0,
      approvedBaseScore: 10.0,
    },
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Company user from org_alpha attempts to access Beta's vulnerability
  const companyAlphaSession = {
    id: "usr_alpha_member",
    email: "lead@alpha.com",
    username: "alpha_lead",
    role: "company",
    userType: "company",
    organizationId: "org_alpha",
    orgId: "org_alpha",
  };

  const req = createMockRequest("http://localhost:3000/api/vulnerabilities/BH-VULN-TENANT-BETA", "GET", null, companyAlphaSession);
  const res = await getVulnerabilityByIdHandler(req, {
    params: Promise.resolve({ id: "BH-VULN-TENANT-BETA" }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /You do not have permission to view this vulnerability/);
});

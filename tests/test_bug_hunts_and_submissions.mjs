import test from "node:test";
import assert from "node:assert/strict";
import { HuntsRepository } from "../lib/db/repositories/hunts.repo";
import { SubmissionsRepository } from "../lib/db/repositories/submissions.repo";
import { GET as getHuntsHandler, POST as postHuntsHandler } from "../app/api/bug-hunts/route";
import {
  GET as getHuntByIdHandler,
  PATCH as patchHuntByIdHandler,
  DELETE as deleteHuntByIdHandler,
} from "../app/api/bug-hunts/[id]/route";
import { GET as getSubmissionsHandler, POST as postSubmissionsHandler } from "../app/api/bug-submissions/route";
import {
  GET as getSubmissionByIdHandler,
  PATCH as patchSubmissionByIdHandler,
  DELETE as deleteSubmissionByIdHandler,
} from "../app/api/bug-submissions/[id]/route";
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
              } else if (v && typeof v === "object" && "$regex" in v) {
                if (!v.$regex.test(doc[k])) { match = false; break; }
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

        async updateOne(filter, update) {
          let targetKey = null;
          let targetDoc = null;
          for (const [key, doc] of colMap.entries()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) { match = false; break; }
            }
            if (match) {
              targetKey = key;
              targetDoc = doc;
              break;
            }
          }

          if (!targetDoc) return { matchedCount: 0, modifiedCount: 0 };

          if (update.$set) {
            Object.assign(targetDoc, update.$set);
          }
          colMap.set(targetKey, targetDoc);
          return { matchedCount: 1, modifiedCount: 1 };
        },

        async deleteOne(filter) {
          for (const [key, doc] of colMap.entries()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) { match = false; break; }
            }
            if (match) {
              colMap.delete(key);
              return { deletedCount: 1 };
            }
          }
          return { deletedCount: 0 };
        },

        async deleteMany(filter) {
          let count = 0;
          for (const [key, doc] of Array.from(colMap.entries())) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) { match = false; break; }
            }
            if (match) {
              colMap.delete(key);
              count++;
            }
          }
          return { deletedCount: count };
        },
      };
    },
  };
}

function createMockRequest(url, method, body = null, sessionUser = null) {
  const headers = new Headers();
  if (sessionUser) {
    const token = createSessionToken(
      { email: sessionUser.email || `${sessionUser.username || sessionUser.id}@example.com`, ...sessionUser },
      TEST_SECRET,
      3600
    );
    headers.set("cookie", `bughuntr_session=${token}`);
  }
  if (body) {
    headers.set("content-type", "application/json");
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

// Set up hermetic mock database for routes
const mockDb = createMockDb();
globalThis._mongoClientPromise = Promise.resolve({
  db() {
    return mockDb;
  },
});

// ==========================================
// 1. HuntsRepository Unit Tests
// ==========================================
test("HuntsRepository: CRUD, listing, and query methods", async () => {
  const repo = new HuntsRepository(mockDb);

  const hunt = await repo.createHunt({
    _id: "hunt_repo_1",
    org_id: "org_acme",
    title: "Acme Web Security",
    description: "Hunt for vulnerabilities in Acme web portal",
    target_scope: ["*.acme.com"],
    categories: ["Web"],
    difficulty: "medium",
    status: "active",
    createdBy: "usr_acme_admin",
    rewards: { critical: 2000, high: 1000, medium: 500, low: 100 },
  });

  assert.equal(hunt._id, "hunt_repo_1");
  assert.equal(hunt.title, "Acme Web Security");

  // listAll
  const allHunts = await repo.listAll();
  assert.equal(allHunts.length >= 1, true);

  // updateHunt
  const updated = await repo.updateHunt("hunt_repo_1", {
    title: "Acme Updated Security Bounty",
    status: "paused",
  });
  assert.equal(updated, true);

  const fetched = await repo.getById("hunt_repo_1");
  assert.equal(fetched.title, "Acme Updated Security Bounty");
  assert.equal(fetched.status, "paused");

  // deleteHunt
  const deleted = await repo.deleteHunt("hunt_repo_1");
  assert.equal(deleted, true);

  const notFound = await repo.getById("hunt_repo_1");
  assert.equal(notFound, null);
});

// ==========================================
// 2. SubmissionsRepository Unit Tests
// ==========================================
test("SubmissionsRepository: CRUD, tenancy isolation, and duplicate check", async () => {
  const repo = new SubmissionsRepository(mockDb);

  const sub1 = await repo.createSubmission({
    _id: "sub_repo_1",
    bounty_id: "hunt_acme_99",
    org_id: "org_acme",
    hunter_id: "usr_hunter_alice",
    title: "SQL Injection in Search Query",
    description: "Unsanitized query in search allows blind SQL injection.",
    severity: "critical",
    status: "pending",
  });

  assert.equal(sub1._id, "sub_repo_1");
  assert.equal(sub1.hunter_id, "usr_hunter_alice");

  // Hunter Isolation: Alice can view her submission
  const aliceSubs = await repo.listByHunter("usr_hunter_alice");
  assert.equal(aliceSubs.length, 1);
  assert.equal(aliceSubs[0]._id, "sub_repo_1");

  // Hunter Isolation: Bob sees 0
  const bobSubs = await repo.listByHunter("usr_hunter_bob");
  assert.equal(bobSubs.length, 0);

  // Organization Isolation: org_acme sees submission
  const acmeSubs = await repo.listByOrg("org_acme");
  assert.equal(acmeSubs.length, 1);

  // listByHunt
  const huntSubs = await repo.listByHunt("hunt_acme_99");
  assert.equal(huntSubs.length, 1);

  // findDuplicate
  const duplicate = await repo.findDuplicate({
    title: "SQL Injection in Search Query",
    orgId: "org_acme",
  });
  assert.notEqual(duplicate, null);
  assert.equal(duplicate._id, "sub_repo_1");

  const nonDuplicate = await repo.findDuplicate({
    title: "Different XSS Bug",
    orgId: "org_acme",
  });
  assert.equal(nonDuplicate, null);

  // updateStatus
  const statusUpdated = await repo.updateStatus("sub_repo_1", "approved", "usr_staff_triager", "Valid critical finding");
  assert.equal(statusUpdated, true);

  const updatedSub = await repo.getById("sub_repo_1");
  assert.equal(updatedSub.status, "approved");
  assert.equal(updatedSub.admin_notes, "Valid critical finding");

  // deleteSubmission
  const subDeleted = await repo.deleteSubmission("sub_repo_1");
  assert.equal(subDeleted, true);
  assert.equal(await repo.getById("sub_repo_1"), null);
});

// ==========================================
// 3. /api/bug-hunts API Route Tests
// ==========================================
test("/api/bug-hunts GET & POST: authorization, role permissions, and validation", async () => {
  // Public GET listing
  const getReq = createMockRequest("http://localhost:3000/api/bug-hunts", "GET");
  const getRes = await getHuntsHandler(getReq);
  assert.equal(getRes.status, 200);

  // POST without auth -> 401
  const unauthPostReq = createMockRequest("http://localhost:3000/api/bug-hunts", "POST", {
    title: "Test Bounty",
  });
  const unauthPostRes = await postHuntsHandler(unauthPostReq);
  assert.equal(unauthPostRes.status, 401);

  // POST by hunter -> 403 Forbidden
  const hunterSession = { id: "usr_hunter_1", role: "user", userType: "hunter", username: "alice" };
  const hunterPostReq = createMockRequest("http://localhost:3000/api/bug-hunts", "POST", {
    title: "Hunter Cannot Create Hunt",
  }, hunterSession);
  const hunterPostRes = await postHuntsHandler(hunterPostReq);
  assert.equal(hunterPostRes.status, 403);

  // POST by company -> 201 Created
  const companySession = { id: "usr_company_1", role: "company", userType: "company", username: "target_corp" };
  const companyPostReq = createMockRequest("http://localhost:3000/api/bug-hunts", "POST", {
    title: "Target Corp Web Bounty",
    description: "Official Target Corp bug bounty program.",
    difficulty: "medium",
    categories: ["Web", "API"],
    rewards: { critical: 3000, high: 1500, medium: 750, low: 200 },
  }, companySession);
  const companyPostRes = await postHuntsHandler(companyPostReq);
  assert.equal(companyPostRes.status, 201);
  const createdHunt = await companyPostRes.json();
  assert.equal(createdHunt.title, "Target Corp Web Bounty");
  assert.equal(createdHunt.company, "target_corp");

  // GET by ID
  const getByIdReq = createMockRequest(`http://localhost:3000/api/bug-hunts/${createdHunt.id}`, "GET");
  const getByIdRes = await getHuntByIdHandler(getByIdReq, { params: Promise.resolve({ id: createdHunt.id }) });
  assert.equal(getByIdRes.status, 200);

  // PATCH by owner company
  const patchReq = createMockRequest(`http://localhost:3000/api/bug-hunts/${createdHunt.id}`, "PATCH", {
    title: "Updated Target Corp Bounty",
  }, companySession);
  const patchRes = await patchHuntByIdHandler(patchReq, { params: Promise.resolve({ id: createdHunt.id }) });
  assert.equal(patchRes.status, 200);

  // PATCH by unauthorized company -> 403
  const otherCompanySession = { id: "usr_company_2", role: "company", userType: "company", username: "other_corp" };
  const unauthorizedPatchReq = createMockRequest(`http://localhost:3000/api/bug-hunts/${createdHunt.id}`, "PATCH", {
    title: "Hijacked Title",
  }, otherCompanySession);
  const unauthorizedPatchRes = await patchHuntByIdHandler(unauthorizedPatchReq, { params: Promise.resolve({ id: createdHunt.id }) });
  assert.equal(unauthorizedPatchRes.status, 403);

  // DELETE by owner company
  const deleteReq = createMockRequest(`http://localhost:3000/api/bug-hunts/${createdHunt.id}`, "DELETE", null, companySession);
  const deleteRes = await deleteHuntByIdHandler(deleteReq, { params: Promise.resolve({ id: createdHunt.id }) });
  assert.equal(deleteRes.status, 200);
});

// ==========================================
// 4. /api/bug-submissions API Route Tests
// ==========================================
test("/api/bug-submissions GET & POST: tenancy isolation, stable hunter_id binding, and duplicate prevention", async () => {
  const hunter1Session = { id: "usr_stable_hunter_1", role: "user", userType: "hunter", username: "hunter_one" };
  const hunter2Session = { id: "usr_stable_hunter_2", role: "user", userType: "hunter", username: "hunter_two" };
  const companySession = { id: "usr_corp_owner", role: "company", userType: "company", username: "cyber_corp" };
  const adminSession = { id: "usr_sys_admin", role: "admin", userType: "company", username: "admin_guy" };

  // POST without auth -> 401
  const unauthPostReq = createMockRequest("http://localhost:3000/api/bug-submissions", "POST", { title: "XSS" });
  assert.equal((await postSubmissionsHandler(unauthPostReq)).status, 401);

  // POST missing description -> 400
  const invalidPostReq = createMockRequest("http://localhost:3000/api/bug-submissions", "POST", {
    title: "Broken Auth",
  }, hunter1Session);
  assert.equal((await postSubmissionsHandler(invalidPostReq)).status, 400);

  // POST valid submission by hunter 1
  const validPostReq1 = createMockRequest("http://localhost:3000/api/bug-submissions", "POST", {
    title: "IDOR in User Profile Endpoint",
    description: "Accessing /api/user?id=123 returns sensitive data without authorization check.",
    severity: "high",
    category: "Broken Access Control",
    company: "cyber_corp",
  }, hunter1Session);
  const validPostRes1 = await postSubmissionsHandler(validPostReq1);
  assert.equal(validPostRes1.status, 201);
  const sub1 = await validPostRes1.json();
  assert.equal(sub1.title, "IDOR in User Profile Endpoint");
  assert.equal(sub1.userId, "usr_stable_hunter_1"); // Bound strictly to session user ID!

  // Duplicate Submission: Same title for cyber_corp -> 409 Conflict
  const dupPostReq = createMockRequest("http://localhost:3000/api/bug-submissions", "POST", {
    title: "IDOR in User Profile Endpoint",
    description: "Another submission of the exact same bug.",
    company: "cyber_corp",
  }, hunter2Session);
  const dupPostRes = await dupPostReq && await postSubmissionsHandler(dupPostReq);
  assert.equal(dupPostRes.status, 409);
  const dupData = await dupPostRes.json();
  assert.match(dupData.error, /already be reported/);

  // Duplicate Check Query in GET
  const checkDupReq = createMockRequest(
    `http://localhost:3000/api/bug-submissions?checkTitle=${encodeURIComponent("IDOR in User Profile Endpoint")}&company=cyber_corp`,
    "GET",
    null,
    hunter1Session
  );
  const checkDupRes = await getSubmissionsHandler(checkDupReq);
  assert.equal(checkDupRes.status, 200);
  const checkDupData = await checkDupRes.json();
  assert.equal(checkDupData.duplicate, true);

  // Hunter Isolation: Hunter 2 queries submissions -> should get 0 submissions (cannot see Hunter 1's bugs!)
  const hunter2GetReq = createMockRequest(
    `http://localhost:3000/api/bug-submissions?userId=usr_stable_hunter_1`, // Malicious attempt to read hunter 1's bugs
    "GET",
    null,
    hunter2Session
  );
  const hunter2GetRes = await getSubmissionsHandler(hunter2GetReq);
  assert.equal(hunter2GetRes.status, 200);
  const hunter2Subs = await hunter2GetRes.json();
  assert.equal(hunter2Subs.length, 0); // Strict isolation enforced!

  // Hunter 1 queries submissions -> sees 1 submission
  const hunter1GetReq = createMockRequest("http://localhost:3000/api/bug-submissions", "GET", null, hunter1Session);
  const hunter1Subs = await (await getSubmissionsHandler(hunter1GetReq)).json();
  assert.equal(hunter1Subs.length, 1);
  assert.equal(hunter1Subs[0].id, sub1.id);

  // Organization Isolation: cyber_corp sees the submission
  const corpGetReq = createMockRequest("http://localhost:3000/api/bug-submissions", "GET", null, companySession);
  const corpSubs = await (await getSubmissionsHandler(corpGetReq)).json();
  assert.equal(corpSubs.length, 1);

  // Admin access: sees all submissions
  const adminGetReq = createMockRequest("http://localhost:3000/api/bug-submissions", "GET", null, adminSession);
  const adminSubs = await (await getSubmissionsHandler(adminGetReq)).json();
  assert.equal(adminSubs.length >= 1, true);

  // GET /api/bug-submissions/[id] Access Control
  // Hunter 2 trying to read Hunter 1's submission -> 403 Forbidden
  const hunter2ReadReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${sub1.id}`, "GET", null, hunter2Session);
  const hunter2ReadRes = await getSubmissionByIdHandler(hunter2ReadReq, { params: Promise.resolve({ id: sub1.id }) });
  assert.equal(hunter2ReadRes.status, 403);

  // Hunter 1 reading own submission -> 200 OK
  const hunter1ReadReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${sub1.id}`, "GET", null, hunter1Session);
  assert.equal((await getSubmissionByIdHandler(hunter1ReadReq, { params: Promise.resolve({ id: sub1.id }) })).status, 200);

  // PATCH /api/bug-submissions/[id] Status Update
  // Hunter 1 trying to approve own bug -> 403 Forbidden
  const hunterPatchReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${sub1.id}`, "PATCH", { status: "approved" }, hunter1Session);
  assert.equal((await patchSubmissionByIdHandler(hunterPatchReq, { params: Promise.resolve({ id: sub1.id }) })).status, 403);

  // Admin updating status -> 200 OK
  const adminPatchReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${sub1.id}`, "PATCH", {
    status: "approved",
    adminNotes: "Critical vulnerability verified and accepted.",
  }, adminSession);
  const adminPatchRes = await patchSubmissionByIdHandler(adminPatchReq, { params: Promise.resolve({ id: sub1.id }) });
  assert.equal(adminPatchRes.status, 200);

  // DELETE /api/bug-submissions/[id]
  // Hunter cannot delete once approved -> 403 Forbidden
  const hunterDelReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${sub1.id}`, "DELETE", null, hunter1Session);
  assert.equal((await deleteSubmissionByIdHandler(hunterDelReq, { params: Promise.resolve({ id: sub1.id }) })).status, 403);

  // Admin delete -> 200 OK
  const adminDelReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${sub1.id}`, "DELETE", null, adminSession);
  assert.equal((await deleteSubmissionByIdHandler(adminDelReq, { params: Promise.resolve({ id: sub1.id }) })).status, 200);
});

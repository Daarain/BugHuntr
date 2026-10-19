import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ProRepository } from "../lib/db/repositories/pro.repo";
import { GET as getProHuntsHandler, POST as postProHuntsHandler, PATCH as patchProHuntsHandler } from "../app/api/pro/hunts/route";
import { GET as getProInvitationsHandler, POST as postProInvitationsHandler } from "../app/api/pro/invitations/route";
import { GET as getProInvitationByIdHandler, PATCH as patchProInvitationByIdHandler } from "../app/api/pro/invitations/[id]/route";
import { createSessionToken } from "../lib/server-auth";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.SESSION_SECRET = TEST_SECRET;
process.env.INTERNAL_API_SECRET = TEST_SECRET;
process.env.NODE_ENV = "test";

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
              } else if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) return JSON.parse(JSON.stringify(doc));
          }
          return null;
        },

        find(filter = {}) {
          let docs = Array.from(colMap.values());
          if (filter.$or && Array.isArray(filter.$or)) {
            docs = docs.filter((doc) => {
              return filter.$or.some((clause) => {
                return Object.entries(clause).every(([k, v]) => doc[k] === v);
              });
            });
          } else {
            docs = docs.filter((doc) => {
              return Object.entries(filter).every(([k, v]) => {
                if (v && typeof v === "object" && "$in" in v) {
                  return v.$in.includes(doc[k]);
                }
                return doc[k] === v;
              });
            });
          }

          return {
            sort(sortCriteria) {
              const [field, dir] = Object.entries(sortCriteria)[0] || ["_id", 1];
              docs.sort((a, b) => {
                const valA = a[field] instanceof Date ? a[field].getTime() : a[field];
                const valB = b[field] instanceof Date ? b[field].getTime() : b[field];
                return dir === -1 ? (valB > valA ? 1 : -1) : (valA > valB ? 1 : -1);
              });
              return this;
            },
            limit(count) {
              docs = docs.slice(0, count);
              return this;
            },
            async toArray() {
              return JSON.parse(JSON.stringify(docs));
            },
          };
        },

        async insertOne(doc) {
          const docCopy = JSON.parse(JSON.stringify(doc));
          if (!docCopy._id) docCopy._id = `mock_${Date.now()}_${Math.random()}`;
          colMap.set(docCopy._id, docCopy);
          return { acknowledged: true, insertedId: docCopy._id };
        },

        async updateOne(filter, update, options = {}) {
          let target = null;
          for (const doc of colMap.values()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) { match = false; break; }
            }
            if (match) { target = doc; break; }
          }

          if (!target && options.upsert) {
            target = { ...filter, ...update.$set };
            colMap.set(target._id || `upsert_${Date.now()}`, target);
            return { matchedCount: 0, upsertedCount: 1 };
          }

          if (!target) return { matchedCount: 0, modifiedCount: 0 };

          if (update.$set) {
            Object.assign(target, JSON.parse(JSON.stringify(update.$set)));
          }
          if (update.$inc) {
            for (const [k, incVal] of Object.entries(update.$inc)) {
              target[k] = (target[k] || 0) + incVal;
            }
          }
          return { matchedCount: 1, modifiedCount: 1 };
        },

        async deleteOne(filter) {
          for (const [id, doc] of colMap.entries()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) { match = false; break; }
            }
            if (match) {
              colMap.delete(id);
              return { deletedCount: 1 };
            }
          }
          return { deletedCount: 0 };
        },
      };
    },
  };
}

let mockDb;
const originalMongoClientPromise = globalThis._mongoClientPromise;

test.beforeEach(() => {
  mockDb = createMockDb();
  globalThis._mongoClientPromise = Promise.resolve({
    db: () => mockDb,
    close: async () => {},
  });
});

test.after(() => {
  globalThis._mongoClientPromise = originalMongoClientPromise;
});

function createReq(url, method = "GET", body = null, sessionUser = null) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (sessionUser) {
    const token = createSessionToken(sessionUser);
    headers.set("cookie", `bughuntr_session=${token}`);
  }
  const init = { method, headers };
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

// ============================================================================
// 1. REPOSITORY TESTS
// ============================================================================

test("ProRepository: CRUD for pro_hunts", async () => {
  const repo = new ProRepository(mockDb);

  const hunt = await repo.createHunt({
    _id: "prohunt_test_001",
    companyId: "org_acme",
    companyName: "Acme Corp",
    title: "Zero Day Hunt",
    description: "Private zero-day program",
    rewards: { critical: 5000, high: 2000, medium: 1000, low: 200 },
    status: "active",
    createdBy: "usr_acme_owner",
    created_at: new Date(),
    updated_at: new Date(),
  });

  assert.equal(hunt._id, "prohunt_test_001");
  assert.equal(hunt.currentHunters, 0);

  const fetched = await repo.getHuntById("prohunt_test_001");
  assert.ok(fetched);
  assert.equal(fetched.title, "Zero Day Hunt");

  await repo.incrementHuntHunters("prohunt_test_001", 1);
  const incremented = await repo.getHuntById("prohunt_test_001");
  assert.equal(incremented.currentHunters, 1);

  await repo.updateHunt("prohunt_test_001", { title: "Updated Zero Day Hunt" });
  const updated = await repo.getHuntById("prohunt_test_001");
  assert.equal(updated.title, "Updated Zero Day Hunt");

  const deleted = await repo.deleteHunt("prohunt_test_001");
  assert.equal(deleted, true);
  const afterDelete = await repo.getHuntById("prohunt_test_001");
  assert.equal(afterDelete, null);
});

test("ProRepository: CRUD and status transitions for pro_invitations", async () => {
  const repo = new ProRepository(mockDb);

  const inv = await repo.createInvitation({
    _id: "inv_001",
    hunt_id: "prohunt_001",
    hunt_title: "Private Target Alpha",
    company_name: "Acme Corp",
    sender_id: "usr_acme_admin",
    hunter_id: "usr_hunter_bob",
    hunter_name: "Bob",
    hunter_username: "bob_hacks",
    token: "token_abc_123",
    status: "pending",
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86400000),
  });

  assert.equal(inv._id, "inv_001");
  assert.equal(inv.status, "pending");

  const byToken = await repo.getInvitationByToken("token_abc_123");
  assert.ok(byToken);
  assert.equal(byToken._id, "inv_001");

  const byId = await repo.getInvitationById("inv_001");
  assert.ok(byId);
  assert.equal(byId.hunter_username, "bob_hacks");

  const hunterList = await repo.listInvitations({ hunterId: "usr_hunter_bob" });
  assert.equal(hunterList.length, 1);

  const huntList = await repo.listInvitations({ huntId: "prohunt_001", status: "pending" });
  assert.equal(huntList.length, 1);

  await repo.updateInvitationStatus("inv_001", "accepted");
  const accepted = await repo.getInvitationById("inv_001");
  assert.equal(accepted.status, "accepted");
  assert.ok(accepted.responded_at);
});

// ============================================================================
// 2. PRO HUNTS API ROUTE TESTS
// ============================================================================

test("GET /api/pro/hunts: returns active pro hunts merging mock data", async () => {
  const repo = new ProRepository(mockDb);
  await repo.createHunt({
    _id: "prohunt_persisted_1",
    companyId: "org_acme",
    companyName: "Acme Corp",
    title: "Persisted Active Hunt",
    description: "Database backed hunt",
    rewards: { critical: 2000, high: 1000, medium: 500, low: 100 },
    status: "active",
    createdBy: "usr_acme_owner",
    created_at: new Date(),
    updated_at: new Date(),
  });

  const req = createReq("http://localhost/api/pro/hunts");
  const res = await getProHuntsHandler(req);
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(Array.isArray(data.hunts));
  const foundPersisted = data.hunts.find((h) => h.id === "prohunt_persisted_1");
  assert.ok(foundPersisted);
  assert.equal(foundPersisted.title, "Persisted Active Hunt");
});

test("POST /api/pro/hunts: creates pro hunt when authenticated as company or admin", async () => {
  const companyUser = {
    id: "usr_acme_owner",
    username: "acme_lead",
    email: "lead@acme.com",
    role: "user",
    userType: "company",
    orgId: "org_acme",
    companyName: "Acme Security",
  };

  const payload = {
    title: "Cloud Infrastructure Audit",
    description: "Private audit of AWS production endpoints",
    rewards: { critical: 10000, high: 5000, medium: 2000, low: 500 },
    allowedTargetSegments: ["*.acme.internal"],
  };

  const req = createReq("http://localhost/api/pro/hunts", "POST", payload, companyUser);
  const res = await postProHuntsHandler(req);
  assert.equal(res.status, 201);

  const data = await res.json();
  assert.ok(data.hunt);
  assert.equal(data.hunt.title, "Cloud Infrastructure Audit");
  assert.equal(data.hunt.companyId, "org_acme");
  assert.equal(data.hunt.createdBy, "usr_acme_owner");
});

test("POST /api/pro/hunts: rejects unauthenticated or researcher accounts with 401 / 403", async () => {
  const payload = { title: "Hacked Hunt", description: "Not allowed" };

  // 1. Unauthenticated
  const anonReq = createReq("http://localhost/api/pro/hunts", "POST", payload);
  const anonRes = await postProHuntsHandler(anonReq);
  assert.equal(anonRes.status, 401);

  // 2. Researcher
  const hunterUser = {
    id: "usr_hunter_1",
    username: "hunter_alice",
    email: "alice@example.com",
    role: "user",
    userType: "hunter",
  };
  const hunterReq = createReq("http://localhost/api/pro/hunts", "POST", payload, hunterUser);
  const hunterRes = await postProHuntsHandler(hunterReq);
  assert.equal(hunterRes.status, 403);
});

// ============================================================================
// 3. PRO INVITATIONS API ROUTE TESTS
// ============================================================================

test("POST /api/pro/invitations: allows company to issue invitation and blocks duplicates", async () => {
  const companyUser = {
    id: "usr_acme_owner",
    username: "acme_lead",
    email: "lead@acme.com",
    role: "user",
    userType: "company",
    orgId: "org_acme",
  };

  const invitePayload = {
    huntId: "prohunt_1",
    huntTitle: "Payment Gateway Assessment",
    companyName: "TechCorp Security",
    hunterId: "usr_hunter_99",
    hunterName: "Charlie",
    hunterUsername: "charlie_researcher",
  };

  // 1. Issue invitation
  const req1 = createReq("http://localhost/api/pro/invitations", "POST", invitePayload, companyUser);
  const res1 = await postProInvitationsHandler(req1);
  assert.equal(res1.status, 201);

  const data1 = await res1.json();
  assert.ok(data1.invitation);
  assert.equal(data1.invitation.hunterId, "usr_hunter_99");
  assert.equal(data1.invitation.status, "pending");
  assert.equal(data1.invitation.invitedBy, "acme_lead");

  // 2. Duplicate attempt returns 409 Conflict
  const req2 = createReq("http://localhost/api/pro/invitations", "POST", invitePayload, companyUser);
  const res2 = await postProInvitationsHandler(req2);
  assert.equal(res2.status, 409);
});

test("GET /api/pro/invitations: isolates researcher visibility to only their invitations", async () => {
  const repo = new ProRepository(mockDb);

  // Invitation for Alice
  await repo.createInvitation({
    _id: "inv_alice",
    hunt_id: "prohunt_1",
    sender_id: "usr_company_1",
    hunter_id: "usr_alice",
    hunter_username: "alice",
    status: "pending",
    token: "token_alice",
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86400000),
  });

  // Invitation for Bob
  await repo.createInvitation({
    _id: "inv_bob",
    hunt_id: "prohunt_1",
    sender_id: "usr_company_1",
    hunter_id: "usr_bob",
    hunter_username: "bob",
    status: "pending",
    token: "token_bob",
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86400000),
  });

  const aliceUser = {
    id: "usr_alice",
    username: "alice",
    email: "alice@example.com",
    role: "user",
    userType: "hunter",
  };

  // Alice queries invitations
  const req = createReq("http://localhost/api/pro/invitations", "GET", null, aliceUser);
  const res = await getProInvitationsHandler(req);
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.invitations.length, 1);
  assert.equal(data.invitations[0].id, "inv_alice");
  assert.equal(data.invitations[0].hunterId, "usr_alice");
});

test("PATCH /api/pro/invitations/[id]: accepting invitation increments hunt currentHunters", async () => {
  const repo = new ProRepository(mockDb);

  await repo.createHunt({
    _id: "prohunt_target_1",
    companyId: "org_corp",
    companyName: "Corp",
    title: "Corp Target",
    description: "Testing",
    rewards: { critical: 1000, high: 500, medium: 200, low: 50 },
    currentHunters: 0,
    status: "active",
    createdBy: "usr_corp_lead",
    created_at: new Date(),
    updated_at: new Date(),
  });

  await repo.createInvitation({
    _id: "inv_charlie",
    hunt_id: "prohunt_target_1",
    sender_id: "usr_corp_lead",
    hunter_id: "usr_charlie",
    hunter_username: "charlie",
    status: "pending",
    token: "token_charlie",
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86400000),
  });

  const charlieUser = {
    id: "usr_charlie",
    username: "charlie",
    email: "charlie@test.com",
    role: "user",
    userType: "hunter",
  };

  // Charlie accepts invitation
  const patchReq = createReq(
    "http://localhost/api/pro/invitations/inv_charlie",
    "PATCH",
    { status: "accepted" },
    charlieUser
  );

  const patchRes = await patchProInvitationByIdHandler(patchReq, {
    params: Promise.resolve({ id: "inv_charlie" }),
  });

  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.equal(patchData.success, true);
  assert.equal(patchData.invitation.status, "accepted");

  // Verify hunt participant count increased
  const huntAfter = await repo.getHuntById("prohunt_target_1");
  assert.equal(huntAfter.currentHunters, 1);
});

test("PATCH /api/pro/invitations/[id]: blocks unauthorized researchers from accepting others' invitations", async () => {
  const repo = new ProRepository(mockDb);

  await repo.createInvitation({
    _id: "inv_secret",
    hunt_id: "prohunt_secret",
    sender_id: "usr_corp_lead",
    hunter_id: "usr_vip_hunter",
    hunter_username: "vip_hunter",
    status: "pending",
    token: "token_vip",
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86400000),
  });

  const attackerUser = {
    id: "usr_attacker",
    username: "attacker",
    email: "attacker@test.com",
    role: "user",
    userType: "hunter",
  };

  const patchReq = createReq(
    "http://localhost/api/pro/invitations/inv_secret",
    "PATCH",
    { status: "accepted" },
    attackerUser
  );

  const patchRes = await patchProInvitationByIdHandler(patchReq, {
    params: Promise.resolve({ id: "inv_secret" }),
  });

  assert.equal(patchRes.status, 403);
});

test("PATCH /api/pro/invitations/[id]: duplicate acceptance cannot double-increment currentHunters", async () => {
  const repo = new ProRepository(mockDb);

  await repo.createHunt({
    _id: "prohunt_race_1",
    companyId: "org_corp",
    companyName: "Corp",
    title: "Race Test Hunt",
    description: "Testing concurrency",
    rewards: { critical: 1000, high: 500, medium: 200, low: 50 },
    currentHunters: 0,
    status: "active",
    createdBy: "usr_corp_lead",
    created_at: new Date(),
    updated_at: new Date(),
  });

  await repo.createInvitation({
    _id: "inv_race_1",
    hunt_id: "prohunt_race_1",
    sender_id: "usr_corp_lead",
    hunter_id: "usr_racer",
    hunter_username: "racer",
    status: "pending",
    token: "token_race",
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86400000),
  });

  const racerUser = {
    id: "usr_racer",
    username: "racer",
    email: "racer@test.com",
    role: "user",
    userType: "hunter",
  };

  // First acceptance request
  const patchReq1 = createReq(
    "http://localhost/api/pro/invitations/inv_race_1",
    "PATCH",
    { status: "accepted" },
    racerUser
  );
  const patchRes1 = await patchProInvitationByIdHandler(patchReq1, {
    params: Promise.resolve({ id: "inv_race_1" }),
  });
  assert.equal(patchRes1.status, 200);

  // Hunt hunters incremented to 1
  let hunt = await repo.getHuntById("prohunt_race_1");
  assert.equal(hunt.currentHunters, 1);

  // Duplicate / concurrent second acceptance request
  const patchReq2 = createReq(
    "http://localhost/api/pro/invitations/inv_race_1",
    "PATCH",
    { status: "accepted" },
    racerUser
  );
  const patchRes2 = await patchProInvitationByIdHandler(patchReq2, {
    params: Promise.resolve({ id: "inv_race_1" }),
  });
  assert.equal(patchRes2.status, 409, "Second accept must return 409 Conflict");

  // Hunt hunters MUST STILL be 1 (never double incremented)
  hunt = await repo.getHuntById("prohunt_race_1");
  assert.equal(hunt.currentHunters, 1, "currentHunters must remain exactly 1");
});

test("PATCH /api/pro/invitations/[id]: rejects expired invitations with 410 Gone", async () => {
  const repo = new ProRepository(mockDb);

  await repo.createHunt({
    _id: "prohunt_expired_1",
    companyId: "org_corp",
    companyName: "Corp",
    title: "Expired Target",
    description: "Testing expiration",
    rewards: { critical: 1000, high: 500, medium: 200, low: 50 },
    currentHunters: 0,
    status: "active",
    createdBy: "usr_corp_lead",
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Invitation that expired yesterday
  await repo.createInvitation({
    _id: "inv_expired_1",
    hunt_id: "prohunt_expired_1",
    sender_id: "usr_corp_lead",
    hunter_id: "usr_late_hunter",
    hunter_username: "late_hunter",
    status: "pending",
    token: "token_late",
    created_at: new Date(Date.now() - 100000000),
    expires_at: new Date(Date.now() - 50000000), // Expired in past
  });

  const lateUser = {
    id: "usr_late_hunter",
    username: "late_hunter",
    email: "late@test.com",
    role: "user",
    userType: "hunter",
  };

  const patchReq = createReq(
    "http://localhost/api/pro/invitations/inv_expired_1",
    "PATCH",
    { status: "accepted" },
    lateUser
  );
  const patchRes = await patchProInvitationByIdHandler(patchReq, {
    params: Promise.resolve({ id: "inv_expired_1" }),
  });

  assert.equal(patchRes.status, 410, "Expired invitation acceptance must return 410");

  // Verify hunt participant count was NOT incremented
  const hunt = await repo.getHuntById("prohunt_expired_1");
  assert.equal(hunt.currentHunters, 0);
});

// ============================================================================
// 4. BOUNDARY AUDIT: ZERO FIRESTORE IN MIGRATED PRO FILES
// ============================================================================

test("Boundary verification: Pro Hunts and Recommendations files have ZERO Firestore imports", () => {
  const filesToCheck = [
    "app/pro/hunts/page.tsx",
    "hooks/use-pro-hunts.ts",
    "components/pro/pro-recommendations-panel.tsx",
    "app/api/pro/hunts/route.ts",
    "app/api/pro/invitations/route.ts",
    "app/api/pro/invitations/[id]/route.ts",
  ];

  for (const relPath of filesToCheck) {
    const fullPath = path.resolve(process.cwd(), relPath);
    assert.ok(fs.existsSync(fullPath), `File must exist: ${relPath}`);

    const content = fs.readFileSync(fullPath, "utf-8");
    assert.equal(
      content.includes('from "firebase/firestore"') || content.includes("from 'firebase/firestore'"),
      false,
      `${relPath} must not import from firebase/firestore`
    );
    assert.equal(
      content.includes('from "@/firebaseConfig"') || content.includes("from '@/firebaseConfig'"),
      false,
      `${relPath} must not import from firebaseConfig`
    );
  }
});

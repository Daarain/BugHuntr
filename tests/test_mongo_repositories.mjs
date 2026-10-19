import test from "node:test";
import assert from "node:assert/strict";
import {
  WalletsRepository,
  PayoutsRepository,
  SubmissionsRepository,
  HuntsRepository,
  OrganizationsRepository,
  VulnerabilitiesRepository,
  GamificationRepository,
  CommunitiesRepository,
  ProRepository,
  ensureMongoIndexes,
} from "../lib/db/repositories/index.ts";

/**
 * Creates an in-memory Mock MongoDB database for hermetic unit testing.
 */
function createMockDb() {
  const store = new Map();

  return {
    collection(name) {
      if (!store.has(name)) {
        store.set(name, new Map());
      }
      const colMap = store.get(name);
      const indexes = [];

      return {
        async createIndexes(idxDefs) {
          indexes.push(...idxDefs);
          return idxDefs.map((i) => i.name || "index");
        },

        async findOne(filter) {
          for (const doc of colMap.values()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) return JSON.parse(JSON.stringify(doc));
          }
          return null;
        },

        async insertOne(doc) {
          const key = doc._id || doc.order_id || doc.id || `doc_${Date.now()}_${Math.random()}`;
          if (colMap.has(key)) {
            const err = new Error(`E11000 duplicate key error collection: ${name}`);
            err.code = 11000;
            throw err;
          }
          colMap.set(key, JSON.parse(JSON.stringify({ ...doc, _id: key })));
          return { acknowledged: true, insertedId: key };
        },

        async updateOne(filter, update, options = {}) {
          let targetKey = null;
          let targetDoc = null;

          for (const [k, d] of colMap.entries()) {
            let match = true;
            for (const [fk, fv] of Object.entries(filter)) {
              if (typeof fv === "object" && fv !== null) {
                if (fv.$gte !== undefined && (d[fk] === undefined || d[fk] < fv.$gte)) {
                  match = false;
                  break;
                }
              } else if (d[fk] !== fv) {
                match = false;
                break;
              }
            }
            if (match) {
              targetKey = k;
              targetDoc = d;
              break;
            }
          }

          if (!targetDoc && options.upsert) {
            const newDoc = {
              ...(update.$setOnInsert || {}),
              ...(update.$set || {}),
              ...filter,
            };
            const key = newDoc._id || `doc_${Date.now()}`;
            colMap.set(key, newDoc);
            return { matchedCount: 0, modifiedCount: 1, upsertedCount: 1 };
          }

          if (!targetDoc) {
            return { matchedCount: 0, modifiedCount: 0 };
          }

          if (update.$set) {
            Object.assign(targetDoc, update.$set);
          }
          if (update.$inc) {
            for (const [field, incVal] of Object.entries(update.$inc)) {
              targetDoc[field] = (targetDoc[field] || 0) + incVal;
            }
          }
          if (update.$push) {
            for (const [field, pushVal] of Object.entries(update.$push)) {
              if (!Array.isArray(targetDoc[field])) targetDoc[field] = [];
              targetDoc[field].push(pushVal);
            }
          }

          colMap.set(targetKey, targetDoc);
          return { matchedCount: 1, modifiedCount: 1 };
        },

        async findOneAndUpdate(filter, update, options = {}) {
          // Check $expr for wallet reservation: balance - reserved >= amount
          let targetKey = null;
          let targetDoc = null;

          for (const [k, d] of colMap.entries()) {
            if (filter.org_id && d.org_id !== filter.org_id) continue;
            if (filter.user_id && d.user_id !== filter.user_id) continue;

            if (filter.$expr) {
              const amount = update.$inc?.reserved || 0;
              const available = (d.balance || 0) - (d.reserved || 0);
              if (available < amount) {
                continue;
              }
            }

            targetKey = k;
            targetDoc = d;
            break;
          }

          if (!targetDoc) return null;

          if (update.$inc) {
            for (const [field, incVal] of Object.entries(update.$inc)) {
              targetDoc[field] = (targetDoc[field] || 0) + incVal;
            }
          }
          if (update.$set) {
            Object.assign(targetDoc, update.$set);
          }

          colMap.set(targetKey, targetDoc);
          return JSON.parse(JSON.stringify(targetDoc));
        },

        find(filter = {}) {
          const results = [];
          for (const d of colMap.values()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (d[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) results.push(JSON.parse(JSON.stringify(d)));
          }

          let sortField = null;
          let sortDir = 1;
          let limitCount = 50;

          const cursor = {
            sort(s) {
              const entries = Object.entries(s);
              if (entries.length > 0) {
                sortField = entries[0][0];
                sortDir = entries[0][1];
              }
              return cursor;
            },
            limit(l) {
              limitCount = l;
              return cursor;
            },
            async toArray() {
              if (sortField) {
                results.sort((a, b) => {
                  const va = a[sortField] || 0;
                  const vb = b[sortField] || 0;
                  return sortDir === -1 ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
                });
              }
              return results.slice(0, limitCount);
            },
          };
          return cursor;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Wallets Repository Tests
// ---------------------------------------------------------------------------
test("Wallets Repository: creates wallet and manages balance accurately", async () => {
  const db = createMockDb();
  const repo = new WalletsRepository(db);

  const wallet = await repo.createWallet({
    org_id: "org_test_01",
    currency: "USDC",
    network: "POLYGON",
    balance: 10000000, // 10 USDC
    reserved: 0,
  });

  assert.equal(wallet.org_id, "org_test_01");
  assert.equal(wallet.balance, 10000000);
  assert.equal(wallet.reserved, 0);

  const fetched = await repo.getWallet("org_test_01");
  assert.equal(fetched.balance, 10000000);
});

test("Wallets Repository: atomic reservation succeeds when funds available and fails when insufficient", async () => {
  const db = createMockDb();
  const repo = new WalletsRepository(db);

  await repo.createWallet({
    org_id: "org_test_02",
    balance: 5000000, // 5 USDC
    reserved: 1000000, // 1 USDC already reserved -> Available = 4 USDC
  });

  // 1. Reserve 3 USDC (should succeed, 4 available >= 3)
  const res1 = await repo.reserveFunds("org_test_02", 3000000);
  assert.equal(res1.success, true);
  assert.equal(res1.availableBalance, 1000000); // 5 - (1 + 3) = 1

  // 2. Attempt to reserve another 2 USDC (should FAIL, only 1 available)
  const res2 = await repo.reserveFunds("org_test_02", 2000000);
  assert.equal(res2.success, false);
  assert.match(res2.error, /Insufficient funds/);
});

test("Wallets Repository: release and complete deduction work correctly", async () => {
  const db = createMockDb();
  const repo = new WalletsRepository(db);

  await repo.createWallet({
    org_id: "org_test_03",
    balance: 10000000,
    reserved: 4000000,
  });

  // Complete deduction of 2 USDC (blockchain confirmed)
  const deducted = await repo.completeDeduction("org_test_03", 2000000);
  assert.equal(deducted, true);

  const wAfterDeduct = await repo.getWallet("org_test_03");
  assert.equal(wAfterDeduct.balance, 8000000);
  assert.equal(wAfterDeduct.reserved, 2000000);

  // Release 1 USDC (failed payout)
  const released = await repo.releaseFunds("org_test_03", 1000000);
  assert.equal(released, true);

  const wAfterRelease = await repo.getWallet("org_test_03");
  assert.equal(wAfterRelease.balance, 8000000);
  assert.equal(wAfterRelease.reserved, 1000000);
});

// ---------------------------------------------------------------------------
// 2. Payouts Repository Tests
// ---------------------------------------------------------------------------
test("Payouts Repository: enforces unique order_id idempotency", async () => {
  const db = createMockDb();
  const repo = new PayoutsRepository(db);

  const payoutDoc = {
    _id: "BH-PAYOUT-sub101",
    order_id: "BH-PAYOUT-sub101",
    huntId: "hunt_01",
    submissionId: "sub_101",
    orgId: "org_01",
    hunterUid: "usr_hunter_99",
    hunterWallet: "0x123",
    amount: 2000000,
    currency: "USDC",
    network: "POLYGON",
    status: "pending_created",
    createdBy: "usr_admin_01",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const created = await repo.createPayout(payoutDoc);
  assert.equal(created.order_id, "BH-PAYOUT-sub101");

  // Attempt duplicate insert with same order_id
  await assert.rejects(
    async () => repo.createPayout(payoutDoc),
    /duplicate key error/
  );
});

test("Payouts Repository: status progression and audit logging", async () => {
  const db = createMockDb();
  const repo = new PayoutsRepository(db);

  await repo.createPayout({
    _id: "BH-PAYOUT-sub202",
    order_id: "BH-PAYOUT-sub202",
    huntId: "hunt_02",
    submissionId: "sub_202",
    orgId: "org_02",
    hunterUid: "usr_hunter_77",
    hunterWallet: "0xabc",
    amount: 1500000,
    currency: "USDC",
    network: "POLYGON",
    status: "processing",
    createdBy: "usr_admin_02",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const updated = await repo.updateStatus("BH-PAYOUT-sub202", "completed", {
    tx_hash: "0xdeadbeef12345678",
  });
  assert.equal(updated, true);

  const p = await repo.getByOrderId("BH-PAYOUT-sub202");
  assert.equal(p.status, "completed");
  assert.equal(p.tx_hash, "0xdeadbeef12345678");

  // Append audit log
  await repo.logEvent({
    order_id: "BH-PAYOUT-sub202",
    eventType: "payout_confirmed",
    actorUid: "system",
    data: { tx: "0xdeadbeef12345678" },
  });

  const logs = await repo.getLogsByOrderId("BH-PAYOUT-sub202");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].eventType, "payout_confirmed");
});

// ---------------------------------------------------------------------------
// 3. Submissions Repository & Tenancy Isolation Tests
// ---------------------------------------------------------------------------
test("Submissions Repository: enforces Hunter Isolation and Organization Isolation", async () => {
  const db = createMockDb();
  const repo = new SubmissionsRepository(db);

  await repo.createSubmission({
    _id: "sub_alpha_1",
    bounty_id: "hunt_01",
    org_id: "org_corp_A",
    hunter_id: "usr_alice",
    title: "XSS on Profile",
    description: "Reflected XSS",
    steps_to_reproduce: "1. Open URL",
    severity: "medium",
    status: "pending",
    payout_status: "unpaid",
    created_at: new Date(),
    updated_at: new Date(),
  });

  await repo.createSubmission({
    _id: "sub_alpha_2",
    bounty_id: "hunt_01",
    org_id: "org_corp_A",
    hunter_id: "usr_bob",
    title: "CSRF on Settings",
    description: "CSRF",
    steps_to_reproduce: "1. Post form",
    severity: "high",
    status: "approved",
    payout_status: "unpaid",
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Hunter Alice queries: should ONLY see Alice's submissions
  const aliceSubs = await repo.listByHunter("usr_alice");
  assert.equal(aliceSubs.length, 1);
  assert.equal(aliceSubs[0]._id, "sub_alpha_1");

  // Hunter Bob queries: should ONLY see Bob's submissions
  const bobSubs = await repo.listByHunter("usr_bob");
  assert.equal(bobSubs.length, 1);
  assert.equal(bobSubs[0]._id, "sub_alpha_2");

  // Org Corp A queries: should see both submissions for org_corp_A
  const orgSubs = await repo.listByOrg("org_corp_A");
  assert.equal(orgSubs.length, 2);
});

// ---------------------------------------------------------------------------
// 4. Gamification Repository Tests
// ---------------------------------------------------------------------------
test("Gamification Repository: awards points and updates reputation tiers (E -> S)", async () => {
  const db = createMockDb();
  const repo = new GamificationRepository(db);

  const hunterId = "usr_hunter_points_01";

  // 1. Initial 100 points -> E tier (0-499)
  const b1 = await repo.addPoints(hunterId, 100, { username: "hunter_01", reason: "First bug" });
  assert.equal(b1.points, 100);
  assert.equal(b1.reputation_rank, "E");

  // 2. Add 500 points -> 600 total -> D tier (500-1499)
  const b2 = await repo.addPoints(hunterId, 500, { reason: "Medium bug" });
  assert.equal(b2.points, 600);
  assert.equal(b2.reputation_rank, "D");

  // 3. Add 10,000 points -> 10,600 total -> A tier (8000-14999)
  const b3 = await repo.addPoints(hunterId, 10000, { reason: "Critical bounty" });
  assert.equal(b3.points, 10600);
  assert.equal(b3.reputation_rank, "A");

  // 4. Add 5,000 points -> 15,600 total -> S tier (15000+)
  const b4 = await repo.addPoints(hunterId, 5000, { reason: "Legendary bounty" });
  assert.equal(b4.points, 15600);
  assert.equal(b4.reputation_rank, "S");
});

// ---------------------------------------------------------------------------
// 5. Index Provisioning Verification
// ---------------------------------------------------------------------------
test("Index Provisioning: registers unique constraints for all MongoDB domain entities", async () => {
  const db = createMockDb();
  const result = await ensureMongoIndexes(db);
  assert.equal(result.success, true);
  assert.ok(result.indexesCreated.organizations);
  assert.ok(result.indexesCreated.payouts);
  assert.ok(result.indexesCreated.org_wallets);
  assert.ok(result.indexesCreated.user_points_balances);
  assert.ok(result.indexesCreated.vulnerabilities);
});

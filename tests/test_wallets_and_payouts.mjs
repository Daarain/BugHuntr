import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WalletsRepository } from "../lib/db/repositories/wallets.repo";
import { PayoutsRepository } from "../lib/db/repositories/payouts.repo";
import { SubmissionsRepository } from "../lib/db/repositories/submissions.repo";
import {
  signCryptomusPayload,
  verifyCryptomusWebhookSignature,
  mapCryptomusStatusToPayoutStatus,
} from "../lib/cryptomus";
import { GET as getWalletHandler, POST as postWalletHandler } from "../app/api/wallet/route";
import { GET as getOrgWalletHandler, POST as postOrgWalletHandler } from "../app/api/wallet/org/route";
import { POST as postDemoEarningHandler } from "../app/api/wallet/demo-earning/route";
import { GET as getPayoutsHandler, POST as postPayoutsHandler } from "../app/api/payouts/route";
import { GET as getPayoutByIdHandler } from "../app/api/payouts/[id]/route";
import { POST as postDemoPayoutHandler } from "../app/api/payouts/demo/route";
import { POST as postBatchPayoutsHandler } from "../app/api/payouts/batch/route";
import { POST as postCryptomusWebhookHandler } from "../app/api/payments/cryptomus-webhook/route";
import { POST as postReviewHandler } from "../app/api/bug-hunt/review/route";
import { createSessionToken } from "../lib/server-auth";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_API_KEY = "test_cryptomus_api_key_secret_2026";
process.env.SESSION_SECRET = TEST_SECRET;
process.env.INTERNAL_API_SECRET = TEST_SECRET;
process.env.CRYPTOMUS_PAYOUT_KEY = TEST_API_KEY;
process.env.NODE_ENV = "test";
process.env.CRYPTOMUS_MOCK = "true";

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
            if (match) {
              return JSON.parse(JSON.stringify(doc));
            }
          }
          return null;
        },

        async insertOne(doc) {
          const id = doc._id || doc.id || doc.order_id || String(Date.now() + Math.random());
          const stored = { ...doc, _id: id };
          if (colMap.has(id)) {
            const err = new Error("E11000 duplicate key error");
            err.code = 11000;
            throw err;
          }
          colMap.set(id, JSON.parse(JSON.stringify(stored)));
          return { insertedId: id, acknowledged: true };
        },

        async updateOne(filter, update, options) {
          let foundKey = null;
          let doc = null;

          for (const [k, v] of colMap.entries()) {
            let match = true;
            for (const [fk, fv] of Object.entries(filter)) {
              if (fk === "reserved" && fv && typeof fv === "object" && "$gte" in fv) {
                if ((v.reserved ?? 0) < fv.$gte) { match = false; break; }
              } else if (fk === "balance" && fv && typeof fv === "object" && "$gte" in fv) {
                if ((v.balance ?? 0) < fv.$gte) { match = false; break; }
              } else if (v[fk] !== fv) {
                match = false;
                break;
              }
            }
            if (match) {
              foundKey = k;
              doc = { ...v };
              break;
            }
          }

          if (!doc) {
            if (options?.upsert) {
              const newDoc = {
                ...(update.$setOnInsert || {}),
                ...(update.$set || {}),
              };
              const id = newDoc._id || filter.user_id || filter.org_id || String(Date.now());
              newDoc._id = id;
              colMap.set(id, JSON.parse(JSON.stringify(newDoc)));
              return { matchedCount: 0, modifiedCount: 1, upsertedCount: 1, upsertedId: id };
            }
            return { matchedCount: 0, modifiedCount: 0 };
          }

          if (update.$inc) {
            for (const [ik, iv] of Object.entries(update.$inc)) {
              doc[ik] = (doc[ik] ?? 0) + iv;
            }
          }

          if (update.$set) {
            for (const [sk, sv] of Object.entries(update.$set)) {
              doc[sk] = sv;
            }
          }

          if (update.$push) {
            for (const [pk, pv] of Object.entries(update.$push)) {
              doc[pk] = doc[pk] || [];
              doc[pk].push(pv);
            }
          }

          colMap.set(foundKey, JSON.parse(JSON.stringify(doc)));
          return { matchedCount: 1, modifiedCount: 1 };
        },

        async findOneAndUpdate(filter, update, options) {
          let foundKey = null;
          let doc = null;

          for (const [k, v] of colMap.entries()) {
            let match = true;
            for (const [fk, fv] of Object.entries(filter)) {
              if (fk === "$expr") {
                // handle { $gte: [{ $subtract: ["$balance", "$reserved"] }, amount] }
                const available = (v.balance || 0) - (v.reserved || 0);
                const reqAmount = fv.$gte[1];
                if (available < reqAmount) {
                  match = false;
                  break;
                }
              } else if (v[fk] !== fv) {
                match = false;
                break;
              }
            }
            if (match) {
              foundKey = k;
              doc = { ...v };
              break;
            }
          }

          if (!doc) return null;

          if (update.$inc) {
            for (const [ik, iv] of Object.entries(update.$inc)) {
              doc[ik] = (doc[ik] ?? 0) + iv;
            }
          }
          if (update.$set) {
            for (const [sk, sv] of Object.entries(update.$set)) {
              doc[sk] = sv;
            }
          }

          colMap.set(foundKey, JSON.parse(JSON.stringify(doc)));
          return JSON.parse(JSON.stringify(doc));
        },

        find(filter = {}) {
          let results = Array.from(colMap.values());
          if (Object.keys(filter).length > 0) {
            results = results.filter((doc) => {
              for (const [k, v] of Object.entries(filter)) {
                if (v && typeof v === "object" && "$in" in v) {
                  if (!v.$in.includes(doc[k])) return false;
                } else if (doc[k] !== v) {
                  return false;
                }
              }
              return true;
            });
          }

          let sortOrder = null;
          let limitCount = null;

          const cursor = {
            sort(sortObj) {
              sortOrder = sortObj;
              return cursor;
            },
            limit(n) {
              limitCount = n;
              return cursor;
            },
            async toArray() {
              let res = [...results];
              if (sortOrder?.createdAt === -1) {
                res.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
              }
              if (limitCount) {
                res = res.slice(0, limitCount);
              }
              return JSON.parse(JSON.stringify(res));
            },
          };

          return cursor;
        },
      };
    },
  };
}

// ----------------------------------------------------------------------------
// TEST SUITE 1: WalletsRepository & PayoutsRepository Unit Operations
// ----------------------------------------------------------------------------

test("WalletsRepository & PayoutsRepository: balance reservation, deduction, release, and user wallets", async () => {
  const mockDb = createMockDb();
  const walletsRepo = new WalletsRepository(mockDb);
  const payoutsRepo = new PayoutsRepository(mockDb);

  // 1. Create org wallet with 1,000,000 units
  const orgWallet = await walletsRepo.createWallet({
    org_id: "org_acme_corp",
    balance: 1000000,
    reserved: 0,
    currency: "USDC",
    network: "POLYGON",
  });
  assert.equal(orgWallet.org_id, "org_acme_corp");
  assert.equal(orgWallet.balance, 1000000);

  // 2. Reserve 400,000 units
  const res1 = await walletsRepo.reserveFunds("org_acme_corp", 400000);
  assert.equal(res1.success, true);
  assert.equal(res1.availableBalance, 600000);

  // 3. Attempt to overspend: reserve 700,000 (available is only 600,000)
  const resOver = await walletsRepo.reserveFunds("org_acme_corp", 700000);
  assert.equal(resOver.success, false);
  assert.match(resOver.error, /Insufficient funds/);

  // 4. Release 100,000 of reserved funds
  const releaseSuccess = await walletsRepo.releaseFunds("org_acme_corp", 100000);
  assert.equal(releaseSuccess, true);
  const walletAfterRelease = await walletsRepo.getWallet("org_acme_corp");
  assert.equal(walletAfterRelease.reserved, 300000);

  // 5. Complete deduction for remaining 300,000
  const deductSuccess = await walletsRepo.completeDeduction("org_acme_corp", 300000);
  assert.equal(deductSuccess, true);
  const walletAfterDeduct = await walletsRepo.getWallet("org_acme_corp");
  assert.equal(walletAfterDeduct.balance, 700000);
  assert.equal(walletAfterDeduct.reserved, 0);

  // 6. User wallet operations
  const userWallet = await walletsRepo.upsertUserWallet("user_hunter_123", {
    wallet_address: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    network: "POLYGON",
    username: "whitehat_alice",
  });
  assert.equal(userWallet.user_id, "user_hunter_123");
  assert.equal(userWallet.wallet_address, "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");

  const fetchedUserWallet = await walletsRepo.getUserWallet("user_hunter_123");
  assert.equal(fetchedUserWallet.wallet_address, "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");

  // 7. Payout creation and idempotency
  const orderId = "BH-PAYOUT-sub_test_001";
  const payout = await payoutsRepo.createPayout({
    _id: orderId,
    order_id: orderId,
    huntId: "hunt_001",
    submissionId: "sub_test_001",
    orgId: "org_acme_corp",
    hunterUid: "user_hunter_123",
    hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    amount: 300000,
    currency: "USDC",
    network: "POLYGON",
    status: "processing",
    createdBy: "admin_user",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(payout.order_id, orderId);

  // Expect duplicate insertion to fail with duplicate key
  await assert.rejects(
    () => payoutsRepo.createPayout(payout),
    /duplicate key/
  );

  // 8. Batch Job management
  const batchJob = await payoutsRepo.createBatchJob({
    _id: "batch_001",
    batch_id: "batch_001",
    org_id: "org_acme_corp",
    created_by: "admin_user",
    status: "processing",
    total_rows: 5,
    processed: 0,
    errors: [],
    created_at: new Date(),
  });
  assert.equal(batchJob.batch_id, "batch_001");

  await payoutsRepo.updateBatchJob("batch_001", {
    status: "completed",
    processed: 5,
  });
  const updatedJob = await payoutsRepo.getBatchJob("batch_001");
  assert.equal(updatedJob.status, "completed");
  assert.equal(updatedJob.processed, 5);
});

// ----------------------------------------------------------------------------
// TEST SUITE 2: Cryptomus Signature Verification & Status Mapping
// ----------------------------------------------------------------------------

test("Cryptomus utilities: signature generation, webhook verification, and status mapping", () => {
  const payload = {
    order_id: "BH-PAYOUT-sub_123",
    amount: "50.00",
    currency: "USDC",
    network: "POLYGON",
    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  };

  // Sign payload
  const sig = signCryptomusPayload(payload, TEST_API_KEY);
  assert.ok(typeof sig === "string" && sig.length === 32, "Signature must be 32-char hex MD5 string");

  // Verify valid webhook signature
  const webhookBody = { ...payload, sign: sig };
  const isValid = verifyCryptomusWebhookSignature(webhookBody, sig, TEST_API_KEY);
  assert.equal(isValid, true, "Signature must verify successfully");

  // Rejects tampered body
  const tamperedBody = { ...payload, amount: "5000.00", sign: sig };
  const isTamperedValid = verifyCryptomusWebhookSignature(tamperedBody, sig, TEST_API_KEY);
  assert.equal(isTamperedValid, false, "Tampered payload must be rejected");

  // Rejects mismatched API key
  const isWrongKeyValid = verifyCryptomusWebhookSignature(webhookBody, sig, "wrong_secret_key");
  assert.equal(isWrongKeyValid, false, "Signature with wrong key must be rejected");

  // Status mapping
  assert.equal(mapCryptomusStatusToPayoutStatus("paid"), "completed");
  assert.equal(mapCryptomusStatusToPayoutStatus("paid_over"), "completed");
  assert.equal(mapCryptomusStatusToPayoutStatus("process"), "processing");
  assert.equal(mapCryptomusStatusToPayoutStatus("fail"), "failed");
  assert.equal(mapCryptomusStatusToPayoutStatus("cancel"), "cancelled");
});

// ----------------------------------------------------------------------------
// TEST SUITE 3: /api/wallet & /api/wallet/org API Routes
// ----------------------------------------------------------------------------

test("/api/wallet & /api/wallet/org: authentication, EVM address validation, and balance checks", async () => {
  const mockDb = createMockDb();
  globalThis._mongoClientPromise = Promise.resolve({ db: () => mockDb });

  // 1. Unauthenticated request to /api/wallet returns 401
  const reqUnauth = new Request("http://localhost/api/wallet", { method: "GET" });
  const resUnauth = await getWalletHandler(reqUnauth);
  assert.equal(resUnauth.status, 401);

  // 2. Authenticated hunter retrieves their wallet and stats
  const hunterToken = createSessionToken({
    id: "hunter_alice_1",
    email: "alice@example.com",
    username: "alice",
    role: "hunter",
    userType: "hunter",
  });

  const reqHunter = new Request("http://localhost/api/wallet", {
    method: "GET",
    headers: { Authorization: `Bearer ${hunterToken}` },
  });
  const resHunter = await getWalletHandler(reqHunter);
  assert.equal(resHunter.status, 200);
  const dataHunter = await resHunter.json();
  assert.equal(dataHunter.totalEarnings, 0);
  assert.equal(dataHunter.completedCount, 0);

  // 3. POST /api/wallet: Rejects invalid EVM address format
  const reqBadAddress = new Request("http://localhost/api/wallet", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hunterToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ walletAddress: "invalid_crypto_address" }),
  });
  const resBadAddress = await postWalletHandler(reqBadAddress);
  assert.equal(resBadAddress.status, 400);

  // 4. POST /api/wallet: Accepts and stores valid EVM address
  const reqGoodAddress = new Request("http://localhost/api/wallet", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hunterToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ walletAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0" }),
  });
  const resGoodAddress = await postWalletHandler(reqGoodAddress);
  assert.equal(resGoodAddress.status, 200);

  // Verify wallet address now reflected in GET /api/wallet
  const resReflected = await getWalletHandler(reqHunter);
  const dataReflected = await resReflected.json();
  assert.equal(dataReflected.walletAddress, "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0");

  // 5. Hunter attempting to view an arbitrary org wallet is rejected with 403
  const reqHunterOrg = new Request("http://localhost/api/wallet?orgId=org_secret_corp", {
    method: "GET",
    headers: { Authorization: `Bearer ${hunterToken}` },
  });
  const resHunterOrg = await getWalletHandler(reqHunterOrg);
  assert.equal(resHunterOrg.status, 403);
});

// ----------------------------------------------------------------------------
// TEST SUITE 4: /api/payouts API Routes, Idempotency & Isolation
// ----------------------------------------------------------------------------

test("/api/payouts: role authorization, tenancy isolation, fund reservation, and idempotency", async () => {
  const mockDb = createMockDb();
  globalThis._mongoClientPromise = Promise.resolve({ db: () => mockDb });

  const hunterToken = createSessionToken({
    id: "hunter_bob_2",
    email: "bob@example.com",
    username: "bob",
    role: "hunter",
    userType: "hunter",
  });

  const adminToken = createSessionToken({
    id: "admin_superuser",
    email: "admin@bughuntr.io",
    username: "admin",
    role: "admin",
    userType: "company",
  });

  // 1. GET /api/payouts: Hunter isolation prevents bob from viewing alice's payouts
  const reqHunterViewOther = new Request("http://localhost/api/payouts?hunterUid=hunter_alice_1", {
    method: "GET",
    headers: { Authorization: `Bearer ${hunterToken}` },
  });
  const resHunterViewOther = await getPayoutsHandler(reqHunterViewOther);
  assert.equal(resHunterViewOther.status, 403);

  // 2. POST /api/payouts: Hunter role is forbidden from disbursing payouts
  const reqHunterDisburse = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hunterToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_100",
      huntId: "hunt_100",
      orgId: "demo_org_001",
      hunterUid: "hunter_bob_2",
      hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      amount: 100,
    }),
  });
  const resHunterDisburse = await postPayoutsHandler(reqHunterDisburse);
  assert.equal(resHunterDisburse.status, 403);

  // 3. Security: Non-existent submission is rejected with 404
  const reqNonExistent = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_nonexistent_999",
      huntId: "hunt_100",
      orgId: "demo_org_001",
      hunterUid: "hunter_bob_2",
      hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      amount: 100,
    }),
  });
  const resNonExistent = await postPayoutsHandler(reqNonExistent);
  assert.equal(resNonExistent.status, 404);

  // Setup valid submission in repository
  const submissionsRepo = new SubmissionsRepository(mockDb);
  await submissionsRepo.createSubmission({
    _id: "sub_100",
    bounty_id: "hunt_100",
    org_id: "demo_org_001",
    hunter_id: "hunter_bob_2",
    title: "SQL Injection in User Profile",
    description: "Found SQLi flaw",
    steps_to_reproduce: "1. Go to /profile...",
    severity: "high",
    status: "approved",
    payout_status: "unpaid",
    reward_amount: 100,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // 4. Security: Hunter UID mismatch is rejected with 403
  const reqHunterMismatch = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_100",
      huntId: "hunt_100",
      orgId: "demo_org_001",
      hunterUid: "hunter_alice_attacker",
      hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      amount: 100,
    }),
  });
  const resHunterMismatch = await postPayoutsHandler(reqHunterMismatch);
  assert.equal(resHunterMismatch.status, 403);

  // 5. Security: Org ID mismatch is rejected with 403
  const reqOrgMismatch = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_100",
      huntId: "hunt_100",
      orgId: "org_wrong_corp",
      hunterUid: "hunter_bob_2",
      hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      amount: 100,
    }),
  });
  const resOrgMismatch = await postPayoutsHandler(reqOrgMismatch);
  assert.equal(resOrgMismatch.status, 403);

  // 6. Security: Bounty hunt mismatch is rejected with 400
  const reqHuntMismatch = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_100",
      huntId: "hunt_wrong_bounty",
      orgId: "demo_org_001",
      hunterUid: "hunter_bob_2",
      hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      amount: 100,
    }),
  });
  const resHuntMismatch = await postPayoutsHandler(reqHuntMismatch);
  assert.equal(resHuntMismatch.status, 400);

  // 7. Security: Tampered reward amount override is rejected with 400
  const reqTamperedAmount = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_100",
      huntId: "hunt_100",
      orgId: "demo_org_001",
      hunterUid: "hunter_bob_2",
      hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      amount: 9999,
    }),
  });
  const resTamperedAmount = await postPayoutsHandler(reqTamperedAmount);
  assert.equal(resTamperedAmount.status, 400);

  // 8. Security: Unapproved submission status (pending) is rejected with 412
  await submissionsRepo.createSubmission({
    _id: "sub_pending",
    bounty_id: "hunt_100",
    org_id: "demo_org_001",
    hunter_id: "hunter_bob_2",
    title: "Pending Bug",
    description: "Not yet reviewed",
    steps_to_reproduce: "steps",
    severity: "low",
    status: "pending",
    payout_status: "unpaid",
    reward_amount: 50,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const reqUnapproved = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_pending",
      huntId: "hunt_100",
      orgId: "demo_org_001",
      hunterUid: "hunter_bob_2",
      hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      amount: 50,
    }),
  });
  const resUnapproved = await postPayoutsHandler(reqUnapproved);
  assert.equal(resUnapproved.status, 412);

  // 9. POST /api/payouts: Admin disburses payout with authorized details -> funds reserved and payout initiated
  const disbursePayload = {
    submissionId: "sub_100",
    huntId: "hunt_100",
    orgId: "demo_org_001",
    hunterUid: "hunter_bob_2",
    hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
    amount: 100,
  };

  const reqAdminDisburse = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(disbursePayload),
  });
  const resAdminDisburse = await postPayoutsHandler(reqAdminDisburse);
  assert.equal(resAdminDisburse.status, 200);
  const dataDisburse = await resAdminDisburse.json();
  assert.equal(dataDisburse.success, true);
  assert.equal(dataDisburse.order_id, "BH-PAYOUT-sub_100");
  assert.equal(dataDisburse.status, "processing");

  // 10. Idempotency: Repeating exact same payout request returns existing payout without double-reserving
  const reqAdminDisburseRepeat = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(disbursePayload),
  });
  const resRepeat = await postPayoutsHandler(reqAdminDisburseRepeat);
  assert.equal(resRepeat.status, 200);
  const dataRepeat = await resRepeat.json();
  assert.equal(dataRepeat.isExisting, true);
  assert.equal(dataRepeat.order_id, "BH-PAYOUT-sub_100");

  // 11. Security: Attempting to disburse an already paid / processing submission with new order returns 409
  await submissionsRepo.createSubmission({
    _id: "sub_already_paid",
    bounty_id: "hunt_100",
    org_id: "demo_org_001",
    hunter_id: "hunter_bob_2",
    title: "Already Paid Bug",
    description: "Paid previously",
    steps_to_reproduce: "steps",
    severity: "low",
    status: "approved",
    payout_status: "paid",
    reward_amount: 50,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const reqAlreadyPaid = new Request("http://localhost/api/payouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_already_paid",
      huntId: "hunt_100",
      orgId: "demo_org_001",
      hunterUid: "hunter_bob_2",
      hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      amount: 50,
    }),
  });
  const resAlreadyPaid = await postPayoutsHandler(reqAlreadyPaid);
  assert.equal(resAlreadyPaid.status, 409);

  // 12. GET /api/payouts/[id]: Lookup payout by order_id
  const reqLookup = new Request("http://localhost/api/payouts/BH-PAYOUT-sub_100", {
    method: "GET",
    headers: { Authorization: `Bearer ${hunterToken}` },
  });
  const resLookup = await getPayoutByIdHandler(reqLookup, {
    params: Promise.resolve({ id: "BH-PAYOUT-sub_100" }),
  });
  assert.equal(resLookup.status, 200);
  const dataLookup = await resLookup.json();
  assert.equal(dataLookup.payout.order_id, "BH-PAYOUT-sub_100");
});

// ----------------------------------------------------------------------------
// TEST SUITE 5: Cryptomus Webhook Idempotency & Balance Settlements
// ----------------------------------------------------------------------------

test("Cryptomus Webhook: signature verification, deduction, release, and idempotency", async () => {
  const mockDb = createMockDb();
  globalThis._mongoClientPromise = Promise.resolve({ db: () => mockDb });

  const walletsRepo = new WalletsRepository(mockDb);
  const payoutsRepo = new PayoutsRepository(mockDb);

  // Setup: org wallet with 10,000,000 balance and 1,000,000 reserved
  await walletsRepo.createWallet({
    org_id: "org_settlement_test",
    balance: 10000000,
    reserved: 1000000,
    currency: "USDC",
    network: "POLYGON",
  });

  // Setup: payout in processing state
  const orderId = "BH-PAYOUT-webhook_test_001";
  await payoutsRepo.createPayout({
    _id: orderId,
    order_id: orderId,
    huntId: "hunt_web_1",
    submissionId: "sub_web_1",
    orgId: "org_settlement_test",
    hunterUid: "hunter_123",
    hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    amount: 1000000,
    currency: "USDC",
    network: "POLYGON",
    status: "processing",
    createdBy: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // 1. Rejects forged webhook signature
  const forgedPayload = {
    order_id: orderId,
    status: "paid",
    txid: "0x123456789abcdef",
  };
  const reqForged = new Request("http://localhost/api/payments/cryptomus-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      sign: "invalid_forged_signature_hex",
    },
    body: JSON.stringify(forgedPayload),
  });
  const resForged = await postCryptomusWebhookHandler(reqForged);
  assert.equal(resForged.status, 403);

  // 2. Processes valid 'paid' webhook -> deducts balance atomically
  const validCompletedPayload = {
    order_id: orderId,
    status: "paid",
    txid: "0xblockchain_tx_confirmed_123",
  };
  const validSig = signCryptomusPayload(validCompletedPayload, TEST_API_KEY);

  const reqValid = new Request("http://localhost/api/payments/cryptomus-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      sign: validSig,
    },
    body: JSON.stringify(validCompletedPayload),
  });

  const resValid = await postCryptomusWebhookHandler(reqValid);
  assert.equal(resValid.status, 200);

  // Verify wallet: balance decreased from 10,000,000 to 9,000,000; reserved decreased to 0
  const walletAfterSettlement = await walletsRepo.getWallet("org_settlement_test");
  assert.equal(walletAfterSettlement.balance, 9000000);
  assert.equal(walletAfterSettlement.reserved, 0);

  // 3. Webhook idempotency: sending exact same 'paid' webhook again does NOT double-deduct
  const reqDuplicate = new Request("http://localhost/api/payments/cryptomus-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      sign: validSig,
    },
    body: JSON.stringify(validCompletedPayload),
  });
  const resDuplicate = await postCryptomusWebhookHandler(reqDuplicate);
  assert.equal(resDuplicate.status, 200);
  const dataDup = await resDuplicate.json();
  assert.match(dataDup.message, /already completed/);

  const walletAfterDuplicate = await walletsRepo.getWallet("org_settlement_test");
  assert.equal(walletAfterDuplicate.balance, 9000000, "Balance must remain unchanged on duplicate webhook");
  assert.equal(walletAfterDuplicate.reserved, 0);

  // 4. Failure scenario releases reserved balance
  const failOrderId = "BH-PAYOUT-fail_test_002";
  await walletsRepo.reserveFunds("org_settlement_test", 500000);
  await payoutsRepo.createPayout({
    _id: failOrderId,
    order_id: failOrderId,
    huntId: "hunt_fail_1",
    submissionId: "sub_fail_1",
    orgId: "org_settlement_test",
    hunterUid: "hunter_123",
    hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    amount: 500000,
    currency: "USDC",
    network: "POLYGON",
    status: "processing",
    createdBy: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const failPayload = {
    order_id: failOrderId,
    status: "fail",
  };
  const failSig = signCryptomusPayload(failPayload, TEST_API_KEY);
  const reqFail = new Request("http://localhost/api/payments/cryptomus-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      sign: failSig,
    },
    body: JSON.stringify(failPayload),
  });

  const resFail = await postCryptomusWebhookHandler(reqFail);
  assert.equal(resFail.status, 200);

  // Reserved funds must be released (back to 0 reserved)
  const walletAfterFail = await walletsRepo.getWallet("org_settlement_test");
  assert.equal(walletAfterFail.reserved, 0);
  assert.equal(walletAfterFail.balance, 9000000);

  // 5. Replaying 'paid' webhook on a terminal 'failed' payout is rejected without balance changes
  const replayPaidPayload = {
    order_id: failOrderId,
    status: "paid",
    txid: "0xlate_tx_confirmation",
  };
  const replaySig = signCryptomusPayload(replayPaidPayload, TEST_API_KEY);
  const reqReplayPaid = new Request("http://localhost/api/payments/cryptomus-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      sign: replaySig,
    },
    body: JSON.stringify(replayPaidPayload),
  });
  const resReplayPaid = await postCryptomusWebhookHandler(reqReplayPaid);
  assert.equal(resReplayPaid.status, 200);
  const dataReplayPaid = await resReplayPaid.json();
  assert.match(dataReplayPaid.message, /terminal state/);

  // Verify wallet balance remained completely unchanged
  const walletAfterReplay = await walletsRepo.getWallet("org_settlement_test");
  assert.equal(walletAfterReplay.balance, 9000000);
  assert.equal(walletAfterReplay.reserved, 0);

  // 6. Webhook with mismatched UUID against registered payout ID is rejected with 400
  const uuidMismatchOrderId = "BH-PAYOUT-uuid_test";
  await payoutsRepo.createPayout({
    _id: uuidMismatchOrderId,
    order_id: uuidMismatchOrderId,
    huntId: "hunt_uuid_1",
    submissionId: "sub_uuid_1",
    orgId: "org_settlement_test",
    hunterUid: "hunter_123",
    hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    amount: 100000,
    currency: "USDC",
    network: "POLYGON",
    status: "processing",
    cryptomus_payout_id: "valid_cryptomus_uuid_original",
    createdBy: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const spoofedUuidPayload = {
    order_id: uuidMismatchOrderId,
    uuid: "attacker_spoofed_uuid",
    status: "paid",
  };
  const spoofedSig = signCryptomusPayload(spoofedUuidPayload, TEST_API_KEY);
  const reqSpoofedUuid = new Request("http://localhost/api/payments/cryptomus-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      sign: spoofedSig,
    },
    body: JSON.stringify(spoofedUuidPayload),
  });
  const resSpoofedUuid = await postCryptomusWebhookHandler(reqSpoofedUuid);
  assert.equal(resSpoofedUuid.status, 400);
});

// ----------------------------------------------------------------------------
// TEST SUITE 6: Zero Firestore calls in Migrated Phase 6 Client Files
// ----------------------------------------------------------------------------

test("Boundary verification: migrated Phase 6 client files have zero direct Firestore/Firebase calls", () => {
  const rootDir = path.resolve(".");
  const filesToCheck = [
    "hooks/use-payout.ts",
    "app/my-wallet/page.tsx",
    "app/payout-demo/page.tsx",
  ];

  const forbiddenPatterns = [
    /from\s+["']firebase\/firestore["']/,
    /from\s+["']firebase\/functions["']/,
    /from\s+["']@\/firebaseConfig["']/,
    /httpsCallable\(/,
    /\bonSnapshot\(/,
    /\bgetFirestore\(/,
  ];

  for (const relativePath of filesToCheck) {
    const fullPath = path.join(rootDir, relativePath);
    assert.ok(fs.existsSync(fullPath), `File must exist: ${relativePath}`);

    const content = fs.readFileSync(fullPath, "utf-8");
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(content),
        `File ${relativePath} contains forbidden pattern: ${pattern.toString()}`
      );
    }
  }
});

// ----------------------------------------------------------------------------
// TEST SUITE 7: Batch Payouts Authorization, Validation & Idempotency
// ----------------------------------------------------------------------------

test("/api/payouts/batch: tenancy isolation, row validation, and duplicate prevention", async () => {
  const mockDb = createMockDb();
  globalThis._mongoClientPromise = Promise.resolve({ db: () => mockDb });

  const walletsRepo = new WalletsRepository(mockDb);
  const submissionsRepo = new SubmissionsRepository(mockDb);

  await walletsRepo.createWallet({
    org_id: "org_batch_test",
    balance: 500000000,
    reserved: 0,
    currency: "USDC",
    network: "POLYGON",
  });

  const adminToken = createSessionToken({
    id: "admin_user",
    email: "admin@bughuntr.io",
    username: "admin",
    role: "admin",
    userType: "company",
  });

  const companyTokenOther = createSessionToken({
    id: "company_user_other",
    email: "company@other.com",
    username: "other_org_admin",
    role: "company",
    userType: "company",
    orgId: "org_unauthorized_other",
    organizationId: "org_unauthorized_other",
  });

  // 1. Company cannot create batch payouts for another organization
  const reqUnauthorizedCompany = new Request("http://localhost/api/payouts/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${companyTokenOther}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      orgId: "org_batch_test",
      payouts: [{
        submissionId: "sub_b_1",
        huntId: "hunt_1",
        hunterUid: "hunter_1",
        hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        amount: 50,
      }],
    }),
  });
  const resUnauthorizedCompany = await postBatchPayoutsHandler(reqUnauthorizedCompany);
  assert.equal(resUnauthorizedCompany.status, 403);

  // Setup submissions for batch
  await submissionsRepo.createSubmission({
    _id: "sub_batch_valid_1",
    bounty_id: "hunt_b_1",
    org_id: "org_batch_test",
    hunter_id: "hunter_valid_1",
    title: "Valid Bug 1",
    description: "Details",
    steps_to_reproduce: "Steps",
    severity: "medium",
    status: "approved",
    payout_status: "unpaid",
    reward_amount: 100,
    created_at: new Date(),
    updated_at: new Date(),
  });

  await submissionsRepo.createSubmission({
    _id: "sub_batch_mismatch_owner",
    bounty_id: "hunt_b_1",
    org_id: "org_batch_test",
    hunter_id: "hunter_legit_owner",
    title: "Bug With Legitimate Owner",
    description: "Details",
    steps_to_reproduce: "Steps",
    severity: "low",
    status: "approved",
    payout_status: "unpaid",
    reward_amount: 50,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // 2. Batch with mixed rows: nonexistent submission, owner mismatch, and valid item
  const batchPayload = {
    orgId: "org_batch_test",
    payouts: [
      {
        submissionId: "sub_nonexistent_xyz",
        huntId: "hunt_b_1",
        hunterUid: "hunter_valid_1",
        hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        amount: 100,
      },
      {
        submissionId: "sub_batch_mismatch_owner",
        huntId: "hunt_b_1",
        hunterUid: "hunter_attacker_spoofed",
        hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        amount: 50,
      },
      {
        submissionId: "sub_batch_valid_1",
        huntId: "hunt_b_1",
        hunterUid: "hunter_valid_1",
        hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        amount: 100,
      },
    ],
  };

  const reqBatch = new Request("http://localhost/api/payouts/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(batchPayload),
  });

  const resBatch = await postBatchPayoutsHandler(reqBatch);
  assert.equal(resBatch.status, 200);
  const dataBatch = await resBatch.json();
  assert.equal(dataBatch.totalRows, 3);
  assert.equal(dataBatch.queued, 1);
  assert.equal(dataBatch.failed, 2);
  assert.match(dataBatch.errors[0].error, /Submission not found/);
  assert.match(dataBatch.errors[1].error, /Hunter UID mismatch/);

  // 3. Repeating the same batch does NOT double-disburse valid submission
  const reqBatchRepeat = new Request("http://localhost/api/payouts/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      orgId: "org_batch_test",
      payouts: [
        {
          submissionId: "sub_batch_valid_1",
          huntId: "hunt_b_1",
          hunterUid: "hunter_valid_1",
          hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
          amount: 100,
        },
      ],
    }),
  });
  const resBatchRepeat = await postBatchPayoutsHandler(reqBatchRepeat);
  assert.equal(resBatchRepeat.status, 200);
  const dataBatchRepeat = await resBatchRepeat.json();
  assert.equal(dataBatchRepeat.queued, 0);
  assert.equal(dataBatchRepeat.failed, 1);
  assert.match(dataBatchRepeat.errors[0].error, /already paid or processing|already exists/);
});

// ----------------------------------------------------------------------------
// TEST SUITE 8: Bug Hunt Review & Bounty Payout Authorization & Validation
// ----------------------------------------------------------------------------

test("/api/bug-hunt/review: role authorization, submission verification, and reward execution", async () => {
  const mockDb = createMockDb();
  globalThis._mongoClientPromise = Promise.resolve({ db: () => mockDb });

  const walletsRepo = new WalletsRepository(mockDb);
  const submissionsRepo = new SubmissionsRepository(mockDb);

  await walletsRepo.createWallet({
    org_id: "demo_org_001",
    balance: 10000000000,
    reserved: 0,
    currency: "INR",
    network: "INTERNAL",
  });

  const hunterToken = createSessionToken({
    id: "hunter_carol",
    email: "carol@example.com",
    username: "carol",
    role: "hunter",
    userType: "hunter",
  });

  const adminToken = createSessionToken({
    id: "admin_triage_lead",
    email: "lead@bughuntr.io",
    username: "triage_lead",
    role: "admin",
    userType: "company",
  });

  // 1. Hunter cannot review submissions or transfer rewards
  const reqHunterReview = new Request("http://localhost/api/bug-hunt/review", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hunterToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_rev_1",
      hunterUid: "hunter_carol",
      hunterUsername: "carol",
      amount: 100,
    }),
  });
  const resHunterReview = await postReviewHandler(reqHunterReview);
  assert.equal(resHunterReview.status, 403);

  // 2. Reviewing nonexistent submission returns 404
  const reqNonexistentReview = new Request("http://localhost/api/bug-hunt/review", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_rev_nonexistent",
      hunterUid: "hunter_carol",
      hunterUsername: "carol",
      amount: 100,
    }),
  });
  const resNonexistentReview = await postReviewHandler(reqNonexistentReview);
  assert.equal(resNonexistentReview.status, 404);

  // Setup valid submission in repo
  await submissionsRepo.createSubmission({
    _id: "sub_rev_1",
    bounty_id: "hunt_rev_1",
    org_id: "demo_org_001",
    hunter_id: "hunter_carol",
    title: "Authentication Bypass",
    description: "Critical auth flaw",
    steps_to_reproduce: "Steps",
    severity: "critical",
    status: "pending",
    payout_status: "unpaid",
    reward_amount: 250,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // 3. Hunter UID mismatch is rejected with 403
  const reqMismatchHunterReview = new Request("http://localhost/api/bug-hunt/review", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_rev_1",
      hunterUid: "hunter_imposter_99",
      hunterUsername: "imposter",
      amount: 250,
    }),
  });
  const resMismatchHunterReview = await postReviewHandler(reqMismatchHunterReview);
  assert.equal(resMismatchHunterReview.status, 403);

  // 4. Reward amount mismatch is rejected with 400
  const reqTamperedReviewAmount = new Request("http://localhost/api/bug-hunt/review", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_rev_1",
      hunterUid: "hunter_carol",
      hunterUsername: "carol",
      amount: 5000,
    }),
  });
  const resTamperedReviewAmount = await postReviewHandler(reqTamperedReviewAmount);
  assert.equal(resTamperedReviewAmount.status, 400);

  // 5. Valid review succeeds, transfers reward, and marks submission paid
  const reqValidReview = new Request("http://localhost/api/bug-hunt/review", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_rev_1",
      hunterUid: "hunter_carol",
      hunterUsername: "carol",
      amount: 250,
      status: "approved",
      reviewNotes: "Confirmed and reward approved",
    }),
  });
  const resValidReview = await postReviewHandler(reqValidReview);
  assert.equal(resValidReview.status, 200);
  const dataValidReview = await resValidReview.json();
  assert.equal(dataValidReview.success, true);

  // Verify submission in DB transitioned to paid and approved
  const subAfterReview = await submissionsRepo.getById("sub_rev_1");
  assert.equal(subAfterReview.payout_status, "paid");
  assert.equal(subAfterReview.status, "approved");

  // 6. Attempting to review an already paid submission is rejected with 409
  const reqAlreadyPaidReview = new Request("http://localhost/api/bug-hunt/review", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionId: "sub_rev_1",
      hunterUid: "hunter_carol",
      hunterUsername: "carol",
      amount: 250,
    }),
  });
  const resAlreadyPaidReview = await postReviewHandler(reqAlreadyPaidReview);
  assert.equal(resAlreadyPaidReview.status, 409);
});

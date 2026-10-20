import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GamificationRepository } from "../lib/db/repositories/gamification.repo";
import { GET as getLeaderboardHandler } from "../app/api/rankings/leaderboard/route";
import { GET as getMeHandler } from "../app/api/rankings/me/route";
import { GET as getTransactionsHandler } from "../app/api/rankings/transactions/route";
import { GET as getAchievementsHandler, POST as postAchievementsHandler } from "../app/api/rankings/achievements/route";
import { GET as getRewardsHandler } from "../app/api/rankings/rewards/route";
import { POST as postRedeemHandler } from "../app/api/rankings/rewards/redeem/route";
import { POST as postPointsHandler } from "../app/api/rankings/points/route";
import { createSessionToken } from "../lib/server-auth";
import { REWARD_CATALOG, ACHIEVEMENTS, SEVERITY_POINTS } from "../types/ranking";

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
              } else if (v && typeof v === "object" && "$gte" in v) {
                if ((doc[k] ?? 0) < v.$gte) { match = false; break; }
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
          const id = doc._id || doc.id || String(Date.now() + Math.random());
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
              if (fv && typeof fv === "object" && "$gte" in fv) {
                if ((v[fk] ?? 0) < fv.$gte) { match = false; break; }
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
              const id = newDoc._id || filter.user_id || filter._id || String(Date.now());
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

          colMap.set(foundKey, JSON.parse(JSON.stringify(doc)));
          return { matchedCount: 1, modifiedCount: 1 };
        },

        async findOneAndUpdate(filter, update, options) {
          let foundKey = null;
          let doc = null;

          for (const [k, v] of colMap.entries()) {
            let match = true;
            for (const [fk, fv] of Object.entries(filter)) {
              if (fv && typeof fv === "object" && "$gte" in fv) {
                if ((v[fk] ?? 0) < fv.$gte) { match = false; break; }
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
            return null;
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

          colMap.set(foundKey, JSON.parse(JSON.stringify(doc)));
          return JSON.parse(JSON.stringify(doc));
        },

        async countDocuments(filter = {}) {
          let count = 0;
          for (const doc of colMap.values()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) { match = false; break; }
            }
            if (match) count++;
          }
          return count;
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
              if (sortOrder) {
                res.sort((a, b) => {
                  for (const [field, dir] of Object.entries(sortOrder)) {
                    const valA = a[field] instanceof Date ? a[field].getTime() : a[field];
                    const valB = b[field] instanceof Date ? b[field].getTime() : b[field];
                    if (valA !== valB) {
                      return dir === -1 ? (valB > valA ? 1 : -1) : (valA > valB ? 1 : -1);
                    }
                  }
                  return 0;
                });
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
// TEST SUITE 1: GamificationRepository Unit Operations
// ----------------------------------------------------------------------------

test("GamificationRepository: points addition, atomic deductions, rank progression, and achievements", async () => {
  const mockDb = createMockDb();
  const repo = new GamificationRepository(mockDb);

  // 1. Initial user starts with 0 points / tier E
  const initial = await repo.getPointsBalance("usr_alice");
  assert.equal(initial, null);

  // 2. Add points for high severity bug (500 pts)
  const afterFirst = await repo.addPoints("usr_alice", 500, {
    username: "alice_hunter",
    bugIncrement: 1,
    reason: "Found XSS bug in authentication",
    severity: "high",
  });
  assert.equal(afterFirst.points, 500);
  assert.equal(afterFirst.reputation_rank, "D"); // >= 500 is D tier
  assert.equal(afterFirst.bugs_submitted, 1);

  // Check progress calculation
  const progD = repo.calculateRankProgress(500);
  assert.equal(progD.rank, "D");
  assert.ok(progD.rankProgress >= 0);

  // 3. Add points to reach C tier (1500 pts)
  const afterSecond = await repo.addPoints("usr_alice", 1000, {
    username: "alice_hunter",
    bugIncrement: 1,
    reason: "Found IDOR in checkout",
    severity: "critical",
  });
  assert.equal(afterSecond.points, 1500);
  assert.equal(afterSecond.reputation_rank, "C"); // >= 1500 is C tier

  // 4. Atomic point deduction (positive path)
  const deductRes = await repo.deductPoints("usr_alice", 200, "Redeemed sticker pack");
  assert.equal(deductRes.success, true);
  assert.equal(deductRes.remainingPoints, 1300);

  // 5. Over-deduction prevention (cannot drop below zero)
  const overDeduct = await repo.deductPoints("usr_alice", 2000, "Attempt overspend");
  assert.equal(overDeduct.success, false);
  assert.match(overDeduct.error, /Insufficient points/);

  // Ensure balance remained untouched after failed over-deduction
  const balanceAfterFail = await repo.getPointsBalance("usr_alice");
  assert.equal(balanceAfterFail.points, 1300);

  // 6. Transaction history includes additions and deductions
  const txs = await repo.listTransactions("usr_alice");
  assert.equal(txs.length, 3);
  assert.ok(txs.some((t) => t.points === -200));
  assert.ok(txs.some((t) => t.points === 500));
  assert.ok(txs.some((t) => t.points === 1000));

  // 7. Achievements unlocking
  const ach = await repo.unlockAchievement("usr_alice", "first_bug", "First Discovery", "Found first bug");
  assert.equal(ach.unlocked, true);

  // Duplicate unlocking is idempotent
  const achDuplicate = await repo.unlockAchievement("usr_alice", "first_bug", "First Discovery", "Found first bug");
  assert.equal(achDuplicate.unlocked, false);

  const achievementsList = await repo.listUserAchievements("usr_alice");
  assert.equal(achievementsList.length, 1);
  assert.equal(achievementsList[0].badge_id, "first_bug");

  // 8. Reward redemptions tracking
  await repo.redeemReward("usr_alice", "security_hoodie");
  const count = await repo.countRedemptions("security_hoodie");
  assert.equal(count, 1);

  const userRewards = await repo.listUserRewards("usr_alice");
  assert.equal(userRewards.length, 1);
  assert.equal(userRewards[0].reward_id, "security_hoodie");
});

// ----------------------------------------------------------------------------
// TEST SUITE 2: Gamification API Routes (Authentication, Authorization & Safety)
// ----------------------------------------------------------------------------

test("API Routes: Leaderboard, points awarding, reward store, and atomic redemptions", async () => {
  const mockDb = createMockDb();
  globalThis._mongoClientPromise = Promise.resolve({ db: () => mockDb });

  const aliceToken = createSessionToken({
    id: "usr_alice",
    email: "alice@example.com",
    role: "hunter",
    username: "alice_hunter",
  });

  const bobToken = createSessionToken({
    id: "usr_bob",
    email: "bob@example.com",
    role: "hunter",
    username: "bob_hunter",
  });

  const adminToken = createSessionToken({
    id: "usr_admin",
    email: "admin@bughuntr.com",
    role: "admin",
    username: "sysadmin",
  });

  // 1. Leaderboard starts empty
  const lbReq1 = new Request("http://localhost/api/rankings/leaderboard", { method: "GET" });
  const lbRes1 = await getLeaderboardHandler(lbReq1);
  assert.equal(lbRes1.status, 200);
  const lbData1 = await lbRes1.json();
  assert.equal(lbData1.leaderboard.length, 0);

  // 2. Award points to Alice via /api/rankings/points
  const awardReq1 = new Request("http://localhost/api/rankings/points", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${aliceToken}`,
    },
    body: JSON.stringify({
      severity: "critical",
      bugId: 101,
      reason: "Remote code execution in image parser",
    }),
  });
  const awardRes1 = await postPointsHandler(awardReq1);
  assert.equal(awardRes1.status, 201);
  const awardData1 = await awardRes1.json();
  assert.equal(awardData1.pointsAwarded, 1000); // Critical is 1000 base points
  assert.equal(awardData1.newTotalPoints, 1000);
  assert.equal(awardData1.rank, "D");

  // 3. Bob attempts to award points to Alice -> Forbidden (403)
  const crossUserAwardReq = new Request("http://localhost/api/rankings/points", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${bobToken}`,
    },
    body: JSON.stringify({
      userId: "usr_alice",
      points: 5000,
      reason: "Unauthorized points grant",
    }),
  });
  const crossUserAwardRes = await postPointsHandler(crossUserAwardReq);
  assert.equal(crossUserAwardRes.status, 403);

  // 4. Admin awards points to Alice (allowed)
  const adminAwardReq = new Request("http://localhost/api/rankings/points", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${adminToken}`,
    },
    body: JSON.stringify({
      userId: "usr_alice",
      points: 7500, // 1000 + 7500 = 8500 (Tier A)
      reason: "Platform excellence bonus",
    }),
  });
  const adminAwardRes = await postPointsHandler(adminAwardReq);
  assert.equal(adminAwardRes.status, 201);
  const adminAwardData = await adminAwardRes.json();
  assert.equal(adminAwardData.newTotalPoints, 8500);
  assert.equal(adminAwardData.rank, "A");

  // 5. Check Alice's /api/rankings/me
  const meReq = new Request("http://localhost/api/rankings/me", {
    method: "GET",
    headers: { Cookie: `bughuntr_session=${aliceToken}` },
  });
  const meRes = await getMeHandler(meReq);
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.ranking.totalPoints, 8500);
  assert.equal(meData.ranking.rank, "A");

  // 6. Achievement triggers: check achievements for Alice
  const achReq = new Request("http://localhost/api/rankings/achievements", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${aliceToken}`,
    },
    body: JSON.stringify({ severity: "critical" }),
  });
  const achRes = await postAchievementsHandler(achReq);
  assert.equal(achRes.status, 200);
  const achData = await achRes.json();
  // Alice submitted 1 bug (first_bug) and it was critical (critical_finder)
  assert.ok(achData.newlyUnlocked.length >= 2);

  // 7. Reward store: Alice views rewards catalog
  const rewardsReq = new Request("http://localhost/api/rankings/rewards", {
    method: "GET",
    headers: { Cookie: `bughuntr_session=${aliceToken}` },
  });
  const rewardsRes = await getRewardsHandler(rewardsReq);
  assert.equal(rewardsRes.status, 200);
  const rewardsData = await rewardsRes.json();
  assert.ok(rewardsData.catalog.length >= 4);

  // 8. Reward redemption: Alice attempts to redeem S-rank reward "elite_status" (Requires S, Alice is A) -> 403
  const rankRestrictedReq = new Request("http://localhost/api/rankings/rewards/redeem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${aliceToken}`,
    },
    body: JSON.stringify({ rewardId: "elite_status" }),
  });
  const rankRestrictedRes = await postRedeemHandler(rankRestrictedReq);
  assert.equal(rankRestrictedRes.status, 403);
  assert.match((await rankRestrictedRes.json()).error, /Requires rank S/);

  // 9. Reward redemption: Alice redeems "mentorship_session" (costs 6000 points, Alice has ~9100)
  const redeemReq = new Request("http://localhost/api/rankings/rewards/redeem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${aliceToken}`,
    },
    body: JSON.stringify({ rewardId: "mentorship_session" }),
  });
  const redeemRes = await postRedeemHandler(redeemReq);
  assert.equal(redeemRes.status, 200);
  const redeemData = await redeemRes.json();
  assert.equal(redeemData.success, true);
  assert.ok(redeemData.remainingPoints >= 0);

  // 10. Reward redemption: Bob (0 points) attempts to redeem -> 400 Insufficient points
  const bobRedeemReq = new Request("http://localhost/api/rankings/rewards/redeem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${bobToken}`,
    },
    body: JSON.stringify({ rewardId: "mentorship_session" }),
  });
  const bobRedeemRes = await postRedeemHandler(bobRedeemReq);
  assert.equal(bobRedeemRes.status, 400);
  assert.match((await bobRedeemRes.json()).error, /Insufficient points/);

  // 11. Unauthenticated redemption rejected with 401
  const unauthRedeemReq = new Request("http://localhost/api/rankings/rewards/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rewardId: "premium_badge" }),
  });
  const unauthRedeemRes = await postRedeemHandler(unauthRedeemReq);
  assert.equal(unauthRedeemRes.status, 401);

  // 12. Leaderboard shows Alice as #1
  const lbReq2 = new Request("http://localhost/api/rankings/leaderboard", { method: "GET" });
  const lbRes2 = await getLeaderboardHandler(lbReq2);
  assert.equal(lbRes2.status, 200);
  const lbData2 = await lbRes2.json();
  assert.equal(lbData2.leaderboard[0].username, "alice_hunter");
});

// ----------------------------------------------------------------------------
// TEST SUITE 3: Boundary Verification: Migrated Phase 8 Client Files Have Zero Firestore
// ----------------------------------------------------------------------------

test("Boundary verification: migrated Phase 8 client files have zero direct Firestore/Firebase calls", () => {
  const clientFiles = [
    "hooks/use-ranking.ts",
    "components/ranking/rewards-store.tsx",
    "app/leaderboard/page.tsx",
    "lib/add-points.ts",
  ];

  const forbiddenTokens = [
    "firebase/firestore",
    "@/firebaseConfig",
    "getFirestore",
    "onSnapshot",
    "collection(",
    "doc(db",
    "getDoc(",
    "getDocs(",
    "setDoc(",
    "addDoc(",
    "updateDoc(",
    "deleteDoc(",
    "serverTimestamp(",
  ];

  for (const relativePath of clientFiles) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    assert.ok(fs.existsSync(fullPath), `File must exist: ${relativePath}`);

    const content = fs.readFileSync(fullPath, "utf-8");

    for (const token of forbiddenTokens) {
      assert.equal(
        content.includes(token),
        false,
        `File ${relativePath} must NOT contain forbidden Firestore token: "${token}"`
      );
    }
  }
});

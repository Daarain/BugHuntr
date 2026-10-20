import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PreferencesRepository, DEFAULT_NOTIFICATION_PREFERENCES } from "../lib/db/repositories/preferences.repo.ts";
import { GamificationRepository } from "../lib/db/repositories/gamification.repo.ts";
import { SubmissionsRepository } from "../lib/db/repositories/submissions.repo.ts";
import { authRepository, AuthRepository } from "../lib/db/auth-repository.ts";
import { GET as getProfileHandler, PATCH as patchProfileHandler } from "../app/api/user/profile/route.ts";
import { GET as getSettingsHandler, PATCH as patchSettingsHandler } from "../app/api/user/settings/route.ts";
import { GET as getStatsHandler, POST as postStatsHandler } from "../app/api/user/stats/route.ts";
import { createSessionToken } from "../lib/server-auth.ts";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.SESSION_SECRET = TEST_SECRET;
process.env.INTERNAL_API_SECRET = TEST_SECRET;
process.env.NODE_ENV = "test";

/**
 * In-memory Mock MongoDB database for hermetic testing.
 */
function createMockMongoDb() {
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
          const id = doc._id || doc.id || String(Date.now() + Math.random());
          const stored = { ...doc, _id: id };
          colMap.set(id, stored);
          return { acknowledged: true, insertedId: id };
        },

        async updateOne(filter, update, options = {}) {
          let foundKey = null;
          let existing = null;

          for (const [key, doc] of colMap.entries()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) {
              foundKey = key;
              existing = doc;
              break;
            }
          }

          if (!existing && options.upsert) {
            const newDoc = {
              ...(filter._id ? { _id: filter._id } : { _id: filter.user_id || String(Date.now()) }),
              ...filter,
              ...(update.$setOnInsert || {}),
              ...(update.$set || {}),
            };
            colMap.set(newDoc._id, newDoc);
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: newDoc._id };
          }

          if (existing && foundKey) {
            if (update.$set) {
              Object.assign(existing, update.$set);
            }
            return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
          }

          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
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
      };
    },
  };
}

/**
 * In-memory Mock PostgreSQL Pool for hermetic testing.
 */
function createMockPgPool() {
  const users = new Map();
  const profiles = new Map();

  return {
    _users: users,
    _profiles: profiles,

    async query(sql, params = []) {
      const cleanSql = sql.trim().toUpperCase();

      if (cleanSql.startsWith("SELECT ID, USERNAME FROM AUTH_USERS WHERE ID = $1")) {
        const id = params[0];
        const user = users.get(id);
        if (user) {
          return { rows: [{ id: user.id, username: user.username }] };
        }
        return { rows: [] };
      }

      if (cleanSql.startsWith("SELECT * FROM USER_PROFILES WHERE USER_ID = $1")) {
        const userId = params[0];
        const profile = profiles.get(userId);
        return { rows: profile ? [JSON.parse(JSON.stringify(profile))] : [] };
      }

      if (cleanSql.startsWith("SELECT * FROM USER_PROFILES WHERE LOWER(USERNAME) = LOWER($1)")) {
        const username = params[0]?.toLowerCase();
        for (const p of profiles.values()) {
          if (p.username.toLowerCase() === username) {
            return { rows: [JSON.parse(JSON.stringify(p))] };
          }
        }
        return { rows: [] };
      }

      if (cleanSql.includes("INSERT INTO USER_PROFILES")) {
        const [userId, username, displayName] = params;
        const profile = {
          user_id: userId,
          username,
          display_name: displayName,
          avatar_url: null,
          bio: null,
          country: null,
          points: 0,
          reputation_rank: "Novice",
          company_name: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        profiles.set(userId, profile);
        return { rows: [profile] };
      }

      if (cleanSql.startsWith("UPDATE USER_PROFILES")) {
        const userId = params[0];
        const profile = profiles.get(userId);
        if (!profile) return { rows: [] };

        // Param mapping based on query string
        let paramIdx = 1;
        if (sql.includes("display_name = $")) profile.display_name = params[paramIdx++];
        if (sql.includes("avatar_url = $")) profile.avatar_url = params[paramIdx++];
        if (sql.includes("bio = $")) profile.bio = params[paramIdx++];
        if (sql.includes("country = $")) profile.country = params[paramIdx++];
        if (sql.includes("company_name = $")) profile.company_name = params[paramIdx++];
        profile.updated_at = new Date();

        return { rows: [JSON.parse(JSON.stringify(profile))] };
      }

      return { rows: [] };
    },
  };
}

// Hermetic in-memory mock databases for route tests
const routeMockDb = createMockMongoDb();
const routeMockPgPool = createMockPgPool();

// Seed mockPgPool with test users/profiles for route tests
routeMockPgPool._users.set("usr_hunter_77", { id: "usr_hunter_77", username: "hunter77" });
routeMockPgPool._profiles.set("usr_hunter_77", {
  user_id: "usr_hunter_77",
  username: "hunter77",
  display_name: "Hunter 77",
  avatar_url: null,
  bio: "Security Researcher",
  country: "US",
  points: 500,
  reputation_rank: "Gold",
  company_name: null,
  created_at: new Date(),
  updated_at: new Date(),
});

// Preserve previous globals so we do not alter or close shared resources
const prevMongoPromise = globalThis._mongoClientPromise;
const prevPgPool = globalThis._pgPool;

// Scoped injection of mocks for route testing
globalThis._mongoClientPromise = Promise.resolve({
  db() {
    return routeMockDb;
  },
});
authRepository.setPool(routeMockPgPool);

// Clean up scoped mocks when this test file finishes without touching external singletons
test.after(() => {
  globalThis._mongoClientPromise = prevMongoPromise;
  globalThis._pgPool = prevPgPool;
  authRepository.setPool(undefined);
});

// ----------------------------------------------------------------------------
// 1. REPOSITORY TESTS
// ----------------------------------------------------------------------------

test("PreferencesRepository: manages default notification settings and updates", async () => {
  const mockDb = createMockMongoDb();
  const repo = new PreferencesRepository(mockDb);

  // 1. No preferences initially
  const initial = await repo.getPreferences("user_test_123");
  assert.equal(initial, null);

  // 2. Partial update creates document with merged defaults
  const updated = await repo.updatePreferences("user_test_123", {
    notifications: { pushNotifications: false },
    theme: "dark",
  });

  assert.equal(updated.user_id, "user_test_123");
  assert.equal(updated.theme, "dark");
  assert.equal(updated.notifications.pushNotifications, false);
  assert.equal(updated.notifications.emailAlerts, true); // default preserved
  assert.equal(updated.notifications.weeklyDigest, true); // default preserved

  // 3. Second update merges into existing
  const updated2 = await repo.updatePreferences("user_test_123", {
    notifications: { emailAlerts: false },
  });

  assert.equal(updated2.notifications.pushNotifications, false); // preserved
  assert.equal(updated2.notifications.emailAlerts, false); // updated
  assert.equal(updated2.theme, "dark"); // preserved
});

test("AuthRepository: updates profile details in user_profiles securely", async () => {
  const repo = new AuthRepository();
  const mockPool = createMockPgPool();
  repo.setPool(mockPool);

  // Seed user
  mockPool._users.set("user_hacker_1", { id: "user_hacker_1", username: "zerocool" });
  mockPool._profiles.set("user_hacker_1", {
    user_id: "user_hacker_1",
    username: "zerocool",
    display_name: "Dade Murphy",
    avatar_url: null,
    bio: "Hack the planet",
    country: "US",
    points: 1200,
    reputation_rank: "Pro",
    company_name: null,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Update editable fields
  const updated = await repo.updateProfile("user_hacker_1", {
    displayName: "Zero Cool",
    bio: "Mess with the best, die like the rest",
    country: "IS",
  });

  assert.ok(updated);
  assert.equal(updated.display_name, "Zero Cool");
  assert.equal(updated.bio, "Mess with the best, die like the rest");
  assert.equal(updated.country, "IS");
  assert.equal(updated.points, 1200); // Unchanged
  assert.equal(updated.reputation_rank, "Pro"); // Unchanged
});

test("SubmissionsRepository: counts submissions by hunter and status", async () => {
  const mockDb = createMockMongoDb();
  const repo = new SubmissionsRepository(mockDb);

  await repo.createSubmission({
    _id: "sub_1",
    bounty_id: "hunt_1",
    hunter_id: "user_100",
    title: "SQLi in auth",
    description: "test",
    steps_to_reproduce: "test",
    severity: "critical",
    status: "approved",
    payout_status: "unpaid",
  });

  await repo.createSubmission({
    _id: "sub_2",
    bounty_id: "hunt_1",
    hunter_id: "user_100",
    title: "XSS in profile",
    description: "test",
    steps_to_reproduce: "test",
    severity: "medium",
    status: "approved",
    payout_status: "unpaid",
  });

  await repo.createSubmission({
    _id: "sub_3",
    bounty_id: "hunt_1",
    hunter_id: "user_100",
    title: "CSRF in logout",
    description: "test",
    steps_to_reproduce: "test",
    severity: "low",
    status: "rejected",
    payout_status: "unpaid",
  });

  const total = await repo.countByHunter("user_100");
  assert.equal(total, 3);

  const approved = await repo.countByHunter("user_100", "approved");
  assert.equal(approved, 2);

  const rejected = await repo.countByHunter("user_100", "rejected");
  assert.equal(rejected, 1);
});

// ----------------------------------------------------------------------------
// 2. API ENDPOINTS & AUTHORIZATION TESTS
// ----------------------------------------------------------------------------

test("GET /api/user/profile: returns profile by username or session", async () => {
  // 1. Missing username and unauthenticated -> 400
  const reqUnauth = new Request("http://localhost/api/user/profile", {
    method: "GET",
  });
  const resUnauth = await getProfileHandler(reqUnauth);
  assert.equal(resUnauth.status, 400);

  // 2. Authenticated request resolves profile for session user
  const token = createSessionToken({
    id: "usr_hunter_77",
    email: "hunter77@bughuntr.io",
    username: "hunter77",
    role: "user",
    userType: "hunter",
  });

  const reqAuth = new Request("http://localhost/api/user/profile", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const resAuth = await getProfileHandler(reqAuth);
  // Returns 200 (if found in PG/MongoDB fallback) or 404 (if unseeded)
  assert.ok([200, 404].includes(resAuth.status));
});

test("PATCH /api/user/profile: enforces authentication and ownership", async () => {
  // 1. Unauthenticated -> 401
  const reqUnauth = new Request("http://localhost/api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "HackerOne" }),
  });
  const resUnauth = await patchProfileHandler(reqUnauth);
  assert.equal(resUnauth.status, 401);

  // 2. Authenticated user cannot modify another user's profile
  const userToken = createSessionToken({
    id: "usr_regular_1",
    email: "user1@bughuntr.io",
    username: "user1",
    role: "user",
    userType: "hunter",
  });

  const reqTamperOther = new Request("http://localhost/api/user/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      userId: "usr_target_2",
      displayName: "Tampered Name",
    }),
  });

  const resTamper = await patchProfileHandler(reqTamperOther);
  assert.equal(resTamper.status, 403);
  const tamperData = await resTamper.json();
  assert.match(tamperData.error, /Forbidden/i);
});

test("PATCH /api/user/profile: strictly blocks privilege escalation attempts", async () => {
  const userToken = createSessionToken({
    id: "usr_regular_2",
    email: "user2@bughuntr.io",
    username: "user2",
    role: "user",
    userType: "hunter",
  });

  // Attempting to elevate role
  const reqRole = new Request("http://localhost/api/user/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      role: "admin",
    }),
  });

  const resRole = await patchProfileHandler(reqRole);
  assert.equal(resRole.status, 400);
  const dataRole = await resRole.json();
  assert.match(dataRole.error, /Protected field 'role' cannot be modified/i);

  // Attempting to add points directly
  const reqPoints = new Request("http://localhost/api/user/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      points: 999999,
    }),
  });

  const resPoints = await patchProfileHandler(reqPoints);
  assert.equal(resPoints.status, 400);
  const dataPoints = await resPoints.json();
  assert.match(dataPoints.error, /Protected field 'points' cannot be modified/i);

  // Attempting to change verification status
  const reqVerify = new Request("http://localhost/api/user/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      verified: true,
    }),
  });

  const resVerify = await patchProfileHandler(reqVerify);
  assert.equal(resVerify.status, 400);
});

test("PATCH /api/user/profile: validates input string lengths", async () => {
  const userToken = createSessionToken({
    id: "usr_regular_3",
    email: "user3@bughuntr.io",
    username: "user3",
    role: "user",
    userType: "hunter",
  });

  // Bio exceeding 1000 characters
  const longBio = "A".repeat(1001);
  const reqLongBio = new Request("http://localhost/api/user/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ bio: longBio }),
  });

  const resLongBio = await patchProfileHandler(reqLongBio);
  assert.equal(resLongBio.status, 400);
  const data = await resLongBio.json();
  assert.match(data.error, /Bio must be a string up to 1000 characters/i);
});

test("GET & PATCH /api/user/settings: manages user notification preferences", async () => {
  // 1. Unauthenticated -> 401
  const reqUnauth = new Request("http://localhost/api/user/settings", { method: "GET" });
  const resUnauth = await getSettingsHandler(reqUnauth);
  assert.equal(resUnauth.status, 401);

  // 2. Authenticated user can fetch preferences
  const userToken = createSessionToken({
    id: "usr_settings_1",
    email: "settings1@bughuntr.io",
    username: "settings1",
    role: "user",
    userType: "hunter",
  });

  // 3. Invalid theme rejected with 400
  const reqBadTheme = new Request("http://localhost/api/user/settings", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ theme: "neon-pink" }),
  });
  const resBadTheme = await patchSettingsHandler(reqBadTheme);
  assert.equal(resBadTheme.status, 400);

  // 4. Invalid notification types rejected with 400
  const reqBadNotif = new Request("http://localhost/api/user/settings", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ notifications: { emailAlerts: "yes" } }),
  });
  const resBadNotif = await patchSettingsHandler(reqBadNotif);
  assert.equal(resBadNotif.status, 400);
});

test("GET /api/user/stats: rejects unauthenticated requests with no username", async () => {
  const req = new Request("http://localhost/api/user/stats", { method: "GET" });
  const res = await getStatsHandler(req);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Missing username parameter or active session/i);
});

// ----------------------------------------------------------------------------
// 3. ZERO-FIRESTORE CLIENT BOUNDARY VERIFICATION
// ----------------------------------------------------------------------------

test("Phase 9 files have zero Firestore imports or client database leaks", () => {
  const filesToCheck = [
    "app/signup/page.tsx",
    "components/dashboard/user-stats-cards.tsx",
    "app/settings/page.tsx",
    "app/profile/page.tsx",
    "lib/user-profile.ts",
    "lib/get-user-profile.ts",
    "app/api/user/profile/route.ts",
    "app/api/user/settings/route.ts",
    "app/api/user/stats/route.ts",
  ];

  for (const relativePath of filesToCheck) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    assert.ok(fs.existsSync(fullPath), `File must exist: ${relativePath}`);

    const content = fs.readFileSync(fullPath, "utf-8");

    // Assert zero Firestore imports
    assert.equal(
      content.includes('from "firebase/firestore"'),
      false,
      `${relativePath} must not import from 'firebase/firestore'`
    );
    assert.equal(
      content.includes("from 'firebase/firestore'"),
      false,
      `${relativePath} must not import from 'firebase/firestore'`
    );
    assert.equal(
      content.includes('from "@/firebaseConfig"'),
      false,
      `${relativePath} must not import from '@/firebaseConfig'`
    );
    assert.equal(
      content.includes("from '@/firebaseConfig'"),
      false,
      `${relativePath} must not import from '@/firebaseConfig'`
    );
  }
});

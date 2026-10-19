import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  AuthRepository,
  DuplicateAccountError,
} from "../lib/db/auth-repository.ts";
import {
  getUserProfilesBatch,
  getUserProfileByUsername,
  getUserProfileById,
} from "../lib/db/users.ts";
import {
  createSessionToken,
  verifySessionToken,
} from "../lib/server-auth.ts";

/**
 * Creates an in-memory mock PostgreSQL client and pool for safe, non-destructive testing
 * without requiring live database connections or network access.
 */
function createMockPgPool() {
  const users = new Map();
  const profiles = new Map();
  const roles = new Map();
  const credentials = new Map();
  const auditLogs = [];

  let inTransaction = false;

  const mockClient = {
    async query(sql, params = []) {
      const normalizedSql = sql.trim().toUpperCase();

      if (normalizedSql === "BEGIN") {
        inTransaction = true;
        return { rows: [] };
      }
      if (normalizedSql === "COMMIT") {
        inTransaction = false;
        return { rows: [] };
      }
      if (normalizedSql === "ROLLBACK") {
        inTransaction = false;
        return { rows: [] };
      }

      // 1. INSERT INTO auth_users
      if (normalizedSql.includes("INSERT INTO AUTH_USERS")) {
        const [id, email, email_verified, password_hash, legacy_firestore_id] = params;
        // Check duplicate email
        for (const u of users.values()) {
          if (u.email.toLowerCase() === email.toLowerCase()) {
            const err = new Error("duplicate key value violates unique constraint \"uq_auth_users_email\"");
            err.code = "23505";
            err.constraint = "uq_auth_users_email";
            throw err;
          }
        }

        const userRow = {
          id,
          email,
          email_verified,
          password_hash,
          legacy_firestore_id,
          is_active: true,
          is_banned: false,
          last_sign_in_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        users.set(id, userRow);
        return { rows: [userRow] };
      }

      // 2. INSERT INTO user_roles
      if (normalizedSql.includes("INSERT INTO USER_ROLES")) {
        const [id, user_id, role] = params;
        const roleKey = `${user_id}:${role}`;
        roles.set(roleKey, { id, user_id, role, assigned_at: new Date() });
        return { rows: [] };
      }

      // 3. INSERT INTO user_profiles
      if (normalizedSql.includes("INSERT INTO USER_PROFILES")) {
        const [user_id, username, display_name, company_name] = params;
        // Check duplicate username
        for (const p of profiles.values()) {
          if (p.username.toLowerCase() === username.toLowerCase()) {
            const err = new Error("duplicate key value violates unique constraint \"uq_user_profiles_username\"");
            err.code = "23505";
            err.constraint = "uq_user_profiles_username";
            throw err;
          }
        }

        const profileRow = {
          user_id,
          username,
          display_name,
          company_name,
          avatar_url: null,
          bio: null,
          country: null,
          points: 0,
          reputation_rank: "Novice",
          created_at: new Date(),
          updated_at: new Date(),
        };
        profiles.set(user_id, profileRow);
        return { rows: [profileRow] };
      }

      // 4. INSERT INTO auth_audit_log
      if (normalizedSql.includes("INSERT INTO AUTH_AUDIT_LOG")) {
        const [user_id, event_type, ip_address, user_agent, metadata] = params;
        auditLogs.push({
          id: auditLogs.length + 1,
          user_id,
          event_type,
          ip_address,
          user_agent,
          metadata: JSON.parse(metadata),
          created_at: new Date(),
        });
        return { rows: [] };
      }

      // 5. SELECT auth_users by email
      if (normalizedSql.includes("FROM AUTH_USERS") && normalizedSql.includes("LOWER(U.EMAIL) = $1")) {
        const [email] = params;
        const user = Array.from(users.values()).find(u => u.email.toLowerCase() === email.toLowerCase());
        if (!user) return { rows: [] };

        const profile = profiles.get(user.id);
        const userRoles = Array.from(roles.values())
          .filter(r => r.user_id === user.id)
          .map(r => r.role);

        return {
          rows: [
            {
              ...user,
              username: profile?.username || null,
              display_name: profile?.display_name || null,
              avatar_url: profile?.avatar_url || null,
              bio: profile?.bio || null,
              country: profile?.country || null,
              points: profile?.points || 0,
              reputation_rank: profile?.reputation_rank || "Novice",
              company_name: profile?.company_name || null,
              roles: userRoles,
            },
          ],
        };
      }

      // 6. SELECT auth_users by ID
      if (normalizedSql.includes("FROM AUTH_USERS") && normalizedSql.includes("U.ID = $1")) {
        const [id] = params;
        const user = users.get(id);
        if (!user) return { rows: [] };

        const profile = profiles.get(id);
        const userRoles = Array.from(roles.values())
          .filter(r => r.user_id === id)
          .map(r => r.role);

        return {
          rows: [
            {
              ...user,
              username: profile?.username || null,
              display_name: profile?.display_name || null,
              avatar_url: profile?.avatar_url || null,
              bio: profile?.bio || null,
              country: profile?.country || null,
              points: profile?.points || 0,
              reputation_rank: profile?.reputation_rank || "Novice",
              company_name: profile?.company_name || null,
              roles: userRoles,
            },
          ],
        };
      }

      // 7. SELECT user_profiles by username
      if (normalizedSql.includes("FROM USER_PROFILES") && normalizedSql.includes("LOWER(USERNAME) = LOWER($1)")) {
        const [username] = params;
        const profile = Array.from(profiles.values()).find(
          p => p.username.toLowerCase() === username.toLowerCase()
        );
        return { rows: profile ? [profile] : [] };
      }

      // 8. SELECT user_profiles batch: WHERE user_id = ANY($1)
      if (normalizedSql.includes("FROM USER_PROFILES") && normalizedSql.includes("USER_ID = ANY($1)")) {
        const [ids] = params;
        const matching = ids
          .map(id => profiles.get(id))
          .filter(Boolean);
        return { rows: matching };
      }

      // 9. UPDATE auth_users last_sign_in_at
      if (normalizedSql.includes("UPDATE AUTH_USERS SET LAST_SIGN_IN_AT")) {
        const [id] = params;
        const user = users.get(id);
        if (user) {
          user.last_sign_in_at = new Date();
          user.updated_at = new Date();
        }
        return { rows: [] };
      }

      // 10. INSERT/UPDATE user_credentials
      if (normalizedSql.includes("INSERT INTO USER_CREDENTIALS")) {
        const [id, user_id, credential_type, secret_hash, is_enabled] = params;
        const cred = {
          id,
          user_id,
          credential_type,
          secret_hash,
          is_enabled,
          last_verified_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        credentials.set(`${user_id}:${credential_type}`, cred);
        return { rows: [cred] };
      }

      // 11. SELECT user_credentials
      if (normalizedSql.includes("FROM USER_CREDENTIALS")) {
        const [user_id, credType] = params;
        const userCreds = Array.from(credentials.values()).filter(c => {
          if (c.user_id !== user_id) return false;
          if (credType && c.credential_type !== credType) return false;
          return true;
        });
        return { rows: userCreds };
      }

      // 12. SELECT user_roles
      if (normalizedSql.includes("FROM USER_ROLES")) {
        const [user_id] = params;
        const userRoles = Array.from(roles.values()).filter(r => r.user_id === user_id);
        return { rows: userRoles };
      }

      return { rows: [] };
    },
    release() {},
  };

  return {
    async query(sql, params) {
      return mockClient.query(sql, params);
    },
    async connect() {
      return mockClient;
    },
    // Expose in-memory stores for verification
    _stores: { users, profiles, roles, credentials, auditLogs },
  };
}

// ---------------------------------------------------------------------------
// 1. User Creation & Constraint Integrity Tests
// ---------------------------------------------------------------------------
test("AuthRepository: createUser successfully creates auth_user, profile, role, and audit log", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  const user = await repo.createUser({
    email: "hunter@bughuntr.io",
    passwordHash: "$2b$10$hashed_test_password_for_verification",
    username: "elite_hunter",
    displayName: "Elite Bug Hunter",
    role: "hunter",
    userType: "hunter",
    ipAddress: "192.168.1.100",
    userAgent: "Mozilla/5.0 TestSuite",
  });

  assert.ok(user.id, "User ID must be generated");
  assert.strictEqual(typeof user.id, "string");
  assert.strictEqual(user.id.length > 0, true);
  assert.strictEqual(user.email, "hunter@bughuntr.io");
  assert.strictEqual(user.roles[0], "hunter");
  assert.ok(user.profile, "User profile must be populated");
  assert.strictEqual(user.profile.username, "elite_hunter");
  assert.strictEqual(user.profile.display_name, "Elite Bug Hunter");
  assert.strictEqual(user.profile.points, 0);

  // Check audit log
  const logs = pool._stores.auditLogs;
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].event_type, "user_signup");
  assert.strictEqual(logs[0].user_id, user.id);
  assert.strictEqual(logs[0].ip_address, "192.168.1.100");
});

test("AuthRepository: createUser preserves legacy Firestore document ID if provided", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  const legacyId = "BH-LEGACY-7xN0kP9zQ2a";
  const user = await repo.createUser({
    id: legacyId,
    email: "legacy@bughuntr.io",
    passwordHash: "$2b$10$test_hash",
    username: "legacy_user",
    legacyFirestoreId: legacyId,
    role: "hunter",
  });

  assert.strictEqual(user.id, legacyId, "Must preserve the explicit legacy ID");
  assert.strictEqual(user.legacy_firestore_id, legacyId);
  assert.strictEqual(user.profile.user_id, legacyId);
});

test("AuthRepository: createUser rejects duplicate email with DuplicateAccountError", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  await repo.createUser({
    email: "duplicate@bughuntr.io",
    passwordHash: "hash1",
    username: "user_one",
  });

  await assert.rejects(
    async () => {
      await repo.createUser({
        email: "DUPLICATE@bughuntr.io", // Case-insensitive duplicate check
        passwordHash: "hash2",
        username: "user_two",
      });
    },
    (err) => {
      assert.ok(err instanceof DuplicateAccountError);
      assert.strictEqual(err.field, "email");
      return true;
    }
  );
});

test("AuthRepository: createUser rejects duplicate username with DuplicateAccountError", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  await repo.createUser({
    email: "user1@bughuntr.io",
    passwordHash: "hash1",
    username: "unique_hunter",
  });

  await assert.rejects(
    async () => {
      await repo.createUser({
        email: "user2@bughuntr.io",
        passwordHash: "hash2",
        username: "unique_hunter",
      });
    },
    (err) => {
      assert.ok(err instanceof DuplicateAccountError);
      assert.strictEqual(err.field, "username");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 2. User Lookup Tests
// ---------------------------------------------------------------------------
test("AuthRepository: findUserByEmail returns full profile and assigned roles", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  const created = await repo.createUser({
    email: "triage@bughuntr.io",
    passwordHash: "$2b$10$secure_hash",
    username: "triager_lead",
    role: "triager",
  });

  const found = await repo.findUserByEmail("TRIAGE@bughuntr.io");
  assert.ok(found, "User should be found by email");
  assert.strictEqual(found.id, created.id);
  assert.strictEqual(found.email, "triage@bughuntr.io");
  assert.strictEqual(found.roles.includes("triager"), true);
  assert.strictEqual(found.profile?.username, "triager_lead");
});

test("AuthRepository: findUserById resolves user by stable string ID", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  const created = await repo.createUser({
    id: "user-uuid-9999",
    email: "lookup@bughuntr.io",
    passwordHash: "$2b$10$test",
    username: "lookup_test",
  });

  const found = await repo.findUserById("user-uuid-9999");
  assert.ok(found);
  assert.strictEqual(found.id, "user-uuid-9999");
  assert.strictEqual(found.profile?.username, "lookup_test");
});

test("AuthRepository: findUserByEmail returns null for non-existent email", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  const found = await repo.findUserByEmail("missing@bughuntr.io");
  assert.strictEqual(found, null);
});

// ---------------------------------------------------------------------------
// 3. Batch Profile Hydration Tests (Application Gateway Pattern)
// ---------------------------------------------------------------------------
test("AuthRepository: getUserProfilesBatch resolves multiple hunter IDs in one call", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  const u1 = await repo.createUser({
    id: "hunter-101",
    email: "h1@test.com",
    passwordHash: "h",
    username: "hunter_alpha",
    displayName: "Alpha Hunter",
  });

  const u2 = await repo.createUser({
    id: "hunter-102",
    email: "h2@test.com",
    passwordHash: "h",
    username: "hunter_beta",
    displayName: "Beta Hunter",
  });

  // Batch lookup for MongoDB submission hydration
  const profileMap = await repo.getUserProfilesBatch(["hunter-101", "hunter-102", "hunter-non-existent"]);
  assert.strictEqual(profileMap instanceof Map, true);
  assert.strictEqual(profileMap.size, 2);

  const p1 = profileMap.get("hunter-101");
  assert.ok(p1);
  assert.strictEqual(p1.username, "hunter_alpha");
  assert.strictEqual(p1.display_name, "Alpha Hunter");

  const p2 = profileMap.get("hunter-102");
  assert.ok(p2);
  assert.strictEqual(p2.username, "hunter_beta");

  assert.strictEqual(profileMap.has("hunter-non-existent"), false);
});

test("AuthRepository: getUserProfilesBatch handles empty and duplicate ID arrays safely", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  const emptyMap = await repo.getUserProfilesBatch([]);
  assert.strictEqual(emptyMap.size, 0);

  const u1 = await repo.createUser({
    id: "hunter-dup",
    email: "dup@test.com",
    passwordHash: "h",
    username: "dup_hunter",
  });

  const dupMap = await repo.getUserProfilesBatch(["hunter-dup", "hunter-dup", "  hunter-dup  "]);
  assert.strictEqual(dupMap.size, 1);
  assert.strictEqual(dupMap.get("hunter-dup")?.username, "dup_hunter");
});

// ---------------------------------------------------------------------------
// 4. Two-Factor Authentication & Credential Storage
// ---------------------------------------------------------------------------
test("AuthRepository: setUserCredential and getUserCredentials manage 2FA secrets", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  const user = await repo.createUser({
    id: "2fa-user",
    email: "2fa@bughuntr.io",
    passwordHash: "h",
    username: "totp_user",
  });

  const cred = await repo.setUserCredential(
    user.id,
    "totp",
    "encrypted_secret_or_hash_12345",
    true
  );

  assert.strictEqual(cred.credential_type, "totp");
  assert.strictEqual(cred.is_enabled, true);

  const fetched = await repo.getUserCredentials(user.id, "totp");
  assert.strictEqual(fetched.length, 1);
  assert.strictEqual(fetched[0].secret_hash, "encrypted_secret_or_hash_12345");
});

// ---------------------------------------------------------------------------
// 5. Security Audit Log Tests
// ---------------------------------------------------------------------------
test("AuthRepository: recordAuthAuditLog logs immutable events", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  await repo.recordAuthAuditLog({
    user_id: "user-abc",
    event_type: "password_reset_requested",
    ip_address: "10.0.0.1",
    user_agent: "SecurityScanner/1.0",
    metadata: { reason: "user_forgot_password" },
  });

  const logs = pool._stores.auditLogs;
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].event_type, "password_reset_requested");
  assert.strictEqual(logs[0].user_id, "user-abc");
  assert.strictEqual(logs[0].metadata.reason, "user_forgot_password");
});

// ---------------------------------------------------------------------------
// 6. Session Token Cross-Compatibility
// ---------------------------------------------------------------------------
test("SessionToken: compatible with SessionUser shape created from PostgreSQL user", () => {
  const sessionUser = {
    id: "user-pg-12345",
    email: "admin@bughuntr.io",
    username: "admin_user",
    role: "admin",
    userType: "hunter",
  };

  const token = createSessionToken(sessionUser);
  assert.strictEqual(typeof token, "string");
  assert.ok(token.includes("."));

  const verified = verifySessionToken(token);
  assert.strictEqual(verified.valid, true);
  assert.deepStrictEqual(verified.user, sessionUser);
});

// ---------------------------------------------------------------------------
// 7. Identity Contract: String Primary Key Invariants
// ---------------------------------------------------------------------------
test("Identity Contract: PostgreSQL user IDs strictly satisfy VARCHAR(128) string contract", async () => {
  const pool = createMockPgPool();
  const repo = new AuthRepository(pool);

  // 1. UUID v4 string
  const uuidUser = await repo.createUser({
    id: "a0000000-0000-0000-0000-000000000001",
    email: "uuid@bughuntr.io",
    passwordHash: "h",
    username: "uuid_user",
  });
  assert.strictEqual(typeof uuidUser.id, "string");
  assert.strictEqual(uuidUser.id.length <= 128, true);

  // 2. Legacy alphanumeric Firestore ID
  const legacyUser = await repo.createUser({
    id: "7xN0kP9zQ2aCustomLegacyDocId",
    email: "legacy_alphanumeric@bughuntr.io",
    passwordHash: "h",
    username: "legacy_alpha_user",
    legacyFirestoreId: "7xN0kP9zQ2aCustomLegacyDocId",
  });
  assert.strictEqual(typeof legacyUser.id, "string");
  assert.strictEqual(legacyUser.id.length <= 128, true);

  // 3. Batch lookup works transparently across both formats
  const batchMap = await repo.getUserProfilesBatch([uuidUser.id, legacyUser.id]);
  assert.strictEqual(batchMap.has(uuidUser.id), true);
  assert.strictEqual(batchMap.has(legacyUser.id), true);
  assert.strictEqual(batchMap.get(uuidUser.id)?.username, "uuid_user");
  assert.strictEqual(batchMap.get(legacyUser.id)?.username, "legacy_alpha_user");
});

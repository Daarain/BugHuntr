import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { AuthRepository, DuplicateAccountError } from "../lib/db/auth-repository.ts";
import { getPostgresPool } from "../lib/db/postgres.ts";
import { getMongoDatabase, getMongoClient } from "../lib/db/mongodb.ts";
import { WalletsRepository } from "../lib/db/repositories/wallets.repo.ts";

test("Live PostgreSQL & MongoDB Integration Verification", async (t) => {
  const pgPool = getPostgresPool();
  const mongoDb = await getMongoDatabase();
  const mongoClient = await getMongoClient();

  const runId = crypto.randomBytes(4).toString("hex");
  const testEmail = `test_hunter_${runId}@example.com`;
  const testUsername = `test_h_${runId}`;
  let createdUserId = null;
  const testOrgId = `org_test_${runId}`;

  try {
    // -----------------------------------------------------------------------
    // 1. PostgreSQL AuthRepository Live Integration
    // -----------------------------------------------------------------------
    await t.test("PostgreSQL AuthRepository: createUser writes to database", async () => {
      const authRepo = new AuthRepository(pgPool);
      const user = await authRepo.createUser({
        email: testEmail,
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMN",
        role: "hunter",
        username: testUsername,
        displayName: "Live Integration Hunter",
        metadata: { source: "integration_test", runId },
      });

      assert(user, "User should be created");
      assert(user.id, "User ID should be generated");
      assert.strictEqual(user.email, testEmail);
      assert.strictEqual(user.roles.includes("hunter"), true);
      assert.strictEqual(user.profile.username, testUsername);
      createdUserId = user.id;

      // Verify directly from PostgreSQL catalog
      const pgRes = await pgPool.query(
        "SELECT id, email, is_active FROM auth_users WHERE id = $1",
        [createdUserId]
      );
      assert.strictEqual(pgRes.rows.length, 1);
      assert.strictEqual(pgRes.rows[0].email, testEmail);
      assert.strictEqual(pgRes.rows[0].is_active, true);
    });

    await t.test("PostgreSQL AuthRepository: findUserByEmail retrieves user with profile and roles", async () => {
      const authRepo = new AuthRepository(pgPool);
      const user = await authRepo.findUserByEmail(testEmail);

      assert(user, "User must be found by email");
      assert.strictEqual(user.id, createdUserId);
      assert.strictEqual(user.email, testEmail);
      assert(user.profile, "User profile must exist");
      assert.strictEqual(user.profile.username, testUsername);
      assert.strictEqual(user.profile.display_name, "Live Integration Hunter");
      assert(Array.isArray(user.roles), "Roles must be an array");
      assert(user.roles.includes("hunter"), "Role must include 'hunter'");
    });

    await t.test("PostgreSQL AuthRepository: findUserById retrieves user by stable string ID", async () => {
      const authRepo = new AuthRepository(pgPool);
      const user = await authRepo.findUserById(createdUserId);

      assert(user, "User must be found by ID");
      assert.strictEqual(user.id, createdUserId);
      assert.strictEqual(user.email, testEmail);
    });

    await t.test("PostgreSQL AuthRepository: findProfileByUsername resolves profile", async () => {
      const authRepo = new AuthRepository(pgPool);
      const profile = await authRepo.findProfileByUsername(testUsername);

      assert(profile, "Profile must be found by username");
      assert.strictEqual(profile.user_id, createdUserId);
      assert.strictEqual(profile.username, testUsername);
    });

    await t.test("PostgreSQL AuthRepository: getUserProfilesBatch batch resolves user profiles", async () => {
      const authRepo = new AuthRepository(pgPool);
      const batch = await authRepo.getUserProfilesBatch([createdUserId]);

      assert.strictEqual(batch.size, 1);
      assert(batch.has(createdUserId));
      assert.strictEqual(batch.get(createdUserId).username, testUsername);
    });

    await t.test("PostgreSQL AuthRepository: credentials and last sign-in management", async () => {
      const authRepo = new AuthRepository(pgPool);

      // Update last sign in
      await authRepo.updateLastSignIn(createdUserId);
      const userAfterSignIn = await authRepo.findUserById(createdUserId);
      assert(userAfterSignIn.last_sign_in_at instanceof Date);

      // Set and verify credential
      await authRepo.setUserCredential(createdUserId, "totp", "encrypted_totp_secret");
      const creds = await authRepo.getUserCredentials(createdUserId);
      assert.strictEqual(creds.length, 1);
      assert.strictEqual(creds[0].credential_type, "totp");
      assert.strictEqual(creds[0].secret_hash, "encrypted_totp_secret");
    });

    await t.test("PostgreSQL AuthRepository: rejects duplicate email with DuplicateAccountError", async () => {
      const authRepo = new AuthRepository(pgPool);
      await assert.rejects(
        async () => {
          await authRepo.createUser({
            email: testEmail,
            passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMN",
            role: "hunter",
            username: `uniq_${runId}`,
          });
        },
        DuplicateAccountError
      );
    });

    // -----------------------------------------------------------------------
    // 2. MongoDB WalletsRepository Live Integration
    // -----------------------------------------------------------------------
    await t.test("MongoDB WalletsRepository: create wallet, reserve, and release", async () => {
      const walletsRepo = new WalletsRepository(mongoDb);

      // Create test wallet
      const wallet = await walletsRepo.createWallet({
        org_id: testOrgId,
        currency: "USDC",
        network: "POLYGON",
        balance: 500,
        reserved: 0,
      });
      assert(wallet, "Wallet should be created");
      assert.strictEqual(wallet.org_id, testOrgId);
      assert.strictEqual(wallet.balance, 500);
      assert.strictEqual(wallet.reserved, 0);

      // Reserve 150
      const reserveRes = await walletsRepo.reserveFunds(testOrgId, 150);
      assert.strictEqual(reserveRes.success, true, "Funds should be reserved");
      assert.strictEqual(reserveRes.availableBalance, 350);

      const afterReserve = await walletsRepo.getWallet(testOrgId);
      assert.strictEqual(afterReserve.balance, 500);
      assert.strictEqual(afterReserve.reserved, 150);

      // Release 150
      const released = await walletsRepo.releaseFunds(testOrgId, 150);
      assert.strictEqual(released, true, "Funds should be released");

      const afterRelease = await walletsRepo.getWallet(testOrgId);
      assert.strictEqual(afterRelease.reserved, 0);
      assert.strictEqual(afterRelease.balance, 500);
    });
  } finally {
    // -----------------------------------------------------------------------
    // 3. Isolated Cleanup (Zero leftover records)
    // -----------------------------------------------------------------------
    if (createdUserId) {
      try {
        await pgPool.query("DELETE FROM auth_audit_log WHERE user_id = $1 OR metadata->>'email' = $2", [createdUserId, testEmail]);
        await pgPool.query("DELETE FROM auth_users WHERE id = $1", [createdUserId]);
        const verifyDeleted = await pgPool.query("SELECT id FROM auth_users WHERE id = $1", [createdUserId]);
        assert.strictEqual(verifyDeleted.rows.length, 0, "Test user must be cleaned up from PostgreSQL");
      } catch (err) {
        console.error("Cleanup error in PostgreSQL:", err.message);
      }
    }

    try {
      const walletsColl = mongoDb.collection("org_wallets");
      await walletsColl.deleteOne({ org_id: testOrgId });
      const verifyMongo = await walletsColl.findOne({ org_id: testOrgId });
      assert.strictEqual(verifyMongo, null, "Test wallet must be cleaned up from MongoDB");
    } catch (err) {
      console.error("Cleanup error in MongoDB:", err.message);
    }

    // Teardown
    await pgPool.end();
    await mongoClient.close();
  }
});

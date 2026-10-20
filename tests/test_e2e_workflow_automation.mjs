import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

// Application route handlers
import { POST as signupHandler } from "../app/api/auth/signup/route.ts";
import { POST as loginHandler } from "../app/api/auth/login/route.ts";
import { POST as logoutHandler } from "../app/api/auth/logout/route.ts";
import { GET as meHandler } from "../app/api/auth/me/route.ts";
import { GET as getHuntsHandler, POST as postHuntsHandler } from "../app/api/bug-hunts/route.ts";
import {
  GET as getHuntByIdHandler,
  PATCH as patchHuntByIdHandler,
  DELETE as deleteHuntByIdHandler,
} from "../app/api/bug-hunts/[id]/route.ts";
import {
  GET as getSubmissionsHandler,
  POST as postSubmissionsHandler,
} from "../app/api/bug-submissions/route.ts";
import {
  GET as getSubmissionByIdHandler,
  PATCH as patchSubmissionByIdHandler,
  DELETE as deleteSubmissionByIdHandler,
} from "../app/api/bug-submissions/[id]/route.ts";

// Database and authentication helpers
import { getPostgresPool } from "../lib/db/postgres.ts";
import { getMongoDatabase, getMongoClient } from "../lib/db/mongodb.ts";
import { AuthRepository } from "../lib/db/auth-repository.ts";
import { createChallengeToken } from "../lib/auth-2fa.ts";

/**
 * BugHuntr Full Integration Workflow & Database Verification
 *
 * Verifies the complete lifecycle using actual Next.js API route handlers
 * and live Supabase PostgreSQL + MongoDB Atlas databases:
 * 1. Administrator provisioning (Authoritative AuthRepository)
 * 2. Administrator authentication & 2FA enforcement
 * 3. Bug bounty hunt creation & authorization
 * 4. Regular hunter signup & privilege escalation prevention
 * 5. Regular hunter login & session persistence
 * 6. Bug hunt discovery & access
 * 7. Bug submission, duplicate detection, and hunter ID binding
 * 8. Administrator review, triage, and status transition
 * 9. Independent database persistence & schema integrity verification
 * 10. Logout session invalidation
 * 11. Complete isolated cleanup & verification (100% audit log restoration)
 */

test("BugHuntr Complete Integration Workflow & Database Verification", async (t) => {
  const runId = crypto.randomBytes(4).toString("hex");
  const testTag = `e2e_${runId}`;

  // Unique disposable test account credentials
  const adminEmail = `test_admin_${testTag}@example.com`;
  const adminUsername = `adm_${testTag}`;
  const adminPassword = `AdminPass123!_${runId}`;
  let adminUserId = null;
  let adminSessionCookie = null;

  const hunterEmail = `test_hunter_${testTag}@example.com`;
  const hunterUsername = `hnt_${testTag}`;
  const hunterPassword = `HunterPass123!_${runId}`;
  let hunterUserId = null;
  let hunterSessionCookie = null;

  let createdHuntId = null;
  let createdSubmissionId = null;

  // Real database connections
  const pgPool = getPostgresPool();
  const mongoDb = await getMongoDatabase();
  const mongoClient = await getMongoClient();
  const authRepo = new AuthRepository(pgPool);

  // Capture baseline record count to verify zero audit log leakage
  const initialAuditRes = await pgPool.query("SELECT count(*) FROM auth_audit_log");
  const initialAuditCount = parseInt(initialAuditRes.rows[0].count, 10);

  // Helper to extract session cookie from a NextResponse
  function extractSessionCookie(res) {
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return null;
    const match = setCookie.match(/bughuntr_session=([^;]+)/);
    return match ? match[1] : null;
  }

  // Helper to build a NextRequest with JSON body and cookie
  function buildRequest(url, method, body = null, cookie = null) {
    const headers = new Headers();
    if (body) {
      headers.set("content-type", "application/json");
    }
    if (cookie) {
      headers.set("cookie", `bughuntr_session=${cookie}`);
    }
    const init = {
      method,
      headers,
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    return new NextRequest(url, init);
  }

  try {
    // =========================================================================
    // STAGE 1: Administrator Provisioning
    // =========================================================================
    await t.test("Stage 1: Provision disposable test administrator via AuthRepository", async () => {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      const adminUser = await authRepo.createUser({
        email: adminEmail,
        passwordHash,
        username: adminUsername,
        displayName: `Test Admin ${testTag}`,
        role: "admin",
        userType: "company",
        companyName: `Test Org ${testTag}`,
        metadata: { runId, source: "e2e_workflow_test" },
      });

      assert.ok(adminUser, "Admin user must be created");
      assert.ok(adminUser.id, "Admin user ID must be generated");
      assert.strictEqual(adminUser.email, adminEmail);
      assert.ok(adminUser.roles.includes("admin"), "User roles must include 'admin'");
      adminUserId = adminUser.id;

      // Verify PostgreSQL persistence
      const pgUserRes = await pgPool.query(
        "SELECT id, email, password_hash, is_active, is_banned FROM auth_users WHERE id = $1",
        [adminUserId]
      );
      assert.strictEqual(pgUserRes.rows.length, 1);
      assert.strictEqual(pgUserRes.rows[0].email, adminEmail);
      assert.strictEqual(pgUserRes.rows[0].is_active, true);
      assert.strictEqual(pgUserRes.rows[0].is_banned, false);
      assert.ok(
        pgUserRes.rows[0].password_hash.startsWith("$2a$") || pgUserRes.rows[0].password_hash.startsWith("$2b$"),
        "Password must be stored strictly as bcrypt hash, never plaintext"
      );

      // Verify role persistence
      const pgRoleRes = await pgPool.query(
        "SELECT role FROM user_roles WHERE user_id = $1",
        [adminUserId]
      );
      assert.strictEqual(pgRoleRes.rows.length, 1);
      assert.strictEqual(pgRoleRes.rows[0].role, "admin");

      // Verify profile persistence
      const pgProfileRes = await pgPool.query(
        "SELECT username, display_name FROM user_profiles WHERE user_id = $1",
        [adminUserId]
      );
      assert.strictEqual(pgProfileRes.rows.length, 1);
      assert.strictEqual(pgProfileRes.rows[0].username, adminUsername);

      // Verify audit log entry
      const pgAuditRes = await pgPool.query(
        "SELECT event_type FROM auth_audit_log WHERE user_id = $1 AND event_type = 'user_signup'",
        [adminUserId]
      );
      assert.strictEqual(pgAuditRes.rows.length >= 1, true, "user_signup audit log must be recorded");
    });

    // =========================================================================
    // STAGE 2: Administrator Authentication & 2FA Enforcement
    // =========================================================================
    await t.test("Stage 2A: Rejects admin login with invalid password", async () => {
      const req = buildRequest("http://localhost:3000/api/auth/login", "POST", {
        email: adminEmail,
        password: "WrongPassword999!",
      });
      const res = await loginHandler(req);
      assert.strictEqual(res.status, 401, "Invalid password must return 401");
      const data = await res.json();
      assert.strictEqual(data.error, "Invalid email or password.");

      // Verify login_failed_password was logged to audit log
      const auditRes = await pgPool.query(
        "SELECT event_type FROM auth_audit_log WHERE user_id = $1 AND event_type = 'login_failed_password'",
        [adminUserId]
      );
      assert.strictEqual(auditRes.rows.length >= 1, true, "login_failed_password must be logged");
    });

    await t.test("Stage 2B: Enforces 2FA challenge for administrator account", async () => {
      // Login attempt without 2FA challenge code
      const req = buildRequest("http://localhost:3000/api/auth/login", "POST", {
        email: adminEmail,
        password: adminPassword,
      });
      const res = await loginHandler(req);
      // Because email transport is not configured in this test environment, the server
      // safely fails closed with 503 ("Two-factor authentication provider is unconfigured.")
      // while signaling requires2FA: true.
      assert.ok(res.status === 200 || res.status === 503, "Must require 2FA challenge");
      const data = await res.json();
      assert.strictEqual(data.requires2FA, true, "requires2FA must be true for admin");
    });

    await t.test("Stage 2C: Admin login rejects invalid 2FA code", async () => {
      const code = "789123";
      const challengeToken = createChallengeToken(adminEmail, code);

      const req = buildRequest("http://localhost:3000/api/auth/login", "POST", {
        email: adminEmail,
        password: adminPassword,
        challengeToken,
        twoFactorCode: "000000", // Wrong code
      });
      const res = await loginHandler(req);
      assert.strictEqual(res.status, 400, "Wrong 2FA code must return 400");
      const data = await res.json();
      assert.strictEqual(data.requires2FA, true);
      assert.strictEqual(data.attemptsRemaining, 2);
    });

    await t.test("Stage 2D: Admin login succeeds with valid 2FA code and sets session", async () => {
      const validCode = "654321";
      const challengeToken = createChallengeToken(adminEmail, validCode);

      const req = buildRequest("http://localhost:3000/api/auth/login", "POST", {
        email: adminEmail,
        password: adminPassword,
        challengeToken,
        twoFactorCode: validCode,
      });
      const res = await loginHandler(req);
      assert.strictEqual(res.status, 200, "Valid 2FA login must return 200");
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.user.role, "admin");
      assert.strictEqual(data.user.email, adminEmail);

      adminSessionCookie = extractSessionCookie(res);
      assert.ok(adminSessionCookie, "Admin bughuntr_session cookie must be set");

      // Verify PostgreSQL updated last_sign_in_at and login_success audit log
      const pgUserAfter = await pgPool.query(
        "SELECT last_sign_in_at FROM auth_users WHERE id = $1",
        [adminUserId]
      );
      assert.ok(pgUserAfter.rows[0].last_sign_in_at, "last_sign_in_at must be populated");

      const pgAuditSuccess = await pgPool.query(
        "SELECT event_type FROM auth_audit_log WHERE user_id = $1 AND event_type = 'login_success'",
        [adminUserId]
      );
      assert.strictEqual(pgAuditSuccess.rows.length >= 1, true, "login_success audit log must be recorded");
    });

    await t.test("Stage 2E: Admin session verified via /api/auth/me", async () => {
      const req = buildRequest("http://localhost:3000/api/auth/me", "GET", null, adminSessionCookie);
      const res = await meHandler(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.authenticated, true);
      assert.strictEqual(data.user.id, adminUserId);
      assert.strictEqual(data.user.role, "admin");
    });

    // =========================================================================
    // STAGE 3: Bug Bounty Hunt Creation & Access Control
    // =========================================================================
    await t.test("Stage 3A: POST /api/bug-hunts rejects unauthenticated requests", async () => {
      const req = buildRequest("http://localhost:3000/api/bug-hunts", "POST", {
        title: "Unauthenticated Hunt",
        description: "Should fail",
      });
      const res = await postHuntsHandler(req);
      assert.strictEqual(res.status, 401, "Unauthenticated hunt creation must return 401");
    });

    await t.test("Stage 3B: Admin creates active bug bounty hunt in MongoDB", async () => {
      const huntTitle = `Synthetic Bounty Program [${testTag}]`;
      const huntDesc = "Automated E2E test bug bounty program with isolated synthetic scope.";
      const huntScope = ["https://synthetic-target.local/api/*", "*.internal.test"];
      const huntRewards = { critical: 1500, high: 750, medium: 300, low: 100 };

      const req = buildRequest(
        "http://localhost:3000/api/bug-hunts",
        "POST",
        {
          title: huntTitle,
          description: huntDesc,
          company: `Corp_${testTag}`,
          scope: huntScope,
          categories: ["Web Application", "API Security"],
          difficulty: "intermediate",
          rewards: huntRewards,
        },
        adminSessionCookie
      );

      const res = await postHuntsHandler(req);
      assert.strictEqual(res.status, 201, "Hunt creation by admin must return 201");
      const data = await res.json();
      assert.ok(data.id, "Hunt ID must be returned");
      assert.strictEqual(data.title, huntTitle);
      assert.strictEqual(data.status, "active");
      createdHuntId = data.id;

      // Verify MongoDB persistence independently
      const mongoHunt = await mongoDb.collection("bug_hunts").findOne({ _id: createdHuntId });
      assert.ok(mongoHunt, "Hunt must exist in MongoDB bug_hunts collection");
      assert.strictEqual(mongoHunt.title, huntTitle);
      assert.strictEqual(mongoHunt.status, "active");
      assert.strictEqual(mongoHunt.createdBy, adminUserId, "createdBy must match admin string ID per Identity Contract");
      assert.deepStrictEqual(mongoHunt.target_scope, huntScope);
      assert.deepStrictEqual(mongoHunt.rewards, huntRewards);
    });

    // =========================================================================
    // STAGE 4: Regular User (Hunter) Registration
    // =========================================================================
    await t.test("Stage 4A: Public signup rejects invalid input", async () => {
      const req = buildRequest("http://localhost:3000/api/auth/signup", "POST", {
        email: "not-an-email",
        password: "123", // too short
      });
      const res = await signupHandler(req);
      assert.strictEqual(res.status, 400, "Malformed signup input must return 400");
    });

    await t.test("Stage 4B: Public signup strictly blocks privilege escalation attempts", async () => {
      const escalateEmail = `attempt_admin_${testTag}@example.com`;
      const req = buildRequest("http://localhost:3000/api/auth/signup", "POST", {
        email: escalateEmail,
        password: "ValidPass123!_Long",
        username: `escalate_${runId}`,
        userType: "admin", // Malicious attempt to elevate role
      });
      const res = await signupHandler(req);
      assert.strictEqual(res.status, 201, "Signup succeeds but role must be strictly constrained");
      const data = await res.json();
      assert.strictEqual(data.user.role, "user", "Session role must be 'user', never admin");
      assert.strictEqual(data.user.userType, "hunter", "UserType must be coerced to 'hunter'");

      // Verify PostgreSQL role table was NOT polluted with admin role
      const pgRole = await pgPool.query(
        "SELECT role FROM user_roles WHERE user_id = $1",
        [data.user.id]
      );
      assert.strictEqual(pgRole.rows[0].role, "hunter", "DB role must be 'hunter'");

      // Immediate cleanup of escalation attempt record (delete audit log before user to prevent orphaned NULL user_id)
      await pgPool.query(
        "DELETE FROM auth_audit_log WHERE user_id = $1 OR metadata->>'email' = $2",
        [data.user.id, escalateEmail]
      );
      await pgPool.query("DELETE FROM auth_users WHERE id = $1", [data.user.id]);
    });

    await t.test("Stage 4C: Public signup registers regular hunter account in PostgreSQL", async () => {
      const req = buildRequest("http://localhost:3000/api/auth/signup", "POST", {
        email: hunterEmail,
        password: hunterPassword,
        username: hunterUsername,
        name: `Hunter ${testTag}`,
        userType: "hunter",
      });
      const res = await signupHandler(req);
      assert.strictEqual(res.status, 201, "Valid signup must return 201");
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.user.email, hunterEmail);
      assert.strictEqual(data.user.role, "user");
      assert.strictEqual(data.user.userType, "hunter");
      hunterUserId = data.user.id;

      // Verify PostgreSQL records
      const pgUser = await pgPool.query(
        "SELECT id, email, password_hash, is_active FROM auth_users WHERE id = $1",
        [hunterUserId]
      );
      assert.strictEqual(pgUser.rows.length, 1);
      assert.strictEqual(pgUser.rows[0].email, hunterEmail);
      assert.strictEqual(pgUser.rows[0].is_active, true);
      assert.ok(
        pgUser.rows[0].password_hash.startsWith("$2a$") || pgUser.rows[0].password_hash.startsWith("$2b$"),
        "Hunter password must be hashed with bcrypt"
      );

      const pgRole = await pgPool.query(
        "SELECT role FROM user_roles WHERE user_id = $1",
        [hunterUserId]
      );
      assert.strictEqual(pgRole.rows.length, 1);
      assert.strictEqual(pgRole.rows[0].role, "hunter");

      const pgProfile = await pgPool.query(
        "SELECT username, display_name FROM user_profiles WHERE user_id = $1",
        [hunterUserId]
      );
      assert.strictEqual(pgProfile.rows.length, 1);
      assert.strictEqual(pgProfile.rows[0].username, hunterUsername);
    });

    await t.test("Stage 4D: Public signup rejects duplicate registration with 409", async () => {
      const req = buildRequest("http://localhost:3000/api/auth/signup", "POST", {
        email: hunterEmail, // duplicate
        password: hunterPassword,
        username: `dup_${runId}`,
      });
      const res = await signupHandler(req);
      assert.strictEqual(res.status, 409, "Duplicate email must return 409 Conflict");
    });

    // =========================================================================
    // STAGE 5: Regular Hunter Login & Session Management
    // =========================================================================
    await t.test("Stage 5A: Hunter login establishes valid session", async () => {
      const req = buildRequest("http://localhost:3000/api/auth/login", "POST", {
        email: hunterEmail,
        password: hunterPassword,
      });
      const res = await loginHandler(req);
      assert.strictEqual(res.status, 200, "Hunter login must return 200");
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.user.role, "user");
      assert.strictEqual(data.user.userType, "hunter");

      hunterSessionCookie = extractSessionCookie(res);
      assert.ok(hunterSessionCookie, "Hunter session cookie must be set");

      // Verify /api/auth/me recognizes hunter session
      const meReq = buildRequest("http://localhost:3000/api/auth/me", "GET", null, hunterSessionCookie);
      const meRes = await meHandler(meReq);
      assert.strictEqual(meRes.status, 200);
      const meData = await meRes.json();
      assert.strictEqual(meData.authenticated, true);
      assert.strictEqual(meData.user.id, hunterUserId);
      assert.strictEqual(meData.user.role, "user");
    });

    await t.test("Stage 5B: Regular hunter is forbidden from creating bug hunts", async () => {
      const req = buildRequest(
        "http://localhost:3000/api/bug-hunts",
        "POST",
        {
          title: "Hunter Attempted Bounty Creation",
          description: "Should fail with 403 Forbidden",
        },
        hunterSessionCookie
      );
      const res = await postHuntsHandler(req);
      assert.strictEqual(res.status, 403, "Hunter must be forbidden from creating hunts");
    });

    // =========================================================================
    // STAGE 6: Bug Hunt Discovery & Access
    // =========================================================================
    await t.test("Stage 6A: Hunter discovers active bug hunt via GET /api/bug-hunts", async () => {
      const req = buildRequest("http://localhost:3000/api/bug-hunts", "GET", null, hunterSessionCookie);
      const res = await getHuntsHandler(req);
      assert.strictEqual(res.status, 200);
      const hunts = await res.json();
      assert.ok(Array.isArray(hunts), "Response must be an array of hunts");
      const found = hunts.find((h) => h.id === createdHuntId);
      assert.ok(found, "Newly created test hunt must be discoverable by hunter");
      assert.strictEqual(found.status, "active");
    });

    await t.test("Stage 6B: Hunter retrieves hunt details via GET /api/bug-hunts/[id]", async () => {
      const req = buildRequest(`http://localhost:3000/api/bug-hunts/${createdHuntId}`, "GET", null, hunterSessionCookie);
      const res = await getHuntByIdHandler(req, { params: Promise.resolve({ id: createdHuntId }) });
      assert.strictEqual(res.status, 200);
      const hunt = await res.json();
      assert.strictEqual(hunt.id, createdHuntId);
      assert.strictEqual(hunt.title, `Synthetic Bounty Program [${testTag}]`);
    });

    // =========================================================================
    // STAGE 7: Bug Report Submission by Hunter
    // =========================================================================
    const submissionTitle = `Synthetic SSRF in Webhook Callback [${testTag}]`;
    const submissionDesc = "Harmless synthetic SSRF finding in test webhook handler.";
    const submissionSteps = "1. Send loopback payload to test stub.\n2. Observe local reflection.";
    const submissionPoC = "https://synthetic-target.local/poc.txt";

    await t.test("Stage 7A: POST /api/bug-submissions rejects unauthenticated requests", async () => {
      const req = buildRequest("http://localhost:3000/api/bug-submissions", "POST", {
        huntId: createdHuntId,
        title: submissionTitle,
        description: submissionDesc,
      });
      const res = await postSubmissionsHandler(req);
      assert.strictEqual(res.status, 401, "Unauthenticated bug submission must return 401");
    });

    await t.test("Stage 7B: POST /api/bug-submissions validates required fields", async () => {
      const req = buildRequest(
        "http://localhost:3000/api/bug-submissions",
        "POST",
        {
          huntId: createdHuntId,
          title: "", // Missing title
          description: submissionDesc,
        },
        hunterSessionCookie
      );
      const res = await postSubmissionsHandler(req);
      assert.strictEqual(res.status, 400, "Missing title must return 400");
    });

    await t.test("Stage 7C: Hunter submits bug report; server strictly binds hunter_id to session", async () => {
      const req = buildRequest(
        "http://localhost:3000/api/bug-submissions",
        "POST",
        {
          huntId: createdHuntId,
          title: submissionTitle,
          description: submissionDesc,
          severity: "high",
          category: "Web Application",
          stepsToReproduce: submissionSteps,
          proofOfConceptUrl: submissionPoC,
          userId: "spoofed_other_hunter_id", // Attempt to spoof submission author
        },
        hunterSessionCookie
      );
      const res = await postSubmissionsHandler(req);
      assert.strictEqual(res.status, 201, "Bug submission must return 201 Created");
      const data = await res.json();
      assert.ok(data.id, "Submission ID must be generated");
      assert.strictEqual(data.title, submissionTitle);
      assert.strictEqual(data.userId, hunterUserId, "Author ID must match hunter session, NOT spoofed ID");
      assert.strictEqual(data.status, "pending");
      createdSubmissionId = data.id;

      // Verify MongoDB persistence independently
      const mongoSub = await mongoDb.collection("bug_submissions").findOne({ _id: createdSubmissionId });
      assert.ok(mongoSub, "Submission must exist in MongoDB bug_submissions collection");
      assert.strictEqual(mongoSub.title, submissionTitle);
      assert.strictEqual(mongoSub.hunter_id, hunterUserId, "hunter_id in MongoDB must match SQL hunter ID");
      assert.strictEqual(mongoSub.bounty_id, createdHuntId);
      assert.strictEqual(mongoSub.status, "pending");
      assert.strictEqual(mongoSub.severity, "high");
    });

    await t.test("Stage 7D: Duplicate submission prevention rejects duplicate reports", async () => {
      const req = buildRequest(
        "http://localhost:3000/api/bug-submissions",
        "POST",
        {
          huntId: createdHuntId,
          title: submissionTitle, // Identical title for same bounty
          description: "Duplicate report attempt",
          severity: "high",
        },
        hunterSessionCookie
      );
      const res = await postSubmissionsHandler(req);
      assert.strictEqual(res.status, 409, "Duplicate submission must return 409 Conflict");
    });

    await t.test("Stage 7E: Access control on pending submissions", async () => {
      // 1. Hunter owner can view full submission
      const ownerReq = buildRequest(
        `http://localhost:3000/api/bug-submissions/${createdSubmissionId}`,
        "GET",
        null,
        hunterSessionCookie
      );
      const ownerRes = await getSubmissionByIdHandler(ownerReq, { params: Promise.resolve({ id: createdSubmissionId }) });
      assert.strictEqual(ownerRes.status, 200);
      const ownerData = await ownerRes.json();
      assert.strictEqual(ownerData.id, createdSubmissionId);
      assert.strictEqual(ownerData.title, submissionTitle);

      // 2. Unauthenticated caller cannot view pending submission (must return 401)
      const unauthReq = buildRequest(
        `http://localhost:3000/api/bug-submissions/${createdSubmissionId}`,
        "GET"
      );
      const unauthRes = await getSubmissionByIdHandler(unauthReq, { params: Promise.resolve({ id: createdSubmissionId }) });
      assert.strictEqual(unauthRes.status, 401, "Unauthenticated access to pending report must be denied");
    });

    // =========================================================================
    // STAGE 8: Administrator Review & Triage Workflow
    // =========================================================================
    await t.test("Stage 8A: Admin reads full submission details", async () => {
      const req = buildRequest(
        `http://localhost:3000/api/bug-submissions/${createdSubmissionId}`,
        "GET",
        null,
        adminSessionCookie
      );
      const res = await getSubmissionByIdHandler(req, { params: Promise.resolve({ id: createdSubmissionId }) });
      assert.strictEqual(res.status, 200, "Admin must be able to read submission details");
      const data = await res.json();
      assert.strictEqual(data.id, createdSubmissionId);
      assert.strictEqual(data.severity, "high");
    });

    await t.test("Stage 8B: Regular hunter is forbidden from triaging or updating status", async () => {
      const req = buildRequest(
        `http://localhost:3000/api/bug-submissions/${createdSubmissionId}`,
        "PATCH",
        { status: "approved" },
        hunterSessionCookie
      );
      const res = await patchSubmissionByIdHandler(req, { params: Promise.resolve({ id: createdSubmissionId }) });
      assert.strictEqual(res.status, 403, "Hunter must be forbidden from triaging submissions");
    });

    await t.test("Stage 8C: Admin triages submission to 'triaged' status", async () => {
      const triageNotes = `Verified finding by automated E2E QA test runner [${testTag}].`;
      const req = buildRequest(
        `http://localhost:3000/api/bug-submissions/${createdSubmissionId}`,
        "PATCH",
        {
          status: "triaged",
          reviewNotes: triageNotes,
        },
        adminSessionCookie
      );
      const res = await patchSubmissionByIdHandler(req, { params: Promise.resolve({ id: createdSubmissionId }) });
      assert.strictEqual(res.status, 200, "Admin triage must return 200");
      const data = await res.json();
      assert.strictEqual(data.status, "triaged");

      // Verify MongoDB persistence
      const mongoSub = await mongoDb.collection("bug_submissions").findOne({ _id: createdSubmissionId });
      assert.strictEqual(mongoSub.status, "triaged");
      assert.strictEqual(mongoSub.admin_notes, triageNotes);
      assert.strictEqual(mongoSub.reviewed_by, adminUsername);
    });

    await t.test("Stage 8D: Admin transitions submission to 'resolved'", async () => {
      const resolveNotes = `Patched and verified in test cycle [${testTag}].`;
      const req = buildRequest(
        `http://localhost:3000/api/bug-submissions/${createdSubmissionId}`,
        "PATCH",
        {
          status: "resolved",
          reviewNotes: resolveNotes,
        },
        adminSessionCookie
      );
      const res = await patchSubmissionByIdHandler(req, { params: Promise.resolve({ id: createdSubmissionId }) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, "resolved");

      // Verify MongoDB persistence
      const mongoSub = await mongoDb.collection("bug_submissions").findOne({ _id: createdSubmissionId });
      assert.strictEqual(mongoSub.status, "resolved");
    });

    // =========================================================================
    // STAGE 9: Logout & Session Invalidation
    // =========================================================================
    await t.test("Stage 9A: Hunter logout invalidates session", async () => {
      const logoutReq = buildRequest("http://localhost:3000/api/auth/logout", "POST", null, hunterSessionCookie);
      const logoutRes = await logoutHandler(logoutReq);
      assert.strictEqual(logoutRes.status, 200);

      // Verify session cookie was cleared in response
      const clearedCookie = logoutRes.headers.get("set-cookie");
      assert.ok(clearedCookie.includes("bughuntr_session="), "Cookie must be cleared");
      assert.ok(clearedCookie.includes("Max-Age=0") || clearedCookie.includes("bughuntr_session=;"));
    });

    await t.test("Stage 9B: Admin logout invalidates session", async () => {
      const logoutReq = buildRequest("http://localhost:3000/api/auth/logout", "POST", null, adminSessionCookie);
      const logoutRes = await logoutHandler(logoutReq);
      assert.strictEqual(logoutRes.status, 200);
    });

    // =========================================================================
    // STAGE 10: Database Integrity Verification
    // =========================================================================
    await t.test("Stage 10: Verify database schema integrity, foreign keys, and audit entries", async () => {
      // 1. Verify PostgreSQL user and role consistency
      const pgUsers = await pgPool.query(
        "SELECT id, email, is_active FROM auth_users WHERE id IN ($1, $2)",
        [adminUserId, hunterUserId]
      );
      assert.strictEqual(pgUsers.rows.length, 2, "Both test users must exist in auth_users");

      const pgRoles = await pgPool.query(
        "SELECT user_id, role FROM user_roles WHERE user_id IN ($1, $2) ORDER BY role",
        [adminUserId, hunterUserId]
      );
      assert.strictEqual(pgRoles.rows.length, 2);
      const roleMap = new Map(pgRoles.rows.map((r) => [r.user_id, r.role]));
      assert.strictEqual(roleMap.get(adminUserId), "admin");
      assert.strictEqual(roleMap.get(hunterUserId), "hunter");

      // 2. Verify MongoDB foreign key references match PostgreSQL stable string IDs
      const mongoHunt = await mongoDb.collection("bug_hunts").findOne({ _id: createdHuntId });
      assert.ok(mongoHunt);
      assert.strictEqual(mongoHunt.createdBy, adminUserId, "createdBy must match admin PostgreSQL ID");

      const mongoSub = await mongoDb.collection("bug_submissions").findOne({ _id: createdSubmissionId });
      assert.ok(mongoSub);
      assert.strictEqual(mongoSub.bounty_id, createdHuntId, "bounty_id must match created hunt");
      assert.strictEqual(mongoSub.hunter_id, hunterUserId, "hunter_id must match hunter PostgreSQL ID");
      assert.strictEqual(mongoSub.status, "resolved");

      // 3. Verify audit log integrity
      const auditEntries = await pgPool.query(
        "SELECT event_type FROM auth_audit_log WHERE user_id IN ($1, $2)",
        [adminUserId, hunterUserId]
      );
      const eventTypes = auditEntries.rows.map((r) => r.event_type);
      assert.ok(eventTypes.includes("user_signup"), "Audit log must contain user_signup");
      assert.ok(eventTypes.includes("login_success"), "Audit log must contain login_success");
    });
  } finally {
    // =========================================================================
    // STAGE 11: Isolated Cleanup & Verification
    // =========================================================================
    console.log(`Executing targeted cleanup for test-run ID: ${runId}`);

    // Clean up MongoDB test submission
    if (createdSubmissionId) {
      try {
        await mongoDb.collection("bug_submissions").deleteOne({ _id: createdSubmissionId });
      } catch (err) {
        console.error("Cleanup error in MongoDB bug_submissions:", err.message);
      }
    }

    // Clean up MongoDB test hunt
    if (createdHuntId) {
      try {
        await mongoDb.collection("bug_hunts").deleteOne({ _id: createdHuntId });
      } catch (err) {
        console.error("Cleanup error in MongoDB bug_hunts:", err.message);
      }
    }

    // Clean up PostgreSQL test users (cascades to user_roles, user_profiles)
    const usersToDelete = [adminUserId, hunterUserId].filter(Boolean);
    if (usersToDelete.length > 0) {
      try {
        // Clean up audit logs for these users or test tag BEFORE deleting users
        await pgPool.query(
          "DELETE FROM auth_audit_log WHERE user_id = ANY($1::varchar[]) OR metadata->>'email' LIKE $2 OR metadata->>'runId' = $3",
          [usersToDelete, `%${testTag}%`, runId]
        );
        // Delete users (cascades to user_roles, user_profiles)
        await pgPool.query(
          "DELETE FROM auth_users WHERE id = ANY($1::varchar[]) OR email LIKE $2",
          [usersToDelete, `%${testTag}%`]
        );
      } catch (err) {
        console.error("Cleanup error in PostgreSQL:", err.message);
      }
    }

    // Verify cleanup
    if (createdHuntId) {
      const remainingHunt = await mongoDb.collection("bug_hunts").findOne({ _id: createdHuntId });
      assert.strictEqual(remainingHunt, null, "Test hunt must be completely deleted from MongoDB");
    }
    if (createdSubmissionId) {
      const remainingSub = await mongoDb.collection("bug_submissions").findOne({ _id: createdSubmissionId });
      assert.strictEqual(remainingSub, null, "Test submission must be completely deleted from MongoDB");
    }
    if (usersToDelete.length > 0) {
      const remainingUsers = await pgPool.query(
        "SELECT id FROM auth_users WHERE id = ANY($1::varchar[]) OR email LIKE $2",
        [usersToDelete, `%${testTag}%`]
      );
      assert.strictEqual(remainingUsers.rows.length, 0, "Test users must be completely deleted from PostgreSQL");
    }

    // Verify exact restoration of auth_audit_log count (zero leakage)
    const finalAuditRes = await pgPool.query("SELECT count(*) FROM auth_audit_log");
    const finalAuditCount = parseInt(finalAuditRes.rows[0].count, 10);
    assert.strictEqual(
      finalAuditCount,
      initialAuditCount,
      `auth_audit_log count must return exactly to initial baseline (${initialAuditCount}), got ${finalAuditCount}`
    );

    console.log(`[CLEANUP VERIFIED] All test records for ${runId} purged successfully. Baseline audit log count restored (${finalAuditCount}/${initialAuditCount}).`);

    // Close connections
    await pgPool.end();
    await mongoClient.close();
  }
});

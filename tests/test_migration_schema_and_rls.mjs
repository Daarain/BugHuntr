import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  mapFirestoreUserToSql,
  mapFirestoreSubmissionToSql,
  mapFirestorePayoutToSql,
  mapFirestoreProInvitationToSql,
  mapFirestoreCommunityToSql,
  mapFirestoreMessageToSql,
  parseArgs,
} from "../scripts/migrate-firestore-to-sql.ts";

test("Migration Schema: 001_accounts_auth_schema.sql defines all required core tables and constraints with string IDs", () => {
  const schema001 = fs.readFileSync(path.resolve("migrations/001_accounts_auth_schema.sql"), "utf-8");
  const requiredTables = [
    "auth_users",
    "user_roles",
    "user_profiles",
    "user_credentials",
    "auth_audit_log",
  ];

  for (const table of requiredTables) {
    assert.match(
      schema001,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "i"),
      `Expected table ${table} in schema 001`
    );
  }

  // Verify constraints and string ID types
  assert.match(schema001, /CHECK \(role IN \('hunter', 'company', 'admin', 'triager'\)\)/);
  assert.match(schema001, /CHECK \(points >= 0\)/);
  assert.match(schema001, /id VARCHAR\(128\) PRIMARY KEY DEFAULT gen_random_uuid\(\)::text/);
});

test("Migration Schema: 002_bug_bounty_domain_supabase_schema.sql defines all domain, community & financial tables", () => {
  const schema002 = fs.readFileSync(path.resolve("migrations/002_bug_bounty_domain_supabase_schema.sql"), "utf-8");
  const requiredTables = [
    "organizations",
    "org_members",
    "bounties",
    "bug_submissions",
    "vulnerabilities",
    "cve_requests",
    "pro_invitations",
    "communities",
    "community_messages",
    "org_wallets",
    "payouts",
    "payout_logs",
  ];

  for (const table of requiredTables) {
    assert.match(
      schema002,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "i"),
      `Expected table ${table} in schema 002`
    );
  }

  // Financial safety constraints
  assert.match(schema002, /CHECK \(reserved <= balance\)/);
  assert.match(schema002, /CHECK \(amount > 0\)/);
});

test("Migration RLS: 003_supabase_rls_policies.sql enables RLS on every table and protects wallets", () => {
  const schema003 = fs.readFileSync(path.resolve("migrations/003_supabase_rls_policies.sql"), "utf-8");
  const allTables = [
    "auth_users",
    "user_roles",
    "user_profiles",
    "user_credentials",
    "auth_audit_log",
    "organizations",
    "org_members",
    "bounties",
    "bug_submissions",
    "vulnerabilities",
    "cve_requests",
    "pro_invitations",
    "communities",
    "community_messages",
    "org_wallets",
    "payouts",
    "payout_logs",
  ];

  for (const table of allTables) {
    assert.match(
      schema003,
      new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`, "i"),
      `Table ${table} must have RLS explicitly enabled`
    );
  }

  // Helper and Financial direct client mutations blocked
  assert.match(schema003, /CREATE OR REPLACE FUNCTION current_user_id\(\)/);
  assert.match(schema003, /rls_org_wallets_block_client_writes/);
  assert.match(schema003, /rls_payouts_block_client_writes/);
  assert.match(schema003, /enforce_profile_field_immutability/);
});

test("Migration Script: parses flags and defaults to dry-run mode for safety", () => {
  const defaultOpts = parseArgs([]);
  assert.equal(defaultOpts.dryRun, true);
  assert.equal(defaultOpts.verifyOnly, false);

  const execOpts = parseArgs(["--execute"]);
  assert.equal(execOpts.dryRun, false);

  const verifyOpts = parseArgs(["--verify-only"]);
  assert.equal(verifyOpts.verifyOnly, true);
});

test("Migration Mapping: transforms Firestore user document safely", () => {
  const firestoreUser = {
    email: "HUNTER@Test.com",
    username: "Elite_Hunter",
    userType: "hunter",
    password: "$2a$10$encryptedhash",
    points: 1500,
  };

  const mapped = mapFirestoreUserToSql("user-uuid-123", firestoreUser);
  assert.equal(mapped.authUser.email, "hunter@test.com");
  assert.equal(mapped.userRole.role, "hunter");
  assert.equal(mapped.userProfile.username, "Elite_Hunter");
  assert.equal(mapped.userProfile.points, 1500);
  assert.equal(mapped.userProfile.reputationRank, "Pro");
});

test("Migration Mapping: transforms Firestore submission document safely", () => {
  const firestoreSub = {
    huntId: "hunt-456",
    orgId: "org-789",
    userId: "hunter-101",
    title: "SQL Injection in Search",
    description: "Detailed report",
    severity: "CRITICAL",
    status: "APPROVED",
    rewardAmount: 2500,
    paid: false,
  };

  const mapped = mapFirestoreSubmissionToSql("sub-999", firestoreSub);
  assert.equal(mapped.bountyId, "hunt-456");
  assert.equal(mapped.hunterId, "hunter-101");
  assert.equal(mapped.severity, "critical");
  assert.equal(mapped.rewardAmount, 2500);
  assert.equal(mapped.payoutStatus, "unpaid");
});

test("Migration Mapping: transforms Firestore payout document safely", () => {
  const firestorePayout = {
    order_id: "BH-PAYOUT-12345",
    submissionId: "sub-999",
    amount: "500.00",
    network: "polygon",
    wallet: "0x1234567890abcdef",
    status: "processing",
  };

  const mapped = mapFirestorePayoutToSql("BH-PAYOUT-12345", firestorePayout);
  assert.equal(mapped.orderId, "BH-PAYOUT-12345");
  assert.equal(mapped.amount, 500);
  assert.equal(mapped.network, "polygon");
  assert.equal(mapped.recipientWallet, "0x1234567890abcdef");
});

test("Migration Mapping: transforms Firestore proInvitation document safely", () => {
  const firestorePro = {
    senderUid: "admin_user_001",
    recipientEmail: "pro_hunter@example.com",
    huntId: "hunt-exclusive-99",
    status: "active",
  };

  const mapped = mapFirestoreProInvitationToSql("pro-inv-abc123", firestorePro);
  assert.equal(mapped.id, "pro-inv-abc123");
  assert.equal(mapped.senderId, "admin_user_001");
  assert.equal(mapped.recipientEmail, "pro_hunter@example.com");
  assert.equal(mapped.huntId, "hunt-exclusive-99");
  assert.equal(mapped.status, "active");
});

test("Migration Mapping: transforms Firestore community & message documents safely", () => {
  const firestoreComm = {
    name: "Web3 Security Hunters",
    description: "Discussion group for web3 exploits",
    creatorId: "hunter_lead_42",
    isPrivate: false,
  };

  const commMapped = mapFirestoreCommunityToSql("comm_web3_group", firestoreComm);
  assert.equal(commMapped.id, "comm_web3_group");
  assert.equal(commMapped.name, "Web3 Security Hunters");
  assert.equal(commMapped.isPrivate, false);

  const firestoreMsg = {
    senderId: "hunter_lead_42",
    senderName: "Lead Hunter",
    content: "Welcome to the group!",
  };

  const msgMapped = mapFirestoreMessageToSql("msg_1001", "comm_web3_group", firestoreMsg);
  assert.equal(msgMapped.id, "msg_1001");
  assert.equal(msgMapped.communityId, "comm_web3_group");
  assert.equal(msgMapped.content, "Welcome to the group!");
});

test("Migration Identifier Safety: accepts arbitrary non-UUID string IDs from legacy Firestore", () => {
  const legacyDocIds = [
    "BH-VULN-submission_abc123",
    "7xN0kP9zQ2a8B5c",
    "hunt-custom-slug",
    "user_firebase_auth_UID_with_dashes-and-underscores",
  ];

  for (const docId of legacyDocIds) {
    const subMapped = mapFirestoreSubmissionToSql(docId, {
      huntId: docId,
      hunterUid: docId,
      title: "Test",
    }, "bugs");

    assert.equal(subMapped.id, docId);
    assert.equal(subMapped.bountyId, docId);
    assert.equal(subMapped.hunterId, docId);
    assert.equal(subMapped.sourceCollection, "bugs");
  }
});

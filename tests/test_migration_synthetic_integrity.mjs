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
  sanitizeIdentifier,
} from "../scripts/migrate-firestore-to-sql.ts";

test("Synthetic Migration: legacy document IDs are preserved and sanitized", () => {
  const legacyIds = [
    "BH-VULN-test-submission-001",
    "7xN0kP9zQ2a8B5c",
    "user_firestore_abc-xyz",
    "payout_order_20261017_001",
  ];

  for (const id of legacyIds) {
    const sanitized = sanitizeIdentifier(id);
    assert.equal(sanitized, id);
    assert.equal(typeof sanitized, "string");
    assert.ok(sanitized.length <= 128);
  }

  // Throws on empty or non-string
  assert.throws(() => sanitizeIdentifier(""), /Identifier must be a non-empty string/);
  assert.throws(() => sanitizeIdentifier(null), /Identifier must be a non-empty string/);
});

test("Synthetic Migration: duplicate deduplication and conflict resolution logic", () => {
  const syntheticUsers = [
    { id: "uid_001", data: { email: "alice@example.com", username: "alice", points: 100 } },
    { id: "uid_002", data: { email: "ALICE@example.com", username: "alice_dup", points: 200 } },
    { id: "uid_003", data: { email: "bob@example.com", username: "bob", points: 50 } },
  ];

  const seenEmails = new Map();
  const duplicates = [];
  const validMapped = [];

  for (const user of syntheticUsers) {
    const mapped = mapFirestoreUserToSql(user.id, user.data);
    const normalizedEmail = mapped.authUser.email;

    if (seenEmails.has(normalizedEmail)) {
      duplicates.push({
        duplicateId: user.id,
        existingId: seenEmails.get(normalizedEmail),
        email: normalizedEmail,
      });
    } else {
      seenEmails.set(normalizedEmail, user.id);
      validMapped.push(mapped);
    }
  }

  assert.equal(validMapped.length, 2, "Only unique emails should be admitted");
  assert.equal(duplicates.length, 1, "Duplicate email must be detected");
  assert.equal(duplicates[0].email, "alice@example.com");
  assert.equal(duplicates[0].duplicateId, "uid_002");
});

test("Synthetic Migration: partial failures are trapped gracefully without crashing", () => {
  const mixedBatch = [
    { id: "valid_001", data: { email: "clean@example.com", points: 150 } },
    { id: "invalid_002", data: { points: 500 } }, // missing email
    { id: "invalid_003", data: { email: "no-at-sign.com" } }, // invalid email
    { id: "valid_004", data: { email: "hunter2@example.com", points: "invalid_number" } }, // string points defaults safely
  ];

  const errors = [];
  const successes = [];

  for (const item of mixedBatch) {
    try {
      const mapped = mapFirestoreUserToSql(item.id, item.data);
      successes.push(mapped);
    } catch (err) {
      errors.push({ id: item.id, error: err.message });
    }
  }

  assert.equal(successes.length, 2, "Two valid users should map successfully");
  assert.equal(errors.length, 2, "Two invalid users should produce errors");
  assert.equal(errors[0].id, "invalid_002");
  assert.equal(errors[1].id, "invalid_003");
  assert.equal(successes[1].userProfile.points, 0, "Invalid points format safely falls back to 0");
});

test("Synthetic Migration: deterministic idempotency on repeated executions", () => {
  const sampleFirestoreUser = {
    email: "hunter_deterministic@domain.io",
    username: "hunter_lead",
    points: 1250,
    userType: "hunter",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  const run1 = mapFirestoreUserToSql("legacy_doc_id_999", sampleFirestoreUser);
  const run2 = mapFirestoreUserToSql("legacy_doc_id_999", sampleFirestoreUser);

  // Exact deep equality between runs
  assert.deepEqual(run1, run2, "Mapping must be purely deterministic and idempotent");
});

test("Synthetic Migration: reconciliation counts (Read = Mapped + Errors)", () => {
  const syntheticSubmissions = [
    { id: "sub_1", data: { huntId: "hunt-1", userId: "u-1", title: "Valid 1", severity: "HIGH" } },
    { id: "sub_2", data: { huntId: "hunt-1", userId: "u-2", title: "Valid 2", severity: "LOW" } },
    { id: "", data: { title: "Invalid missing ID" } },
  ];

  let read = 0;
  let mapped = 0;
  let errorCount = 0;

  for (const doc of syntheticSubmissions) {
    read++;
    try {
      mapFirestoreSubmissionToSql(doc.id, doc.data);
      mapped++;
    } catch {
      errorCount++;
    }
  }

  assert.equal(read, 3);
  assert.equal(mapped, 2);
  assert.equal(errorCount, 1);
  assert.equal(read, mapped + errorCount, "Reconciliation invariant must hold: Read = Mapped + Errors");
});

test("Synthetic Migration: 004_down_reversion.sql covers 100% of tables defined in 001 and 002", () => {
  const schema001 = fs.readFileSync(path.resolve("migrations/001_accounts_auth_schema.sql"), "utf-8");
  const schema002 = fs.readFileSync(path.resolve("migrations/002_bug_bounty_domain_supabase_schema.sql"), "utf-8");
  const schema004 = fs.readFileSync(path.resolve("migrations/004_down_reversion.sql"), "utf-8");

  // Extract all CREATE TABLE IF NOT EXISTS <name>
  const createTableRegex = /CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/gi;
  const createdTables = new Set();

  let match;
  while ((match = createTableRegex.exec(schema001)) !== null) {
    createdTables.add(match[1].toLowerCase());
  }
  while ((match = createTableRegex.exec(schema002)) !== null) {
    createdTables.add(match[1].toLowerCase());
  }

  // Extract all DROP TABLE IF EXISTS <name>
  const dropTableRegex = /DROP TABLE IF EXISTS\s+([a-zA-Z0-9_]+)/gi;
  const droppedTables = new Set();
  while ((match = dropTableRegex.exec(schema004)) !== null) {
    droppedTables.add(match[1].toLowerCase());
  }

  assert.equal(createdTables.size, 17, "Exactly 17 tables must be defined across 001 and 002");
  for (const table of createdTables) {
    assert.ok(
      droppedTables.has(table),
      `Rollback script 004_down_reversion.sql must drop table: ${table}`
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeIdentifier,
  mapFirestoreOrgToMongo,
  mapFirestoreHuntToMongo,
  mapFirestoreSubmissionToMongo,
  mapFirestoreVulnerabilityToMongo,
  mapFirestoreWalletToMongo,
  mapFirestorePayoutToMongo,
  mapFirestoreProfilePointsToMongo,
  mapFirestoreCommunityToMongo,
  mapFirestoreMessageToMongo,
} from "../scripts/migrate-firestore-to-mongo.ts";

test("MongoDB Migration: Legacy string document IDs are preserved directly as _id", () => {
  const legacyDocIds = [
    "BH-VULN-submission_987abc",
    "BH-PAYOUT-sub-101-hunt-1",
    "org_corp_enterprise_01",
    "7xN0kP9zQ2a8B5c",
  ];

  for (const id of legacyDocIds) {
    const clean = sanitizeIdentifier(id);
    assert.equal(clean, id);
    assert.ok(typeof clean === "string");
  }

  assert.throws(() => sanitizeIdentifier(""), /Identifier must be a non-empty string/);
  assert.throws(() => sanitizeIdentifier(null), /Identifier must be a non-empty string/);
});

test("MongoDB Migration: Identity Boundary — User IDs are referenced as stable string IDs from SQL auth", () => {
  const sqlAuthUserId = "usr_sql_auth_987654";

  // Submission mapping
  const sub = mapFirestoreSubmissionToMongo("sub_001", {
    hunter_id: sqlAuthUserId,
    bounty_id: "hunt_001",
    title: "SQL Injection in Search Query",
    severity: "critical",
  });
  assert.equal(sub.hunter_id, sqlAuthUserId);
  assert.equal(typeof sub.hunter_id, "string");

  // Payout mapping
  const payout = mapFirestorePayoutToMongo("BH-PAYOUT-sub-001", {
    hunterUid: sqlAuthUserId,
    amount: 5000000,
    orgId: "org_001",
  });
  assert.equal(payout.hunterUid, sqlAuthUserId);
  assert.equal(typeof payout.hunterUid, "string");

  // Gamification points mapping
  const points = mapFirestoreProfilePointsToMongo(sqlAuthUserId, {
    points: 8500,
    bugsSubmitted: 12,
  });
  assert.equal(points.user_id, sqlAuthUserId);
  assert.equal(points._id, sqlAuthUserId);
  assert.equal(points.reputation_rank, "A"); // 8500 points = A tier

  // Community message mapping
  const msg = mapFirestoreMessageToMongo("msg_001", {
    userId: sqlAuthUserId,
    communityId: "comm_001",
    content: "Found a critical bug!",
  });
  assert.equal(msg.sender_id, sqlAuthUserId);
});

test("MongoDB Migration: Organizations and OrgMembers mapping", () => {
  const { org, member } = mapFirestoreOrgToMongo("org_alpha", {
    name: "Alpha Corp Inc",
    ownerId: "usr_founder_001",
    verified: true,
  });

  assert.equal(org._id, "org_alpha");
  assert.equal(org.name, "Alpha Corp Inc");
  assert.equal(org.slug, "alpha-corp-inc");
  assert.equal(org.verified, true);
  assert.ok(member);
  assert.equal(member.org_id, "org_alpha");
  assert.equal(member.user_id, "usr_founder_001");
  assert.equal(member.role, "owner");
});

test("MongoDB Migration: Bug Hunts and scope mapping", () => {
  const hunt = mapFirestoreHuntToMongo("hunt_web_001", {
    org_id: "org_alpha",
    title: "Web App Bounty Program",
    scope: ["api.alpha.com", "*.alpha.com"],
    rewards: { critical: 2000, high: 1000, medium: 400, low: 100 },
    createdBy: "usr_admin_001",
  });

  assert.equal(hunt._id, "hunt_web_001");
  assert.equal(hunt.org_id, "org_alpha");
  assert.deepEqual(hunt.target_scope, ["api.alpha.com", "*.alpha.com"]);
  assert.equal(hunt.rewards.critical, 2000);
  assert.equal(hunt.createdBy, "usr_admin_001");
});

test("MongoDB Migration: Wallets and Payouts mapping", () => {
  const wallet = mapFirestoreWalletToMongo("org_alpha", {
    balance: 50000000,
    reserved: 10000000,
    currency: "USDC",
    network: "POLYGON",
  });

  assert.equal(wallet._id, "org_alpha");
  assert.equal(wallet.balance, 50000000);
  assert.equal(wallet.reserved, 10000000);
  assert.equal(wallet.currency, "USDC");

  const payout = mapFirestorePayoutToMongo("BH-PAYOUT-sub_001", {
    order_id: "BH-PAYOUT-sub_001",
    huntId: "hunt_001",
    submissionId: "sub_001",
    orgId: "org_alpha",
    hunterUid: "usr_hunter_001",
    amount: 10000000,
    status: "completed",
  });

  assert.equal(payout._id, "BH-PAYOUT-sub_001");
  assert.equal(payout.amount, 10000000);
  assert.equal(payout.status, "completed");
});

test("MongoDB Migration: Deduplication and reconciliation counting", () => {
  const syntheticRaw = [
    { id: "sub_001", data: { title: "Bug 1", hunter_id: "u1" } },
    { id: "sub_002", data: { title: "Bug 2", hunter_id: "u2" } },
    { id: "sub_003_bad", data: null }, // Corrupt doc
  ];

  let read = 0;
  let mapped = 0;
  const errors = [];

  for (const item of syntheticRaw) {
    read++;
    try {
      if (!item.data) throw new Error("Document body is null");
      const res = mapFirestoreSubmissionToMongo(item.id, item.data);
      assert.ok(res._id);
      mapped++;
    } catch (err) {
      errors.push({ id: item.id, error: err.message });
    }
  }

  assert.equal(read, 3);
  assert.equal(mapped, 2);
  assert.equal(errors.length, 1);
  assert.equal(read, mapped + errors.length, "Reconciliation must satisfy Read = Mapped + Errors");
});

test("Phase 6A: Multi-collection legacy submission field mapping & researcher/hunt reference preservation", () => {
  // 1. bugs collection variant
  const bugDoc = mapFirestoreSubmissionToMongo("legacy_bug_001", {
    huntId: "hunt_prod_999",
    reporterUid: "hunter_uid_456",
    title: "Stored XSS via Comments",
    description: "PoC details here",
    steps: "1. Visit page\n2. Inject payload",
    pocUrl: "https://storage.googleapis.com/poc/xss.mp4",
    severity: "HIGH",
    status: "APPROVED",
    paid: false,
    bountyAmount: "1500.50",
    submittedAt: { seconds: 1770000000 },
  }, "bugs");

  assert.equal(bugDoc._id, "legacy_bug_001");
  assert.equal(bugDoc.bounty_id, "hunt_prod_999");
  assert.equal(bugDoc.hunter_id, "hunter_uid_456");
  assert.equal(bugDoc.title, "Stored XSS via Comments");
  assert.equal(bugDoc.steps_to_reproduce, "1. Visit page\n2. Inject payload");
  assert.equal(bugDoc.proof_of_concept_url, "https://storage.googleapis.com/poc/xss.mp4");
  assert.equal(bugDoc.severity, "high");
  assert.equal(bugDoc.status, "approved");
  assert.equal(bugDoc.payout_status, "unpaid");
  assert.equal(bugDoc.reward_amount, 1500.50);
  assert.equal(bugDoc.source_collection, "bugs");
  assert.equal(bugDoc.created_at.getTime(), 1770000000 * 1000);

  // 2. bugSubmissions pointer collection variant
  const ptrDoc = mapFirestoreSubmissionToMongo("ptr_sub_002", {
    bountyId: "hunt_prod_999",
    hunterUid: "hunter_uid_789",
    bugTitle: "RCE in File Upload",
    stepsToReproduce: "Upload malicious payload",
    proofOfConceptUrl: "https://storage.googleapis.com/poc/rce.png",
    severity: "CRITICAL",
    status: "RESOLVED",
    paid: true,
    rewardAmount: 5000,
    createdAt: new Date("2026-05-01T12:00:00Z"),
  }, "bugSubmissions");

  assert.equal(ptrDoc._id, "ptr_sub_002");
  assert.equal(ptrDoc.bounty_id, "hunt_prod_999");
  assert.equal(ptrDoc.hunter_id, "hunter_uid_789");
  assert.equal(ptrDoc.title, "RCE in File Upload");
  assert.equal(ptrDoc.severity, "critical");
  assert.equal(ptrDoc.status, "resolved");
  assert.equal(ptrDoc.payout_status, "paid");
  assert.equal(ptrDoc.reward_amount, 5000);
  assert.equal(ptrDoc.source_collection, "bugSubmissions");
  assert.equal(ptrDoc.created_at.toISOString(), "2026-05-01T12:00:00.000Z");

  // 3. submissions / bugReports legacy variant
  const reportDoc = mapFirestoreSubmissionToMongo("report_003", {
    huntId: "hunt_prod_999",
    submittedBy: "hunter_uid_101",
    title: "CSRF on Account Settings",
    severity: "medium",
    status: "TRIAGED",
    payout_status: "processing",
    payout_order_id: "BH-PAYOUT-order-123",
  }, "bugReports");

  assert.equal(reportDoc._id, "report_003");
  assert.equal(reportDoc.bounty_id, "hunt_prod_999");
  assert.equal(reportDoc.hunter_id, "hunter_uid_101");
  assert.equal(reportDoc.severity, "medium");
  assert.equal(reportDoc.status, "triaged");
  assert.equal(reportDoc.payout_status, "processing");
  assert.equal(reportDoc.payout_order_id, "BH-PAYOUT-order-123");
  assert.equal(reportDoc.source_collection, "bugReports");
});

test("Phase 6A: Submission pointer resolution & deduplication across aliased collections", () => {
  // Scenario: In Firestore legacy, submitting a bug created primary in `bugs` and pointer in `bugSubmissions`
  const legacyBugsCollection = [
    {
      id: "bug_primary_100",
      data: {
        huntId: "hunt_001",
        hunterUid: "usr_hunter_01",
        title: "IDOR in User Profile",
        severity: "HIGH",
        status: "APPROVED",
        createdAt: "2026-03-01T10:00:00Z",
      },
    },
  ];

  const legacyBugSubmissionsCollection = [
    {
      id: "pointer_doc_200",
      data: {
        bugId: "bug_primary_100", // points to primary
        huntId: "hunt_001",
        hunterUid: "usr_hunter_01",
        title: "IDOR in User Profile",
        severity: "HIGH",
        status: "APPROVED",
        fakeReportScore: 0.12,
        createdAt: "2026-03-01T10:00:00Z",
      },
    },
  ];

  // Legacy external payout referencing the pointer document ID
  const legacyPayouts = [
    {
      id: "BH-PAYOUT-payout_900",
      data: {
        order_id: "BH-PAYOUT-payout_900",
        submissionId: "pointer_doc_200", // Payout references the pointer doc ID
        huntId: "hunt_001",
        hunterUid: "usr_hunter_01",
        amount: 1500,
      },
    },
  ];

  // Ingestion & pointer reconciliation algorithm
  const canonicalSubmissions = new Map();
  const aliasPointers = new Map();

  // Ingest primary
  for (const item of legacyBugsCollection) {
    const doc = mapFirestoreSubmissionToMongo(item.id, item.data, "bugs");
    canonicalSubmissions.set(doc._id, doc);
  }

  // Ingest secondary pointers: detect alias pointer linking to primary
  for (const item of legacyBugSubmissionsCollection) {
    const primaryTargetId = item.data.bugId;
    if (primaryTargetId && canonicalSubmissions.has(primaryTargetId)) {
      // Map alias pointer to primary target
      aliasPointers.set(item.id, primaryTargetId);
      // Merge any secondary metadata if needed
      const primaryDoc = canonicalSubmissions.get(primaryTargetId);
      if (item.data.fakeReportScore !== undefined) {
        primaryDoc.admin_notes = primaryDoc.admin_notes
          ? `${primaryDoc.admin_notes}; fakeReportScore: ${item.data.fakeReportScore}`
          : `fakeReportScore: ${item.data.fakeReportScore}`;
      }
    } else {
      const doc = mapFirestoreSubmissionToMongo(item.id, item.data, "bugSubmissions");
      canonicalSubmissions.set(doc._id, doc);
    }
  }

  // Reconcile external references in payouts
  const mappedPayouts = [];
  for (const p of legacyPayouts) {
    const payout = mapFirestorePayoutToMongo(p.id, p.data);
    // Resolve submission reference if pointer alias exists
    if (aliasPointers.has(payout.submissionId)) {
      const resolvedId = aliasPointers.get(payout.submissionId);
      payout.submissionId = resolvedId;
    }
    mappedPayouts.push(payout);
  }

  // Invariants check
  assert.equal(canonicalSubmissions.size, 1, "Duplicate pointer should be reconciled to primary");
  assert.ok(canonicalSubmissions.has("bug_primary_100"));
  assert.equal(aliasPointers.get("pointer_doc_200"), "bug_primary_100");
  assert.equal(mappedPayouts[0].submissionId, "bug_primary_100", "Payout submission pointer must resolve to canonical master ID");
  assert.ok(canonicalSubmissions.get(mappedPayouts[0].submissionId), "Resolved submission pointer must exist in canonical submissions");
});

test("Phase 6A: Robust timestamp normalization handles ISO strings, Date objects, Firestore timestamps, and seconds/nanoseconds", () => {
  const cases = [
    { input: new Date("2026-06-15T08:30:00Z"), expected: "2026-06-15T08:30:00.000Z" },
    { input: "2026-06-15T08:30:00Z", expected: "2026-06-15T08:30:00.000Z" },
    { input: { seconds: 1770000000, nanoseconds: 500000000 }, expected: new Date(1770000000 * 1000).toISOString() },
    { input: { toDate: () => new Date("2026-08-20T14:00:00Z") }, expected: "2026-08-20T14:00:00.000Z" },
    { input: 1770000000000, expected: new Date(1770000000000).toISOString() },
  ];

  for (const c of cases) {
    const sub = mapFirestoreSubmissionToMongo("test_ts_doc", {
      hunter_id: "hunter_ts",
      bounty_id: "bounty_ts",
      title: "Timestamp Test",
      submittedAt: c.input,
    });
    assert.equal(sub.created_at.toISOString(), c.expected);
  }
});

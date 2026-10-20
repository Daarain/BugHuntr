import { test } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import {
  validateRemoteMongoServerIdentity,
  isHostApproved,
  validateHostPatternSafety,
  parsePostgresTarget,
} from "../scripts/test-db-connections.ts";

const baseEnv = {
  ...process.env,
  NODE_ENV: "development",
  RUN_STAGING_DB_PROBE: "true",
  APP_ENV: "staging",
  POSTGRES_URL: "postgresql://postgres.abcdefghijklmnopqrst:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  MONGODB_URI: "mongodb+srv://user:pass@cluster0.abcde.mongodb.net/bughuntr_staging",
  EXPECTED_STAGING_PG_HOST: "aws-0-us-east-1.pooler.supabase.com",
  EXPECTED_STAGING_PG_DB: "postgres",
  EXPECTED_STAGING_PG_PROJECT_REF: "abcdefghijklmnopqrst",
  EXPECTED_STAGING_MONGO_HOST: "cluster0.abcde.mongodb.net",
  EXPECTED_STAGING_MONGO_DB: "bughuntr_staging",
  EXPECTED_STAGING_MONGO_REPLICA_SET: "atlas-staging-shard-0",
};

function runExpectingFailure(envOverrides, expectedErrSubstr) {
  try {
    execSync("node node_modules/tsx/dist/cli.mjs scripts/test-db-connections.ts", {
      env: { ...baseEnv, ...envOverrides },
      stdio: "pipe",
    });
    assert.fail("Process should have failed with exit code 1");
  } catch (err) {
    assert.strictEqual(err.status, 1, "Exit code must be 1");
    const out = (err.stderr ? err.stderr.toString() : "") + (err.stdout ? err.stdout.toString() : "");
    assert(
      out.includes(expectedErrSubstr),
      `Expected output to include '${expectedErrSubstr}', but received:\n${out}`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Process & CLI Pre-Connection Guards
// ---------------------------------------------------------------------------
test("1. Unconditional production block aborts immediately", () => {
  runExpectingFailure(
    { NODE_ENV: "production" },
    "Database connection diagnostic cannot run in production"
  );
});

test("2. Explicit opt-in RUN_STAGING_DB_PROBE required", () => {
  runExpectingFailure(
    { RUN_STAGING_DB_PROBE: "false" },
    "Explicit opt-in required: RUN_STAGING_DB_PROBE"
  );
});

test("3. Environment designation must be staging or development", () => {
  runExpectingFailure(
    { APP_ENV: "production", ENVIRONMENT: "", NODE_ENV: "test" },
    "Target environment must be 'staging' or 'development'"
  );
});

test("4. Missing EXPECTED_STAGING_PG_HOST configuration aborts before connection", () => {
  runExpectingFailure(
    { EXPECTED_STAGING_PG_HOST: "", APPROVED_STAGING_PG_HOSTS: "" },
    "No approved PostgreSQL staging hosts configured"
  );
});

test("5. Missing EXPECTED_STAGING_PG_DB configuration aborts before connection", () => {
  runExpectingFailure(
    { EXPECTED_STAGING_PG_DB: "", APPROVED_STAGING_PG_DB: "" },
    "No approved PostgreSQL staging database configured"
  );
});

test("6. Missing EXPECTED_STAGING_MONGO_HOST configuration aborts before connection", () => {
  runExpectingFailure(
    { EXPECTED_STAGING_MONGO_HOST: "", APPROVED_STAGING_MONGO_HOSTS: "" },
    "No approved MongoDB staging hosts configured"
  );
});

test("7. Missing EXPECTED_STAGING_MONGO_DB configuration aborts before connection", () => {
  runExpectingFailure(
    { EXPECTED_STAGING_MONGO_DB: "", APPROVED_STAGING_MONGO_DB: "" },
    "No approved MongoDB staging database configured"
  );
});

test("8. Missing EXPECTED_STAGING_MONGO_REPLICA_SET configuration aborts before connection", () => {
  runExpectingFailure(
    { EXPECTED_STAGING_MONGO_REPLICA_SET: "", APPROVED_STAGING_MONGO_REPLICA_SETS: "" },
    "No approved MongoDB staging replica set configured"
  );
});

test("9. PostgreSQL host mismatch aborts before connection", () => {
  runExpectingFailure(
    { POSTGRES_URL: "postgresql://postgres.abcdefghijklmnopqrst:pass@other-host.supabase.co:6543/postgres" },
    "is not in approved staging host list"
  );
});

test("10. PostgreSQL database mismatch aborts before connection", () => {
  runExpectingFailure(
    { POSTGRES_URL: "postgresql://postgres.abcdefghijklmnopqrst:pass@aws-0-us-east-1.pooler.supabase.com:6543/other_db" },
    "does not match expected staging database"
  );
});

test("11. MongoDB host mismatch aborts before connection", () => {
  runExpectingFailure(
    { MONGODB_URI: "mongodb+srv://user:pass@unapproved-cluster.mongodb.net/bughuntr_staging" },
    "is not in approved staging host list"
  );
});

test("12. MongoDB database mismatch aborts before connection", () => {
  runExpectingFailure(
    { MONGODB_URI: "mongodb+srv://user:pass@cluster0.abcde.mongodb.net/other_staging_db" },
    "does not match expected staging database"
  );
});

test("13. Production-indicating keyword in host triggers rejection", () => {
  runExpectingFailure(
    {
      POSTGRES_URL: "postgresql://postgres.abcdefghijklmnopqrst:pass@prod-cluster.supabase.co:6543/postgres",
      EXPECTED_STAGING_PG_HOST: "prod-cluster.supabase.co",
    },
    "suspicious keyword match"
  );
});

// ---------------------------------------------------------------------------
// 2. Supabase Pooler & Project Reference Verification
// ---------------------------------------------------------------------------
test("14. Supabase shared pooler requires EXPECTED_STAGING_PG_PROJECT_REF", () => {
  runExpectingFailure(
    { EXPECTED_STAGING_PG_PROJECT_REF: "", APPROVED_STAGING_PG_PROJECT_REF: "" },
    "PostgreSQL target is a shared Supabase pooler"
  );
});

test("15. Supabase shared pooler rejects mismatched project reference in username", () => {
  runExpectingFailure(
    { POSTGRES_URL: "postgresql://postgres.wrongprojectref:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres" },
    "PostgreSQL pooler project reference 'wrongprojectref' does not match expected staging project reference"
  );
});

test("16. parsePostgresTarget correctly extracts project ref from pooler and direct URLs", () => {
  const poolerTarget = parsePostgresTarget(
    "postgresql://postgres.myprojectref123:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
  );
  assert.strictEqual(poolerTarget.projectRef, "myprojectref123");
  assert.strictEqual(poolerTarget.host, "aws-0-us-east-1.pooler.supabase.com");
  assert.strictEqual(poolerTarget.dbName, "postgres");

  const directTarget = parsePostgresTarget(
    "postgresql://postgres:secret@db.myprojectref123.supabase.co:5432/postgres"
  );
  assert.strictEqual(directTarget.projectRef, "myprojectref123");
  assert.strictEqual(directTarget.host, "db.myprojectref123.supabase.co");
  assert.strictEqual(directTarget.dbName, "postgres");
});

// ---------------------------------------------------------------------------
// 3. Constrained Wildcard Safety Validation
// ---------------------------------------------------------------------------
test("17. validateHostPatternSafety rejects broad multi-tenant wildcards", () => {
  assert.throws(() => validateHostPatternSafety("*.mongodb.net"), {
    message: /Wildcard host pattern '\*\.mongodb\.net' is too broad/,
  });
  assert.throws(() => validateHostPatternSafety("*.supabase.co"), {
    message: /Wildcard host pattern '\*\.supabase\.co' is too broad/,
  });
  assert.throws(() => validateHostPatternSafety("*.pooler.supabase.com"), {
    message: /Wildcard host pattern '\*\.pooler\.supabase\.com' is too broad/,
  });
  assert.throws(() => validateHostPatternSafety("*.com"), {
    message: /Wildcard host pattern '\*\.com' is too broad/,
  });
});

test("18. validateHostPatternSafety allows cluster-specific constrained subdomains", () => {
  assert.doesNotThrow(() => validateHostPatternSafety("*.abcde.mongodb.net"));
  assert.doesNotThrow(() => validateHostPatternSafety("*.staging.mycompany.internal"));
});

test("19. CLI configuration rejects broad wildcard in APPROVED_STAGING_MONGO_HOSTS", () => {
  runExpectingFailure(
    { APPROVED_STAGING_MONGO_HOSTS: "*.mongodb.net", EXPECTED_STAGING_MONGO_HOST: "" },
    "is too broad. Wildcards cannot match shared multi-tenant cloud domains"
  );
});

// ---------------------------------------------------------------------------
// 4. MongoDB Atlas SRV Seed to Member Host Matching
// ---------------------------------------------------------------------------
test("20. isHostApproved matches real Atlas shard member nodes to Atlas SRV seed host", () => {
  const approved = ["cluster0.abcde.mongodb.net"];

  // Real Atlas shard member hostnames returned by hello command
  assert.strictEqual(isHostApproved("ac-abcde-shard-00-00.abcde.mongodb.net", approved), true);
  assert.strictEqual(isHostApproved("ac-abcde-shard-00-01.abcde.mongodb.net", approved), true);
  assert.strictEqual(isHostApproved("cluster0-shard-00-00.abcde.mongodb.net", approved), true);

  // Unrelated or rogue clusters must be rejected
  assert.strictEqual(isHostApproved("ac-other-shard-00-00.other.mongodb.net", approved), false);
  assert.strictEqual(isHostApproved("malicious-cluster.evil.mongodb.net", approved), false);
});

test("21. isHostApproved supports cluster-constrained wildcards", () => {
  const approved = ["*.abcde.mongodb.net"];
  assert.strictEqual(isHostApproved("node1.abcde.mongodb.net", approved), true);
  assert.strictEqual(isHostApproved("ac-abcde-shard-00-00.abcde.mongodb.net", approved), true);
  assert.strictEqual(isHostApproved("node1.other.mongodb.net", approved), false);
});

// ---------------------------------------------------------------------------
// 5. Remote MongoDB Topology & Identity Verification (Unit Tests)
// ---------------------------------------------------------------------------
test("22. validateRemoteMongoServerIdentity verifies real Atlas staging replica set topology", () => {
  const realAtlasHello = {
    setName: "atlas-staging-shard-0",
    me: "ac-abcde-shard-00-00.abcde.mongodb.net:27017",
    primary: "ac-abcde-shard-00-01.abcde.mongodb.net:27017",
    hosts: [
      "ac-abcde-shard-00-00.abcde.mongodb.net:27017",
      "ac-abcde-shard-00-01.abcde.mongodb.net:27017",
      "ac-abcde-shard-00-02.abcde.mongodb.net:27017",
    ],
    isWritablePrimary: true,
  };

  const approvedHosts = ["cluster0.abcde.mongodb.net"];
  const approvedReplicaSets = ["atlas-staging-shard-0"];

  const result = validateRemoteMongoServerIdentity(realAtlasHello, approvedHosts, approvedReplicaSets);
  assert.strictEqual(result.verifiedReplicaSet, "atlas-staging-shard-0");
  assert.strictEqual(result.serverReportedMe, "ac-abcde-shard-00-00.abcde.mongodb.net:27017");
  assert.strictEqual(result.serverReportedPrimary, "ac-abcde-shard-00-01.abcde.mongodb.net:27017");
  assert.strictEqual(result.verifiedHosts.length, 3);
});

test("23. validateRemoteMongoServerIdentity rejects standalone server missing setName", () => {
  const standaloneHello = {
    me: "staging-mongo-0.mongodb.net:27017",
    isWritablePrimary: true,
  };

  assert.throws(
    () => validateRemoteMongoServerIdentity(standaloneHello, ["cluster0.abcde.mongodb.net"], ["atlas-staging-shard-0"]),
    {
      message: /Connected server returned no replica set name \(setName\)/,
    }
  );
});

test("24. validateRemoteMongoServerIdentity rejects mismatched replica set name", () => {
  const wrongRsHello = {
    setName: "production-shard-0",
    me: "ac-abcde-shard-00-00.abcde.mongodb.net:27017",
    hosts: ["ac-abcde-shard-00-00.abcde.mongodb.net:27017"],
  };

  assert.throws(
    () => validateRemoteMongoServerIdentity(wrongRsHello, ["cluster0.abcde.mongodb.net"], ["atlas-staging-shard-0"]),
    {
      message: /suspicious keyword match|Remote MongoDB replica set mismatch/,
    }
  );
});

test("25. validateRemoteMongoServerIdentity rejects server returning missing host identity", () => {
  const missingHostHello = {
    setName: "atlas-staging-shard-0",
  };

  assert.throws(
    () => validateRemoteMongoServerIdentity(missingHostHello, ["cluster0.abcde.mongodb.net"], ["atlas-staging-shard-0"]),
    {
      message: /Server returned no member or host identity information/,
    }
  );
});

test("26. validateRemoteMongoServerIdentity rejects server with unapproved member host", () => {
  const unapprovedMemberHello = {
    setName: "atlas-staging-shard-0",
    me: "ac-abcde-shard-00-00.abcde.mongodb.net:27017",
    hosts: [
      "ac-abcde-shard-00-00.abcde.mongodb.net:27017",
      "ac-rogue-shard-00-00.rogue.mongodb.net:27017",
    ],
  };

  assert.throws(
    () => validateRemoteMongoServerIdentity(unapprovedMemberHello, ["cluster0.abcde.mongodb.net"], ["atlas-staging-shard-0"]),
    {
      message: /is not in approved staging host list/,
    }
  );
});

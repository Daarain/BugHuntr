/**
 * Staging-Only Database Connection Diagnostic (Phase 1A Hardened)
 *
 * Safety Invariants & Remote Target Identity Verification:
 * 1. UNCONDITIONAL PRODUCTION BLOCK: Immediately exits if NODE_ENV === "production".
 * 2. EXPLICIT OPT-IN: Requires RUN_STAGING_DB_PROBE === "true".
 * 3. ENVIRONMENT DESIGNATION: Requires APP_ENV, ENVIRONMENT, or NODE_ENV to be "staging" or "development".
 * 4. INDEPENDENT REMOTE TARGET VERIFICATION:
 *    - Does NOT rely on client-side environment designations or negative keyword checks alone.
 *    - Does NOT treat URI pathname or client-selected db.databaseName alone as proof of remote deployment identity.
 *    - Requires explicit expected target identifiers:
 *      * EXPECTED_STAGING_PG_HOST / APPROVED_STAGING_PG_HOSTS
 *      * EXPECTED_STAGING_PG_DB / APPROVED_STAGING_PG_DB
 *      * EXPECTED_STAGING_PG_PROJECT_REF (mandatory when using shared pooler *.pooler.supabase.com)
 *      * EXPECTED_STAGING_MONGO_HOST / APPROVED_STAGING_MONGO_HOSTS
 *      * EXPECTED_STAGING_MONGO_DB / APPROVED_STAGING_MONGO_DB
 *      * EXPECTED_STAGING_MONGO_REPLICA_SET / APPROVED_STAGING_MONGO_REPLICA_SETS
 *    - Constrains wildcard matching to prevent broad multi-tenant cloud root domains (*.mongodb.net, *.supabase.co).
 *    - Correctly bridges MongoDB Atlas SRV seed hostnames and cluster member hostnames (*.<clusterId>.mongodb.net).
 *    - Dynamically validates PostgreSQL remote database via server-returned current_database().
 *    - Dynamically validates MongoDB remote deployment identity via server-returned `hello` topology
 *      (verifying server-reported setName, me, primary, and member hosts against approved allowlists).
 *    - Rejects and aborts unconditionally before any write or transaction probe if remote identity
 *      cannot be independently verified.
 * 5. SENSITIVE DETAIL PROTECTION:
 *    - Never prints passwords, tokens, credentials, or full connection strings.
 * 6. CONTROLLED TRANSACTION PROBE: Verifies write-and-abort on dedicated collection `_transaction_readiness_probe`.
 * 7. TARGETED CLEANUP: Only deletes the specific generated probeId; never purges collections.
 * 8. STRICT TEARDOWN: Always closes sessions, pools, and clients in finally blocks.
 *
 * Usage:
 *   RUN_STAGING_DB_PROBE=true \
 *   APP_ENV=staging \
 *   EXPECTED_STAGING_PG_HOST="aws-0-us-east-1.pooler.supabase.com" \
 *   EXPECTED_STAGING_PG_DB="postgres" \
 *   EXPECTED_STAGING_PG_PROJECT_REF="abcdefghijklmnopqrst" \
 *   EXPECTED_STAGING_MONGO_HOST="cluster0.staging.mongodb.net" \
 *   EXPECTED_STAGING_MONGO_DB="bughuntr_staging" \
 *   EXPECTED_STAGING_MONGO_REPLICA_SET="atlas-staging-shard-0" \
 *   npx tsx scripts/test-db-connections.ts
 */

import { randomUUID } from "crypto";

export interface ApprovedTargetConfig {
  approvedPgHosts: string[];
  expectedPgDb: string;
  expectedPgProjectRef?: string;
  approvedMongoHosts: string[];
  expectedMongoDb: string;
  approvedMongoReplicaSets: string[];
}

export interface RemoteMongoIdentityResult {
  verifiedReplicaSet: string;
  verifiedHosts: string[];
  serverReportedMe: string;
  serverReportedPrimary: string;
}

export const FORBIDDEN_BROAD_WILDCARDS = [
  "mongodb.net",
  "supabase.co",
  "supabase.com",
  "pooler.supabase.com",
  "amazonaws.com",
  "azure.com",
  "com",
  "net",
  "io",
  "org",
];

export function validateHostPatternSafety(pattern: string): void {
  const p = pattern.trim().toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    // Suffix must have at least 2 dots (>= 3 domain segments, e.g. abcde.mongodb.net)
    // and must not match public multi-tenant provider domains
    if (FORBIDDEN_BROAD_WILDCARDS.includes(suffix) || suffix.split(".").length < 3) {
      throw new Error(
        `Target validation failed: Wildcard host pattern '${pattern}' is too broad. Wildcards cannot match shared multi-tenant cloud domains (e.g. '*.mongodb.net', '*.supabase.co'). Specify a cluster-specific subdomain pattern (e.g. '*.abcde.mongodb.net') or exact hostnames.`
      );
    }
  }
}

export function getApprovedList(primaryVar: string | undefined, secondaryVar: string | undefined): string[] {
  const raw = primaryVar || secondaryVar || "";
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isHostApproved(candidateHost: string, approvedList: string[]): boolean {
  const cand = candidateHost.toLowerCase();
  return approvedList.some((approved) => {
    const app = approved.toLowerCase();

    // 1. Exact hostname match
    if (app === cand) return true;

    // 2. Constrained Wildcard match (e.g. *.abcde.mongodb.net)
    if (app.startsWith("*.")) {
      const suffix = app.slice(1); // e.g. .abcde.mongodb.net
      if (cand.endsWith(suffix) && cand.length > suffix.length) {
        return true;
      }
    }

    // 3. MongoDB Atlas SRV seed host to member host matching:
    // When an approved host is an Atlas SRV seed host (e.g. cluster0.abcde.mongodb.net),
    // Atlas member nodes follow the pattern ac-<clusterId>-shard-*.abcde.mongodb.net
    // or cluster0-shard-*.abcde.mongodb.net. They share the unique cluster domain: <clusterId>.mongodb.net
    if (app.endsWith(".mongodb.net")) {
      const parts = app.split(".");
      if (parts.length >= 4) {
        // e.g. [cluster0, abcde, mongodb, net] -> clusterDomain = "abcde.mongodb.net"
        const clusterDomain = parts.slice(1).join(".");
        if (cand.endsWith("." + clusterDomain)) {
          return true;
        }
      }
    }

    return false;
  });
}

export function isNameApproved(candidate: string, approvedList: string[]): boolean {
  const cand = candidate.toLowerCase();
  return approvedList.some((approved) => {
    const app = approved.toLowerCase();
    if (app === cand) return true;
    if (app.includes("*")) {
      const regex = new RegExp("^" + app.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      return regex.test(cand);
    }
    return false;
  });
}

export function assertNonProductionKeywords(name: string, targetIdentifier: string): void {
  const lower = targetIdentifier.toLowerCase();
  const prodKeywords = ["prod", "production", "live-db", "prod-cluster", "master-db"];
  const isSuspicious = prodKeywords.some(
    (kw) => lower.includes(kw) && !lower.includes("staging")
  );

  if (isSuspicious) {
    throw new Error(
      `${name} target appears to reference a production environment (suspicious keyword match: '${targetIdentifier}'). Aborting.`
    );
  }
}

export function validateApprovedTargetConfiguration(
  target: "all" | "postgres" | "mongo" = "all"
): ApprovedTargetConfig {
  const approvedPgHosts = getApprovedList(
    process.env.EXPECTED_STAGING_PG_HOST,
    process.env.APPROVED_STAGING_PG_HOSTS
  );
  const expectedPgDb = (
    process.env.EXPECTED_STAGING_PG_DB ||
    process.env.APPROVED_STAGING_PG_DB ||
    ""
  ).trim().toLowerCase();

  const expectedPgProjectRef = (
    process.env.EXPECTED_STAGING_PG_PROJECT_REF ||
    process.env.APPROVED_STAGING_PG_PROJECT_REF ||
    ""
  ).trim().toLowerCase() || undefined;

  const approvedMongoHosts = getApprovedList(
    process.env.EXPECTED_STAGING_MONGO_HOST,
    process.env.APPROVED_STAGING_MONGO_HOSTS
  );
  const expectedMongoDb = (
    process.env.EXPECTED_STAGING_MONGO_DB ||
    process.env.APPROVED_STAGING_MONGO_DB ||
    ""
  ).trim().toLowerCase();

  const approvedMongoReplicaSets = getApprovedList(
    process.env.EXPECTED_STAGING_MONGO_REPLICA_SET,
    process.env.APPROVED_STAGING_MONGO_REPLICA_SETS
  );

  if (target !== "mongo") {
    if (approvedPgHosts.length === 0) {
      throw new Error(
        "Target validation failed: No approved PostgreSQL staging hosts configured via EXPECTED_STAGING_PG_HOST or APPROVED_STAGING_PG_HOSTS."
      );
    }

    // Validate PostgreSQL host wildcard safety
    for (const hostPattern of approvedPgHosts) {
      validateHostPatternSafety(hostPattern);
    }

    if (!expectedPgDb) {
      throw new Error(
        "Target validation failed: No approved PostgreSQL staging database configured via EXPECTED_STAGING_PG_DB."
      );
    }
  }

  if (target !== "postgres") {
    if (approvedMongoHosts.length === 0) {
      throw new Error(
        "Target validation failed: No approved MongoDB staging hosts configured via EXPECTED_STAGING_MONGO_HOST or APPROVED_STAGING_MONGO_HOSTS."
      );
    }

    // Validate MongoDB host wildcard safety
    for (const hostPattern of approvedMongoHosts) {
      validateHostPatternSafety(hostPattern);
    }

    if (!expectedMongoDb) {
      throw new Error(
        "Target validation failed: No approved MongoDB staging database configured via EXPECTED_STAGING_MONGO_DB."
      );
    }

    if (approvedMongoReplicaSets.length === 0) {
      throw new Error(
        "Target validation failed: No approved MongoDB staging replica set configured via EXPECTED_STAGING_MONGO_REPLICA_SET or APPROVED_STAGING_MONGO_REPLICA_SETS. Remote topology identity cannot be independently verified."
      );
    }
  }

  return {
    approvedPgHosts,
    expectedPgDb,
    expectedPgProjectRef,
    approvedMongoHosts,
    expectedMongoDb,
    approvedMongoReplicaSets,
  };
}

export function parsePostgresTarget(rawUrl: string): {
  host: string;
  dbName: string;
  user: string;
  projectRef?: string;
} {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const dbName = (parsed.pathname || "").replace(/^\//, "").split("?")[0].toLowerCase();
    const user = decodeURIComponent(parsed.username || "").toLowerCase();

    // Extract project ref:
    // In pooler: postgres.[project-ref]
    // In direct: db.[project-ref].supabase.co
    let projectRef: string | undefined;
    if (user.includes(".")) {
      projectRef = user.split(".")[1];
    } else if (host.startsWith("db.") && host.endsWith(".supabase.co")) {
      projectRef = host.split(".")[1];
    }

    return { host, dbName, user, projectRef };
  } catch (err: any) {
    throw new Error(`Failed to parse PostgreSQL URL: ${err.message}`);
  }
}

export function parseMongoTarget(rawUri: string): { hosts: string[]; dbName: string } {
  try {
    const withoutProto = rawUri.replace(/^mongodb(\+srv)?:\/\//, "");
    const withoutCreds = withoutProto.includes("@") ? withoutProto.split("@")[1] : withoutProto;
    const pathAndQuery = withoutCreds.includes("/") ? withoutCreds.slice(withoutCreds.indexOf("/") + 1) : "";
    const dbFromPath = pathAndQuery.split("?")[0].toLowerCase();
    const dbName = dbFromPath || (process.env.MONGODB_DB_NAME || "bughuntr").toLowerCase();

    const hostPortPart = withoutCreds.split("/")[0].split("?")[0];
    const hosts = hostPortPart
      .split(",")
      .map((h) => h.split(":")[0].trim().toLowerCase())
      .filter(Boolean);

    return { hosts, dbName };
  } catch (err: any) {
    throw new Error(`Failed to parse MongoDB URI: ${err.message}`);
  }
}

/**
 * Validates remote MongoDB deployment identity against server-returned hello response.
 * Does not trust client-selected db.databaseName or URI alone.
 */
export function validateRemoteMongoServerIdentity(
  helloResponse: any,
  approvedMongoHosts: string[],
  approvedReplicaSets: string[]
): RemoteMongoIdentityResult {
  if (!helloResponse || typeof helloResponse !== "object") {
    throw new Error(
      "Remote MongoDB deployment identity validation failed: Empty or invalid hello response received from server."
    );
  }

  // 1. Replica Set verification from server hello response
  const setName = typeof helloResponse.setName === "string" ? helloResponse.setName.trim() : "";
  if (!setName) {
    throw new Error(
      "Remote MongoDB deployment identity validation failed: Connected server returned no replica set name (setName). Staging transaction validation requires an approved replica set deployment."
    );
  }

  assertNonProductionKeywords("Remote MongoDB ReplicaSet", setName);

  if (!approvedReplicaSets || approvedReplicaSets.length === 0) {
    throw new Error(
      "Remote MongoDB deployment identity validation failed: No approved replica sets configured in EXPECTED_STAGING_MONGO_REPLICA_SET or APPROVED_STAGING_MONGO_REPLICA_SETS."
    );
  }

  const isReplicaSetMatched = isNameApproved(setName, approvedReplicaSets);
  if (!isReplicaSetMatched) {
    throw new Error(
      `Remote MongoDB replica set mismatch! Server returned setName '${setName}', which does not match approved staging replica sets [${approvedReplicaSets.join(
        ", "
      )}].`
    );
  }

  // 2. Server-reported member hosts verification
  const me = typeof helloResponse.me === "string" ? helloResponse.me.trim() : "";
  const primary = typeof helloResponse.primary === "string" ? helloResponse.primary.trim() : "";
  const memberHosts = Array.isArray(helloResponse.hosts) ? helloResponse.hosts : [];

  const rawHosts: string[] = [me, primary, ...memberHosts].filter(Boolean);
  if (rawHosts.length === 0) {
    throw new Error(
      "Remote MongoDB deployment identity validation failed: Server returned no member or host identity information in hello response."
    );
  }

  const verifiedHosts = Array.from(
    new Set(rawHosts.map((h) => h.split(":")[0].trim().toLowerCase()).filter(Boolean))
  );

  for (const host of verifiedHosts) {
    assertNonProductionKeywords("Remote MongoDB Server Host", host);
    if (!isHostApproved(host, approvedMongoHosts)) {
      throw new Error(
        `Remote MongoDB server-reported identity host '${host}' is not in approved staging host list [${approvedMongoHosts.join(
          ", "
        )}].`
      );
    }
  }

  return {
    verifiedReplicaSet: setName,
    verifiedHosts,
    serverReportedMe: me || "unknown",
    serverReportedPrimary: primary || "unknown",
  };
}

export async function runDiagnostics(): Promise<void> {
  // 1. Unconditional Production Block
  if (process.env.NODE_ENV === "production") {
    console.error(
      "FATAL: Database connection diagnostic cannot run in production (NODE_ENV === 'production'). Aborting unconditionally."
    );
    process.exit(1);
  }

  // 2. Explicit Opt-In Requirement
  if (process.env.RUN_STAGING_DB_PROBE !== "true") {
    console.error(
      "FATAL: Diagnostic aborted. Explicit opt-in required: RUN_STAGING_DB_PROBE must be set to 'true'."
    );
    process.exit(1);
  }

  // 3. Staging/Development Environment Verification
  const targetEnv = (
    process.env.APP_ENV ||
    process.env.ENVIRONMENT ||
    process.env.NODE_ENV ||
    ""
  ).toLowerCase();

  if (targetEnv !== "staging" && targetEnv !== "development") {
    console.error(
      `FATAL: Diagnostic aborted. Target environment must be 'staging' or 'development'. Detected: '${targetEnv}'.`
    );
    process.exit(1);
  }

  const args = typeof process !== "undefined" && process.argv ? process.argv.slice(2) : [];
  let probeTarget: "all" | "postgres" | "mongo" = "all";
  if (args.includes("--pg-only") || process.env.PROBE_TARGET === "postgres") {
    probeTarget = "postgres";
  } else if (args.includes("--mongo-only") || process.env.PROBE_TARGET === "mongo") {
    probeTarget = "mongo";
  }

  console.log("================================================================================");
  console.log(`Starting BugHuntr Phase 1A Database Diagnostics (Staging Only - Hardened)${probeTarget !== "all" ? ` [${probeTarget.toUpperCase()}-ONLY]` : ""}`);
  console.log(`Target Environment: ${targetEnv}`);
  console.log("================================================================================\n");

  let approvedConfig: ApprovedTargetConfig;
  try {
    approvedConfig = validateApprovedTargetConfiguration(probeTarget);
  } catch (cfgErr: any) {
    console.error(`FATAL: ${cfgErr.message}`);
    process.exit(1);
  }

  const {
    approvedPgHosts,
    expectedPgDb,
    expectedPgProjectRef,
    approvedMongoHosts,
    expectedMongoDb,
    approvedMongoReplicaSets,
  } = approvedConfig;

  let pgTarget: ReturnType<typeof parsePostgresTarget> | undefined;
  if (probeTarget !== "mongo") {
    // Inspect PostgreSQL Connection String (static validation)
    const pgUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
    if (!pgUrl) {
      console.error("FATAL: Neither POSTGRES_URL nor DATABASE_URL is defined.");
      process.exit(1);
    }

    try {
      pgTarget = parsePostgresTarget(pgUrl);
      assertNonProductionKeywords("PostgreSQL Host", pgTarget.host);
      assertNonProductionKeywords("PostgreSQL Database", pgTarget.dbName);
      if (pgTarget.projectRef) {
        assertNonProductionKeywords("PostgreSQL Project Ref", pgTarget.projectRef);
      }
    } catch (pgParseErr: any) {
      console.error(`FATAL: ${pgParseErr.message}`);
      process.exit(1);
    }

    if (!isHostApproved(pgTarget.host, approvedPgHosts)) {
      console.error(
        `FATAL: PostgreSQL host '${pgTarget.host}' is not in approved staging host list [${approvedPgHosts.join(
          ", "
        )}]. Aborting.`
      );
      process.exit(1);
    }
    if (pgTarget.dbName !== expectedPgDb) {
      console.error(
        `FATAL: PostgreSQL database '${pgTarget.dbName}' does not match expected staging database '${expectedPgDb}'. Aborting.`
      );
      process.exit(1);
    }

    // Supabase Pooler project-ref verification:
    // All projects on a shared Supabase pooler connect to the same host and have the same db ('postgres').
    // Therefore, EXPECTED_STAGING_PG_PROJECT_REF must be configured and matched against the user/host.
    const isSupabasePooler = pgTarget.host.endsWith("pooler.supabase.com");
    if (isSupabasePooler) {
      if (!expectedPgProjectRef) {
        console.error(
          "FATAL: PostgreSQL target is a shared Supabase pooler (*.pooler.supabase.com). Because all projects on this pooler share the same host and database name ('postgres'), EXPECTED_STAGING_PG_PROJECT_REF must be configured to positively verify the staging project reference. Aborting."
        );
        process.exit(1);
      }
      if (pgTarget.projectRef !== expectedPgProjectRef) {
        console.error(
          `FATAL: PostgreSQL pooler project reference '${pgTarget.projectRef || "unspecified"}' does not match expected staging project reference '${expectedPgProjectRef}'. Aborting.`
        );
        process.exit(1);
      }
    } else if (expectedPgProjectRef && pgTarget.projectRef) {
      if (pgTarget.projectRef !== expectedPgProjectRef) {
        console.error(
          `FATAL: PostgreSQL project reference '${pgTarget.projectRef}' does not match expected staging project reference '${expectedPgProjectRef}'. Aborting.`
        );
        process.exit(1);
      }
    }
  }

  let mongoTarget: ReturnType<typeof parseMongoTarget> | undefined;
  if (probeTarget !== "postgres") {
    // Inspect MongoDB Connection URI (static validation)
    const mongoUri = process.env.MONGODB_URI || "";
    if (!mongoUri) {
      console.error("FATAL: MONGODB_URI is not defined.");
      process.exit(1);
    }

    try {
      mongoTarget = parseMongoTarget(mongoUri);
      assertNonProductionKeywords("MongoDB Host", mongoTarget.hosts.join(","));
      assertNonProductionKeywords("MongoDB Database", mongoTarget.dbName);
    } catch (mongoParseErr: any) {
      console.error(`FATAL: ${mongoParseErr.message}`);
      process.exit(1);
    }

    for (const host of mongoTarget.hosts) {
      if (!isHostApproved(host, approvedMongoHosts)) {
        console.error(
          `FATAL: MongoDB host '${host}' is not in approved staging host list [${approvedMongoHosts.join(
            ", "
          )}]. Aborting.`
        );
        process.exit(1);
      }
    }
    if (mongoTarget.dbName !== expectedMongoDb) {
      console.error(
        `FATAL: MongoDB database '${mongoTarget.dbName}' does not match expected staging database '${expectedMongoDb}'. Aborting.`
      );
      process.exit(1);
    }
  }

  console.log("[STATIC TARGET VERIFICATION PASSED]");
  if (pgTarget) {
    console.log(`  PostgreSQL Target Host:        ${pgTarget.host}`);
    console.log(`  PostgreSQL Target Database:    ${pgTarget.dbName}`);
    if (pgTarget.projectRef) {
      console.log(`  PostgreSQL Project Ref:        ${pgTarget.projectRef}`);
    }
  }
  if (mongoTarget) {
    console.log(`  MongoDB Target Hosts:          ${mongoTarget.hosts.join(", ")}`);
    console.log(`  MongoDB Target Database:       ${mongoTarget.dbName}`);
    console.log(`  Approved Mongo ReplicaSets:    ${approvedMongoReplicaSets.join(", ")}`);
  }
  console.log();

  let pgPool;
  let mongoClient;
  const probeId = `probe_${randomUUID()}`;
  let probeCollection: any = null;

  try {
    if (probeTarget !== "mongo") {
      // -------------------------------------------------------------------------
      // 1. PostgreSQL Connectivity Probe & Dynamic Target Verification
      // -------------------------------------------------------------------------
      console.log("[1/3] Testing PostgreSQL Connection & Target Verification...");
      const { getPostgresPool } = await import("../lib/db/postgres");
      pgPool = getPostgresPool();
      const pgResult = await pgPool.query(
        "SELECT NOW() as current_time, current_database() as db_name, version() as version;"
      );

      const pgRow = pgResult.rows[0];
      const resolvedPgDb = (pgRow.db_name || "").toLowerCase();
      if (resolvedPgDb !== expectedPgDb) {
        console.error(
          `FATAL: PostgreSQL dynamic target mismatch. Connected database is '${resolvedPgDb}', expected '${expectedPgDb}'. Aborting.`
        );
        process.exit(1);
      }

      console.log("  [SUCCESS] PostgreSQL connected and verified against expected staging target.");
      console.log(`    Database: ${pgRow.db_name}`);
      console.log(`    Server Time: ${pgRow.current_time}`);
      console.log(`    Version: ${pgRow.version.split(" ")[0]} ${pgRow.version.split(" ")[1]}\n`);
    }

    if (probeTarget !== "postgres") {
      // -------------------------------------------------------------------------
      // 2. MongoDB Topology Probe & Remote Server Identity Verification
      // -------------------------------------------------------------------------
      console.log("[2/3] Testing MongoDB Connection & Remote Server Identity Verification...");
      const { getMongoClient, getMongoDatabase } = await import("../lib/db/mongodb");
      mongoClient = await getMongoClient();
      const db = await getMongoDatabase();

      const hello = await db.command({ hello: 1 });
      const remoteIdentity = validateRemoteMongoServerIdentity(
        hello,
        approvedMongoHosts,
        approvedMongoReplicaSets
      );

      console.log("  [SUCCESS] Remote MongoDB deployment identity verified by server-returned topology:");
      console.log(`    Server-Verified Replica Set: ${remoteIdentity.verifiedReplicaSet}`);
      console.log(`    Server Node Identity (me):   ${remoteIdentity.serverReportedMe}`);
      console.log(`    Primary Node:                ${remoteIdentity.serverReportedPrimary}`);
      console.log(`    Topology Member Hosts:       ${remoteIdentity.verifiedHosts.join(", ")}`);
      console.log(`    Writable Primary:            ${Boolean(hello.isWritablePrimary)}`);
      console.log(`    Max Wire Version:            ${hello.maxWireVersion}\n`);

      // -------------------------------------------------------------------------
      // 3. MongoDB Transaction Readiness Probe (Write & Abort)
      // -------------------------------------------------------------------------
      console.log("[3/3] Testing MongoDB Multi-Document Transaction Support (Write & Abort)...");
      probeCollection = db.collection("_transaction_readiness_probe");

      let session;
      let transactionSupported = false;

      try {
        session = mongoClient.startSession();
        session.startTransaction();

        // Write within transaction
        await probeCollection.insertOne(
          {
            probeId,
            createdAt: new Date(),
            purpose: "transaction_verification",
            env: targetEnv,
          },
          { session }
        );

        // Verify visibility inside transaction
        const docInside = await probeCollection.findOne({ probeId }, { session });
        if (!docInside) {
          throw new Error("Probe document was not visible inside active transaction.");
        }

        // Deliberately abort the transaction
        await session.abortTransaction();
        await session.endSession();
        session = undefined;

        // Verify that document was rolled back outside the transaction
        const docOutside = await probeCollection.findOne({ probeId });
        if (docOutside !== null) {
          throw new Error(
            "Transaction rollback failed: probe document persisted outside transaction after abortTransaction()."
          );
        }

        transactionSupported = true;
        console.log("  [SUCCESS] Multi-document transactions verified.");
        console.log(`    Probe ID: ${probeId}`);
        console.log("    Write, isolation, and rollback behaved as expected.\n");
      } catch (txnError: any) {
        if (session) {
          try {
            await session.abortTransaction();
          } catch {
            // Ignore secondary abort errors during failure
          }
          await session.endSession();
        }

        // Discriminate error codes
        if (
          txnError.code === 20 ||
          txnError.message?.includes("Transaction numbers are only allowed on a replica set member or mongos")
        ) {
          console.error("  [FAILED] MongoDB instance does not support transactions.");
          console.error("    Error Code 20 (IllegalOperation): Standalone MongoDB instance detected.");
          console.error(
            "    Financial transactions and wallet consistency require a Replica Set (Atlas or local replica set).\n"
          );
        } else if (txnError.code === 13) {
          console.error("  [FAILED] Insufficient permissions for transactions.");
          console.error("    Error Code 13 (Unauthorized): Database user lacks required RBAC roles.\n");
        } else if (txnError.code === 18) {
          console.error("  [FAILED] Authentication failed during transaction session.");
          console.error("    Error Code 18 (AuthenticationFailed).\n");
        } else {
          console.error(`  [FAILED] Transaction probe encountered an error: ${txnError.message}\n`);
        }
        throw txnError;
      }
    }

    console.log("================================================================================");
    console.log("Diagnostic Summary: ALL CHECKS PASSED");
    if (probeTarget === "postgres") {
      console.log("PostgreSQL connection infrastructure is verified and ready.");
    } else if (probeTarget === "mongo") {
      console.log("MongoDB connection infrastructure is verified and ready.");
    } else {
      console.log("PostgreSQL and MongoDB connection infrastructure is verified and ready.");
    }
    console.log("================================================================================");
  } catch (error: any) {
    console.error("Diagnostic encountered a failure:", error.message || error);
    process.exit(1);
  } finally {
    // Targeted cleanup of probe document if it accidentally persisted
    if (probeCollection) {
      try {
        await probeCollection.deleteOne({ probeId });
      } catch (cleanupErr: any) {
        console.error("Notice: Failed to perform targeted probe cleanup:", cleanupErr.message);
      }
    }

    // Strict teardown of pools and clients
    if (pgPool) {
      try {
        await pgPool.end();
      } catch (poolErr: any) {
        console.error("Notice: Failed to close PostgreSQL pool:", poolErr.message);
      }
    }
    if (mongoClient) {
      try {
        await mongoClient.close();
      } catch (clientErr: any) {
        console.error("Notice: Failed to close MongoDB client:", clientErr.message);
      }
    }
  }
}

// Auto-run when executed directly via CLI
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("test-db-connections.ts") || process.argv[1].endsWith("test-db-connections.js"))
) {
  runDiagnostics();
}

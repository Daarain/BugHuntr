/**
 * MongoDB Connection Infrastructure (Phase 1A)
 *
 * Scoped strictly to MongoDB-owned domain:
 * - Organizations and enterprise tenant relations
 * - Bug hunts, bug reports, submissions, and vulnerabilities
 * - Wallets, balances, payment records, payouts, payout logs, and subscriptions
 * - Rewards, points balances, points transactions, and achievements
 * - Communities, memberships, messages, and collaboration
 *
 * Configured conservatively for Vercel serverless execution with self-healing connection retry.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/db/mongodb.ts cannot be executed in the browser");
}

import { MongoClient, type MongoClientOptions, type Db } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

/**
 * Retrieves and validates the MongoDB connection URI from environment variables.
 * Throws a descriptive configuration error if MONGODB_URI is not configured.
 */
export function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri || typeof uri !== "string" || uri.trim().length === 0) {
    throw new Error(
      "MongoDB connection URI missing: MONGODB_URI environment variable is not configured."
    );
  }
  return uri.trim();
}

/**
 * Lazily initializes and returns the cached MongoDB client promise.
 * No connections or environment lookups occur at module import time.
 *
 * Pool sizing:
 * - minPoolSize: 0 ensures serverless lambdas do not maintain idle sockets when frozen.
 * - maxPoolSize: 10 limits socket usage per active container.
 * - serverSelectionTimeoutMS: 5000 (5s) fails fast on network or replica set unreachable.
 *
 * Resiliency:
 * - Attaches a rejection handler to clear the cached promise on failure, ensuring
 *   subsequent invocations can retry rather than permanently failing on a cached rejection.
 */
export async function getMongoClient(options?: MongoClientOptions): Promise<MongoClient> {
  if (globalThis._mongoClientPromise) {
    return globalThis._mongoClientPromise;
  }

  const uri = getMongoUri();

  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
    ...options,
  });

  const connectPromise = client.connect().catch((err) => {
    // Self-healing: clear the cached promise so subsequent requests can retry
    globalThis._mongoClientPromise = undefined;
    throw err;
  });

  globalThis._mongoClientPromise = connectPromise;
  return connectPromise;
}

/**
 * Lazily obtains the connected MongoDB client and returns the requested database instance.
 * Defaults to process.env.MONGODB_DB_NAME or "bughuntr".
 */
export async function getMongoDatabase(dbName?: string): Promise<Db> {
  const client = await getMongoClient();
  const targetDb = dbName || process.env.MONGODB_DB_NAME || "bughuntr";
  return client.db(targetDb);
}

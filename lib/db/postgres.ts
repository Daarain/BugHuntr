/**
 * PostgreSQL Connection Infrastructure (Phase 1A)
 *
 * Scoped strictly to SQL-owned domain:
 * - User identity and account credentials (bcrypt hashes)
 * - Roles, account permissions, and basic user profiles
 * - Two-factor authentication (2FA) secrets/recovery codes
 * - Authentication and account-security audit records
 *
 * Configured conservatively for Vercel serverless execution and Supabase connection poolers.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/db/postgres.ts cannot be executed in the browser");
}

import { Pool, type PoolConfig } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

/**
 * Retrieves and validates the PostgreSQL connection URL from environment variables.
 * Prefers POSTGRES_URL, falling back to DATABASE_URL.
 * Throws a descriptive configuration error if neither variable is set.
 */
export function getPostgresUrl(): string {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url || typeof url !== "string" || url.trim().length === 0) {
    throw new Error(
      "PostgreSQL connection string missing: neither POSTGRES_URL nor DATABASE_URL environment variable is configured."
    );
  }
  return url.trim();
}

/**
 * Lazily initializes and returns the cached PostgreSQL connection pool.
 * No connections or environment lookups occur at module import time.
 *
 * Pool sizing:
 * - max: 2 connections per serverless instance to prevent exhausting Supabase pooler limits.
 * - idleTimeoutMillis: 10000 (10s) to release idle connections promptly in serverless containers.
 * - connectionTimeoutMillis: 5000 (5s) to fail fast on network or pool exhaustion.
 */
export function getPostgresPool(configOverrides?: Partial<PoolConfig>): Pool {
  if (globalThis._pgPool) {
    return globalThis._pgPool;
  }

  const connectionString = getPostgresUrl();

  const pool = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    ...configOverrides,
  });

  // Attach error handler to idle clients to prevent uncaught process exceptions
  pool.on("error", (err: Error) => {
    console.error("Unexpected error on idle PostgreSQL client:", err.message);
  });

  globalThis._pgPool = pool;
  return pool;
}

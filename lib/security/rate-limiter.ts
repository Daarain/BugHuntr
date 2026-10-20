/**
 * Distributed & Serverless Rate Limiting Module
 *
 * Implements persistent, multi-instance rate limiting backed by MongoDB TTL documents,
 * with a high-performance in-memory sliding-window fallback for local/offline test suites.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMongoDatabase } from "@/lib/db/mongodb";

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

// In-memory fallback cache for offline test environments
const memoryStore = new Map<string, { count: number; resetAt: number }>();

export function clearMemoryRateLimitStore(): void {
  memoryStore.clear();
}

/**
 * Extracts normalized client IP address from standard proxy/CDN headers.
 */
export function getClientIp(request: Request | NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip");
  if (realIp?.trim()) return realIp.trim();
  return "127.0.0.1";
}

/**
 * Checks and increments rate limit counter for a given key.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now();

  try {
    const db = await getMongoDatabase();
    const col = db.collection("rate_limits");

    // Ensure TTL index exists (lazily created once)
    col.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }).catch(() => {});

    const resetDate = new Date(now + windowSeconds * 1000);

    const doc = await col.findOneAndUpdate(
      { _id: key as any },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          created_at: new Date(now),
          expires_at: resetDate,
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    const currentCount = doc?.count || 1;
    const expiresAt = doc?.expires_at ? new Date(doc.expires_at).getTime() : now + windowSeconds * 1000;
    const resetSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));

    if (currentCount > limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds,
      };
    }

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - currentCount),
      resetSeconds,
    };
  } catch {
    // Database unavailable or offline: use memoryStore fallback
    let entry = memoryStore.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 1, resetAt: now + windowSeconds * 1000 };
      memoryStore.set(key, entry);
    } else {
      entry.count += 1;
    }

    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    const allowed = entry.count <= limit;

    return {
      allowed,
      limit,
      remaining: allowed ? Math.max(0, limit - entry.count) : 0,
      resetSeconds,
    };
  }
}

/**
 * Enforces rate limiting on an incoming Next.js API request.
 * Returns null if allowed, or a 429 Too Many Requests response if rate limit is exceeded.
 */
export async function enforceRateLimit(
  request: Request | NextRequest,
  options: {
    action: string;
    limit: number;
    windowSeconds: number;
    identifier?: string;
  }
): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const key = options.identifier
    ? `rl:${options.action}:${ip}:${options.identifier}`
    : `rl:${options.action}:${ip}`;

  const result = await checkRateLimit(key, options.limit, options.windowSeconds);

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests. Please wait a moment before trying again.",
        retryAfter: result.resetSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.resetSeconds),
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(result.resetSeconds),
        },
      }
    );
  }

  return null;
}

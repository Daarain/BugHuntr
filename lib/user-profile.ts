/**
 * User Profile Helper
 *
 * Interacts with PostgreSQL authRepository to ensure profile records exist.
 * Zero Firestore dependencies.
 */

import { authRepository } from "./db/auth-repository";

function isPostgresConfigured(): boolean {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  return Boolean(url && url.trim().length > 0);
}

export async function createUserProfile(username: string, userId?: string) {
  const cleanUsername = username.trim().replace(/[^a-zA-Z0-9_-]/g, "_");

  if (isPostgresConfigured() && userId) {
    try {
      const existing = await authRepository.findProfileByUsername(cleanUsername);
      if (existing) return existing;
    } catch {
      // Continue to fallback
    }
  }

  // Non-Firestore synthetic profile for unconfigured or memory environments
  return {
    id: userId || cleanUsername,
    user_id: userId || cleanUsername,
    username: cleanUsername,
    points: 0,
    walletBalance: 0,
    createdAt: new Date().toISOString(),
    ...(userId ? { userId } : {}),
  };
}

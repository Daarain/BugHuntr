/**
 * User Profile and Identity Resolution Service (PostgreSQL / Supabase)
 *
 * Provides batch resolution and profile lookups for application gateway:
 * - Hydrates user profiles for lists of MongoDB bug submissions, payouts, and comments
 * - Resolves usernames to PostgreSQL user profiles
 */

import { authRepository, type UserProfile } from "./auth-repository";

/**
 * Resolves a list of user IDs to a Map of UserProfiles in a single batched query.
 * Used by MongoDB endpoints to hydrate hunter profiles without cross-database joins.
 */
export async function getUserProfilesBatch(userIds: string[]): Promise<Map<string, UserProfile>> {
  return authRepository.getUserProfilesBatch(userIds);
}

/**
 * Retrieves a user profile by username.
 */
export async function getUserProfileByUsername(username: string): Promise<UserProfile | null> {
  return authRepository.findProfileByUsername(username);
}

/**
 * Retrieves a user profile by stable user ID.
 */
export async function getUserProfileById(userId: string): Promise<UserProfile | null> {
  const user = await authRepository.findUserById(userId);
  return user?.profile || null;
}

/**
 * Updates a user profile in PostgreSQL.
 */
export async function updateUserProfile(
  userId: string,
  updates: {
    displayName?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    country?: string | null;
    companyName?: string | null;
  }
): Promise<UserProfile | null> {
  return authRepository.updateProfile(userId, updates);
}

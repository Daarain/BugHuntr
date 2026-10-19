/**
 * User Profile Retrieval Service
 *
 * Universal helper that safely bridges client and server contexts:
 * - On the client: Calls the authenticated /api/user/profile endpoint to avoid bundling database drivers.
 * - On the server: Resolves directly via PostgreSQL authoritative store with MongoDB fallback.
 * Zero Firestore dependencies.
 */

export async function getUserProfileByUsername(username: string) {
  if (!username) return null;

  // 1. Client-side execution: Call internal API route to keep pg driver on server
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(`/api/user/profile?username=${encodeURIComponent(username)}`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.error("Client profile fetch error:", err);
      return null;
    }
  }

  // 2. Server-side execution: Direct PostgreSQL query
  try {
    const { getUserProfileByUsername: getPgProfile } = await import("./db/users");
    const pgProfile = await getPgProfile(username);
    if (pgProfile) {
      return {
        id: pgProfile.user_id,
        username: pgProfile.username,
        displayName: pgProfile.display_name,
        name: pgProfile.display_name,
        avatarUrl: pgProfile.avatar_url,
        bio: pgProfile.bio,
        country: pgProfile.country,
        points: pgProfile.points || 0,
        reputationRank: pgProfile.reputation_rank || "Novice",
        companyName: pgProfile.company_name,
        createdAt: pgProfile.created_at,
      };
    }
  } catch {
    // If PostgreSQL is not reachable, fallback to MongoDB
  }

  // 3. Server-side MongoDB fallback
  try {
    const { getMongoDatabase } = await import("@/lib/db/mongodb");
    const { GamificationRepository } = await import("@/lib/db/repositories/gamification.repo");
    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);
    const balance = await repo.getPointsBalanceByUsername(username);
    if (balance) {
      return {
        id: balance.user_id,
        username: balance.username || username,
        displayName: balance.username || username,
        name: balance.username || username,
        points: balance.points || 0,
        reputationRank: balance.reputation_rank || "Novice",
        createdAt: balance.last_activity,
      };
    }
  } catch {
    return null;
  }

  return null;
}

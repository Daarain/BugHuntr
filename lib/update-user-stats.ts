/**
 * User Gamification Stats Helper (MongoDB Implementation)
 *
 * Updates hunter points, submitted bug counters, streaks, and reputation tiers
 * in the MongoDB user_points_balances collection.
 */

import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";

// Server-only database execution guard
if (typeof window !== "undefined") {
  throw new Error("lib/update-user-stats.ts is a server-only module and cannot be executed in the browser.");
}

export async function updateUserBugCount(username: string, increment: number = 1): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    const existing = await repo.getPointsBalanceByUsername(username);
    const userId = existing?.user_id || username;

    await repo.addPoints(userId, 0, {
      username,
      bugIncrement: increment,
      reason: "Bug count incremented",
    });

    return true;
  } catch (error) {
    console.error("Error updating bug count:", error);
    return false;
  }
}

export async function updateUserStats(
  username: string,
  points: number,
  bugIncrement: number = 1,
  role: "user" | "admin" | "triager" | "company" | "hunter" | string = "user",
  companyName?: string
): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    // Look up existing balance by username or default to username as string ID
    const existing = await repo.getPointsBalanceByUsername(username);
    const userId = existing?.user_id || username;

    await repo.addPoints(userId, points, {
      username,
      bugIncrement,
      reason: `Stats updated (role: ${role}${companyName ? `, company: ${companyName}` : ""})`,
    });

    return true;
  } catch (error) {
    console.error("Error updating user stats:", error);
    return false;
  }
}
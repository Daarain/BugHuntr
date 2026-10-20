/**
 * Points Allocation Helper (MongoDB Implementation)
 *
 * Provides backwards-compatible point awarding to user profiles backed by MongoDB GamificationRepository.
 */

import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";

export async function addPointsToUserProfile(username: string, points: number): Promise<boolean> {
  try {
    if (!username || points <= 0) return false;

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    const balance = await repo.getPointsBalanceByUsername(username);
    if (!balance) return false;

    await repo.addPoints(balance.user_id, points, {
      username,
      reason: "Points added to user profile",
    });

    return true;
  } catch (error) {
    console.error("Error in addPointsToUserProfile:", error);
    return false;
  }
}

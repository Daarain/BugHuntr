import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";
import { REWARD_CATALOG } from "@/types/ranking";

export async function GET(request: NextRequest) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    let userRewards: any[] = [];
    if (authenticated && user) {
      const records = await repo.listUserRewards(user.id);
      userRewards = records.map((r) => ({
        id: r._id,
        userId: r.user_id,
        rewardId: r.reward_id,
        redeemedAt: new Date(r.redeemed_at).toISOString(),
        status: r.status,
      }));
    }

    // Attach current redemptions count for limitedQuantity rewards
    const catalogWithAvailability = await Promise.all(
      REWARD_CATALOG.map(async (reward) => {
        let remainingQuantity: number | undefined = undefined;
        if (reward.limitedQuantity) {
          const count = await repo.countRedemptions(reward.id);
          remainingQuantity = Math.max(0, reward.limitedQuantity - count);
        }
        return {
          ...reward,
          remainingQuantity,
        };
      })
    );

    return NextResponse.json({
      catalog: catalogWithAvailability,
      userRewards,
    });
  } catch (error: any) {
    console.error("GET /api/rankings/rewards error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

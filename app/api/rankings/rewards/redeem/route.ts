import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";
import { REWARD_CATALOG, RankTier } from "@/types/ranking";

function isRankHigherOrEqual(userRank: RankTier, requiredRank: RankTier): boolean {
  const order: RankTier[] = ["E", "D", "C", "B", "A", "S"];
  return order.indexOf(userRank) >= order.indexOf(requiredRank);
}

export async function POST(request: NextRequest) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { rewardId } = body;

    if (!rewardId) {
      return NextResponse.json({ error: "Reward ID is required" }, { status: 400 });
    }

    const reward = REWARD_CATALOG.find((r) => r.id === rewardId);
    if (!reward) {
      return NextResponse.json({ error: "Reward not found in catalogue" }, { status: 404 });
    }

    if (!reward.available) {
      return NextResponse.json({ error: "Reward is currently unavailable" }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    const balance = await repo.getPointsBalance(user.id);
    const userRank = (balance?.reputation_rank || repo.deriveRank(balance?.points || 0)) as RankTier;

    // Check rank requirement
    if (reward.requiredRank && !isRankHigherOrEqual(userRank, reward.requiredRank)) {
      return NextResponse.json(
        { error: `Requires rank ${reward.requiredRank} or higher. Your current rank is ${userRank}.` },
        { status: 403 }
      );
    }

    // Check inventory stock if limited
    if (reward.limitedQuantity) {
      const redemptionsCount = await repo.countRedemptions(reward.id);
      if (redemptionsCount >= reward.limitedQuantity) {
        return NextResponse.json({ error: "Reward is out of stock" }, { status: 400 });
      }
    }

    // Atomically deduct points
    const deduction = await repo.deductPoints(
      user.id,
      reward.pointsCost,
      `Redeemed reward: ${reward.name}`
    );

    if (!deduction.success) {
      return NextResponse.json(
        { error: deduction.error || "Insufficient points to redeem reward" },
        { status: 400 }
      );
    }

    // Record redemption
    const record = await repo.redeemReward(user.id, reward.id);

    return NextResponse.json({
      success: true,
      message: "Reward redeemed successfully!",
      remainingPoints: deduction.remainingPoints,
      redemption: {
        id: record._id,
        userId: record.user_id,
        rewardId: record.reward_id,
        redeemedAt: new Date(record.redeemed_at).toISOString(),
        status: record.status,
      },
    }, { status: 200 });
  } catch (error: any) {
    console.error("POST /api/rankings/rewards/redeem error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

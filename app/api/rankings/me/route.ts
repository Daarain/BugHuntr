import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";
import { RankTier } from "@/types/ranking";

export async function GET(request: NextRequest) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    const balance = await repo.getPointsBalance(user.id);
    const points = balance?.points || 0;
    const rank = (balance?.reputation_rank || repo.deriveRank(points)) as RankTier;
    const progress = repo.calculateRankProgress(points);

    const ranking = {
      id: user.id,
      userId: user.id,
      username: balance?.username || user.username || user.id,
      points,
      totalPoints: points,
      rank,
      bugsFound: balance?.bugs_submitted || 0,
      bugsSubmitted: balance?.bugs_submitted || 0,
      totalEarnings: balance?.total_earnings || 0,
      joinDate: balance?.join_date ? new Date(balance.join_date).toISOString() : new Date().toISOString(),
      joinedAt: balance?.join_date ? new Date(balance.join_date).toISOString() : new Date().toISOString(),
      weeklyPoints: balance?.weekly_points || 0,
      monthlyPoints: balance?.monthly_points || 0,
      streak: balance?.streak || 0,
      lastActivity: balance?.last_activity ? new Date(balance.last_activity).toISOString() : new Date().toISOString(),
      rankProgress: progress.rankProgress,
      nextRankPoints: progress.nextRankPoints,
      reputation: balance?.reputation || 0,
      successRate: balance?.success_rate || 0,
      certifications: balance?.certifications || [],
    };

    return NextResponse.json({ ranking });
  } catch (error: any) {
    console.error("GET /api/rankings/me error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

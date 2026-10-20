import { NextRequest, NextResponse } from "next/server";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";
import { RANK_CONFIGS, RankTier } from "@/types/ranking";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeframeParam = searchParams.get("timeframe");
    const timeframe = timeframeParam === "weekly" || timeframeParam === "monthly" ? timeframeParam : "all";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "100", 10), 1), 250);
    const search = searchParams.get("search")?.toLowerCase().trim() || "";

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    const balances = await repo.getLeaderboard(timeframe, limit);

    let rankings = balances.map((b) => {
      const rank = (b.reputation_rank || repo.deriveRank(b.points)) as RankTier;
      const progress = repo.calculateRankProgress(b.points);

      return {
        id: b.user_id,
        userId: b.user_id,
        username: b.username || b.user_id,
        points: b.points,
        totalPoints: b.points,
        rank,
        bugsFound: b.bugs_submitted || 0,
        bugsSubmitted: b.bugs_submitted || 0,
        totalEarnings: b.total_earnings || 0,
        joinDate: b.join_date ? new Date(b.join_date).toISOString() : new Date(b.updated_at).toISOString(),
        joinedAt: b.join_date ? new Date(b.join_date).toISOString() : new Date(b.updated_at).toISOString(),
        weeklyPoints: b.weekly_points || 0,
        monthlyPoints: b.monthly_points || 0,
        streak: b.streak || 0,
        lastActivity: b.last_activity ? new Date(b.last_activity).toISOString() : new Date().toISOString(),
        rankProgress: progress.rankProgress,
        nextRankPoints: progress.nextRankPoints,
        reputation: b.reputation || 0,
        successRate: b.success_rate || 0,
        certifications: b.certifications || [],
      };
    });

    if (search) {
      rankings = rankings.filter(
        (r) => r.username.toLowerCase().includes(search) || r.userId.toLowerCase().includes(search)
      );
    }

    return NextResponse.json({
      leaderboard: rankings,
      rankings,
      total: rankings.length,
    });
  } catch (error: any) {
    console.error("GET /api/rankings/leaderboard error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

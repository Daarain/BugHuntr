import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";
import { SEVERITY_POINTS, getStreakMultiplier } from "@/types/ranking";

export async function POST(request: NextRequest) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const targetUserId = body.userId || user.id;

    // Cross-user authorization check
    if (targetUserId !== user.id && user.role !== "admin" && user.role !== "triager") {
      return NextResponse.json(
        { error: "Forbidden: You are not authorized to award points to other users" },
        { status: 403 }
      );
    }

    const severity = body.severity as keyof typeof SEVERITY_POINTS | undefined;
    const bugId = body.bugId ? (typeof body.bugId === "number" ? body.bugId : parseInt(body.bugId, 10)) : undefined;
    const reason = (body.reason || "Points awarded").trim();

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    const currentBalance = await repo.getPointsBalance(targetUserId);
    const streak = currentBalance?.streak || 0;
    const multiplier = getStreakMultiplier(streak);

    let basePoints = typeof body.points === "number" ? body.points : 0;
    if (severity && SEVERITY_POINTS[severity]) {
      basePoints = SEVERITY_POINTS[severity];
    }

    if (basePoints <= 0) {
      return NextResponse.json({ error: "Points must be greater than zero" }, { status: 400 });
    }

    const pointsToAward = Math.floor(basePoints * multiplier);

    const updated = await repo.addPoints(targetUserId, pointsToAward, {
      username: body.username || (targetUserId === user.id ? user.username : undefined),
      bugIncrement: bugId ? 1 : 0,
      reason,
      bugId,
      severity,
      multiplier: multiplier > 1 ? multiplier : undefined,
    });

    const progress = repo.calculateRankProgress(updated.points);

    return NextResponse.json({
      success: true,
      pointsAwarded: pointsToAward,
      newTotalPoints: updated.points,
      rank: updated.reputation_rank,
      rankProgress: progress.rankProgress,
      nextRankPoints: progress.nextRankPoints,
    }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/rankings/points error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

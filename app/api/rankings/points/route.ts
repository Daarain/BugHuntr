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
    const isStaff = user.role === "admin" || user.role === "triager";

    // 1. Cross-user authorization check: ordinary users can never award points to others
    if (targetUserId !== user.id && !isStaff) {
      return NextResponse.json(
        { error: "Forbidden: You are not authorized to award points to other users" },
        { status: 403 }
      );
    }

    const severity = body.severity as keyof typeof SEVERITY_POINTS | undefined;
    const bugId = body.bugId ? (typeof body.bugId === "number" ? body.bugId : parseInt(body.bugId, 10)) : undefined;
    const reason = (body.reason || "Points awarded").trim();

    // 2. Prevent arbitrary points inflation:
    // Non-staff users CANNOT provide arbitrary `body.points`. Points must come strictly from verified severity.
    if (!isStaff && typeof body.points === "number" && !severity) {
      return NextResponse.json(
        { error: "Forbidden: Only administrators and triagers can award manual arbitrary points" },
        { status: 403 }
      );
    }

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    // 3. Idempotency enforcement: prevent duplicate points awards for the same bug ID
    if (bugId) {
      const existingTx = await db.collection("points_transactions").findOne({
        user_id: targetUserId,
        bug_id: bugId,
      });
      if (existingTx) {
        return NextResponse.json(
          { error: `Points have already been awarded for bug ID ${bugId}` },
          { status: 409 }
        );
      }
    }

    const currentBalance = await repo.getPointsBalance(targetUserId);
    const streak = currentBalance?.streak || 0;
    const multiplier = getStreakMultiplier(streak);

    let basePoints = 0;
    if (severity && SEVERITY_POINTS[severity]) {
      basePoints = SEVERITY_POINTS[severity];
    } else if (isStaff && typeof body.points === "number") {
      basePoints = body.points;
    }

    if (basePoints <= 0 || basePoints > 100000) {
      return NextResponse.json({ error: "Invalid points amount: must be positive and not exceed 100,000" }, { status: 400 });
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

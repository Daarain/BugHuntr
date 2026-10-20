import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { updateUserStats } from "@/lib/update-user-stats";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import { getUserProfileByUsername } from "@/lib/db/users";

/**
 * User Gamification Stats API
 *
 * GET: Retrieves aggregated gamification stats (points, submitted bugs, accepted bugs, rank, streak)
 * for a specified username or the authenticated session user.
 *
 * POST: Increments submitted bug counters and adds earned points in MongoDB.
 * Enforces session authentication: users can only record activity under their own account.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const usernameParam = searchParams.get("username")?.trim();
    const userIdParam = searchParams.get("userId")?.trim();

    let targetUsername = usernameParam || null;
    let targetUserId = userIdParam || null;

    if (!targetUsername && !targetUserId) {
      const session = getSessionFromRequest(request);
      if (session.authenticated && session.user) {
        targetUsername = session.user.username;
        targetUserId = session.user.id;
      }
    }

    if (!targetUsername && !targetUserId) {
      return NextResponse.json(
        { error: "Missing username parameter or active session" },
        { status: 400 }
      );
    }

    // If username is provided but not userId, try to resolve userId from PostgreSQL
    if (targetUsername && !targetUserId) {
      try {
        const pgProfile = await getUserProfileByUsername(targetUsername);
        if (pgProfile) {
          targetUserId = pgProfile.user_id;
        }
      } catch {
        // Continue with targetUsername
      }
    }

    const db = await getMongoDatabase();
    const gamificationRepo = new GamificationRepository(db);
    const submissionsRepo = new SubmissionsRepository(db);

    // Retrieve gamification balance
    let balance = null;
    if (targetUserId) {
      balance = await gamificationRepo.getPointsBalance(targetUserId);
    }
    if (!balance && targetUsername) {
      balance = await gamificationRepo.getPointsBalanceByUsername(targetUsername);
    }

    const points = balance?.points || 0;
    const bugsSubmitted = balance?.bugs_submitted || 0;
    const rankInfo = gamificationRepo.calculateRankProgress(points);

    // Retrieve accepted bugs count from submissions repository
    let acceptedBugs = 0;
    try {
      if (targetUserId) {
        acceptedBugs = await submissionsRepo.countByHunter(targetUserId, "approved");
      }
      if (acceptedBugs === 0 && targetUsername) {
        acceptedBugs = await submissionsRepo.countByHunter(targetUsername, "approved");
      }
    } catch (countErr) {
      console.warn("Could not retrieve accepted bugs count:", countErr);
    }

    return NextResponse.json({
      points,
      bugsSubmitted,
      acceptedBugs,
      rank: rankInfo.rank,
      rankProgress: rankInfo.rankProgress,
      nextRankPoints: rankInfo.nextRankPoints,
      monthlyPoints: balance?.monthly_points || 0,
      streak: balance?.streak || 0,
      username: targetUsername || balance?.username || "unknown",
      userId: targetUserId || balance?.user_id || "",
    });
  } catch (error: any) {
    console.error("User stats GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve user stats." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized: Active session required." },
        { status: 401 }
      );
    }

    // Role check: Only administrators or triagers may manually modify user stats.
    // Ordinary users cannot modify their own or other users' authoritative points or bug counters.
    const isStaff = session.user.role === "admin" || session.user.role === "triager";
    if (!isStaff) {
      return NextResponse.json(
        { error: "Forbidden: User statistics and points are authoritative and can only be updated by administrators and triagers." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { points, bugIncrement, username: targetUsername } = body;

    const safePoints = typeof points === "number" && points > 0 ? points : 0;
    const safeBugIncrement = typeof bugIncrement === "number" ? bugIncrement : 1;
    const effectiveUsername = (targetUsername && typeof targetUsername === "string") ? targetUsername.trim() : session.user.username;

    const success = await updateUserStats(
      effectiveUsername,
      safePoints,
      safeBugIncrement,
      session.user.role
    );

    return NextResponse.json({ success });
  } catch (error: any) {
    console.error("User stats POST error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update user stats." },
      { status: 500 }
    );
  }
}

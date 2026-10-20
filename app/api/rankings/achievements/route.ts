import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";
import { ACHIEVEMENTS } from "@/types/ranking";

export async function GET(request: NextRequest) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    const userAchievements = await repo.listUserAchievements(user.id);

    return NextResponse.json({
      achievements: userAchievements.map((ua) => ({
        id: ua._id,
        userId: ua.user_id,
        achievementId: ua.badge_id,
        unlockedAt: new Date(ua.unlocked_at).toISOString(),
        progress: ua.progress,
      })),
    });
  } catch (error: any) {
    console.error("GET /api/rankings/achievements error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const severity = body.severity; // e.g. "critical" trigger for critical_finder

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    const balance = await repo.getPointsBalance(user.id);
    if (!balance) {
      return NextResponse.json({ newlyUnlocked: [] });
    }

    const userAchievements = await repo.listUserAchievements(user.id);
    const unlockedBadgeIds = new Set(userAchievements.map((ua) => ua.badge_id));
    const newlyUnlocked: any[] = [];

    for (const achievement of ACHIEVEMENTS) {
      if (unlockedBadgeIds.has(achievement.id)) continue;

      let qualified = false;
      switch (achievement.requirement.type) {
        case "points":
          qualified = balance.points >= Number(achievement.requirement.value);
          break;
        case "bugs":
          qualified = balance.bugs_submitted >= Number(achievement.requirement.value);
          break;
        case "streak":
          qualified = balance.streak >= Number(achievement.requirement.value);
          break;
        case "rank":
          qualified = balance.reputation_rank === achievement.requirement.value;
          break;
        case "special":
          if (achievement.requirement.value === "critical_bug") {
            // Require verified critical bug outcome in database (points transaction or submission)
            // rather than trusting unverified client parameter
            const pointsTxCol = db.collection("points_transactions");
            const hasCriticalTx = await pointsTxCol.findOne({
              user_id: user.id,
              severity: "critical",
            });

            if (hasCriticalTx) {
              qualified = true;
            } else {
              const submissionsCol = db.collection("submissions");
              const hasCriticalSub = await submissionsCol.findOne({
                hunter_id: user.id,
                severity: "critical",
              });
              if (hasCriticalSub) {
                qualified = true;
              }
            }
          }
          break;
      }

      if (qualified) {
        const { unlocked, achievement: doc } = await repo.unlockAchievement(
          user.id,
          achievement.id,
          achievement.name,
          achievement.description
        );

        if (unlocked) {
          // Award bonus points atomically
          if (achievement.pointsReward > 0) {
            await repo.addPoints(user.id, achievement.pointsReward, {
              reason: `Achievement unlocked: ${achievement.name}`,
              severity: "medium",
            });
          }

          newlyUnlocked.push({
            id: doc._id,
            userId: user.id,
            achievementId: achievement.id,
            name: achievement.name,
            pointsReward: achievement.pointsReward,
            unlockedAt: new Date(doc.unlocked_at).toISOString(),
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      newlyUnlocked,
    });
  } catch (error: any) {
    console.error("POST /api/rankings/achievements error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

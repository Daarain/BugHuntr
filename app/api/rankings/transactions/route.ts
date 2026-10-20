import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";

export async function GET(request: NextRequest) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10), 1), 100);

    const db = await getMongoDatabase();
    const repo = new GamificationRepository(db);

    const txs = await repo.listTransactions(user.id, limit);

    return NextResponse.json({
      transactions: txs.map((t) => ({
        id: t._id,
        userId: t.user_id,
        bugId: typeof t.bug_id === "number" ? t.bug_id : t.bug_id ? parseInt(String(t.bug_id), 10) || 0 : 0,
        points: t.points,
        reason: t.reason,
        timestamp: new Date(t.timestamp).toISOString(),
        severity: t.severity || "medium",
        multiplier: t.multiplier,
      })),
    });
  } catch (error: any) {
    console.error("GET /api/rankings/transactions error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

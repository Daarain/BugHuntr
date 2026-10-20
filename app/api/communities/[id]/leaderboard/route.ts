import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { CommunitiesRepository } from "@/lib/db/repositories/communities.repo";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Community ID is required" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10), 1), 100);

    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    const community = await commRepo.getById(id);
    if (!community) {
      return NextResponse.json({ error: "Community not found" }, { status: 404 });
    }

    const { authenticated, user } = getSessionFromRequest(request);
    let isMember = false;
    if (authenticated && user) {
      isMember = await commRepo.isMember(id, user.id);
    }

    if (community.is_private && !isMember && user?.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: This is a private community. Membership is required." },
        { status: 403 }
      );
    }

    const members = await commRepo.listLeaderboard(id, limit);

    return NextResponse.json({
      leaderboard: members.map((m) => ({
        userId: m.user_id,
        username: m.username,
        role: m.role,
        avatar: m.avatar,
        reputation: m.reputation || 0,
        solvedCount: m.solved_count || 0,
        helpfulCount: m.helpful_count || 0,
        bugsPosted: m.bugs_posted || 0,
        skills: m.skills || [],
      })),
    });
  } catch (error: any) {
    console.error("GET /api/communities/[id]/leaderboard error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * /api/communities/[id]/leave
 *
 * Authenticated endpoint for leaving a community.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { CommunitiesRepository } from "@/lib/db/repositories/communities.repo";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    await commRepo.removeMember(id, user.id);

    return NextResponse.json({ success: true, communityId: id });
  } catch (error: any) {
    console.error("POST /api/communities/[id]/leave error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

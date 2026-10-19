/**
 * /api/communities/[id]/join
 *
 * Authenticated endpoint for joining a community.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
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

    const community = await commRepo.getById(id);
    if (!community) {
      return NextResponse.json({ error: "Community not found" }, { status: 404 });
    }

    // Server-enforced gating for private communities
    if (community.is_private) {
      const isAdmin = user.role === "admin";
      const isCreator = community.creator_id === user.id;

      let hasValidInvite = false;
      const body = await request.json().catch(() => ({}));
      const { searchParams } = new URL(request.url);
      const inviteCode = body?.inviteCode || body?.code || searchParams.get("inviteCode") || searchParams.get("code");

      const communityInviteCode = (community as any).invite_code;
      if (inviteCode && typeof inviteCode === "string" && communityInviteCode && typeof communityInviteCode === "string") {
        const received = inviteCode.trim();
        const expected = communityInviteCode.trim();
        if (received.length > 0 && received.length === expected.length) {
          try {
            hasValidInvite = crypto.timingSafeEqual(
              Buffer.from(received, "utf8"),
              Buffer.from(expected, "utf8")
            );
          } catch {
            hasValidInvite = false;
          }
        }
      }

      if (!isAdmin && !isCreator && !hasValidInvite) {
        return NextResponse.json(
          { error: "Forbidden: Cannot join a private community without an invitation or invite code." },
          { status: 403 }
        );
      }
    }

    await commRepo.addMember(
      {
        _id: `${id}:${user.id}`,
        community_id: id,
        user_id: user.id,
        role: "member",
        joined_at: new Date(),
      },
      {
        username: user.username || user.email,
        permissions: ["comment", "create_thread"],
      }
    );

    return NextResponse.json({ success: true, communityId: id });
  } catch (error: any) {
    console.error("POST /api/communities/[id]/join error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

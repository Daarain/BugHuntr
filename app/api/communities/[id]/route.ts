/**
 * /api/communities/[id]
 *
 * Authenticated endpoints for:
 * - GET: Fetch community details and channels
 * - PATCH: Update community metadata
 * - DELETE: Delete community
 */

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

    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    const community = await commRepo.getById(id);
    if (!community) {
      return NextResponse.json({ error: "Community not found" }, { status: 404 });
    }

    const { authenticated, user } = getSessionFromRequest(request);
    let isMember = false;
    let userRole = null;

    if (authenticated && user) {
      isMember = await commRepo.isMember(id, user.id);
      if (isMember) {
        const member = await commRepo.getMember(id, user.id);
        userRole = member?.role || null;
      }
    }

    // Access control: private community requires membership
    if (community.is_private && !isMember && user?.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: This is a private community. Membership is required." },
        { status: 403 }
      );
    }

    const channels = await commRepo.listChannels(id);
    const members = await commRepo.listMembers(id);

    return NextResponse.json({
      community: {
        id: community._id,
        name: community.name,
        description: community.description,
        avatar: community.avatar,
        banner: community.banner,
        isPrivate: community.is_private,
        memberCount: community.member_count,
        ownerId: community.creator_id,
        tags: community.tags || [],
        createdAt: new Date(community.created_at).toISOString(),
        channels: channels.map((c) => ({
          id: c.channel_id,
          name: c.name,
          type: c.type,
          description: c.description,
          isPrivate: c.is_private,
          memberIds: c.member_ids || [],
          createdAt: new Date(c.created_at).toISOString(),
        })),
        members: members.map((m) => ({
          id: m._id,
          userId: m.user_id,
          username: m.username,
          avatar: m.avatar,
          role: m.role,
          joinedAt: new Date(m.joined_at).toISOString(),
          isOnline: Boolean(m.is_online),
          permissions: m.permissions || [],
          reputation: m.reputation || 0,
          skills: m.skills || [],
        })),
        isMember,
        userRole,
      },
    });
  } catch (error: any) {
    console.error("GET /api/communities/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    // Authorization: owner or platform admin
    const isOwner = community.creator_id === user.id;
    const isPlatformAdmin = user.role === "admin";
    if (!isOwner && !isPlatformAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Only the community owner or platform admin can update this community" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const updates: any = {};
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.description === "string") updates.description = body.description.trim();
    if (typeof body.avatar === "string") updates.avatar = body.avatar;
    if (typeof body.banner === "string") updates.banner = body.banner;
    if (typeof body.isPrivate === "boolean") updates.is_private = body.isPrivate;
    if (Array.isArray(body.tags)) updates.tags = body.tags;

    await commRepo.updateCommunity(id, updates);
    const updated = await commRepo.getById(id);

    return NextResponse.json({ success: true, community: updated });
  } catch (error: any) {
    console.error("PATCH /api/communities/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const isOwner = community.creator_id === user.id;
    const isPlatformAdmin = user.role === "admin";
    if (!isOwner && !isPlatformAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Only the community owner or platform admin can delete this community" },
        { status: 403 }
      );
    }

    await commRepo.deleteCommunity(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/communities/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

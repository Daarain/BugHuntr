/**
 * /api/communities/[id]/channels
 *
 * Authenticated endpoints for:
 * - GET: List channels in community
 * - POST: Create a new channel
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
    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    const community = await commRepo.getById(id);
    if (!community) {
      return NextResponse.json({ error: "Community not found" }, { status: 404 });
    }

    const { authenticated, user } = getSessionFromRequest(request);

    if (community.is_private) {
      if (!authenticated || !user) {
        return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
      }

      const isMember = await commRepo.isMember(id, user.id);
      const isAdmin = user.role === "admin";
      const isOwner = community.creator_id === user.id;

      if (!isMember && !isAdmin && !isOwner) {
        return NextResponse.json(
          { error: "Forbidden: You are not a member of this private community" },
          { status: 403 }
        );
      }
    }

    const channels = await commRepo.listChannels(id);
    const visibleChannels = channels.filter((c) => {
      if (!c.is_private) return true;
      if (!authenticated || !user) return false;
      return user.role === "admin" || community.creator_id === user.id || (c.member_ids && c.member_ids.includes(user.id));
    });

    return NextResponse.json({
      channels: visibleChannels.map((c) => ({
        id: c.channel_id,
        name: c.name,
        type: c.type,
        description: c.description,
        isPrivate: c.is_private,
        memberIds: c.member_ids || [],
        createdAt: c.created_at ? new Date(c.created_at).toISOString() : new Date().toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("GET /api/communities/[id]/channels error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

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

    const isMember = await commRepo.isMember(id, user.id);
    if (!isMember && user.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: You must be a member of this community to create channels" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { name, description = "", type = "text", isPrivate = false } = body;

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return NextResponse.json(
        { error: "Channel name is required and must be at least 2 characters" },
        { status: 400 }
      );
    }

    const channelId = name.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-");
    const channel = await commRepo.createChannel(id, {
      channel_id: channelId,
      name: name.trim(),
      description: description.trim(),
      type,
      is_private: Boolean(isPrivate),
      member_ids: [],
    });

    return NextResponse.json({
      success: true,
      channel: {
        id: channel.channel_id,
        name: channel.name,
        type: channel.type,
        description: channel.description,
        isPrivate: channel.is_private,
        memberIds: channel.member_ids || [],
        createdAt: new Date(channel.created_at).toISOString(),
      },
    });
  } catch (error: any) {
    console.error("POST /api/communities/[id]/channels error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

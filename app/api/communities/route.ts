/**
 * /api/communities
 *
 * Authenticated endpoints for:
 * - GET: List public, searched, or joined communities
 * - POST: Create a new security research community
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { CommunitiesRepository } from "@/lib/db/repositories/communities.repo";

function sanitizeCommunity(doc: any) {
  if (!doc) return doc;
  const { invite_code, ...rest } = doc;
  return rest;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const joined = searchParams.get("joined") === "true";
    const search = searchParams.get("search") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    if (joined) {
      const { authenticated, user } = getSessionFromRequest(request);
      if (!authenticated || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const joinedList = await commRepo.listJoined(user.id);
      return NextResponse.json({ communities: joinedList.map(sanitizeCommunity) });
    }

    if (search) {
      const results = await commRepo.listCommunities({ search, limit });
      const { authenticated, user } = getSessionFromRequest(request);

      if (authenticated && user && user.role === "admin") {
        return NextResponse.json({ communities: results.map(sanitizeCommunity) });
      }

      let joinedIds = new Set<string>();
      if (authenticated && user) {
        const joinedList = await commRepo.listJoined(user.id);
        joinedIds = new Set(joinedList.map((c) => c._id));
      }

      // Filter out private communities unless caller is a joined member
      const filtered = results.filter((c) => !c.is_private || joinedIds.has(c._id));
      return NextResponse.json({ communities: filtered.map(sanitizeCommunity) });
    }

    const publicCommunities = await commRepo.listPublic(limit);
    return NextResponse.json({ communities: publicCommunities.map(sanitizeCommunity) });
  } catch (error: any) {
    console.error("GET /api/communities error:", error);
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
    const { name, description = "", isPrivate = false, tags = [], avatar = "", banner = "" } = body;

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return NextResponse.json(
        { error: "Community name is required and must be at least 2 characters" },
        { status: 400 }
      );
    }

    const communityId = name.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-") + "-" + Date.now();
    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    const isPrivateBool = Boolean(isPrivate);
    const inviteCode = isPrivateBool
      ? (typeof body.inviteCode === "string" && body.inviteCode.trim()
          ? body.inviteCode.trim()
          : crypto.randomBytes(16).toString("hex"))
      : undefined;

    const newCommunity = await commRepo.createCommunity({
      _id: communityId,
      name: name.trim(),
      description: description.trim(),
      creator_id: user.id,
      avatar,
      banner,
      is_private: isPrivateBool,
      ...(inviteCode ? { invite_code: inviteCode } : {}),
      tags: Array.isArray(tags) ? tags : [],
      member_count: 1,
      created_at: new Date(),
      updated_at: new Date(),
    } as any);

    const channels = await commRepo.listChannels(communityId);

    return NextResponse.json({
      success: true,
      community: {
        id: newCommunity._id,
        name: newCommunity.name,
        description: newCommunity.description,
        isPrivate: newCommunity.is_private,
        inviteCode: (newCommunity as any).invite_code,
        memberCount: newCommunity.member_count,
        ownerId: newCommunity.creator_id,
        tags: newCommunity.tags,
        avatar: newCommunity.avatar,
        banner: newCommunity.banner,
        channels: channels.map((c) => ({
          id: c.channel_id,
          name: c.name,
          type: c.type,
          description: c.description,
          isPrivate: c.is_private,
          memberIds: c.member_ids || [],
          createdAt: c.created_at ? new Date(c.created_at).toISOString() : new Date().toISOString(),
        })),
        createdAt: new Date(newCommunity.created_at).toISOString(),
      },
    }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/communities error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

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
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10), 1), 200);

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

    const messages = await commRepo.listMessages(id, undefined, { limit });

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m._id,
        communityId: m.community_id,
        channelId: m.channel_id,
        senderId: m.user_id,
        userId: m.user_id,
        username: m.username,
        text: m.content,
        content: m.content,
        createdAt: new Date(m.created_at).toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("GET /api/communities/[id]/messages error:", error);
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
    if (!id) {
      return NextResponse.json({ error: "Community ID is required" }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    const community = await commRepo.getById(id);
    if (!community) {
      return NextResponse.json({ error: "Community not found" }, { status: 404 });
    }

    const isMember = await commRepo.isMember(id, user.id);
    if (!isMember && user.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: You must be a member of this community to send messages" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const content = (body.text || body.content || "").trim();

    if (!content) {
      return NextResponse.json({ error: "Message content cannot be empty" }, { status: 400 });
    }

    const messageDoc = await commRepo.sendMessage({
      _id: `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      community_id: id,
      user_id: user.id,
      username: user.username,
      content,
      created_at: new Date(),
    });

    return NextResponse.json({
      message: {
        id: messageDoc._id,
        communityId: messageDoc.community_id,
        senderId: messageDoc.user_id,
        userId: messageDoc.user_id,
        username: messageDoc.username,
        text: messageDoc.content,
        content: messageDoc.content,
        createdAt: new Date(messageDoc.created_at).toISOString(),
      },
    }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/communities/[id]/messages error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

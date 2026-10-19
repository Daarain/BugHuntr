import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { CommunitiesRepository } from "@/lib/db/repositories/communities.repo";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  try {
    const { id, threadId } = await params;
    if (!id || !threadId) {
      return NextResponse.json({ error: "Community ID and Thread ID are required" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "250", 10), 1), 500);

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

    const messages = await commRepo.listThreadChat(threadId, limit);

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m._id,
        threadId: m.thread_id,
        communityId: m.community_id,
        content: m.content,
        authorId: m.author_id,
        authorUsername: m.author_username,
        createdAt: new Date(m.created_at).toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("GET /api/communities/[id]/threads/[threadId]/chat error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, threadId } = await params;
    if (!id || !threadId) {
      return NextResponse.json({ error: "Community ID and Thread ID are required" }, { status: 400 });
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
        { error: "Forbidden: You must be a member of this community to chat" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const content = (body.content || "").trim();
    if (!content) {
      return NextResponse.json({ error: "Message content cannot be empty" }, { status: 400 });
    }

    const messageDoc = await commRepo.sendThreadChatMessage({
      _id: `tchat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      thread_id: threadId,
      community_id: id,
      content,
      author_id: user.id,
      author_username: user.username,
      created_at: new Date(),
    });

    return NextResponse.json({
      message: {
        id: messageDoc._id,
        threadId: messageDoc.thread_id,
        communityId: messageDoc.community_id,
        content: messageDoc.content,
        authorId: messageDoc.author_id,
        authorUsername: messageDoc.author_username,
        createdAt: new Date(messageDoc.created_at).toISOString(),
      },
    }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/communities/[id]/threads/[threadId]/chat error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

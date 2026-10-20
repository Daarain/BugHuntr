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

    const thread = await commRepo.getThread(threadId);
    if (!thread || thread.community_id !== id) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    return NextResponse.json({
      thread: {
        id: thread._id,
        communityId: thread.community_id,
        channelId: thread.channel_id,
        title: thread.title,
        description: thread.description,
        severity: thread.severity,
        status: thread.status,
        tags: thread.tags || [],
        authorId: thread.author_id,
        authorUsername: thread.author_username,
        solutionCommentId: thread.solution_comment_id || null,
        solutionByUserId: thread.solution_by_user_id || null,
        commentCount: thread.comment_count || 0,
        attachmentUrls: thread.attachment_urls || [],
        createdAt: new Date(thread.created_at).toISOString(),
        updatedAt: new Date(thread.updated_at).toISOString(),
      },
    });
  } catch (error: any) {
    console.error("GET /api/communities/[id]/threads/[threadId] error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    const thread = await commRepo.getThread(threadId);
    if (!thread || thread.community_id !== id) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const member = await commRepo.getMember(id, user.id);
    const isOwnerOrAdmin = member?.role === "owner" || member?.role === "admin" || user.role === "admin";
    const isAuthor = thread.author_id === user.id;

    if (!isAuthor && !isOwnerOrAdmin) {
      return NextResponse.json(
        { error: "Forbidden: You are not authorized to edit this thread" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const updates: any = {};

    if (body.status !== undefined) {
      const allowedStatuses = ["open", "in-progress", "solved", "closed"];
      if (!allowedStatuses.includes(body.status)) {
        return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
      }
      updates.status = body.status;
    }

    if (Array.isArray(body.attachmentUrls)) {
      updates.attachment_urls = body.attachmentUrls;
    }

    if (body.title && isAuthor) {
      updates.title = body.title.trim();
    }
    if (body.description && isAuthor) {
      updates.description = body.description.trim();
    }

    const success = await commRepo.updateThread(threadId, updates);
    if (!success) {
      return NextResponse.json({ error: "Failed to update thread" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PATCH /api/communities/[id]/threads/[threadId] error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const thread = await commRepo.getThread(threadId);
    if (!thread || thread.community_id !== id) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const member = await commRepo.getMember(id, user.id);
    const isOwnerOrAdmin = member?.role === "owner" || member?.role === "admin" || user.role === "admin";
    const isAuthor = thread.author_id === user.id;

    if (!isAuthor && !isOwnerOrAdmin) {
      return NextResponse.json(
        { error: "Forbidden: You are not authorized to delete this thread" },
        { status: 403 }
      );
    }

    const success = await commRepo.deleteThread(threadId);
    if (!success) {
      return NextResponse.json({ error: "Failed to delete thread" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Thread deleted successfully" });
  } catch (error: any) {
    console.error("DELETE /api/communities/[id]/threads/[threadId] error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

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

    const comments = await commRepo.listComments(threadId);

    return NextResponse.json({
      comments: comments.map((c) => ({
        id: c._id,
        threadId: c.thread_id,
        communityId: c.community_id,
        content: c.content,
        authorId: c.author_id,
        authorUsername: c.author_username,
        parentId: c.parent_id || null,
        mentions: c.mentions || [],
        isSolution: Boolean(c.is_solution),
        attachmentUrls: c.attachment_urls || [],
        createdAt: new Date(c.created_at).toISOString(),
        updatedAt: new Date(c.updated_at).toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("GET /api/communities/[id]/threads/[threadId]/comments error:", error);
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
        { error: "Forbidden: You must be a member of this community to comment" },
        { status: 403 }
      );
    }

    const thread = await commRepo.getThread(threadId);
    if (!thread || thread.community_id !== id) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const body = await request.json();
    const content = (body.content || "").trim();
    if (!content) {
      return NextResponse.json({ error: "Comment content cannot be empty" }, { status: 400 });
    }

    const parentId = body.parentId || null;
    const attachmentUrls = Array.isArray(body.attachmentUrls) ? body.attachmentUrls : [];

    // Parse mentions: @username
    const matches = content.match(/@([a-zA-Z0-9_-]+)/g);
    const mentions: string[] = matches ? Array.from(new Set(matches.map((m: string) => m.slice(1).toLowerCase()))) : [];

    const commentId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const commentDoc = await commRepo.addComment({
      _id: commentId,
      thread_id: threadId,
      community_id: id,
      content,
      author_id: user.id,
      author_username: user.username,
      parent_id: parentId,
      mentions,
      is_solution: false,
      attachment_urls: attachmentUrls,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Award reputation for helpful reply
    await commRepo.awardReputation(
      id,
      user.id,
      user.username,
      2,
      "Helpful thread reply",
      threadId,
      { helpfulCount: 1 }
    );

    // Notify thread author if someone else replied
    if (thread.author_id !== user.id) {
      await commRepo.createNotification({
        _id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        user_id: thread.author_id,
        community_id: id,
        type: "reply",
        title: "New reply on your thread",
        message: `${user.username} replied to ${thread.title}`,
        thread_id: threadId,
        comment_id: commentId,
        read: false,
        created_at: new Date(),
      });
    }

    // Notify mentioned users
    if (mentions.length > 0) {
      const members = await commRepo.listMembers(id, 100);
      for (const m of members) {
        if (m.user_id === user.id) continue;
        if (mentions.includes(m.username.toLowerCase())) {
          await commRepo.createNotification({
            _id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            user_id: m.user_id,
            community_id: id,
            type: "mention",
            title: "You were tagged",
            message: `${user.username} mentioned you in ${thread.title}`,
            thread_id: threadId,
            comment_id: commentId,
            read: false,
            created_at: new Date(),
          });
        }
      }
    }

    return NextResponse.json({
      comment: {
        id: commentDoc._id,
        threadId: commentDoc.thread_id,
        communityId: commentDoc.community_id,
        content: commentDoc.content,
        authorId: commentDoc.author_id,
        authorUsername: commentDoc.author_username,
        parentId: commentDoc.parent_id || null,
        mentions: commentDoc.mentions,
        isSolution: false,
        attachmentUrls: commentDoc.attachment_urls,
        createdAt: new Date(commentDoc.created_at).toISOString(),
        updatedAt: new Date(commentDoc.updated_at).toISOString(),
      },
    }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/communities/[id]/threads/[threadId]/comments error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

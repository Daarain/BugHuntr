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
    const channelId = searchParams.get("channelId") || undefined;
    const severity = searchParams.get("severity") || undefined;
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const tagsParam = searchParams.get("tags");
    const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "100", 10), 1), 300);

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

    const threads = await commRepo.listThreads(id, channelId, {
      severity,
      status,
      search,
      tags,
      limit,
    });

    return NextResponse.json({
      threads: threads.map((t) => ({
        id: t._id,
        communityId: t.community_id,
        channelId: t.channel_id,
        title: t.title,
        description: t.description,
        severity: t.severity,
        status: t.status,
        tags: t.tags || [],
        authorId: t.author_id,
        authorUsername: t.author_username,
        solutionCommentId: t.solution_comment_id || null,
        solutionByUserId: t.solution_by_user_id || null,
        commentCount: t.comment_count || 0,
        attachmentUrls: t.attachment_urls || [],
        createdAt: new Date(t.created_at).toISOString(),
        updatedAt: new Date(t.updated_at).toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("GET /api/communities/[id]/threads error:", error);
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
        { error: "Forbidden: You must be a member of this community to create threads" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const title = (body.title || "").trim();
    const description = (body.description || "").trim();
    const channelId = (body.channelId || "general").trim();
    const severity = body.severity || "low";
    const tags = Array.isArray(body.tags) ? body.tags.map((t: string) => String(t).trim()).filter(Boolean) : [];
    const attachmentUrls = Array.isArray(body.attachmentUrls) ? body.attachmentUrls : [];

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    const threadId = `th_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const threadDoc = await commRepo.createThread({
      _id: threadId,
      community_id: id,
      channel_id: channelId,
      title,
      description,
      severity,
      status: "open",
      tags,
      author_id: user.id,
      author_username: user.username,
      comment_count: 0,
      attachment_urls: attachmentUrls,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Award reputation for posting bug thread
    await commRepo.awardReputation(
      id,
      user.id,
      user.username,
      5,
      "Posted bug thread",
      threadId,
      { bugsPosted: 1 }
    );

    // Notify matching experts if any tags present
    if (tags.length > 0) {
      const members = await commRepo.listMembers(id, 50);
      const normalizedTags = tags.map((t: string) => t.toLowerCase());
      for (const member of members) {
        if (member.user_id === user.id) continue;
        const matches = member.skills?.some((skill) => normalizedTags.includes(skill.toLowerCase()));
        if (matches) {
          await commRepo.createNotification({
            _id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            user_id: member.user_id,
            community_id: id,
            type: "mention",
            title: "Expert requested",
            message: `${user.username} opened a thread matching your skills: ${title}`,
            thread_id: threadId,
            read: false,
            created_at: new Date(),
          });
        }
      }
    }

    return NextResponse.json({
      thread: {
        id: threadDoc._id,
        communityId: threadDoc.community_id,
        channelId: threadDoc.channel_id,
        title: threadDoc.title,
        description: threadDoc.description,
        severity: threadDoc.severity,
        status: threadDoc.status,
        tags: threadDoc.tags,
        authorId: threadDoc.author_id,
        authorUsername: threadDoc.author_username,
        solutionCommentId: null,
        solutionByUserId: null,
        commentCount: 0,
        attachmentUrls: threadDoc.attachment_urls,
        createdAt: new Date(threadDoc.created_at).toISOString(),
        updatedAt: new Date(threadDoc.updated_at).toISOString(),
      },
    }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/communities/[id]/threads error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

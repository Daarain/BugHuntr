import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { CommunitiesRepository } from "@/lib/db/repositories/communities.repo";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string; commentId: string }> }
) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, threadId, commentId } = await params;
    if (!id || !threadId || !commentId) {
      return NextResponse.json({ error: "Community ID, Thread ID, and Comment ID are required" }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    const thread = await commRepo.getThread(threadId);
    if (!thread || thread.community_id !== id) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Only the thread author (or community owner / system admin) can accept a solution
    const member = await commRepo.getMember(id, user.id);
    const isOwnerOrAdmin = member?.role === "owner" || user.role === "admin";
    const isAuthor = thread.author_id === user.id;

    if (!isAuthor && !isOwnerOrAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Only the author of the thread can accept a solution" },
        { status: 403 }
      );
    }

    const comments = await commRepo.listComments(threadId);
    const comment = comments.find((c) => c._id === commentId);
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const marked = await commRepo.markCommentAsSolution(threadId, commentId, comment.author_id);
    if (!marked) {
      return NextResponse.json({ error: "Failed to mark comment as solution" }, { status: 500 });
    }

    // Award 25 reputation points to the solver
    await commRepo.awardReputation(
      id,
      comment.author_id,
      comment.author_username,
      25,
      "Solution accepted",
      threadId,
      { solvedCount: 1 }
    );

    // If author is different, award author 10 reputation points for resolving thread
    if (thread.author_id !== comment.author_id) {
      await commRepo.awardReputation(
        id,
        thread.author_id,
        thread.author_username,
        10,
        "Thread resolved",
        threadId
      );
    }

    // Notify solver
    await commRepo.createNotification({
      _id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      user_id: comment.author_id,
      community_id: id,
      type: "solution_accepted",
      title: "Solution accepted",
      message: `${thread.author_username} marked your reply as the solution in ${thread.title}`,
      thread_id: threadId,
      comment_id: commentId,
      read: false,
      created_at: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: "Solution accepted successfully",
    });
  } catch (error: any) {
    console.error("POST /api/communities/[id]/threads/[threadId]/comments/[commentId]/solution error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

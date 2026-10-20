import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { CommunitiesRepository } from "@/lib/db/repositories/communities.repo";

export async function DELETE(
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

    const comments = await commRepo.listComments(threadId);
    const comment = comments.find((c) => c._id === commentId);
    if (!comment || comment.community_id !== id) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const member = await commRepo.getMember(id, user.id);
    const isOwnerOrAdmin = member?.role === "owner" || member?.role === "admin" || user.role === "admin";
    const isAuthor = comment.author_id === user.id;

    if (!isAuthor && !isOwnerOrAdmin) {
      return NextResponse.json(
        { error: "Forbidden: You are not authorized to delete this comment" },
        { status: 403 }
      );
    }

    const success = await commRepo.deleteComment(commentId);
    if (!success) {
      return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Comment deleted successfully" });
  } catch (error: any) {
    console.error("DELETE /api/communities/[id]/threads/[threadId]/comments/[commentId] error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { CommunitiesRepository } from "@/lib/db/repositories/communities.repo";

export async function GET(request: NextRequest) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get("communityId") || undefined;
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "30", 10), 1), 100);

    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    const notifications = await commRepo.listNotifications(user.id, communityId, limit);

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        id: n._id,
        communityId: n.community_id,
        type: n.type,
        title: n.title,
        message: n.message,
        threadId: n.thread_id,
        commentId: n.comment_id || null,
        read: Boolean(n.read),
        createdAt: new Date(n.created_at).toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("GET /api/communities/notifications error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { authenticated, user } = getSessionFromRequest(request);
    if (!authenticated || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const notificationId = body.notificationId;
    if (!notificationId) {
      return NextResponse.json({ error: "Notification ID is required" }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const commRepo = new CommunitiesRepository(db);

    const success = await commRepo.markNotificationRead(notificationId, user.id);
    if (!success) {
      return NextResponse.json({ error: "Notification not found or access denied" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PATCH /api/communities/notifications error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

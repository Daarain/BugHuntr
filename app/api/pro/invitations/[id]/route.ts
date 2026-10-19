import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { ProRepository } from "@/lib/db/repositories/pro.repo";
import { mapDocToProInvitation } from "@/lib/pro-utils";

/**
 * GET /api/pro/invitations/[id]
 * Retrieves single invitation with authorization verification.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Invitation ID is required." }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const repo = new ProRepository(db);

    const doc = await repo.getInvitationById(id);
    if (!doc) {
      return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    }

    const isRecipient =
      doc.hunter_id === session.user.id ||
      (doc.hunter_username && doc.hunter_username.toLowerCase() === session.user.username?.toLowerCase()) ||
      (doc.recipient_email && doc.recipient_email.toLowerCase() === session.user.email?.toLowerCase());

    const isSender = doc.sender_id === session.user.id;
    const isAdmin = session.user.role === "admin";

    if (!isRecipient && !isSender && !isAdmin) {
      return NextResponse.json({ error: "Forbidden: You are not authorized to view this invitation." }, { status: 403 });
    }

    return NextResponse.json({ invitation: mapDocToProInvitation(doc) });
  } catch (error: any) {
    console.error("GET /api/pro/invitations/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/pro/invitations/[id]
 * Updates invitation status (accept, decline, or expire).
 *
 * Atomically increments `currentHunters` on the associated Pro Hunt when accepted.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Invitation ID is required." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.status) {
      return NextResponse.json({ error: "New status is required." }, { status: 400 });
    }

    const newStatus = body.status;
    const allowedStatuses = ["accepted", "declined", "expired"];
    if (!allowedStatuses.includes(newStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${allowedStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const db = await getMongoDatabase();
    const repo = new ProRepository(db);

    const existing = await repo.getInvitationById(id);
    if (!existing) {
      return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    }

    const isRecipient =
      existing.hunter_id === session.user.id ||
      (existing.hunter_username && existing.hunter_username.toLowerCase() === session.user.username?.toLowerCase()) ||
      (existing.recipient_email && existing.recipient_email.toLowerCase() === session.user.email?.toLowerCase());

    const isSender = existing.sender_id === session.user.id;
    const isAdmin = session.user.role === "admin";

    // Researchers can accept or decline their invitations
    // Senders/admins can cancel/expire invitations
    if (newStatus === "accepted" || newStatus === "declined") {
      if (!isRecipient && !isAdmin) {
        return NextResponse.json(
          { error: "Forbidden: Only the invited researcher can accept or decline this invitation." },
          { status: 403 }
        );
      }
    } else if (newStatus === "expired") {
      if (!isSender && !isAdmin) {
        return NextResponse.json(
          { error: "Forbidden: Only the issuing company or admin can expire this invitation." },
          { status: 403 }
        );
      }
    }

    // Expired invitation check
    const isExpired =
      existing.status === "expired" ||
      (existing.expires_at && new Date(existing.expires_at).getTime() < Date.now());

    if (isExpired && (newStatus === "accepted" || newStatus === "declined")) {
      if (existing.status !== "expired") {
        await repo.updateInvitationStatus(id, "expired");
      }
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
    }

    if (existing.status === "accepted" && newStatus === "accepted") {
      return NextResponse.json(
        { error: "Invitation has already been accepted.", invitation: mapDocToProInvitation(existing) },
        { status: 409 }
      );
    }

    if (existing.status === "declined" && (newStatus === "accepted" || newStatus === "declined")) {
      return NextResponse.json(
        { error: "Invitation has already been declined.", invitation: mapDocToProInvitation(existing) },
        { status: 409 }
      );
    }

    // Bind hunter_id to the authenticated user ID if it was matched by username or email
    const hunterIdToBind = isRecipient ? session.user.id : undefined;

    const updated = await repo.updateInvitationStatus(id, newStatus, hunterIdToBind);

    if (!updated && (newStatus === "accepted" || newStatus === "declined")) {
      const current = await repo.getInvitationById(id);
      return NextResponse.json(
        {
          error: `Invitation cannot transition to ${newStatus} (current status: ${current?.status || "unknown"}).`,
          invitation: current ? mapDocToProInvitation(current) : null,
        },
        { status: 409 }
      );
    }

    // Only increment hunt currentHunters if THIS exact request performed the transition
    if (newStatus === "accepted" && updated && existing.status !== "accepted") {
      await repo.incrementHuntHunters(existing.hunt_id, 1);
    }

    const updatedDoc = await repo.getInvitationById(id);
    return NextResponse.json({
      success: true,
      invitation: updatedDoc ? mapDocToProInvitation(updatedDoc) : null,
    });
  } catch (error: any) {
    console.error("PATCH /api/pro/invitations/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

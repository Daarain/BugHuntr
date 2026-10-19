import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { HuntsRepository } from "@/lib/db/repositories/hunts.repo";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import type { BugHuntDoc } from "@/lib/db/types";

function mapDocToBugHunt(doc: BugHuntDoc) {
  return {
    id: doc._id,
    title: doc.title,
    description: doc.description,
    company: doc.org_id,
    scope: doc.target_scope || [],
    categories: doc.categories || [],
    difficulty: doc.difficulty || "intermediate",
    status: doc.status,
    startDate: doc.startDate || doc.created_at?.toISOString() || "",
    endDate: doc.endDate || "",
    maxParticipants: doc.maxParticipants,
    currentParticipants: doc.currentParticipants || 0,
    createdBy: doc.createdBy,
    createdAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    updatedAt: doc.updated_at ? new Date(doc.updated_at).toISOString() : new Date().toISOString(),
    rewards: doc.rewards || { critical: 0, high: 0, medium: 0, low: 0 },
    rewardTypes: ["cash"],
    rewardDetails: {
      cash: `${doc.rewards?.critical || 0} max critical payout`,
      certificates: "Standard certificate",
      internship: "Opportunity considered",
      jobs: "Opportunity considered",
    },
    rules: doc.rules || [],
    assets: doc.assets || [],
    submissions: [],
  };
}

/**
 * GET /api/bug-hunts/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getMongoDatabase();
    const repo = new HuntsRepository(db);

    const hunt = await repo.getById(id);
    if (!hunt) {
      return NextResponse.json({ error: "Bug hunt not found" }, { status: 404 });
    }

    return NextResponse.json(mapDocToBugHunt(hunt));
  } catch (error: any) {
    console.error("Get bug hunt error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to retrieve bug hunt" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/bug-hunts/[id]
 * Updates bug hunt properties. Enforces admin or creator authorization.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getMongoDatabase();
    const repo = new HuntsRepository(db);

    const existing = await repo.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Bug hunt not found" }, { status: 404 });
    }

    // Authorization: only platform admin or the hunt's creator can update
    const isOwner = existing.createdBy === session.user.id;
    const isAdmin = session.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "Forbidden: You cannot modify this bug hunt" }, { status: 403 });
    }

    const updates = await request.json();
    const updateDoc: Partial<BugHuntDoc> = {};

    if (updates.title) updateDoc.title = updates.title;
    if (updates.description) updateDoc.description = updates.description;
    if (updates.status) updateDoc.status = updates.status;
    if (updates.scope) updateDoc.target_scope = updates.scope;
    if (updates.rewards) updateDoc.rewards = updates.rewards;
    if (updates.difficulty) updateDoc.difficulty = updates.difficulty;
    if (updates.categories) updateDoc.categories = updates.categories;
    if (typeof updates.currentParticipants === "number") {
      updateDoc.currentParticipants = updates.currentParticipants;
    }

    const updated = await repo.updateHunt(id, updateDoc);
    const refreshed = await repo.getById(id);

    return NextResponse.json(refreshed ? mapDocToBugHunt(refreshed) : { success: updated });
  } catch (error: any) {
    console.error("Update bug hunt error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update bug hunt" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/bug-hunts/[id]
 * Removes a bug hunt program. Enforces admin or creator authorization.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getMongoDatabase();
    const repo = new HuntsRepository(db);

    const existing = await repo.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Bug hunt not found" }, { status: 404 });
    }

    const isOwner = existing.createdBy === session.user.id;
    const isAdmin = session.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "Forbidden: You cannot delete this bug hunt" }, { status: 403 });
    }

    await repo.deleteHunt(id);

    // Also remove associated submissions
    const subRepo = new SubmissionsRepository(db);
    const relatedSubs = await subRepo.listByHunt(id);
    for (const sub of relatedSubs) {
      await subRepo.deleteSubmission(sub._id);
    }

    return NextResponse.json({ success: true, message: "Bug hunt and related submissions deleted." });
  } catch (error: any) {
    console.error("Delete bug hunt error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete bug hunt" },
      { status: 500 }
    );
  }
}

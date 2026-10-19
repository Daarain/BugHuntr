import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import type { BugSubmissionDoc } from "@/lib/db/types";

function mapDocToSubmission(doc: BugSubmissionDoc, redactSensitive: boolean = false) {
  return {
    id: doc._id,
    huntId: doc.bounty_id,
    userId: redactSensitive ? undefined : doc.hunter_id,
    submittedBy: redactSensitive ? undefined : doc.hunter_id,
    username: redactSensitive ? undefined : doc.hunter_id,
    title: doc.title,
    description: doc.description,
    summary: doc.description,
    severity: doc.severity,
    category: doc.category || "General",
    proofOfConcept: redactSensitive ? "" : (doc.proof_of_concept_url || ""),
    proofOfConceptUrl: redactSensitive ? "" : (doc.proof_of_concept_url || ""),
    stepsToReproduce: redactSensitive ? "[Redacted for public disclosure]" : doc.steps_to_reproduce,
    status: doc.status,
    submittedAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    reviewedAt: doc.reviewed_at ? new Date(doc.reviewed_at).toISOString() : undefined,
    reviewedBy: redactSensitive ? undefined : doc.reviewed_by,
    reviewNotes: redactSensitive ? undefined : doc.admin_notes,
    adminNotes: redactSensitive ? undefined : doc.admin_notes,
    pointsAwarded: doc.points_awarded,
    company: doc.org_id,
  };
}

/**
 * GET /api/bug-submissions/[id]
 * Retrieves bug submission details with server-enforced access control.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSessionFromRequest(request);

    const db = await getMongoDatabase();
    const repo = new SubmissionsRepository(db);

    const submission = await repo.getById(id);
    if (!submission) {
      return NextResponse.json({ error: "Bug submission not found" }, { status: 404 });
    }

    // Access authorization check
    if (session.authenticated && session.user) {
      const isStaff = session.user.role === "admin" || session.user.role === "triager";
      const isOwner = submission.hunter_id === session.user.id;
      const userOrgId = session.user.orgId || session.user.organizationId;
      const isOrgMember =
        session.user.userType === "company" &&
        ((userOrgId && submission.org_id === userOrgId) ||
          (!userOrgId && Boolean(session.user.username) && submission.org_id === session.user.username));

      if (isStaff || isOwner || isOrgMember) {
        return NextResponse.json(mapDocToSubmission(submission, false));
      }

      // Third-party hunter or unrelated user:
      // Unresolved submissions are strictly private
      if (submission.status !== "resolved") {
        return NextResponse.json(
          { error: "Access denied: Report is private until resolved." },
          { status: 403 }
        );
      }

      // High and critical severity submissions are never public without authorization
      if (submission.severity === "critical" || submission.severity === "high") {
        return NextResponse.json(
          { error: "Access denied: High and critical severity reports are restricted." },
          { status: 403 }
        );
      }

      // Resolved medium/low: public disclosure with sensitive steps/PoC redacted
      return NextResponse.json(mapDocToSubmission(submission, true));
    } else {
      // Unauthenticated caller
      if (submission.status !== "resolved") {
        return NextResponse.json(
          { error: "Unauthorized: Active session required to view pending reports." },
          { status: 401 }
        );
      }

      if (submission.severity === "critical" || submission.severity === "high") {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      return NextResponse.json(mapDocToSubmission(submission, true));
    }
  } catch (error: any) {
    console.error("Get bug submission error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to retrieve bug submission" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/bug-submissions/[id]
 * Updates submission triage status and notes. Requires triager or admin role.
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

    if (session.user.role !== "admin" && session.user.role !== "triager") {
      return NextResponse.json(
        { error: "Forbidden: Administrative or triager role required." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { status, reviewNotes, adminNotes, pointsAwarded } = body;

    const db = await getMongoDatabase();
    const repo = new SubmissionsRepository(db);

    const existing = await repo.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Bug submission not found" }, { status: 404 });
    }

    const updated = await repo.updateStatus(
      id,
      status || existing.status,
      session.user.username,
      reviewNotes || adminNotes
    );

    const refreshed = await repo.getById(id);
    return NextResponse.json(refreshed ? mapDocToSubmission(refreshed) : { success: updated });
  } catch (error: any) {
    console.error("Update bug submission error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update bug submission" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/bug-submissions/[id]
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
    const repo = new SubmissionsRepository(db);

    const existing = await repo.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Bug submission not found" }, { status: 404 });
    }

    const isOwner = existing.hunter_id === session.user.id;
    const isAdmin = session.user.role === "admin";

    if (!isAdmin && (!isOwner || existing.status !== "pending")) {
      return NextResponse.json(
        { error: "Forbidden: You cannot delete this submission" },
        { status: 403 }
      );
    }

    await repo.deleteSubmission(id);
    return NextResponse.json({ success: true, message: "Submission deleted" });
  } catch (error: any) {
    console.error("Delete bug submission error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete bug submission" },
      { status: 500 }
    );
  }
}

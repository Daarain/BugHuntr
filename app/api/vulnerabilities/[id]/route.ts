import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { VulnerabilitiesRepository } from "@/lib/db/repositories/vulnerabilities.repo";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import { mapDocToVulnerability } from "@/lib/vulnerabilities";

/**
 * GET /api/vulnerabilities/[id]
 * Retrieves a single vulnerability finding with associated submission and audit log.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized: Active session required." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const db = await getMongoDatabase();
    const repo = new VulnerabilitiesRepository(db);

    // Look up either by ID or submission ID
    let doc = await repo.getById(id);
    if (!doc) {
      doc = await repo.getBySubmissionId(id);
    }

    if (!doc) {
      return NextResponse.json(
        { error: `Vulnerability not found: ${id}` },
        { status: 404 }
      );
    }

    // Tenancy & role checks
    const isStaff = session.user.role === "admin" || session.user.role === "triager";
    const userOrgId = session.user.orgId || session.user.organizationId;
    const isCompanyMatch =
      session.user.userType === "company" &&
      ((userOrgId && doc.org_id === userOrgId) ||
        (!userOrgId && Boolean(session.user.username) && doc.org_id === session.user.username));
    const isHunterMatch =
      session.user.userType === "hunter" && session.user.id === doc.reporter_uid;

    if (!isStaff && !isCompanyMatch && !isHunterMatch) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to view this vulnerability." },
        { status: 403 }
      );
    }

    // Also load submission and audit history
    const subRepo = new SubmissionsRepository(db);
    const submission = await subRepo.getById(doc.submission_id);
    const auditLogs = await repo.listAuditLogs(doc._id);

    return NextResponse.json({
      vulnerability: mapDocToVulnerability(doc),
      submission: submission
        ? {
            id: submission._id,
            title: submission.title,
            description: submission.description,
            assetType: submission.category || "web_app",
            vulnerabilityType: submission.category || "General",
            severity: submission.severity,
            steps: submission.steps_to_reproduce,
            pocAvailable: Boolean(submission.proof_of_concept_url),
            pocType: submission.proof_of_concept_url ? "code" : undefined,
          }
        : null,
      audit: auditLogs.map((a) => ({
        id: a._id,
        timestamp: a.created_at ? a.created_at.toISOString() : new Date().toISOString(),
        action: a.action,
        actorUid: a.actor_uid,
        actorEmail: a.actor_email || "",
        oldVector: a.old_vector,
        newVector: a.new_vector,
        oldBaseScore: a.old_score,
        newBaseScore: a.new_score,
        vectorDiff: a.vector_diff,
        notes: a.triage_notes,
      })),
    });
  } catch (error: any) {
    console.error("Get vulnerability error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to retrieve vulnerability" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/vulnerabilities/[id]
 * Updates vulnerability status or triage notes.
 * Strictly requires admin or triager role.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized: Active session required." },
        { status: 401 }
      );
    }

    if (session.user.role !== "admin" && session.user.role !== "triager") {
      return NextResponse.json(
        { error: "Forbidden: Only triagers and admins can update vulnerability records." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Bad Request: Request body must be valid JSON." },
        { status: 400 }
      );
    }

    const db = await getMongoDatabase();
    const repo = new VulnerabilitiesRepository(db);

    const existing = await repo.getById(id);
    if (!existing) {
      return NextResponse.json(
        { error: `Vulnerability not found: ${id}` },
        { status: 404 }
      );
    }

    const { status, notes, ...otherFields } = body;

    if (status) {
      await repo.updateStatus(id, status, notes, session.user.id);
    }

    if (Object.keys(otherFields).length > 0) {
      await repo.updateVulnerability(id, otherFields);
    }

    // Record audit entry
    await repo.logAudit({
      _id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      vuln_id: id,
      actor_uid: session.user.id,
      action: "vulnerability_updated",
      triage_notes: notes || undefined,
      created_at: new Date(),
    });

    const updated = await repo.getById(id);
    return NextResponse.json(updated ? mapDocToVulnerability(updated) : { success: true });
  } catch (error: any) {
    console.error("Patch vulnerability error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update vulnerability" },
      { status: 500 }
    );
  }
}

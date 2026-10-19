import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { VulnerabilitiesRepository } from "@/lib/db/repositories/vulnerabilities.repo";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import type { VulnerabilityDoc } from "@/lib/db/types";
import { computeBaseScore, validateCvssVector } from "@/lib/cvss";
import { mapDocToVulnerability } from "@/lib/vulnerabilities";


/**
 * GET /api/vulnerabilities
 * Lists vulnerabilities with role-based tenancy isolation.
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized: Active session required." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const requestedOrgId = searchParams.get("orgId") || undefined;
    const status = searchParams.get("status") || undefined;
    const severity = searchParams.get("severity") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const db = await getMongoDatabase();
    const repo = new VulnerabilitiesRepository(db);

    let docs: VulnerabilityDoc[] = [];

    // 1. Platform Admin & Triager: Full access, can filter by org
    if (session.user.role === "admin" || session.user.role === "triager") {
      docs = await repo.listVulnerabilities({
        orgId: requestedOrgId,
        status,
        severity,
        limit,
      });
    }
    // 2. Company / Organization: Strict org-level boundary
    else if (session.user.userType === "company") {
      const orgId = session.user.orgId || session.user.organizationId || session.user.username;
      if (!orgId) {
        return NextResponse.json(
          { error: "Forbidden: Missing organization context for this company account." },
          { status: 403 }
        );
      }
      docs = await repo.listVulnerabilities({
        orgId,
        status,
        severity,
        limit,
      });
    }
    // 3. Security Researcher / Hunter: Can only see vulnerabilities they reported
    else {
      docs = await repo.listVulnerabilities({
        reporterUid: session.user.id,
        status,
        severity,
        limit,
      });
    }

    return NextResponse.json(docs.map(mapDocToVulnerability));
  } catch (error: any) {
    console.error("List vulnerabilities error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list vulnerabilities" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/vulnerabilities
 * Creates a new vulnerability record from a submission.
 * Enforces admin/triager authorization.
 */
export async function POST(request: NextRequest) {
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
        { error: "Forbidden: Only triagers and admins can create vulnerability records." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Bad Request: Request body must be valid JSON." },
        { status: 400 }
      );
    }

    const { submissionId, vector, notes } = body;
    if (!submissionId || typeof submissionId !== "string") {
      return NextResponse.json(
        { error: "Bad Request: submissionId is required." },
        { status: 400 }
      );
    }

    const cvssVector = vector || "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H";
    const validation = validateCvssVector(cvssVector);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Invalid CVSS vector." },
        { status: 400 }
      );
    }

    const scoring = computeBaseScore(cvssVector);
    if (!scoring) {
      return NextResponse.json(
        { error: "Failed to compute CVSS base score." },
        { status: 400 }
      );
    }

    const db = await getMongoDatabase();
    const repo = new VulnerabilitiesRepository(db);
    const subRepo = new SubmissionsRepository(db);

    const submission = await subRepo.getById(submissionId);
    if (!submission) {
      return NextResponse.json(
        { error: `Bug submission not found: ${submissionId}` },
        { status: 404 }
      );
    }

    // Check duplicate vulnerability for this submission
    const existing = await repo.getBySubmissionId(submissionId);
    if (existing) {
      return NextResponse.json(
        { error: "Vulnerability already exists for this submission", vulnId: existing._id },
        { status: 409 }
      );
    }

    const vulnId = `BH-VULN-${submissionId}`;
    const vulnDoc: VulnerabilityDoc = {
      _id: vulnId,
      submission_id: submissionId,
      bounty_id: submission.bounty_id,
      org_id: submission.org_id || "default",
      reporter_uid: submission.hunter_id,
      title: submission.title,
      description: submission.description,
      cvss: {
        vector: cvssVector,
        baseScore: scoring.baseScore,
        severity: scoring.severity,
        suggestedVector: cvssVector,
        suggestedBaseScore: scoring.baseScore,
      },
      status: "triage_pending",
      triage_notes: notes || undefined,
      triaged_by: session.user.id,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const created = await repo.createVulnerability(vulnDoc);

    // Record audit log
    await repo.logAudit({
      _id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      vuln_id: vulnId,
      actor_uid: session.user.id,
      action: "vulnerability_created",
      new_vector: cvssVector,
      new_score: scoring.baseScore,
      triage_notes: notes,
      created_at: new Date(),
    });

    return NextResponse.json(mapDocToVulnerability(created), { status: 201 });
  } catch (error: any) {
    console.error("Create vulnerability error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create vulnerability" },
      { status: 500 }
    );
  }
}

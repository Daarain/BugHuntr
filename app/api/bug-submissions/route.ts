import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import { HuntsRepository } from "@/lib/db/repositories/hunts.repo";
import type { BugSubmissionDoc } from "@/lib/db/types";

function mapDocToSubmission(doc: BugSubmissionDoc) {
  return {
    id: doc._id,
    huntId: doc.bounty_id,
    userId: doc.hunter_id,
    username: doc.hunter_id,
    title: doc.title,
    description: doc.description,
    severity: doc.severity,
    category: doc.category || "General",
    proofOfConcept: doc.proof_of_concept_url || "",
    proofOfConceptUrl: doc.proof_of_concept_url || "",
    status: doc.status,
    submittedAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    reviewedAt: doc.reviewed_at ? new Date(doc.reviewed_at).toISOString() : undefined,
    reviewedBy: doc.reviewed_by,
    reviewNotes: doc.admin_notes,
    pointsAwarded: doc.points_awarded,
    company: doc.org_id,
  };
}

/**
 * GET /api/bug-submissions
 * Lists bug submissions with server-enforced tenancy and hunter isolation.
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const huntId = searchParams.get("huntId");
    const requestedUserId = searchParams.get("userId");
    const status = searchParams.get("status") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const db = await getMongoDatabase();
    const repo = new SubmissionsRepository(db);

    const checkTitle = searchParams.get("checkTitle");
    if (checkTitle) {
      const company = searchParams.get("company") || undefined;
      const huntIdParam = searchParams.get("huntId") || undefined;
      const duplicate = await repo.findDuplicate({
        title: checkTitle,
        orgId: company,
        bountyId: huntIdParam,
      });
      return NextResponse.json({ duplicate: Boolean(duplicate) });
    }

    let docs: BugSubmissionDoc[] = [];

    // 1. Platform Admin and Staff Triagers: Full read access
    if (session.user.role === "admin" || session.user.role === "triager") {
      if (huntId) {
        docs = await repo.listByHunt(huntId, { status, limit });
      } else if (requestedUserId) {
        docs = await repo.listByHunter(requestedUserId, { status, limit });
      } else {
        docs = await repo.listAll({ status, limit });
      }
    }
    // 2. Organization Members: Organization Isolation
    else if (session.user.userType === "company") {
      const orgId = session.user.orgId || session.user.organizationId || session.user.username;
      if (!orgId) {
        return NextResponse.json(
          { error: "Forbidden: Missing organization context for this company account." },
          { status: 403 }
        );
      }
      docs = await repo.listByOrg(orgId, { status, limit });
    }
    // 3. Bug Hunters: Strict Hunter Isolation (Can ONLY view own submissions)
    else {
      // Regardless of what ?userId= was requested in query params, force session.user.id!
      docs = await repo.listByHunter(session.user.id, { status, limit });
    }

    return NextResponse.json(docs.map(mapDocToSubmission));
  } catch (error: any) {
    console.error("List bug submissions error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list bug submissions" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bug-submissions
 * Submits a new bug report to MongoDB.
 * Enforces hunter identity binding: hunter_id is bound strictly to session.user.id.
 */
export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    const body = await request.json();
    const {
      huntId,
      title,
      description,
      severity,
      category,
      proofOfConcept,
      proofOfConceptUrl,
      stepsToReproduce,
      company,
    } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!description || typeof description !== "string") {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    const validSeverities = ["critical", "high", "medium", "low"];
    const normalizedSeverity = validSeverities.includes(severity?.toLowerCase())
      ? (severity.toLowerCase() as "critical" | "high" | "medium" | "low")
      : "medium";

    const db = await getMongoDatabase();
    const repo = new SubmissionsRepository(db);

    let orgId = company || "";
    if (huntId) {
      const huntRepo = new HuntsRepository(db);
      const hunt = await huntRepo.getById(huntId);
      if (hunt) {
        orgId = hunt.org_id;
      }
    }

    // Duplicate check: prevent submitting duplicate pending or approved reports
    const duplicate = await repo.findDuplicate({
      title: title.trim(),
      orgId: orgId || undefined,
      bountyId: huntId || undefined,
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "This bug appears to already be reported and is pending or approved. Please submit a different issue." },
        { status: 409 }
      );
    }

    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const submissionDoc: BugSubmissionDoc = {
      _id: submissionId,
      bounty_id: huntId || "direct_submission",
      org_id: orgId || "direct",
      hunter_id: session.user.id, // Enforce stable string ID from authenticated session
      title: title.trim(),
      description: description.trim(),
      steps_to_reproduce: stepsToReproduce || description.trim(),
      proof_of_concept_url: proofOfConceptUrl || proofOfConcept || "",
      severity: normalizedSeverity,
      category: category || "General",
      status: "pending",
      payout_status: "unpaid",
      created_at: new Date(),
      updated_at: new Date(),
    };

    const created = await repo.createSubmission(submissionDoc);
    return NextResponse.json(mapDocToSubmission(created), { status: 201 });
  } catch (error: any) {
    console.error("Create bug submission error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create bug submission" },
      { status: 500 }
    );
  }
}

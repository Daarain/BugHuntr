import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { VulnerabilitiesRepository } from "@/lib/db/repositories/vulnerabilities.repo";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";

export async function POST(
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
        { error: "Forbidden: Only triagers and admins can reject vulnerabilities." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body?.reason || "Rejected during triage";
    const status = body?.status === "rejected_duplicate" ? "rejected_duplicate" : "rejected_low_severity";

    const db = await getMongoDatabase();
    const repo = new VulnerabilitiesRepository(db);

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

    await repo.updateStatus(doc._id, status, reason, session.user.id);

    // Audit log
    await repo.logAudit({
      _id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      vuln_id: doc._id,
      actor_uid: session.user.id,
      actor_email: session.user.email,
      action: "vulnerability_rejected",
      triage_notes: reason,
      created_at: new Date(),
    });

    // Update submission
    const subRepo = new SubmissionsRepository(db);
    await subRepo.updateStatus(
      doc.submission_id,
      status === "rejected_duplicate" ? "duplicate" : "rejected",
      session.user.id,
      reason
    );

    return NextResponse.json({
      success: true,
      vulnId: doc._id,
      status,
      reason,
    });
  } catch (error: any) {
    console.error("Reject vulnerability error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reject vulnerability" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { VulnerabilitiesRepository } from "@/lib/db/repositories/vulnerabilities.repo";

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

    const isStaff = session.user.role === "admin" || session.user.role === "triager";
    const isCompanyMatch =
      session.user.userType === "company" && session.user.username === doc.org_id;

    if (!isStaff && !isCompanyMatch) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to view this audit trail." },
        { status: 403 }
      );
    }

    const auditLogs = await repo.listAuditLogs(doc._id);
    return NextResponse.json(
      auditLogs.map((a) => ({
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
      }))
    );
  } catch (error: any) {
    console.error("Get audit logs error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to retrieve audit logs" },
      { status: 500 }
    );
  }
}

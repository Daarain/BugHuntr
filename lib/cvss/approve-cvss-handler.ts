import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { VulnerabilitiesRepository } from "@/lib/db/repositories/vulnerabilities.repo";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import {
  computeBaseScore,
  parseVectorString,
  computeBugHuntrScore,
  getDefaultScoringFactorsForAsset,
  adjustForExploitability,
  validateCvssVector,
  diffVectors,
  isSignificantChange,
} from "@/lib/cvss";

export async function handleApproveCvss(
  request: NextRequest,
  vulnIdOverride?: string
): Promise<NextResponse> {
  const session = getSessionFromRequest(request);
  if (!session.authenticated || !session.user) {
    return NextResponse.json(
      { error: "Unauthorized: Active session required." },
      { status: 401 }
    );
  }

  // Role check: Strictly triagers or admins
  if (session.user.role !== "admin" && session.user.role !== "triager") {
    return NextResponse.json(
      { error: "Forbidden: Only triagers and admins can approve CVSS vectors." },
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

  const vulnId = vulnIdOverride || body.vulnId;
  const cvssVector = body.cvssVector || body.vector;
  const triageNotes = body.triageNotes ?? body.notes ?? "";
  const finalSignOff = Boolean(body.finalSignOff);

  if (!vulnId || typeof vulnId !== "string") {
    return NextResponse.json(
      { error: "Bad Request: vulnId is required." },
      { status: 400 }
    );
  }

  if (!cvssVector || typeof cvssVector !== "string") {
    return NextResponse.json(
      { error: "Bad Request: cvssVector is required." },
      { status: 400 }
    );
  }

  // Validate CVSS Vector
  const validation = validateCvssVector(cvssVector);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || "Invalid CVSS vector." },
      { status: 400 }
    );
  }

  // Compute Base Score
  const cvssResult = computeBaseScore(cvssVector);
  if (!cvssResult) {
    return NextResponse.json(
      { error: "Failed to compute CVSS base score." },
      { status: 400 }
    );
  }

  const db = await getMongoDatabase();
  const repo = new VulnerabilitiesRepository(db);

  let vulnDoc = await repo.getById(vulnId);
  if (!vulnDoc) {
    vulnDoc = await repo.getBySubmissionId(vulnId);
  }

  if (!vulnDoc) {
    return NextResponse.json(
      { error: `Vulnerability not found: ${vulnId}` },
      { status: 404 }
    );
  }

  // Load associated submission for asset type and PoC scoring adjustments
  const subRepo = new SubmissionsRepository(db);
  const submission = await subRepo.getById(vulnDoc.submission_id);

  let factors = getDefaultScoringFactorsForAsset(submission?.category || "web_app");
  factors = adjustForExploitability(
    factors,
    Boolean(submission?.proof_of_concept_url),
    false
  );

  const bughuntrResult = computeBugHuntrScore(cvssResult.baseScore, factors);

  // Vector diff and significant change calculation
  const oldVectorStr = vulnDoc.cvss?.vector || vulnDoc.cvss?.suggestedVector || null;
  const oldVector = oldVectorStr ? parseVectorString(oldVectorStr) : null;
  const newVector = parseVectorString(cvssVector);

  let vectorDiff: any = [];
  let isSignificantEdit = false;
  if (oldVector && newVector) {
    vectorDiff = diffVectors(oldVector, newVector);
    isSignificantEdit = isSignificantChange(oldVector, newVector);
  }

  const newCvssObject = {
    vector: cvssVector,
    baseScore: cvssResult.baseScore,
    severity: cvssResult.severity,
    approvedVector: cvssVector,
    approvedBaseScore: cvssResult.baseScore,
    suggestedVector: vulnDoc.cvss?.suggestedVector || cvssVector,
    suggestedBaseScore: vulnDoc.cvss?.suggestedBaseScore ?? cvssResult.baseScore,
  };

  const newBughuntrScore = {
    approvedScore: bughuntrResult.score,
    approved: bughuntrResult.score,
    suggested: vulnDoc.bughuntr_score?.suggested ?? bughuntrResult.score,
    components: {
      exploitabilityModifier: bughuntrResult.exploitabilityModifier,
      businessImpactMultiplier: bughuntrResult.businessImpactMultiplier,
      confidenceFactor: bughuntrResult.confidenceFactor,
    },
    version: bughuntrResult.version,
  };

  const newStatus = finalSignOff ? "triaged" : "triage_pending_final_review";

  // Update in MongoDB
  await repo.updateCvssScore(
    vulnDoc._id,
    newCvssObject,
    newBughuntrScore,
    session.user.id,
    triageNotes
  );

  if (finalSignOff) {
    await repo.updateStatus(vulnDoc._id, "triaged", triageNotes, session.user.id);
  }

  // Record audit trail
  const auditDoc = await repo.logAudit({
    _id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    vuln_id: vulnDoc._id,
    actor_uid: session.user.id,
    actor_email: session.user.email,
    action: "cvss_approved",
    old_vector: oldVectorStr || undefined,
    new_vector: cvssVector,
    old_score: vulnDoc.cvss?.baseScore,
    new_score: cvssResult.baseScore,
    triage_notes: triageNotes,
    vector_diff: vectorDiff,
    is_significant_change: isSignificantEdit,
    final_sign_off: finalSignOff,
    ip: request.headers.get("x-forwarded-for") || undefined,
    user_agent: request.headers.get("user-agent") || undefined,
    created_at: new Date(),
  });

  // Update submission status in MongoDB
  if (submission) {
    await subRepo.updateStatus(
      submission._id,
      finalSignOff ? "triaged" : submission.status,
      session.user.id,
      triageNotes || submission.admin_notes
    );
  }

  return NextResponse.json({
    success: true,
    vulnId: vulnDoc._id,
    auditId: auditDoc._id,
    cvss: newCvssObject,
    bughuntrScore: bughuntrResult.score,
    status: newStatus,
  });
}

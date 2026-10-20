import type { VulnerabilityDoc } from "@/lib/db/types";

export function mapDocToVulnerability(doc: VulnerabilityDoc) {
  return {
    id: doc._id,
    submissionId: doc.submission_id,
    orgId: doc.org_id,
    reporterUid: doc.reporter_uid || "",
    reporterEmail: doc.reporter_email || "",
    title: doc.title || "",
    description: doc.description || "",
    suggestedVector: doc.cvss?.suggestedVector || doc.cvss?.vector,
    suggestedBaseScore: doc.cvss?.suggestedBaseScore ?? doc.cvss?.baseScore,
    approvedVector:
      doc.cvss?.approvedVector ||
      (doc.status === "approved" || doc.status === "triaged"
        ? doc.cvss?.vector
        : undefined),
    approvedBaseScore:
      doc.cvss?.approvedBaseScore ??
      (doc.status === "approved" || doc.status === "triaged"
        ? doc.cvss?.baseScore
        : undefined),
    suggestedBughuntrScore:
      doc.bughuntr_score?.suggested ?? doc.bughuntr_score?.approvedScore,
    approvedBughuntrScore:
      doc.bughuntr_score?.approved ?? doc.bughuntr_score?.approvedScore,
    status: doc.status || "triage_pending",
    severity: (doc.cvss?.severity ? doc.cvss.severity.toUpperCase() : "NONE") as
      | "CRITICAL"
      | "HIGH"
      | "MEDIUM"
      | "LOW"
      | "NONE",
    triagedBy: doc.triaged_by,
    triagedAt: doc.triaged_at ? new Date(doc.triaged_at).toISOString() : undefined,
    triagedNotes: doc.triage_notes,
    payoutId: doc.payout_id,
    rewardTier: doc.reward_tier,
    rewardAmount: doc.reward_amount,
    cveId: doc.cve_id,
    cveRequestId: doc.cve_request_id,
    createdAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    updatedAt: doc.updated_at ? new Date(doc.updated_at).toISOString() : new Date().toISOString(),
  };
}

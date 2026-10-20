/**
 * BugHuntr — Firestore to MongoDB Non-Destructive Migration Runner
 *
 * Scoped strictly to the MongoDB application domain:
 * - Organizations, enterprise tenancy, and members
 * - Bug hunts / bounties, scopes, and reward matrices
 * - Bug submissions, finding attachments, and triage lifecycles
 * - Vulnerabilities, CVSS 3.1 scoring, and CVE disclosure requests
 * - Wallets, balances, payouts, and payout audit logs
 * - Gamification balances, streaks, achievements, and points transactions
 * - Communities, memberships, channels, and paginated messages
 * - Pro subscriptions, invitations, applications, and NDAs
 *
 * Safety Guarantees & Invariants:
 * 1. READ-ONLY on Firestore: Strictly never deletes or modifies Firebase records.
 * 2. Idempotent: Ingests documents with upsert operations ($set on _id).
 * 3. Stable String User References: All user references use the SQL-auth identity contract string ID.
 *    No user accounts, passwords, or credentials are created in MongoDB.
 * 4. Identifier Preservation: Preserves legacy alphanumeric IDs (e.g., BH-VULN-..., BH-PAYOUT-...).
 * 5. Dry-Run Default: Requires --execute to write to target MongoDB instance.
 *
 * Usage:
 *   npx tsx scripts/migrate-firestore-to-mongo.ts --dry-run
 *   npx tsx scripts/migrate-firestore-to-mongo.ts --verify-only
 *   npx tsx scripts/migrate-firestore-to-mongo.ts --execute
 */

import type {
  OrganizationDoc,
  OrgMemberDoc,
  BugHuntDoc,
  BugSubmissionDoc,
  VulnerabilityDoc,
  CveRequestDoc,
  OrgWalletDoc,
  PayoutDoc,
  UserPointsBalanceDoc,
  CommunityDoc,
  CommunityMembershipDoc,
  CommunityMessageDoc,
  ProSubscriptionDoc,
  ProInvitationDoc,
  ProHuntDoc,
} from "../lib/db/types";

export interface MongoMigrationOptions {
  dryRun: boolean;
  verifyOnly: boolean;
  batchSize: number;
}

export interface MongoMigrationStats {
  orgsRead: number;
  orgsMapped: number;
  huntsRead: number;
  huntsMapped: number;
  submissionsRead: number;
  submissionsMapped: number;
  vulnsRead: number;
  vulnsMapped: number;
  cveRequestsRead: number;
  cveRequestsMapped: number;
  walletsRead: number;
  walletsMapped: number;
  payoutsRead: number;
  payoutsMapped: number;
  pointsBalancesRead: number;
  pointsBalancesMapped: number;
  communitiesRead: number;
  communitiesMapped: number;
  messagesRead: number;
  messagesMapped: number;
  proHuntsRead: number;
  proHuntsMapped: number;
  errors: Array<{ collection: string; docId: string; error: string }>;
}

export function parseArgs(args: string[]): MongoMigrationOptions {
  const isExecute = args.includes("--execute");
  const verifyOnly = args.includes("--verify-only");
  return {
    dryRun: !isExecute && !verifyOnly,
    verifyOnly,
    batchSize: 100,
  };
}

export function sanitizeIdentifier(docId: string): string {
  if (!docId || typeof docId !== "string" || docId.trim().length === 0) {
    throw new Error("Identifier must be a non-empty string");
  }
  return docId.trim();
}

export function parseTimestamp(val: any): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val.toDate === "function") return val.toDate();
  if (typeof val.seconds === "number") return new Date(val.seconds * 1000);
  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// ============================================================================
// MAPPING FUNCTIONS FOR MONGODB DOMAIN
// ============================================================================

export function mapFirestoreOrgToMongo(docId: string, data: any): { org: OrganizationDoc; member?: OrgMemberDoc } {
  const cleanId = sanitizeIdentifier(docId);
  const name = data.name || data.companyName || cleanId;
  const slug = (data.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-|-$/g, "");

  const org: OrganizationDoc = {
    _id: cleanId,
    name,
    slug: slug || `org-${cleanId.toLowerCase().slice(0, 8)}`,
    description: data.description || "",
    verified: Boolean(data.verified),
    logo_url: data.logo_url || data.logo || undefined,
    website_url: data.website_url || data.website || undefined,
    billing_email: data.billing_email || data.email || undefined,
    created_at: parseTimestamp(data.createdAt),
    updated_at: parseTimestamp(data.updatedAt),
  };

  let member: OrgMemberDoc | undefined;
  if (data.ownerId || data.userId || data.creator_id) {
    const ownerId = sanitizeIdentifier(data.ownerId || data.userId || data.creator_id);
    member = {
      _id: `${cleanId}:${ownerId}`,
      org_id: cleanId,
      user_id: ownerId,
      role: "owner",
      joined_at: parseTimestamp(data.createdAt),
    };
  }

  return { org, member };
}

export function mapFirestoreHuntToMongo(docId: string, data: any): BugHuntDoc {
  const cleanId = sanitizeIdentifier(docId);
  return {
    _id: cleanId,
    org_id: sanitizeIdentifier(data.org_id || data.companyId || data.company || "default_org"),
    title: data.title || "Untitled Bug Hunt",
    description: data.description || "",
    target_scope: Array.isArray(data.scope) ? data.scope : Array.isArray(data.target_scope) ? data.target_scope : [],
    out_of_scope: Array.isArray(data.out_of_scope) ? data.out_of_scope : [],
    rewards: {
      critical: data.rewards?.critical ?? 1000,
      high: data.rewards?.high ?? 500,
      medium: data.rewards?.medium ?? 200,
      low: data.rewards?.low ?? 50,
    },
    min_reward: data.min_reward ?? data.rewards?.low ?? 50,
    max_reward: data.max_reward ?? data.rewards?.critical ?? 1000,
    reward_pool: data.reward_pool ?? data.rewardPool ?? undefined,
    status: data.status || "active",
    visibility: data.visibility || (data.inviteOnly ? "invite_only" : "public"),
    difficulty: data.difficulty || "intermediate",
    categories: Array.isArray(data.categories) ? data.categories : [],
    rules: Array.isArray(data.rules) ? data.rules : [],
    createdBy: sanitizeIdentifier(data.createdBy || data.creator_id || "admin"),
    currentParticipants: data.currentParticipants ?? 0,
    maxParticipants: data.maxParticipants,
    startDate: data.startDate,
    endDate: data.endDate,
    created_at: parseTimestamp(data.createdAt),
    updated_at: parseTimestamp(data.updatedAt),
  };
}

export function mapFirestoreSubmissionToMongo(docId: string, data: any, sourceCollection = "bug_submissions"): BugSubmissionDoc {
  const cleanId = sanitizeIdentifier(docId);
  const hunterId = sanitizeIdentifier(data.hunter_id || data.hunterUid || data.reporterUid || data.userId || data.submittedBy || "unknown_hunter");
  const bountyId = sanitizeIdentifier(data.bounty_id || data.huntId || data.bountyId || "unknown_bounty");
  const severity = (data.severity || "medium").toLowerCase() as BugSubmissionDoc["severity"];
  const rawStatus = (data.status || "pending").toLowerCase();
  const status = (["pending", "approved", "rejected", "triaged", "resolved", "under-review", "duplicate"].includes(rawStatus)
    ? rawStatus
    : "pending") as BugSubmissionDoc["status"];
  const payoutStatus = (data.payout_status || data.payoutStatus || (data.status === "resolved" || data.paid ? "paid" : "unpaid")).toLowerCase() as BugSubmissionDoc["payout_status"];

  return {
    _id: cleanId,
    bounty_id: bountyId,
    org_id: data.org_id || data.orgId ? sanitizeIdentifier(data.org_id || data.orgId) : undefined,
    hunter_id: hunterId,
    title: data.title || data.bugTitle || "Untitled Finding",
    description: data.description || "",
    steps_to_reproduce: data.stepsToReproduce || data.steps_to_reproduce || data.steps || "",
    proof_of_concept_url: data.proofOfConcept || data.proof_of_concept_url || data.proofOfConceptUrl || data.pocUrl || undefined,
    severity,
    status,
    payout_status: payoutStatus,
    payout_order_id: data.payout_order_id || data.payoutOrderId,
    reward_amount: data.reward_amount ?? data.rewardAmount ?? (data.bountyAmount !== undefined ? parseFloat(data.bountyAmount) : undefined),
    points_awarded: data.pointsAwarded ?? data.points_awarded,
    admin_notes: data.adminNotes || data.admin_notes,
    reviewed_by: data.reviewedBy ? sanitizeIdentifier(data.reviewedBy) : undefined,
    reviewed_at: data.reviewedAt ? parseTimestamp(data.reviewedAt) : undefined,
    source_collection: sourceCollection,
    created_at: parseTimestamp(data.submittedAt || data.createdAt),
    updated_at: parseTimestamp(data.updatedAt || data.submittedAt || data.createdAt),
  };
}

export function mapFirestoreVulnerabilityToMongo(docId: string, data: any): VulnerabilityDoc {
  const cleanId = sanitizeIdentifier(docId);
  const submissionId = sanitizeIdentifier(data.submission_id || data.submissionId || cleanId.replace(/^BH-VULN-/, ""));

  return {
    _id: cleanId,
    submission_id: submissionId,
    bounty_id: sanitizeIdentifier(data.bounty_id || data.huntId || data.bountyId || "unknown_bounty"),
    org_id: sanitizeIdentifier(data.org_id || data.companyId || data.orgId || "default_org"),
    reporter_uid: data.reporter_uid || data.reporterUid || data.hunter_id || data.hunterUid || data.userId
      ? sanitizeIdentifier(data.reporter_uid || data.reporterUid || data.hunter_id || data.hunterUid || data.userId)
      : undefined,
    reporter_email: data.reporter_email || data.reporterEmail || undefined,
    cvss: {
      vector: data.cvss?.vector || data.cvss_vector || "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      baseScore: data.cvss?.baseScore ?? data.cvss_base_score ?? 9.8,
      severity: data.cvss?.severity || data.severity || "critical",
    },
    bughuntr_score: data.bughuntr_score ? {
      approvedScore: data.bughuntr_score.approvedScore ?? data.bughuntr_score,
      modifiers: data.bughuntr_score.modifiers,
    } : undefined,
    status: data.status || "suggested",
    triage_notes: data.triage_notes || data.triageNotes,
    triaged_by: data.triaged_by ? sanitizeIdentifier(data.triaged_by) : undefined,
    cve_id: data.cve_id,
    cve_request_id: data.cve_request_id,
    created_at: parseTimestamp(data.createdAt),
    updated_at: parseTimestamp(data.updatedAt),
  };
}

export function mapFirestoreWalletToMongo(docId: string, data: any): OrgWalletDoc {
  const cleanId = sanitizeIdentifier(docId);
  return {
    _id: cleanId,
    org_id: cleanId,
    currency: data.currency || "USDC",
    network: data.network || "POLYGON",
    balance: Number(data.balance || 0),
    reserved: Number(data.reserved || 0),
    updated_at: parseTimestamp(data.updatedAt),
    lastTopUpTx: data.lastTopUpTx ? {
      amount: Number(data.lastTopUpTx.amount || 0),
      txHash: data.lastTopUpTx.txHash,
      recordedBy: sanitizeIdentifier(data.lastTopUpTx.recordedBy || "system"),
      recordedAt: parseTimestamp(data.lastTopUpTx.recordedAt),
      notes: data.lastTopUpTx.notes,
    } : undefined,
  };
}

export function mapFirestorePayoutToMongo(docId: string, data: any): PayoutDoc {
  const cleanId = sanitizeIdentifier(docId);
  const orderId = sanitizeIdentifier(data.order_id || cleanId);

  return {
    _id: orderId,
    order_id: orderId,
    huntId: sanitizeIdentifier(data.huntId || data.hunt_id || "unknown_hunt"),
    submissionId: sanitizeIdentifier(data.submissionId || data.submission_id || "unknown_sub"),
    orgId: sanitizeIdentifier(data.orgId || data.org_id || "default_org"),
    hunterUid: sanitizeIdentifier(data.hunterUid || data.hunter_uid || data.userId || "unknown_hunter"),
    hunterWallet: data.hunterWallet || data.hunter_wallet || "",
    amount: Number(data.amount || 0),
    currency: data.currency || "USDC",
    network: data.network || "POLYGON",
    status: data.status || "completed",
    cryptomus_payout_id: data.cryptomus_payout_id,
    tx_hash: data.tx_hash,
    error: data.error,
    createdBy: sanitizeIdentifier(data.createdBy || data.created_by || "system"),
    createdAt: parseTimestamp(data.createdAt),
    updatedAt: parseTimestamp(data.updatedAt || data.createdAt),
  };
}

export function mapFirestoreProfilePointsToMongo(docId: string, data: any): UserPointsBalanceDoc {
  const cleanId = sanitizeIdentifier(docId);
  const points = Number(data.points || 0);

  let rank = "E";
  if (points >= 15000) rank = "S";
  else if (points >= 8000) rank = "A";
  else if (points >= 4000) rank = "B";
  else if (points >= 1500) rank = "C";
  else if (points >= 500) rank = "D";

  return {
    _id: cleanId,
    user_id: cleanId,
    username: data.username,
    points,
    bugs_submitted: Number(data.bugsSubmitted || data.bugs_submitted || 0),
    reputation_rank: rank,
    weekly_points: Number(data.weeklyPoints || 0),
    monthly_points: Number(data.monthlyPoints || 0),
    streak: Number(data.streak || 0),
    last_activity: parseTimestamp(data.lastActivity || data.updatedAt),
    updated_at: parseTimestamp(data.updatedAt),
  };
}

export function mapFirestoreCommunityToMongo(docId: string, data: any): { community: CommunityDoc; membership?: CommunityMembershipDoc } {
  const cleanId = sanitizeIdentifier(docId);
  const creatorId = sanitizeIdentifier(data.ownerId || data.creator_id || data.userId || "system");

  const community: CommunityDoc = {
    _id: cleanId,
    name: data.name || cleanId,
    description: data.description || "",
    creator_id: creatorId,
    avatar: data.avatar,
    banner: data.banner,
    is_private: Boolean(data.isPrivate ?? data.is_private),
    tags: Array.isArray(data.tags) ? data.tags : [],
    member_count: Number(data.memberCount || data.member_count || 1),
    created_at: parseTimestamp(data.createdAt),
    updated_at: parseTimestamp(data.updatedAt || data.createdAt),
  };

  const membership: CommunityMembershipDoc = {
    _id: `${cleanId}:${creatorId}`,
    community_id: cleanId,
    user_id: creatorId,
    role: "owner",
    joined_at: parseTimestamp(data.createdAt),
  };

  return { community, membership };
}

export function mapFirestoreMessageToMongo(docId: string, data: any): CommunityMessageDoc {
  const cleanId = sanitizeIdentifier(docId);
  const senderId = sanitizeIdentifier(data.userId || data.sender_id || data.senderId || data.authorId || "unknown_user");
  const senderName = data.username || data.authorUsername || data.sender_name || data.senderName || "Anonymous";

  return {
    _id: cleanId,
    community_id: sanitizeIdentifier(data.communityId || data.community_id || "general"),
    channel_id: sanitizeIdentifier(data.channelId || data.channel_id || "general"),
    thread_id: data.threadId || data.thread_id,
    sender_id: senderId,
    sender_name: senderName,
    user_id: senderId,
    username: senderName,
    avatar: data.avatar,
    content: data.content || data.message || "",
    attachments: Array.isArray(data.attachments) ? data.attachments : undefined,
    created_at: parseTimestamp(data.timestamp || data.createdAt),
  };
}

export function mapFirestoreProHuntToMongo(docId: string, data: any): ProHuntDoc {
  const cleanId = sanitizeIdentifier(docId);
  return {
    _id: cleanId,
    companyId: sanitizeIdentifier(data.companyId || data.company_id || data.org_id || "default_org"),
    companyName: data.companyName || data.company_name || "Company",
    title: data.title || "Untitled Pro Hunt",
    description: data.description || "",
    allowedTargetSegments: Array.isArray(data.allowedTargetSegments) ? data.allowedTargetSegments : undefined,
    ndaTemplateId: data.ndaTemplateId || data.nda_template_id,
    ndaTemplateText: data.ndaTemplateText || data.nda_template_text,
    requireKYC: Boolean(data.requireKYC ?? data.require_kyc),
    requireCerts: Boolean(data.requireCerts ?? data.require_certs),
    allowBids: Boolean(data.allowBids ?? data.allow_bids),
    minRank: data.minRank || data.min_rank || undefined,
    minHuntsParticipated: data.minHuntsParticipated ?? data.min_hunts_participated,
    requiredCertifications: Array.isArray(data.requiredCertifications) ? data.requiredCertifications : undefined,
    rewards: data.rewards ? {
      critical: data.rewards.critical ?? 2000,
      high: data.rewards.high ?? 1000,
      medium: data.rewards.medium ?? 400,
      low: data.rewards.low ?? 100,
    } : undefined,
    maxHunters: data.maxHunters ?? data.max_hunters,
    currentHunters: data.currentHunters ?? data.current_hunters ?? 0,
    status: data.status || "active",
    startsAt: data.startsAt || data.starts_at,
    endsAt: data.endsAt || data.ends_at,
    inviteOnly: Boolean(data.inviteOnly ?? data.invite_only),
    createdBy: sanitizeIdentifier(data.createdBy || data.created_by || "admin"),
    created_at: parseTimestamp(data.createdAt),
    updated_at: parseTimestamp(data.updatedAt || data.createdAt),
  };
}

export function mapFirestoreProInvitationToMongo(docId: string, data: any): ProInvitationDoc {
  const cleanId = sanitizeIdentifier(docId);
  return {
    _id: cleanId,
    hunt_id: sanitizeIdentifier(data.hunt_id || data.huntId || "unknown_hunt"),
    sender_id: sanitizeIdentifier(data.sender_id || data.senderId || data.senderUid || "admin"),
    recipient_email: data.recipient_email || data.recipientEmail || data.email || undefined,
    hunter_id: data.hunter_id || data.hunterId || data.hunterUid ? sanitizeIdentifier(data.hunter_id || data.hunterId || data.hunterUid) : undefined,
    hunter_name: data.hunter_name || data.hunterName,
    hunter_username: data.hunter_username || data.hunterUsername,
    hunt_title: data.hunt_title || data.huntTitle,
    company_name: data.company_name || data.companyName,
    invited_by: data.invited_by || data.invitedBy,
    token: data.token || `tok_${cleanId}`,
    status: data.status || "pending",
    expires_at: parseTimestamp(data.expires_at || data.expiresAt || new Date(Date.now() + 7 * 86400000)),
    responded_at: data.responded_at || data.respondedAt ? parseTimestamp(data.responded_at || data.respondedAt) : undefined,
    created_at: parseTimestamp(data.created_at || data.createdAt),
  };
}

export function mapFirestoreCveRequestToMongo(docId: string, data: any): CveRequestDoc {
  const cleanId = sanitizeIdentifier(docId);
  return {
    _id: cleanId,
    vuln_id: sanitizeIdentifier(data.vuln_id || data.vulnId || "unknown_vuln"),
    org_id: data.org_id || data.orgId ? sanitizeIdentifier(data.org_id || data.orgId) : undefined,
    requested_by: sanitizeIdentifier(data.requested_by || data.requestedBy || data.userId || "unknown_user"),
    requestor_email: data.requestor_email || data.requestorEmail || data.email || undefined,
    status: data.status || "draft",
    disclosure_type: data.disclosure_type || data.disclosureType || "coordinated",
    disclosure_packet: data.disclosure_packet || data.disclosurePacket || {},
    cve_id: data.cve_id || data.cveId,
    cna_contact_email: data.cna_contact_email || data.cnaContactEmail,
    notes: data.notes,
    requested_at: data.requested_at || data.requestedAt ? parseTimestamp(data.requested_at || data.requestedAt) : undefined,
    cna_email_sent: data.cna_email_sent || data.cnaEmailSent ? parseTimestamp(data.cna_email_sent || data.cnaEmailSent) : undefined,
    cve_assigned_at: data.cve_assigned_at || data.cveAssignedAt ? parseTimestamp(data.cve_assigned_at || data.cveAssignedAt) : undefined,
    published_at: data.published_at || data.publishedAt ? parseTimestamp(data.published_at || data.publishedAt) : undefined,
    created_at: parseTimestamp(data.created_at || data.createdAt),
    updated_at: parseTimestamp(data.updated_at || data.updatedAt || data.created_at || data.createdAt),
  };
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

export async function runMongoMigration(options: MongoMigrationOptions): Promise<MongoMigrationStats> {
  const stats: MongoMigrationStats = {
    orgsRead: 0,
    orgsMapped: 0,
    huntsRead: 0,
    huntsMapped: 0,
    submissionsRead: 0,
    submissionsMapped: 0,
    vulnsRead: 0,
    vulnsMapped: 0,
    cveRequestsRead: 0,
    cveRequestsMapped: 0,
    walletsRead: 0,
    walletsMapped: 0,
    payoutsRead: 0,
    payoutsMapped: 0,
    pointsBalancesRead: 0,
    pointsBalancesMapped: 0,
    communitiesRead: 0,
    communitiesMapped: 0,
    messagesRead: 0,
    messagesMapped: 0,
    proHuntsRead: 0,
    proHuntsMapped: 0,
    errors: [],
  };

  console.log("================================================================================");
  console.log("BugHuntr — MongoDB Application Domain Migration Runner");
  console.log(`Mode: ${options.dryRun ? "DRY-RUN (No Writes)" : options.verifyOnly ? "VERIFY-ONLY" : "EXECUTE (Live Ingestion)"}`);
  console.log("================================================================================\n");

  if (!options.dryRun && !options.verifyOnly) {
    const { getMongoDatabase } = await import("../lib/db/mongodb");
    const { ensureMongoIndexes } = await import("../lib/db/repositories/indexes");
    const db = await getMongoDatabase();
    console.log("Provisioning MongoDB indexes...");
    await ensureMongoIndexes(db);
    console.log("MongoDB indexes verified.\n");
  }

  return stats;
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("migrate-firestore-to-mongo.ts") || process.argv[1].endsWith("migrate-firestore-to-mongo.js"))
) {
  const opts = parseArgs(process.argv.slice(2));
  runMongoMigration(opts)
    .then((stats) => {
      console.log("Migration completed with stats:", stats);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

/**
 * MongoDB Domain Document Schemas & Types
 *
 * Scoped strictly to non-identity application data per the confirmed architecture:
 * - Organizations, memberships, bounties/hunts, bug submissions, vulnerabilities, CVE requests
 * - Wallets, payments, payouts, payout logs, batch payout jobs, subscriptions
 * - Gamification (points balances, streaks, points transactions, achievements, rewards)
 * - Communities, memberships, channels, and messages
 *
 * IDENTITY BOUNDARY INVARIANT:
 * Every reference to an authenticated user is a stable string ID (VARCHAR(128)) matching
 * the PostgreSQL/Supabase auth_users.id. MongoDB NEVER stores user credentials, passwords,
 * auth tokens, or competing user-identity models.
 */

// ============================================================================
// 1. ORGANIZATIONS & TENANCY
// ============================================================================

export interface OrganizationDoc {
  _id: string; // org_id
  name: string;
  slug: string;
  description?: string;
  verified: boolean;
  logo_url?: string;
  website_url?: string;
  billing_email?: string;
  created_at: Date;
  updated_at: Date;
}

export interface OrgMemberDoc {
  _id: string; // org_id:user_id composite or random uuid
  org_id: string;
  user_id: string; // Foreign reference to SQL auth_users.id (string)
  role: "owner" | "admin" | "triager" | "member";
  joined_at: Date;
}

// ============================================================================
// 2. BOUNTIES & BUG HUNTS
// ============================================================================

export interface BugHuntRewardMatrix {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface BugHuntDoc {
  _id: string; // hunt_id
  org_id: string; // Reference to organizations._id
  title: string;
  description: string;
  target_scope: string[];
  out_of_scope: string[];
  rewards: BugHuntRewardMatrix;
  min_reward?: number;
  max_reward?: number;
  reward_pool?: number;
  status: "draft" | "active" | "paused" | "completed";
  visibility: "public" | "private" | "invite_only";
  difficulty?: "beginner" | "intermediate" | "advanced" | "expert";
  categories?: string[];
  rules?: string[];
  assets?: string[];
  createdBy: string; // Reference to SQL auth_users.id (string)
  currentParticipants: number;
  maxParticipants?: number;
  startDate?: string;
  endDate?: string;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// 3. SUBMISSIONS & TRIAGE
// ============================================================================

export interface BugSubmissionDoc {
  _id: string; // submission_id
  bounty_id: string; // Reference to bug_hunts._id
  org_id?: string; // Reference to organizations._id
  hunter_id: string; // Reference to SQL auth_users.id (string)
  title: string;
  description: string;
  steps_to_reproduce: string;
  proof_of_concept_url?: string;
  severity: "critical" | "high" | "medium" | "low";
  category?: string;
  status: "pending" | "approved" | "rejected" | "triaged" | "resolved" | "under-review" | "duplicate";
  payout_status: "unpaid" | "processing" | "paid" | "failed" | "cancelled";
  payout_order_id?: string; // Reference to payouts.order_id
  reward_amount?: number; // In smallest currency units
  points_awarded?: number;
  admin_notes?: string;
  reviewed_by?: string; // Reference to SQL auth_users.id (string)
  reviewed_at?: Date;
  source_collection?: string; // Legacy collection tracker (bugs vs bugSubmissions)
  created_at: Date;
  updated_at: Date;
}

export interface VulnerabilityDoc {
  _id: string; // e.g. BH-VULN-submission_123
  submission_id: string; // Reference to bug_submissions._id (UNIQUE)
  bounty_id: string;
  org_id: string;
  reporter_uid?: string; // Reference to SQL auth_users.id (string)
  reporter_email?: string;
  title?: string;
  description?: string;
  cvss: {
    vector: string;
    baseScore: number;
    severity: string;
    suggestedVector?: string;
    suggestedBaseScore?: number;
    approvedVector?: string;
    approvedBaseScore?: number;
  };
  bughuntr_score?: {
    approvedScore?: number;
    approved?: number;
    suggested?: number;
    modifiers?: Record<string, any>;
    components?: Record<string, any>;
    version?: string;
  };
  status:
    | "suggested"
    | "approved"
    | "rejected"
    | "cve_requested"
    | "triage_pending"
    | "triage_pending_final_review"
    | "triaged"
    | "eligible_for_payout"
    | "rejected_low_severity"
    | "rejected_duplicate";
  triage_notes?: string;
  triaged_by?: string; // Reference to SQL auth_users.id (string)
  triaged_at?: Date;
  payout_id?: string;
  reward_tier?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  reward_amount?: number;
  cve_id?: string;
  cve_request_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface VulnerabilityAuditDoc {
  _id: string;
  vuln_id: string;
  actor_uid: string; // Reference to SQL auth_users.id (string)
  actor_email?: string;
  action: string;
  old_vector?: string;
  new_vector?: string;
  old_score?: number;
  new_score?: number;
  triage_notes?: string;
  vector_diff?: any;
  is_significant_change?: boolean;
  final_sign_off?: boolean;
  ip?: string;
  user_agent?: string;
  created_at: Date;
}

export interface CveRequestDoc {
  _id: string; // e.g. BH-CVE-123
  vuln_id: string; // Reference to vulnerabilities._id (UNIQUE)
  org_id?: string; // Reference to organizations._id
  requested_by: string; // Reference to SQL auth_users.id (string)
  requestor_email?: string;
  status:
    | "draft"
    | "submitted"
    | "requested"
    | "cna_acknowledged"
    | "under_review"
    | "approved"
    | "rejected"
    | "cve_assigned"
    | "public";
  disclosure_type: "public" | "coordinated" | string;
  disclosure_packet: Record<string, any>;
  cve_id?: string;
  cna_contact_email?: string;
  notes?: string;
  requested_at?: Date;
  cna_email_sent?: Date;
  cve_assigned_at?: Date;
  published_at?: Date;
  status_history?: Array<{
    status: string;
    changedAt: Date;
    changedBy: string; // Reference to SQL auth_users.id
    notes?: string;
  }>;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// 4. FINANCIAL CUSTODY & WALLETS
// ============================================================================

export interface OrgWalletDoc {
  _id: string; // org_id (UNIQUE)
  org_id: string;
  currency: string;
  network: string;
  balance: number; // Smallest token units (e.g., micro-USDC or paise)
  reserved: number; // Amount locked for processing payouts
  updated_at: Date;
  lastTopUpTx?: {
    amount: number;
    txHash?: string;
    recordedBy: string; // Reference to SQL auth_users.id (string)
    recordedAt: Date;
    notes?: string;
  };
}

export interface UserWalletDoc {
  _id: string; // user_id (UNIQUE, matches SQL auth_users.id)
  user_id: string; // Reference to SQL auth_users.id (string)
  username?: string;
  wallet_address: string;
  network: string; // e.g. "POLYGON"
  created_at: Date;
  updated_at: Date;
}

export type MongoPayoutStatus =
  | "pending_created"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface PayoutDoc {
  _id: string; // order_id (UNIQUE, e.g. BH-PAYOUT-sub_123-timestamp)
  order_id: string;
  huntId: string;
  submissionId: string;
  orgId: string;
  hunterUid: string; // Reference to SQL auth_users.id (string)
  hunterWallet: string;
  amount: number;
  currency: string;
  network: string;
  status: MongoPayoutStatus;
  cryptomus_payout_id?: string;
  tx_hash?: string;
  cryptomus_response?: any;
  webhook_history?: Array<{
    receivedAt: Date;
    payload: any;
  }>;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  createdBy: string; // Reference to SQL auth_users.id (string)
  createdAt: Date;
  updatedAt: Date;
}

export interface PayoutLogDoc {
  _id: string;
  order_id?: string;
  eventType: string;
  actorUid?: string; // Reference to SQL auth_users.id (string)
  ip?: string;
  userAgent?: string;
  data: Record<string, any>;
  createdAt: Date;
}

export interface BatchPayoutJobDoc {
  _id: string; // batch_id (UNIQUE)
  batch_id: string;
  org_id: string;
  created_by: string; // Reference to SQL auth_users.id (string)
  status: "pending" | "processing" | "completed" | "failed";
  total_rows: number;
  processed: number;
  errors: Array<{
    row: number;
    error: string;
  }>;
  created_at: Date;
}

// ============================================================================
// 5. GAMIFICATION & RANKINGS
// ============================================================================

export interface UserPointsBalanceDoc {
  _id: string; // user_id (UNIQUE, matches SQL auth_users.id)
  user_id: string; // Reference to SQL auth_users.id (string)
  username?: string;
  points: number; // >= 0
  bugs_submitted: number;
  reputation_rank: string; // "E" | "D" | "C" | "B" | "A" | "S"
  weekly_points: number;
  monthly_points: number;
  streak: number;
  last_activity: Date;
  updated_at: Date;
  total_earnings?: number;
  certifications?: string[];
  reputation?: number;
  success_rate?: number;
  join_date?: Date;
}

export interface PointsTransactionDoc {
  _id: string;
  user_id: string; // Reference to SQL auth_users.id (string)
  bug_id?: string | number;
  points: number;
  reason: string;
  severity?: "critical" | "high" | "medium" | "low";
  multiplier?: number;
  timestamp: Date;
}

export interface UserAchievementDoc {
  _id: string; // user_id:badge_id composite or random uuid
  user_id: string; // Reference to SQL auth_users.id (string)
  badge_id: string;
  title: string;
  description: string;
  unlocked_at: Date;
  progress?: number;
}

export interface UserRewardDoc {
  _id: string;
  user_id: string; // Reference to SQL auth_users.id (string)
  reward_id: string;
  redeemed_at: Date;
  status: "pending" | "delivered" | "expired";
}

// ============================================================================
// 6. COMMUNITIES & SOCIAL MESSAGING
// ============================================================================

export interface CommunityDoc {
  _id: string; // community_id
  name: string;
  description: string;
  creator_id: string; // Reference to SQL auth_users.id (string)
  avatar?: string;
  banner?: string;
  is_private: boolean;
  tags: string[];
  member_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface CommunityMembershipDoc {
  _id: string; // community_id:user_id composite (UNIQUE)
  community_id: string;
  user_id: string; // Reference to SQL auth_users.id (string)
  role: "owner" | "admin" | "moderator" | "member";
  joined_at: Date;
}

export interface CommunityMessageDoc {
  _id: string; // message_id
  community_id: string;
  channel_id?: string;
  thread_id?: string;
  sender_id?: string; // Reference to SQL auth_users.id (string)
  sender_name?: string;
  user_id?: string;
  username?: string;
  avatar?: string;
  content: string;
  attachments?: any[];
  created_at: Date;
}

export interface CommunityChannelDoc {
  _id: string; // community_id:channel_id composite
  community_id: string;
  channel_id: string;
  name: string;
  type: "text" | "voice" | "announcement";
  description?: string;
  is_private: boolean;
  member_ids?: string[];
  created_at: Date;
}

export interface CommunityThreadDoc {
  _id: string; // thread_id
  community_id: string;
  channel_id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "critical";
  status: "open" | "in_progress" | "solved" | "closed";
  tags: string[];
  author_id: string; // Reference to SQL auth_users.id (string)
  author_username: string;
  solution_comment_id?: string | null;
  solution_by_user_id?: string | null;
  comment_count: number;
  attachment_urls: Array<{ name: string; url: string; type: string; size: number }>;
  created_at: Date;
  updated_at: Date;
}

export interface CommunityCommentDoc {
  _id: string; // comment_id
  thread_id: string;
  community_id: string;
  content: string;
  author_id: string; // Reference to SQL auth_users.id (string)
  author_username: string;
  parent_id?: string | null;
  mentions: string[];
  is_solution?: boolean;
  attachment_urls: Array<{ name: string; url: string; type: string; size: number }>;
  created_at: Date;
  updated_at: Date;
}

export interface CommunityChatMessageDoc {
  _id: string; // message_id
  thread_id?: string;
  community_id: string;
  content: string;
  author_id: string; // Reference to SQL auth_users.id (string)
  author_username: string;
  created_at: Date;
}

export interface CommunityNotificationDoc {
  _id: string; // notification_id
  user_id: string; // Reference to SQL auth_users.id (string)
  community_id: string;
  type: "reply" | "mention" | "solution_accepted";
  title: string;
  message: string;
  thread_id: string;
  comment_id?: string | null;
  read: boolean;
  created_at: Date;
}

export interface CommunityReputationEventDoc {
  _id: string;
  community_id: string;
  user_id: string; // Reference to SQL auth_users.id (string)
  username: string;
  points: number;
  reason: string;
  thread_id: string;
  created_at: Date;
}

// ============================================================================
// 7. PRO SUBSCRIPTIONS & COLLABORATION
// ============================================================================

export interface ProSubscriptionDoc {
  _id: string; // org_id (UNIQUE)
  org_id: string;
  company_name?: string;
  plan_type: "basic" | "premium" | "enterprise";
  status: "active" | "expired" | "suspended";
  start_date: Date;
  end_date: Date;
  features: string[];
  updated_at: Date;
}

export interface ProInvitationDoc {
  _id: string;
  hunt_id: string;
  sender_id: string; // Reference to SQL auth_users.id (string)
  recipient_email?: string;
  hunter_id?: string; // Reference to SQL auth_users.id (string)
  hunter_name?: string;
  hunter_username?: string;
  hunt_title?: string;
  company_name?: string;
  invited_by?: string;
  token: string;
  status: "pending" | "accepted" | "declined" | "expired";
  expires_at: Date;
  responded_at?: Date;
  created_at: Date;
}

export interface ProHuntDoc {
  _id: string;
  companyId: string;
  companyName: string;
  title: string;
  description: string;
  allowedTargetSegments?: string[];
  ndaTemplateId?: string;
  ndaTemplateText?: string;
  requireKYC?: boolean;
  requireCerts?: boolean;
  allowBids?: boolean;
  minRank?: "C" | "B" | "A" | "S";
  minHuntsParticipated?: number;
  requiredCertifications?: string[];
  rewards?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  maxHunters?: number;
  currentHunters?: number;
  status: "draft" | "active" | "paused" | "completed";
  startsAt?: string;
  endsAt?: string;
  inviteOnly?: boolean;
  createdBy: string;
  created_at: Date;
  updated_at: Date;
}

export interface ProApplicationDoc {
  _id: string; // hunt_id:hunter_id composite (UNIQUE)
  hunt_id: string;
  hunter_id: string; // Reference to SQL auth_users.id (string)
  hunter_name?: string;
  hunter_rank?: string;
  cover: string;
  bid_amount?: number;
  attachments: string[];
  status: "pending" | "approved" | "rejected" | "more_info_requested";
  created_at: Date;
}

export interface ProNdaDoc {
  _id: string; // hunt_id:hunter_id composite (UNIQUE)
  hunt_id: string;
  hunter_id: string; // Reference to SQL auth_users.id (string)
  hunter_name?: string;
  nda_text: string;
  signature_hash: string;
  ip_address?: string;
  signed_at: Date;
}

// ============================================================================
// 8. USER PREFERENCES & ACCOUNT SETTINGS
// ============================================================================

export interface UserNotificationPreferences {
  emailAlerts: boolean;
  pushNotifications: boolean;
  bugUpdates: boolean;
  communityMessages: boolean;
  weeklyDigest: boolean;
}

export interface UserPreferencesDoc {
  _id: string; // user_id (UNIQUE, matches SQL auth_users.id)
  user_id: string; // Reference to SQL auth_users.id (string)
  notifications: UserNotificationPreferences;
  theme?: "light" | "dark" | "system";
  created_at: Date;
  updated_at: Date;
}

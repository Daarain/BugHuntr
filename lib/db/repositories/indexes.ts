/**
 * MongoDB Index Provisioning
 *
 * Idempotently establishes required unique, compound, and query performance indexes
 * across all non-identity application collections in MongoDB.
 */

import type { Db } from "mongodb";

export async function ensureMongoIndexes(db: Db): Promise<{ success: boolean; indexesCreated: Record<string, string[]> }> {
  const result: Record<string, string[]> = {};

  // 1. organizations
  result.organizations = await db.collection("organizations").createIndexes([
    { key: { slug: 1 }, unique: true, name: "uq_organizations_slug" },
    { key: { created_at: -1 }, name: "idx_organizations_created_at" },
  ]);

  // 2. org_members
  result.org_members = await db.collection("org_members").createIndexes([
    { key: { org_id: 1, user_id: 1 }, unique: true, name: "uq_org_members_org_user" },
    { key: { user_id: 1 }, name: "idx_org_members_user_id" },
  ]);

  // 3. bug_hunts
  result.bug_hunts = await db.collection("bug_hunts").createIndexes([
    { key: { org_id: 1, status: 1 }, name: "idx_bug_hunts_org_status" },
    { key: { visibility: 1, status: 1 }, name: "idx_bug_hunts_visibility_status" },
    { key: { createdBy: 1 }, name: "idx_bug_hunts_created_by" },
  ]);

  // 4. bug_submissions
  result.bug_submissions = await db.collection("bug_submissions").createIndexes([
    { key: { bounty_id: 1 }, name: "idx_submissions_bounty" },
    { key: { hunter_id: 1, status: 1 }, name: "idx_submissions_hunter_status" },
    { key: { org_id: 1, status: 1 }, name: "idx_submissions_org_status" },
    { key: { payout_order_id: 1 }, name: "idx_submissions_payout_order" },
  ]);

  // 5. vulnerabilities
  result.vulnerabilities = await db.collection("vulnerabilities").createIndexes([
    { key: { submission_id: 1 }, unique: true, name: "uq_vulnerabilities_submission" },
    { key: { org_id: 1, status: 1 }, name: "idx_vulnerabilities_org_status" },
    { key: { cve_id: 1 }, sparse: true, name: "idx_vulnerabilities_cve" },
  ]);

  // 6. vulnerabilities_audit
  result.vulnerabilities_audit = await db.collection("vulnerabilities_audit").createIndexes([
    { key: { vuln_id: 1, created_at: -1 }, name: "idx_vuln_audit_vuln_created" },
    { key: { actor_uid: 1 }, name: "idx_vuln_audit_actor" },
  ]);

  // 7. cve_requests
  result.cve_requests = await db.collection("cve_requests").createIndexes([
    { key: { vuln_id: 1 }, unique: true, name: "uq_cve_requests_vuln" },
    { key: { requested_by: 1 }, name: "idx_cve_requests_requester" },
    { key: { status: 1 }, name: "idx_cve_requests_status" },
  ]);

  // 8. org_wallets
  result.org_wallets = await db.collection("org_wallets").createIndexes([
    { key: { org_id: 1 }, unique: true, name: "uq_org_wallets_org_id" },
  ]);

  // 9. payouts
  result.payouts = await db.collection("payouts").createIndexes([
    { key: { order_id: 1 }, unique: true, name: "uq_payouts_order_id" },
    { key: { submissionId: 1 }, name: "idx_payouts_submission" },
    { key: { hunterUid: 1, status: 1 }, name: "idx_payouts_hunter_status" },
    { key: { orgId: 1, status: 1 }, name: "idx_payouts_org_status" },
    { key: { status: 1, createdAt: -1 }, name: "idx_payouts_status_created" },
  ]);

  // 10. payout_logs
  result.payout_logs = await db.collection("payout_logs").createIndexes([
    { key: { order_id: 1 }, name: "idx_payout_logs_order" },
    { key: { actorUid: 1 }, name: "idx_payout_logs_actor" },
    { key: { createdAt: -1 }, name: "idx_payout_logs_created" },
  ]);

  // 11. batch_payout_jobs
  result.batch_payout_jobs = await db.collection("batch_payout_jobs").createIndexes([
    { key: { batch_id: 1 }, unique: true, name: "uq_batch_payout_batch_id" },
    { key: { org_id: 1 }, name: "idx_batch_payout_org" },
  ]);

  // 12. user_points_balances
  result.user_points_balances = await db.collection("user_points_balances").createIndexes([
    { key: { user_id: 1 }, unique: true, name: "uq_points_balances_user_id" },
    { key: { points: -1 }, name: "idx_points_balances_leaderboard" },
    { key: { username: 1 }, sparse: true, name: "idx_points_balances_username" },
  ]);

  // 13. points_transactions
  result.points_transactions = await db.collection("points_transactions").createIndexes([
    { key: { user_id: 1, timestamp: -1 }, name: "idx_points_tx_user_time" },
  ]);

  // 14. user_achievements
  result.user_achievements = await db.collection("user_achievements").createIndexes([
    { key: { user_id: 1, badge_id: 1 }, unique: true, name: "uq_user_achievements" },
  ]);

  // 15. user_rewards
  result.user_rewards = await db.collection("user_rewards").createIndexes([
    { key: { user_id: 1, redeemed_at: -1 }, name: "idx_user_rewards_user" },
  ]);

  // 16. communities
  result.communities = await db.collection("communities").createIndexes([
    { key: { name: 1 }, name: "idx_communities_name" },
    { key: { creator_id: 1 }, name: "idx_communities_creator" },
  ]);

  // 17. community_memberships
  result.community_memberships = await db.collection("community_memberships").createIndexes([
    { key: { community_id: 1, user_id: 1 }, unique: true, name: "uq_community_members" },
    { key: { user_id: 1 }, name: "idx_community_members_user" },
  ]);

  // 18. community_messages
  result.community_messages = await db.collection("community_messages").createIndexes([
    { key: { community_id: 1, channel_id: 1, created_at: -1 }, name: "idx_messages_comm_channel_created" },
    { key: { thread_id: 1, created_at: 1 }, sparse: true, name: "idx_messages_thread_created" },
  ]);

  // 19. pro_subscriptions
  result.pro_subscriptions = await db.collection("pro_subscriptions").createIndexes([
    { key: { org_id: 1 }, unique: true, name: "uq_pro_subscriptions_org" },
  ]);

  // 20. pro_hunts
  result.pro_hunts = await db.collection("pro_hunts").createIndexes([
    { key: { companyId: 1, status: 1 }, name: "idx_pro_hunts_company_status" },
    { key: { createdBy: 1 }, name: "idx_pro_hunts_created_by" },
  ]);

  // 21. pro_invitations
  result.pro_invitations = await db.collection("pro_invitations").createIndexes([
    { key: { token: 1 }, unique: true, name: "uq_pro_invitations_token" },
    { key: { hunt_id: 1, hunter_id: 1 }, name: "idx_pro_invitations_hunt_hunter" },
    { key: { hunter_id: 1, status: 1 }, name: "idx_pro_invitations_hunter_status" },
    { key: { hunter_username: 1, status: 1 }, name: "idx_pro_invitations_username_status" },
  ]);

  // 21. pro_applications
  result.pro_applications = await db.collection("pro_applications").createIndexes([
    { key: { hunt_id: 1, hunter_id: 1 }, unique: true, name: "uq_pro_applications_hunt_hunter" },
  ]);

  // 22. pro_ndas
  result.pro_ndas = await db.collection("pro_ndas").createIndexes([
    { key: { hunt_id: 1, hunter_id: 1 }, unique: true, name: "uq_pro_ndas_hunt_hunter" },
  ]);

  // 23. user_preferences
  result.user_preferences = await db.collection("user_preferences").createIndexes([
    { key: { user_id: 1 }, unique: true, name: "uq_user_preferences_user_id" },
  ]);

  return { success: true, indexesCreated: result };
}

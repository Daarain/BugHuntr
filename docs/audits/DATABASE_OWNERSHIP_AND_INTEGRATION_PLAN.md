# BugHuntr — Database Ownership and Integration Plan
## Dual-Database Architecture: SQL (Supabase PostgreSQL) & MongoDB

**Document**: `docs/audits/DATABASE_OWNERSHIP_AND_INTEGRATION_PLAN.md`  
**Date**: October 2026  
**Status**: Authoritative Architectural Plan & Integration Specification  
**Assessment Type**: Read-Only Architectural Mapping & Boundary Analysis  
**Scope Preservation**: Zero application code modified, zero database schemas executed, zero production connections established  

---

## 1. Executive Summary

### 1.1 Confirmed Architectural Boundary
Following the database audit and architecture review, the BugHuntr engineering steering group finalized and confirmed the definitive **database ownership boundary**:

1. **SQL (Supabase PostgreSQL) — Restricted to Core Identity & Authentication Security**:
   SQL is strictly limited to low-volume, highly structured, user-related identity, account, and authentication-security data:
   - User accounts and login credentials (`auth_users`)
   - Basic user profiles (`user_profiles`: username, display name, avatar, bio, country, contact metadata — excluding application-domain gamification state)
   - User roles and platform permissions (`user_roles`: hunter, company, admin, triager)
   - Two-factor authentication credentials and session secrets (`user_credentials`)
   - Authentication and account-security audit event records (`auth_audit_log`)

2. **MongoDB — Authoritative for ALL BugHuntr Application Domain Data**:
   MongoDB owns all non-identity application entities across the platform:
   - Organizations, enterprise profiles, and organization memberships (`organizations`, `org_members`)
   - Bug bounty programs, hunt catalogs, and scope configurations (`bug_hunts`)
   - Bug reports, findings, triage lifecycles, and submission attachments (`bug_submissions`)
   - Triaged vulnerabilities, CVSS vectors, and BugHuntr algorithmic scoring metadata (`vulnerabilities`, `vulnerabilities_audit`)
   - Coordinated vulnerability disclosure packets and CNA tracking (`cve_requests`)
   - Wallets, custody balances, payment records, payouts, payout logs, billing, and subscriptions (`org_wallets`, `payouts`, `payout_logs`, `batch_payout_jobs`, `payout_queue`, `pro_subscriptions`)
   - Gamification points balances, activity event streams, rewards, and achievements (`user_points_balances`, `points_transactions`, `user_achievements`, `user_rewards`)
   - Communities, memberships, channels, real-time messages, and discussion threads (`communities`, `community_memberships`, `community_messages`)
   - All other application-domain collaboration records (`pro_invitations`, `pro_applications`, `pro_ndas`)

> [!IMPORTANT]
> **Confirmed Architecture Rule**:
> SQL is strictly restricted to user identity, accounts, roles, credentials, and authentication security logs. MongoDB is the authoritative persistence engine for **all** other application domain data, including all financial custody, wallets, payouts, and gamification balances. This allocation is confirmed architecture.

---

## 2. SQL Ownership Map (Supabase PostgreSQL)

### 2.1 Scope of SQL Responsibility
The SQL database is strictly scoped to authentication, account credentials, and platform security access control. No application-domain entities (organizations, bounties, submissions, wallets, payouts, or points) reside in SQL.

### 2.2 Table Inventory and Schema Definitions

| SQL Table Name | Source Migration File | Entity Classification | Primary Key | Key Columns & Constraints | Relationship to MongoDB |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`auth_users`** | `001_accounts_auth_schema.sql` | Core Identity | `id VARCHAR(128)` | `email` (UNIQUE, regex check), `password_hash`, `email_verified`, `is_active`, `is_banned`, `legacy_firestore_id`, `created_at`, `updated_at` | Referenced logically by MongoDB documents (`hunter_id`, `user_id`, `creator_id`, `actor_id`) |
| **`user_roles`** | `001_accounts_auth_schema.sql` | Access Control | `id VARCHAR(128)` | `user_id` (FK `auth_users.id` ON DELETE CASCADE), `role` (`hunter`, `company`, `admin`, `triager`), `assigned_by`, `assigned_at`, CONSTRAINT `uq_user_roles_user_role` UNIQUE(`user_id`, `role`) | Evaluated by server gateway to authorize MongoDB read/write operations |
| **`user_profiles`** | `001_accounts_auth_schema.sql` | Basic Account Profile | `user_id VARCHAR(128)` | PK/FK `auth_users.id` (ON DELETE CASCADE), `username` (UNIQUE, regex format check), `display_name`, `avatar_url`, `bio`, `country`, `company_name`, `created_at`, `updated_at` | Stores basic profile metadata only. Application points and gamification state reside in MongoDB. |
| **`user_credentials`** | `001_accounts_auth_schema.sql` | 2FA / Session Secrets | `id VARCHAR(128)` | `user_id` (FK `auth_users.id` ON DELETE CASCADE), `credential_type` (`password`, `totp`, `email_otp`, `api_key`), `secret_hash`, `is_enabled`, `last_verified_at`, UNIQUE(`user_id`, `credential_type`) | Isolated credential store. Never accessed by application clients directly. |
| **`auth_audit_log`** | `001_accounts_auth_schema.sql` | Auth Security Trail | `id BIGSERIAL` | `user_id` (FK `auth_users.id` ON DELETE SET NULL), `event_type`, `ip_address`, `user_agent`, `metadata` JSONB, `created_at` | Append-only security audit log for logins, 2FA verifications, and role mutations. |

### 2.3 SQL Security & Invariant Rules
1. **Identifier Strategy**: `VARCHAR(128)` primary keys accommodate UUIDs, legacy Firestore IDs, and external auth tokens without typecasting errors.
2. **Row-Level Security (RLS)**: Enforced via `migrations/003_supabase_rls_policies.sql` exclusively for `auth_users`, `user_roles`, `user_profiles`, `user_credentials`, and `auth_audit_log`.
3. **Application Decoupling**: All application tables originally drafted in `migrations/002_bug_bounty_domain_supabase_schema.sql` (including `organizations`, `bounties`, `bug_submissions`, `vulnerabilities`, `org_wallets`, and `payouts`) are **excluded** from the SQL database deployment.

---

## 3. MongoDB Ownership Map (Application Data)

### 3.1 Scope of MongoDB Responsibility
MongoDB is the authoritative persistence engine for all BugHuntr application workflows, domain records, financial ledgers, and social feeds:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                   MONGODB                                       │
│ ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────┐ │
│ │  Organizations & Bounties│ │   Reports & Triaging    │ │  Financial Custody  │ │
│ │ ----------------------- │ │ ----------------------- │ │ ------------------- │ │
│ │ • organizations         │ │ • bug_submissions       │ │ • org_wallets       │ │
│ │ • org_members           │ │ • vulnerabilities       │ │ • payouts           │ │
│ │ • bug_hunts             │ │ • vulnerabilities_audit │ │ • payout_logs       │ │
│ │ • pro_subscriptions     │ │ • cve_requests          │ │ • batch_payout_jobs │ │
│ └─────────────────────────┘ └─────────────────────────┘ └─────────────────────┘ │
│ ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────┐ │
│ │  Pro & Collaboration    │ │  Gamification & Ranking │ │  Social & Messaging │ │
│ │ ----------------------- │ │ ----------------------- │ │ ------------------- │ │
│ │ • pro_invitations       │ │ • user_points_balances  │ │ • communities       │ │
│ │ • pro_applications      │ │ • points_transactions   │ │ • community_members │ │
│ │ • pro_ndas              │ │ • user_achievements     │ │ • community_messages│ │
│ └─────────────────────────┘ └─────────────────────────┘ └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Collection Definitions and Target Schemas

| Collection Name | Domain Subsystem | Document Schema Highlights | Key Target Indexes | Cross-Database Logical Reference |
| :--- | :--- | :--- | :--- | :--- |
| **`organizations`** | Tenancy Root | `_id`, `name`, `slug`, `description`, `verified`, `logo_url`, `website_url`, `billing_email`, `created_at`, `updated_at` | `{ slug: 1 }` (UNIQUE) | Referenced by `hunter_id`, `org_id` |
| **`org_members`** | Tenancy RBAC | `_id`, `org_id`, `user_id`, `role` (`owner`, `admin`, `triager`, `member`), `joined_at` | `{ org_id: 1, user_id: 1 }` (UNIQUE), `{ user_id: 1 }` | `user_id` $\rightarrow$ SQL `auth_users.id` |
| **`org_wallets`** | Financial Custody | `_id` (= `org_id`), `org_id`, `balance` (Numeric), `reserved` (Numeric), `currency`, `network`, `updated_at` | `{ org_id: 1 }` (UNIQUE) | `org_id` $\rightarrow$ Mongo `organizations._id` |
| **`payouts`** | Financial Ledger | `_id`, `order_id`, `submission_id`, `hunt_id`, `org_id`, `hunter_uid`, `amount`, `currency`, `network`, `recipient_wallet`, `status`, `tx_hash`, `cryptomus_id`, `created_at`, `updated_at` | `{ order_id: 1 }` (UNIQUE), `{ submission_id: 1 }`, `{ hunter_uid: 1 }`, `{ status: 1 }` | `hunter_uid` $\rightarrow$ SQL `auth_users.id`<br>`org_id` $\rightarrow$ Mongo `organizations._id` |
| **`payout_logs`** | Financial Audit | `_id`, `order_id`, `actor_id`, `event_type`, `payload` (Object), `created_at` | `{ order_id: 1 }`, `{ created_at: -1 }` | `actor_id` $\rightarrow$ SQL `auth_users.id` |
| **`batch_payout_jobs`** | Payment Queue | `_id`, `batch_id`, `org_id`, `created_by`, `status`, `total_rows`, `processed`, `errors` (Array), `created_at` | `{ batch_id: 1 }` (UNIQUE), `{ org_id: 1 }` | `created_by` $\rightarrow$ SQL `auth_users.id` |
| **`bug_hunts`** | Bounties / Programs | `_id`, `org_id`, `title`, `description`, `target_scope` (Array), `out_of_scope` (Array), `rewards` (Object), `min_reward`, `max_reward`, `reward_pool`, `status`, `visibility`, `timestamps` | `{ org_id: 1, status: 1 }`, `{ visibility: 1, status: 1 }` | `org_id` $\rightarrow$ Mongo `organizations._id` |
| **`bug_submissions`** | Reports & Findings | `_id`, `bounty_id`, `org_id`, `hunter_id`, `title`, `description`, `steps_to_reproduce`, `proof_of_concept_url`, `severity`, `status`, `payout_status`, `payout_order_id`, `reward_amount`, `source_collection`, `timestamps` | `{ bounty_id: 1 }`, `{ hunter_id: 1 }`, `{ org_id: 1, status: 1 }`, `{ payout_order_id: 1 }` | `hunter_id` $\rightarrow$ SQL `auth_users.id`<br>`org_id` $\rightarrow$ Mongo `organizations._id` |
| **`vulnerabilities`** | Triaged CVSS Findings | `_id` (e.g., `BH-VULN-...`), `submission_id`, `bounty_id`, `org_id`, `cvss` (Vector, BaseScore, Severity), `bughuntr_score` (Approved, Modifiers), `status`, `triage_notes`, `triaged_by`, `cve_id`, `cve_request_id`, `timestamps` | `{ submission_id: 1 }` (UNIQUE), `{ org_id: 1, status: 1 }`, `{ cve_id: 1 }` | `triaged_by` $\rightarrow$ SQL `auth_users.id` |
| **`vulnerabilities_audit`** | Triage Review Log | `_id`, `vuln_id`, `actor_uid`, `action`, `old_vector`, `new_vector`, `old_score`, `new_score`, `triage_notes`, `vector_diff` (Array), `ip`, `user_agent`, `created_at` | `{ vuln_id: 1, created_at: -1 }`, `{ actor_uid: 1 }` | `actor_uid` $\rightarrow$ SQL `auth_users.id` |
| **`cve_requests`** | Coordinated Disclosure | `_id` (e.g., `BH-CVE-...`), `vuln_id`, `requested_by`, `status`, `disclosure_type`, `disclosure_packet` (Object), `cve_id`, `cna_contact_email`, `status_history` (Array), `timestamps` | `{ vuln_id: 1 }` (UNIQUE), `{ requested_by: 1 }`, `{ status: 1 }` | `requested_by` $\rightarrow$ SQL `auth_users.id` |
| **`user_points_balances`**| Gamification State | `_id` (= `user_id`), `user_id`, `points` (Integer `>= 0`), `bugs_submitted`, `reputation_rank`, `weekly_points`, `monthly_points`, `streak`, `last_activity`, `updated_at` | `{ user_id: 1 }` (UNIQUE), `{ points: -1 }` (Leaderboard index) | `user_id` $\rightarrow$ SQL `auth_users.id` |
| **`points_transactions`** | Gamification Stream | `_id`, `user_id`, `bug_id`, `points`, `reason`, `severity`, `multiplier`, `timestamp` | `{ user_id: 1, timestamp: -1 }` | `user_id` $\rightarrow$ SQL `auth_users.id` |
| **`user_achievements`** | Badges & Rewards | `_id`, `user_id`, `badge_id`, `title`, `description`, `unlocked_at` | `{ user_id: 1, badge_id: 1 }` (UNIQUE) | `user_id` $\rightarrow$ SQL `auth_users.id` |
| **`pro_invitations`** | Private Bounties | `_id`, `hunt_id`, `sender_id`, `recipient_email`, `hunter_id`, `token`, `status`, `expires_at`, `timestamps` | `{ hunt_id: 1, recipient_email: 1 }`, `{ token: 1 }` | `sender_id`, `hunter_id` $\rightarrow$ SQL `auth_users.id` |
| **`pro_applications`** | Private Bounty Bids | `_id`, `hunt_id`, `hunter_id`, `hunter_rank`, `cover`, `bid_amount`, `attachments` (Array), `status`, `timestamps` | `{ hunt_id: 1, hunter_id: 1 }` (UNIQUE) | `hunter_id` $\rightarrow$ SQL `auth_users.id` |
| **`pro_ndas`** | Legal Agreements | `_id`, `hunt_id`, `hunter_id`, `signature`, `ip_address`, `signed_at` | `{ hunt_id: 1, hunter_id: 1 }` (UNIQUE) | `hunter_id` $\rightarrow$ SQL `auth_users.id` |
| **`pro_subscriptions`** | Enterprise Billing | `_id`, `org_id`, `plan_type` (`basic`, `premium`, `enterprise`), `status`, `start_date`, `end_date`, `features` (Array), `updated_at` | `{ org_id: 1 }` (UNIQUE) | `org_id` $\rightarrow$ Mongo `organizations._id` |
| **`communities`** | Collaboration Spaces | `_id`, `name`, `description`, `creator_id`, `is_private`, `tags` (Array), `member_count`, `timestamps` | `{ name: 1 }`, `{ creator_id: 1 }` | `creator_id` $\rightarrow$ SQL `auth_users.id` |
| **`community_memberships`**| Social Membership | `_id`, `community_id`, `user_id`, `role` (`owner`, `admin`, `moderator`, `member`), `joined_at` | `{ community_id: 1, user_id: 1 }` (UNIQUE), `{ user_id: 1 }` | `user_id` $\rightarrow$ SQL `auth_users.id` |
| **`community_messages`** | Chat & Discussion | `_id`, `community_id`, `channel_id`, `thread_id`, `sender_id`, `sender_name`, `content`, `attachments` (Array), `created_at` | `{ community_id: 1, created_at: -1 }`, `{ thread_id: 1, created_at: 1 }` | `sender_id` $\rightarrow$ SQL `auth_users.id` |

---

## 4. Existing-to-Target Entity Mapping Matrix

| Existing Data Entity | Current Implementation Location | Target Database | Target Entity / Collection | Rationale & Data Boundary Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **`users` (Identity)** | Firestore `users`; `app/api/auth/*` | **SQL** | `auth_users` | Core user identity, email, bcrypt hash, account status flags. |
| **`users.role` / `userType`** | Embedded in Firestore `users` | **SQL** | `user_roles` | Authoritative platform authorization roles (`hunter`, `company`, `admin`, `triager`). |
| **`userProfiles` (Basic)** | Firestore `userProfiles`; `lib/user-profile.ts` | **SQL** | `user_profiles` | Basic identity/profile details (username, name, avatar, bio, country). |
| **`users.credentials`** | Firestore `users.credentials`; `lib/auth-2fa.ts` | **SQL** | `user_credentials` | 2FA/TOTP/email OTP secrets and verification attempts. |
| **`auth_audit_log`** | `migrations/001_accounts_auth_schema.sql` | **SQL** | `auth_audit_log` | Immutable security log for logins, privilege grants, and credential updates. |
| **`orgs` / Companies** | Firestore `orgs`, `users.companyName` | **MongoDB** | `organizations` | Multi-tenant organization profile and application entity. |
| **Org Memberships** | Implicit or embedded in legacy docs | **MongoDB** | `org_members` | Multi-tenant membership linking users (`auth_users.id`) to organizations. |
| **`org_wallets`** | Firestore `org_wallets`; `functions/src/utils/firestore.ts` | **MongoDB** | `org_wallets` | Application financial custody ledger. Enforces balance reserves and deductions. |
| **`payouts`** | Firestore `payouts`; `types/payout.ts` | **MongoDB** | `payouts` | Payment order records, blockchain hashes, and Cryptomus statuses. |
| **`payout_logs`** | Firestore `payout_logs`; `functions/src/utils/firestore.ts` | **MongoDB** | `payout_logs` | Append-only financial reconciliation trail for audit and compliance. |
| **`batch_payout_jobs`** | Firestore `batch_payout_jobs`; `createBatchPayouts.ts` | **MongoDB** | `batch_payout_jobs` | Queue and job processing state for bulk payouts. |
| **`proSubscriptions`** | `types/pro.ts`; `hooks/use-pro-subscription.ts` | **MongoDB** | `pro_subscriptions` | Commercial tier subscription state and billing dates. |
| **`bug_hunts` (All)** | Firestore `bug_hunts`, `bugHunts`, `proBugHunts` | **MongoDB** | `bug_hunts` | Program catalog, polymorphic JSON scopes, and reward matrices. |
| **`bug_submissions` (All)**| Firestore `bug_submissions`, `bugs`, `bugSubmissions`, `submissions` | **MongoDB** | `bug_submissions` | High-volume submission payloads, markdown steps, and triage lifecycles. |
| **`vulnerabilities`** | Firestore `vulnerabilities`; `hooks/use-vulnerability.ts` | **MongoDB** | `vulnerabilities` | Triaged findings, CVSS 3.1 vectors, and BugHuntr scoring factors. |
| **`vulnerabilities/audit`** | Firestore subcollection `vulnerabilities/{id}/audit` | **MongoDB** | `vulnerabilities_audit` | Append-only triage audit trail documenting vector scoring adjustments. |
| **`cve_requests`** | Firestore `cve_requests`; `requestCve.ts` | **MongoDB** | `cve_requests` | Coordinated disclosure packets, CNA tracking, and timeline history. |
| **`proInvitations`** | Firestore `proInvitations`; `hooks/use-pro-hunts.ts` | **MongoDB** | `pro_invitations` | Application collaboration data linking hunters to private bug hunts. |
| **`proApplications` / `NDAs`**| `types/pro.ts`; `hooks/use-pro-applications.ts` | **MongoDB** | `pro_applications`, `pro_ndas` | Private bounty proposals and signed legal agreements. |
| **`userProfiles.points`** | Firestore `userProfiles.points`; `update-user-stats.ts` | **MongoDB** | `user_points_balances` | Application gamification balance, bug counters, streaks, and ranks. |
| **`pointsTransactions`** | Firestore `pointsTransactions`; `hooks/use-ranking.ts` | **MongoDB** | `points_transactions` | Append-only gamification activity event stream. |
| **`userAchievements` / `Rewards`**| Firestore `userAchievements`, `userRewards` | **MongoDB** | `user_achievements` | Badges, achievements, and unlock histories. |
| **`communities`** | Firestore `communities`; `hooks/use-community.tsx` | **MongoDB** | `communities`, `community_memberships` | High-volume social collaboration spaces and discussion groups. |
| **`community_messages` (All)**| Firestore `messages`, `channels`, `threads` | **MongoDB** | `community_messages` | High-frequency write workload. Keyset-paginated message documents. |

---

## 5. Cross-Database Dependencies & Architectural Integration

### 5.1 The Cross-Database Architectural Boundary
Under this confirmed architecture, the boundary between SQL and MongoDB is strictly clean:
- **SQL contains ONLY core identity, authentication credentials, and platform security roles**.
- **MongoDB contains ALL application domain entities, financial ledgers, and collaborative content**.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                APPLICATION GATEWAY                                     │
│                        (Next.js Server Actions / API Routes)                           │
└──────────────────┬──────────────────────────────────────────────────┬──────────────────┘
                   │                                                  │
                   ▼                                                  ▼
┌──────────────────────────────────────┐           ┌──────────────────────────────────────┐
│        Supabase PostgreSQL           │           │               MongoDB                │
│ ──────────────────────────────────── │           │ ──────────────────────────────────── │
│ • auth_users (Core Identity)         │◄───┐      │ • organizations & org_members        │
│ • user_roles (Access Control)        │    │      │ • bug_hunts (Programs)               │
│ • user_profiles (Basic Info)         │    │      │ • bug_submissions (Findings)         │
│ • user_credentials (2FA Secrets)     │    │      │ • vulnerabilities & cve_requests     │
│ • auth_audit_log (Security Trail)    │    │      │ • org_wallets (Custody Ledger)       │
│                                      │    │      │ • payouts & payout_logs              │
│                                      │    │      │ • user_points_balances & streaks     │
│                                      │    │      │ • points_transactions (History)      │
│                                      │    │      │ • communities & community_messages   │
│                                      │    │      │                                      │
│                                      │    │      │ [All documents reference user ID     │
│                                      │    │      │  as a logical string VARCHAR(128)]   │
└──────────────────────────────────────┘    │      └──────────────────────────────────────┘
                                            │                                                 │
                                            └───────────────[ Logical User ID ]───────────────┘
```

### 5.2 Referencing SQL User IDs from MongoDB Documents
1. **Format**: Every reference to a user in a MongoDB document (e.g., `bug_submissions.hunter_id`, `payouts.hunter_uid`, `org_members.user_id`, `community_messages.sender_id`) is stored as a standard **UTF-8 string (`VARCHAR(128)`)** directly matching `auth_users.id`.
2. **Preservation of Legacy IDs**: Legacy Firestore document IDs (e.g., `7xN0kP9zQ2a`) and standard UUIDs are stored as-is without binary BSON conversion.
3. **Application-Level Resolution**: When frontend views request submission details alongside hunter profiles, the Application Gateway loads the submission document from MongoDB and queries `user_profiles` in SQL by `user_id` using an in-memory batch lookup (`WHERE user_id = ANY($1)`), avoiding distributed database joins.

### 5.3 Financial Operations & Integrity in MongoDB
A critical architectural benefit of assigning `org_wallets`, `payouts`, `payout_logs`, and `bug_submissions` to MongoDB is that **all payment and submission documents reside within the same database engine**.

The repository's payment workflows ([`functions/src/functions/createPayout.ts`](file:///d:/Projects/BugHuntr/BugHuntr/functions/src/functions/createPayout.ts), [`createBatchPayouts.ts`](file:///d:/Projects/BugHuntr/BugHuntr/functions/src/functions/createBatchPayouts.ts), [`cryptomusWebhook.ts`](file:///d:/Projects/BugHuntr/BugHuntr/functions/src/functions/cryptomusWebhook.ts), [`reconcilePayouts.ts`](file:///d:/Projects/BugHuntr/BugHuntr/functions/src/functions/reconcilePayouts.ts), and [`lib/transfer-reward.ts`](file:///d:/Projects/BugHuntr/BugHuntr/lib/transfer-reward.ts)) rely heavily on atomic wallet deductions, status changes, and idempotency:

#### 1. Multi-Document ACID Transactions
In MongoDB deployments operating as a Replica Set, operations that mutate multiple documents together are executed within a native client transaction:
```javascript
const session = client.startSession();
try {
  await session.withTransaction(async () => {
    // 1. Verify wallet available balance and atomically increment 'reserved'
    const walletRes = await db.collection("org_wallets").updateOne(
      { org_id: orgId, $expr: { $gte: [{ $subtract: ["$balance", "$reserved"] }, amount] } },
      { $inc: { reserved: amount }, $set: { updated_at: new Date() } },
      { session }
    );
    if (walletRes.matchedCount === 0) throw new Error("INSUFFICIENT_FUNDS");

    // 2. Lock bug submission under transaction
    const subRes = await db.collection("bug_submissions").updateOne(
      { _id: submissionId, payout_status: "unpaid", status: { $in: ["approved", "triaged", "resolved"] } },
      { $set: { payout_status: "processing", payout_order_id: orderId, updated_at: new Date() } },
      { session }
    );
    if (subRes.matchedCount === 0) throw new Error("SUBMISSION_NOT_ELIGIBLE_OR_ALREADY_PROCESSING");

    // 3. Insert payout record
    await db.collection("payouts").insertOne({
      order_id: orderId,
      submission_id: submissionId,
      org_id: orgId,
      hunter_uid: hunterUid,
      amount,
      status: "pending_created",
      created_at: new Date()
    }, { session });

    // 4. Create immutable audit log
    await db.collection("payout_logs").insertOne({
      order_id: orderId,
      actor_id: actorId,
      event_type: "funds_reserved",
      payload: { amount, orgId },
      created_at: new Date()
    }, { session });
  });
} finally {
  await session.endSession();
}
```

#### 2. Atomic Conditional Updates (Fallback for Standalone Engines)
If MongoDB is executed in environments where multi-document transactions are unavailable, atomic financial safety is preserved via conditional filter operations (`$inc` with preconditions):
- **Fund Reservation**: `updateOne({ _id: orgId, $expr: { $gte: [{ $subtract: ["$balance", "$reserved"] }, amount] } }, { $inc: { reserved: amount } })` ensures mathematically un-bypassable reservation.
- **Completion Deduction**: `updateOne({ _id: orgId, balance: { $gte: amount }, reserved: { $gte: amount } }, { $inc: { balance: -amount, reserved: -amount } })`.
- **Failure Release**: `updateOne({ _id: orgId, reserved: { $gte: amount } }, { $inc: { reserved: -amount } })`.

#### 3. Idempotency & Unique Indexes
- `payouts.order_id` is guarded by a **UNIQUE index** (`{ order_id: 1 }`), physically preventing double-payment execution upon duplicate API calls.
- Webhook events in `cryptomusWebhook.ts` check existing `status` before executing deductions; if status is already `completed`, the webhook execution terminates cleanly.

#### 4. Automated Reconciliation Daemon
The cron function [`functions/src/functions/reconcilePayouts.ts`](file:///d:/Projects/BugHuntr/BugHuntr/functions/src/functions/reconcilePayouts.ts) queries MongoDB every 15 minutes for payouts in `pending_created` or `processing` older than 30 minutes, reconciling them against the Cryptomus merchant API and repairing orphaned reservations automatically.

---

## 6. Authentication and Authorization Integration

### 6.1 Authentication Architecture
- **Authoritative Identity**: Stored exclusively in PostgreSQL `auth_users` and `user_credentials`.
- **Session Gateway**: The Next.js server (`app/api/auth/*` and `lib/server-auth.ts`) acts as the authoritative authentication gateway:
  1. The user posts credentials to `/api/auth/login`.
  2. The server compares the password against `auth_users.password_hash` using `bcrypt.compare`.
  3. If 2FA is required, `lib/auth-2fa.ts` issues and validates a single-use HMAC challenge token.
  4. Upon success, an HTTP-only, signed session cookie (`bughuntr_session`) is returned containing `{ id, email, username, role, userType }`.

### 6.2 Server-Side Authorization Enforcement Across Both Databases
Because PostgreSQL RLS does not apply to MongoDB collections, **multi-tenant authorization is strictly enforced at the Application Gateway / Service layer**:

```
[ Incoming Request + bughuntr_session Cookie ]
                     │
                     ▼
       [ Server Middleware & Session Verification ]
         - Verifies HMAC signature in memory
         - Resolves user.id, user.role, and user.userType
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
  [ SQL Operations ]      [ MongoDB Operations ]
  - Direct RLS applied    - Tenancy filter injected by Service Layer:
  - Role checked via       - Hunter: { hunter_id: user.id }
    user_roles             - Org Member: { org_id: user.orgId }
                           - Triager/Admin: { ... } (unrestricted)
```

1. **Hunter Isolation**: All queries for submissions submitted by hunters must programmatically inject `{ hunter_id: sessionUser.id }`.
2. **Organization Isolation**: Enterprise users querying bounties, wallets, and received submissions must programmatically inject `{ org_id: sessionUser.orgId }`.
3. **Privilege Gating**: Payout creation (`createPayout`), CVSS approval (`approveCvss`), and CVE requests (`requestCve`) explicitly assert `sessionUser.role IN ('admin', 'triager')` before executing MongoDB mutations.

---

## 7. Outdated Recommendations in Existing Audit Reports

The previous audit reports (`DATABASE_AUDIT_FINAL_REPORT.md`, `HIGH_VOLUME_DATABASE_AUDIT.md`, `LOW_VOLUME_SQL_DATABASE_AUDIT.md`, and `DATABASE_MIGRATION_ARCHITECTURE.md`) assumed that either all 17 tables or all low-volume tables should be deployed to PostgreSQL. The following table identifies all recommendations in those reports that are **formally superseded**:

| Document | Superseded Recommendation | Original Premise | Confirmed Architectural Reality |
| :--- | :--- | :--- | :--- |
| `DATABASE_AUDIT_FINAL_REPORT.md` | **Section 1.1 & 2.1**: "Single-Platform Recommendation: BugHuntr should be hosted on a unified PostgreSQL (Supabase) architecture." | Assumed MongoDB was unnecessary and all data should live in PostgreSQL. | **Superseded**: Architecture is polyglot. SQL is restricted to identity and auth security. MongoDB owns all application data. |
| `LOW_VOLUME_SQL_DATABASE_AUDIT.md` | **Section 3.4 & 3.5**: Mapping `organizations`, `org_members`, and `org_wallets` to SQL tables. | Assumed low-volume organization and wallet data belonged in PostgreSQL. | **Superseded**: `organizations`, `org_members`, and `org_wallets` belong to MongoDB. |
| `002_bug_bounty_domain_supabase_schema.sql` | The entire DDL schema `002` (organizations, bounties, submissions, vulns, wallets, payouts). | Intended to be deployed to Supabase PostgreSQL. | **Superseded**: **`002` will NOT be executed in PostgreSQL**. All entities defined in `002` belong in MongoDB. |
| `003_supabase_rls_policies.sql` | Declaring RLS policies for `organizations`, `org_wallets`, `payouts`, `bug_submissions`, `vulnerabilities`. | Assumed PostgreSQL RLS would protect financial and application data. | **Superseded**: PostgreSQL RLS is deployed **only** for `auth_users`, `user_roles`, `user_profiles`, `user_credentials`, and `auth_audit_log`. MongoDB security is enforced at the Application Gateway. |
| `DATABASE_AUDIT_FINAL_REPORT.md` | **Section 4.3**: Gamification points stored in SQL `user_profiles.points`. | Materialized points balance onto SQL profile. | **Superseded**: Points balances and gamification state belong in MongoDB `user_points_balances`. SQL user profiles store basic account information only. |
| `scripts/migrate-firestore-to-sql.ts` | Monolithic script migrating submissions, wallets, payouts, and communities into SQL. | Ingesting all Firestore data into PostgreSQL tables. | **Superseded**: Script is replaced by two separate migration runners: SQL Identity Migrator and MongoDB Application Migrator. |

---

## 8. Migration Dependencies and Execution Order

### 8.1 Migration Phasing & Execution Sequence

```
[ Phase 1: Database Initialization ]
  ├─ SQL: Execute migrations/001_accounts_auth_schema.sql (Identity & Auth ONLY)
  ├─ SQL: Execute curated RLS from migrations/003 (auth_users, roles, credentials)
  └─ MongoDB: Provision collections, unique indexes, and schema validation rules
            │
            ▼
[ Phase 2: Ingestion Execution ]
  Step 2.1 (SQL): Ingest auth_users -> user_roles -> user_credentials -> user_profiles -> auth_audit_log
  Step 2.2 (Mongo): Ingest organizations -> org_members -> org_wallets
  Step 2.3 (Mongo): Ingest bug_hunts -> pro_invitations -> pro_subscriptions
  Step 2.4 (Mongo): Ingest bug_submissions -> vulnerabilities -> vulnerabilities_audit -> cve_requests
  Step 2.5 (Mongo): Ingest payouts -> payout_logs -> batch_payout_jobs
  Step 2.6 (Mongo): Ingest user_points_balances -> points_transactions -> user_achievements
  Step 2.7 (Mongo): Ingest communities -> community_memberships -> community_messages
            │
            ▼
[ Phase 3: Dual-Database Reconciliation & Validation ]
  Verify: Firestore Document Count == Mapped_SQL + Mapped_Mongo + Errors
  Verify: Zero broken logical user references across SQL and MongoDB
```

### 8.2 Preservation of Historical Identifiers & Payment References
To prevent financial and vulnerability tracking corruption during migration:
1. **Preserve Original String Keys**: All existing Firestore document IDs (e.g., `BH-VULN-submission_abc123`, `BH-PAYOUT-sub-101-hunt-1`, `7xN0kP9zQ2a`) must be preserved directly in MongoDB `_id` and SQL `auth_users.id`.
2. **Explicit Orphan Checks Before Ingestion**: Pre-flight validation scripts must verify that:
   - Every `payouts.submission_id` points to a valid submission document.
   - Every `vulnerabilities.submission_id` links to an existing submission.
   - Every `org_wallets.org_id` has a matching organization record.
3. **No Unreconciled Record Dropping**: Duplicate submission records across legacy collections (`bugs` vs `bugSubmissions`) must **not** be dropped without checking whether an existing payout or vulnerability references that specific document ID. If a pointer ID is referenced externally, an alias mapping must be preserved in MongoDB.

---

## 9. Architectural Decision Register & Deployment Prerequisites

### 9.1 Architectural Decision Register

#### Decision DEC-01: Ownership of Payouts, Wallets, and Financial Logs
- **Status**: **CONFIRMED ARCHITECTURE**
- **Decision**: `org_wallets`, `payouts`, `payout_logs`, `payout_queue`, and `batch_payout_jobs` are assigned to **MongoDB**.
- **Rationale**: Reconciles financial custody, payment ledgers, and bug submissions within the same database engine. Eliminates cross-database distributed two-phase commits. Financial atomicity is achieved via MongoDB multi-document transactions or atomic conditional updates (`$inc` with preconditions).

#### Decision DEC-02: Authentication Gateway Architecture (Server Gateway vs. Direct Supabase GoTrue)
- **Status**: **Recommended — Pending Human Approval**
- **Decision**: Maintain the Next.js Server-Side API as the authoritative authentication gateway. Client applications authenticate via server route handlers (`/api/auth/*`) receiving HTTP-only session cookies. The server securely queries PostgreSQL for auth/identity and MongoDB for application data.
- **Rationale**: Prevents exposing direct database ports or client JWT generation for two separate databases. Centralizes multi-tenant query filter injection for MongoDB.

#### Decision DEC-03: Deduplication and Normalization of Legacy Submission Collections
- **Status**: **Recommended — Pending Human Approval**
- **Decision**: Consolidate legacy collections (`bugs`, `bugSubmissions`, `bug_submissions`, `submissions`, `bugReports`) into MongoDB `bug_submissions`.
- **Safety Invariant**: Identify pointer records where `bugSubmissions.bugId == bugs.id`. Merge unique metadata (`fakeReport` scores) into the master document. If external records (`payouts`, `vulnerabilities`) reference a pointer ID, retain an alias pointer in MongoDB to prevent orphan references.

#### Decision DEC-04: Gamification Balances, Points, and History
- **Status**: **CONFIRMED ARCHITECTURE**
- **Decision**: Gamification state, points balances, streaks, reward unlocks, and points transaction histories are assigned to **MongoDB** (`user_points_balances`, `points_transactions`, `user_achievements`, `user_rewards`).
- **Rationale**: SQL `user_profiles` is kept strictly focused on basic account identity metadata. Application-domain gamification metrics remain co-located with bug submission rewards in MongoDB. Historical balances from `userProfiles.points` are ingested into `user_points_balances.points` as authoritative without forced recalculation from incomplete event logs.

---

### 9.2 Unresolved Deployment Prerequisites & Verification Gaps

| Prerequisite ID | Description | Existing Repository Evidence | Technical Gap / Unresolved Question | Action Required Prior to Implementation |
| :--- | :--- | :--- | :--- | :--- |
| **PREREQ-01** | **MongoDB Multi-Document Transaction Support (Replica Set Verification)** | Repository contains `firebaseConfig.js` and `package.json`, but **zero** MongoDB deployment manifests, Docker compose files, or connection strings. | Standalone MongoDB instances do **not** support multi-document transactions (`client.startSession`). Multi-document transactions require a MongoDB Replica Set (e.g. MongoDB Atlas or a 3-node replica set). | **Confirm deployment infrastructure**: Staging and production MongoDB clusters must be provisioned as a Replica Set to enable `session.withTransaction(...)`. |
| **PREREQ-02** | **Driver Dependency Provisioning** | `package.json` contains `firebase: ^12.3.0`, but lacks `mongodb`, `@supabase/supabase-js`, and `pg`. | Neither SQL nor MongoDB drivers are currently installed in the project. | Approved driver packages must be added to `package.json` and `functions/package.json` during the implementation phase. |
| **PREREQ-03** | **Password Hash Migration Verification** | Users in Firestore have bcrypt hashes generated by `bcryptjs.hash(password, 10)` in `app/api/auth/signup/route.ts`. | While bcrypt is algorithmically standard, live authentication against PostgreSQL `auth_users` using these hashes has not yet been executed. | Execute pre-flight login verification on staging with sample test hashes. |
| **PREREQ-04** | **Legacy Pointer Cross-Reference Audit** | `createBatchPayouts.ts` falls back across 4 collections (`bug_submissions`, `vulnerabilities`, `bugReports`, `submissions`). | Exact document count of legacy payouts referencing pointer IDs vs master IDs is unknown. | Execute read-only audit script over Firestore snapshot to quantify referenced pointer IDs before executing deduplication. |

---

### 9.3 Acceptance Criteria for Staging Execution Sign-Off

```
[ ] 1. Architecture Alignment Sign-Off
    [ ] 1.1 Confirm SQL database is deployed with 001_accounts_auth_schema.sql ONLY (zero application tables).
    [ ] 1.2 Confirm MongoDB owns organizations, bug_hunts, submissions, vulns, org_wallets, payouts, and gamification.
    [ ] 1.3 Human sign-off on DEC-02 (Server Auth Gateway) and DEC-03 (Deduplication with alias preservation).

[ ] 2. Infrastructure & Connection Verification
    [ ] 2.1 Verify MongoDB staging environment is deployed as a Replica Set supporting multi-document transactions.
    [ ] 2.2 Verify PostgreSQL staging connection pooling (PgBouncer/Supavisor) and connection string isolation.

[ ] 3. Tooling & Ingestion Safety
    [ ] 3.1 Migration runners implemented in dry-run mode for both SQL and MongoDB.
    [ ] 3.2 Automated reconciliation passes:
            Firestore_Read_Count == SQL_Ingested_Count + Mongo_Ingested_Count + Logged_Errors.
    [ ] 3.3 Foreign key join check confirms zero orphan references across SQL user IDs and MongoDB documents.

[ ] 4. Security & Isolation Validation
    [ ] 4.1 Automated test verifies hunter cannot query another hunter's submissions from MongoDB via server API.
    [ ] 4.2 Automated test verifies multi-document transaction rolls back wallet reservation if payout creation fails.
```

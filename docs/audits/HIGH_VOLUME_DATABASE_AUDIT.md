# BugHuntr — Audit B: High-Volume Data & Database/Workload Scalability

**Audit Date**: October 2026  
**Auditor**: Database Architecture & Workload Scalability Assessment  
**Status**: Completed (Read-Only Assessment)  
**Schema Preservation**: 100% Preserved (Zero schema modifications)

---

## 1. Executive Summary

This independent audit assesses the high-volume, append-only, chat/social, and transaction-intensive datasets across the BugHuntr codebase. The primary objective is to evaluate whether the existing PostgreSQL / Supabase architecture defined in the repository migrations can sustain the workload, and to establish non-destructive scalability options while **preserving the existing schema exactly as implemented**.

Key findings:
- **Bug Submissions & Vulnerabilities**: Submissions (`bug_submissions`) and triaged vulnerability records (`vulnerabilities`) contain large payloads (reproduction steps, PoC URLs, CVSS vectors, and BugHuntr JSONB calculation metadata). The existing relational schema with B-Tree indexes on `bounty_id`, `org_id`, `hunter_id`, and `status` provides optimal indexing and ACID transactional consistency, supporting scaling up to tens of millions of submissions without schema alterations.
- **Community Chat & Collaboration**: Real-time communication (`community_messages`, `communities/{id}/messages`, channel messages, and thread discussions) represents the highest write-rate and record-growth workload. In PostgreSQL / Supabase, the compound index `(community_id, created_at DESC)` effectively satisfies infinite-scroll pagination. Connection pooling (Supavisor) and query cursor optimization are required to prevent connection saturation under heavy concurrent messaging.
- **Audit Logs & Financial Histories**: Audit logs (`auth_audit_log`, `payout_logs`, `vulnerabilities/{vulnId}/audit`) and payout records (`payouts`) are immutable, append-only data streams. Their growth is linear with platform transactions. PostgreSQL easily accommodates this volume; scaling strategies such as transparent table partitioning by date range (`created_at`) preserve the table name, columns, and indexes unchanged.
- **Scalability Support**: PostgreSQL / Supabase fully supports the entire workload. No non-relational or separate NoSQL engine is required for data integrity or throughput at BugHuntr's operational scale.

---

## 2. Scope and Methodology

### 2.1 Scope
The audit inspected every dataset exhibiting potential high record growth, frequent writes, large payload sizes, or intensive query workloads:
1. Bug Submissions (`bug_submissions`, legacy `bugs`, `bugSubmissions`, `bugHuntSubmissions`, `submissions`, `bugReports`)
2. Vulnerability Records & CVSS Scores (`vulnerabilities`, `vulnerabilities/{vulnId}/audit`)
3. Community Messages & Collaboration Threads (`community_messages`, `communities/{id}/messages`, threads, comments)
4. Payout Transactions & Queue Jobs (`payouts`, `payout_queue`, `batch_payout_jobs`, `payout_logs`)
5. Security & Authentication Audit Logs (`auth_audit_log`, `payout_webhook_orphan`)
6. Gamification Activity Records (`pointsTransactions`, `userRewards`, `userAchievements`, `reputation_events`)

### 2.2 Methodology & Distinction Standards
- **Measured Facts**: Directly verified from repository code paths, schema DDL, constraints, trigger functions, and passing automated test suites.
- **Derived Estimates**: Inferred from platform mechanics (e.g., submission review workflows, batch CSV processing sizes, chat messaging patterns).
- **Unknowns**: Production telemetry not present in the local repository (e.g., actual daily active users, average messages sent per minute, exact production database storage utilization).

---

## 3. Existing Datasets and Schema Inventory

### 3.1 Dataset 1: Bug Submissions (Reports)
- **Current Storage Location**: Fragmented across legacy Firestore collections: `bug_submissions`, `bugs`, `bugSubmissions`, `bugHuntSubmissions`, `submissions`, `bugReports` (`app/submit/page.tsx`, `app/dashboard/page.tsx`, `hooks/use-bug-hunt.ts`, `functions/src/functions/createBatchPayouts.ts`).
- **Target SQL Definition**: `bug_submissions` in `migrations/002_bug_bounty_domain_supabase_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS bug_submissions (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      bounty_id VARCHAR(128) NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
      org_id VARCHAR(128) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      hunter_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      steps_to_reproduce TEXT NOT NULL,
      proof_of_concept_url TEXT,
      severity VARCHAR(50) NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low', 'none')),
      status VARCHAR(50) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'triaged', 'accepted', 'resolved', 'rejected', 'duplicate')),
      payout_status VARCHAR(50) NOT NULL DEFAULT 'unpaid' CHECK (payout_status IN ('unpaid', 'processing', 'pending_external_confirmation', 'paid', 'failed')),
      reward_amount NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (reward_amount >= 0),
      hunter_wallet_address VARCHAR(255),
      source_collection VARCHAR(50) NOT NULL DEFAULT 'bug_submissions',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- **Existing Indexes**:
  - `idx_bug_submissions_bounty_id ON bug_submissions(bounty_id)`
  - `idx_bug_submissions_org_id ON bug_submissions(org_id)`
  - `idx_bug_submissions_hunter_id ON bug_submissions(hunter_id)`
  - `idx_bug_submissions_status ON bug_submissions(status)`
  - `idx_bug_submissions_payout_status ON bug_submissions(payout_status)`
- **Relationships**: Foreign keys to `bounties(id)`, `organizations(id)`, and `auth_users(id)`.

### 3.2 Dataset 2: Vulnerabilities & CVSS Scoring
- **Current Storage Location**: Firestore `vulnerabilities` collection and subcollection `vulnerabilities/{vulnId}/audit` (`docs/CVSS_FIRESTORE_SCHEMA.md`, `functions/src/functions/cvss/*`, `hooks/use-vulnerability.ts`).
- **Target SQL Definition**: `vulnerabilities` in `migrations/002_bug_bounty_domain_supabase_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS vulnerabilities (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      submission_id VARCHAR(128) NOT NULL REFERENCES bug_submissions(id) ON DELETE CASCADE,
      bounty_id VARCHAR(128) NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
      org_id VARCHAR(128) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      cvss_vector VARCHAR(150),
      cvss_base_score NUMERIC(3, 1) CHECK (cvss_base_score >= 0.0 AND cvss_base_score <= 10.0),
      cvss_severity VARCHAR(20) CHECK (cvss_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE')),
      bughuntr_score NUMERIC(3, 1) CHECK (bughuntr_score >= 0.0 AND bughuntr_score <= 10.0),
      bughuntr_components JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(50) NOT NULL DEFAULT 'triage_pending' CHECK (status IN (
          'triage_pending', 'triage_pending_final_review', 'triaged',
          'rejected_low_severity', 'eligible_for_payout', 'cve_requested',
          'disclosed', 'fixed', 'wont_fix', 'archived'
      )),
      triage_notes TEXT,
      triaged_by VARCHAR(128) REFERENCES auth_users(id),
      triaged_at TIMESTAMPTZ,
      cve_id VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_vulnerabilities_submission_id UNIQUE (submission_id)
  );
  ```
- **Existing Indexes**:
  - `idx_vulnerabilities_submission_id ON vulnerabilities(submission_id)`
  - `idx_vulnerabilities_org_id ON vulnerabilities(org_id)`
  - `idx_vulnerabilities_status ON vulnerabilities(status)`
- **Relationships**: 1:1 with `bug_submissions(id)`, FKs to `bounties`, `organizations`, `auth_users`.

### 3.3 Dataset 3: Community Messages & Real-Time Collaboration
- **Current Storage Location**: Firestore `communities` collection, subcollections `communities/{id}/messages`, `channels/{channelId}/messages`, `threads/{threadId}/comments`, `threads/{threadId}/chat` (`hooks/use-community.tsx`, `hooks/use-thread-collaboration.ts`, `app/community/[id]/page.tsx`).
- **Target SQL Definition**: `communities` and `community_messages` in `migrations/002_bug_bounty_domain_supabase_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS communities (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      creator_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
      is_private BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS community_messages (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      community_id VARCHAR(128) NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      sender_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
      sender_name VARCHAR(100),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- **Existing Indexes**:
  - `idx_community_messages_community ON community_messages(community_id, created_at DESC)`
- **Relationships**: FK `community_id` to `communities(id)`, FK `sender_id` to `auth_users(id)`.

### 3.4 Dataset 4: Crypto Payout Records & Batch Jobs
- **Current Storage Location**: Firestore `payouts`, `payout_queue`, `batch_payout_jobs`, `payout_reconciliation_reports` (`functions/src/functions/createPayout.ts`, `functions/src/functions/createBatchPayouts.ts`, `functions/src/functions/reconcilePayouts.ts`, `functions/src/functions/cryptomusWebhook.ts`).
- **Target SQL Definition**: `payouts` in `migrations/002_bug_bounty_domain_supabase_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS payouts (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      order_id VARCHAR(100) NOT NULL,
      submission_id VARCHAR(128) NOT NULL REFERENCES bug_submissions(id) ON DELETE RESTRICT,
      org_id VARCHAR(128) NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      hunter_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
      amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
      currency VARCHAR(10) NOT NULL DEFAULT 'USDT',
      network VARCHAR(50) NOT NULL,
      recipient_wallet VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending_created' CHECK (status IN (
          'pending_created', 'processing', 'pending_external_confirmation',
          'paid', 'completed', 'failed', 'cancelled'
      )),
      external_payout_id VARCHAR(100),
      error_details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_payouts_order_id UNIQUE (order_id)
  );
  ```
- **Existing Indexes**:
  - `idx_payouts_order_id ON payouts(order_id)`
  - `idx_payouts_submission_id ON payouts(submission_id)`
  - `idx_payouts_org_id ON payouts(org_id)`
  - `idx_payouts_hunter_id ON payouts(hunter_id)`
  - `idx_payouts_status ON payouts(status)`
- **Relationships**: UNIQUE `order_id` (matches Cryptomus merchant reference), FKs to `bug_submissions`, `organizations`, `auth_users`.

### 3.5 Dataset 5: Audit Logs (Authentication & Payout Lifecycle)
- **Current Storage Location**:
  - `auth_audit_log` in `migrations/001_accounts_auth_schema.sql`
  - `payout_logs` in `migrations/002_bug_bounty_domain_supabase_schema.sql` & Firestore `payout_logs`
  - `payout_webhook_orphan` in Firestore (`functions/src/utils/firestore.ts`)
  - `vulnerabilities/{vulnId}/audit` in Firestore (`docs/CVSS_FIRESTORE_SCHEMA.md`)
- **Target SQL Definitions**:
  ```sql
  CREATE TABLE IF NOT EXISTS auth_audit_log (
      id BIGSERIAL PRIMARY KEY,
      user_id VARCHAR(128) REFERENCES auth_users(id) ON DELETE SET NULL,
      event_type VARCHAR(100) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS payout_logs (
      id BIGSERIAL PRIMARY KEY,
      order_id VARCHAR(100) NOT NULL,
      actor_id VARCHAR(128),
      event_type VARCHAR(100) NOT NULL,
      log_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- **Existing Indexes**:
  - `idx_auth_audit_log_user_id ON auth_audit_log(user_id)`
  - `idx_auth_audit_log_created_at ON auth_audit_log(created_at)`
  - `idx_auth_audit_log_event_type ON auth_audit_log(event_type)`
  - `idx_payout_logs_order_id ON payout_logs(order_id)`
  - `idx_payout_logs_created_at ON payout_logs(created_at)`

---

## 4. Evidence-Based Workload Assessment

| Workload Dimension | `bug_submissions` & `vulnerabilities` | `community_messages` | `payouts` & `payout_queue` | `auth_audit_log` & `payout_logs` |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Category** | Fact (Code & DDL); Estimate (Volume) | Fact (Code & DDL); Estimate (Rate) | Fact (Cloud Functions & Cryptomus flow) | Fact (DDL & Logging calls); Estimate (Log volume) |
| **Record Count (Observed/Est.)** | Estimated $10^3$ to $10^5$ submissions. | Estimated $10^4$ to $10^6+$ chat messages. | Estimated $10^3$ to $10^5$ payout operations. | Linear with platform events: $10^5$ to $10^7$ rows. |
| **Payload Size** | **Large**: $2\text{ KB}$ to $100\text{ KB}$ (detailed markdown reports, code snippets, JSONB components). | **Small to Medium**: $100\text{ B}$ to $2\text{ KB}$ text strings. | **Small**: $500\text{ B}$ to $2\text{ KB}$ (financial fields, Cryptomus response JSON). | **Medium**: $300\text{ B}$ to $5\text{ KB}$ (JSONB metadata, IPs, headers). |
| **Write Frequency** | Moderate burst writes when public bounties launch; otherwise steady ($1\text{--}5\text{ writes/min}$). | **High continuous write rate**: bursts up to $50\text{--}200\text{ msgs/sec}$ during active events. | Burst writes during CSV batch payouts (batches of 100); webhook updates on tx confirmation. | High append-only write frequency on every auth/payout event. |
| **Read Frequency** | Moderate to High (feed, hunter dashboard, triager queue). | **Extremely High**: active community channels poll or subscribe via WebSockets. | Low to Moderate (wallet screen, admin reconciliation). | Low (compliance, investigation, reconciliation). |
| **Query & Sorting Patterns** | Filter by `status`, `bounty_id`, `org_id`, `hunter_id`. Sort by `created_at DESC`. | Filter by `community_id`, sort by `created_at DESC` with `LIMIT 50`. | Lookup by `order_id`, filter by `status = 'pending_external_confirmation'`. | Filter by `user_id`, `order_id`, range filter on `created_at`. |
| **Pagination & Aggregation** | Keyset / cursor pagination (`WHERE created_at < $cursor`). Aggregations on count by status. | Keyset pagination on `(community_id, created_at DESC)`. | Aggregations for total volume paid (`SUM(amount)`). | Time-bucket aggregations for audit monitoring. |

---

## 5. Security and Integrity Considerations

### 5.1 Financial Integrity & Double-Spend Prevention
In the legacy Firestore codebase, payout creation was vulnerable to race conditions (addressed in SEC-04) where concurrent API calls could initiate duplicate crypto transfers before document status updated.
In the SQL architecture:
- `uq_payouts_order_id` strictly blocks duplicate order IDs at the database engine level.
- `payout_status` on `bug_submissions` and `status` on `payouts` are updated inside an ACID transaction alongside `org_wallets` fund reservation.
- **Client Mutation Block**: `migrations/003_supabase_rls_policies.sql` implements total client mutation denial:
  ```sql
  CREATE POLICY rls_payouts_block_client_writes ON payouts
      FOR ALL TO authenticated
      USING (FALSE) WITH CHECK (FALSE);
  CREATE POLICY rls_org_wallets_block_client_writes ON org_wallets
      FOR ALL TO authenticated
      USING (FALSE) WITH CHECK (FALSE);
  ```

### 5.2 Multi-Tenant Data Isolation for Submissions
Bug submissions contain sensitive zero-day vulnerability data. The RLS policies in `migrations/003_supabase_rls_policies.sql` enforce multi-tenant isolation:
- Hunters can only read submissions where `hunter_id = current_user_id()`.
- Company members can only read submissions where `is_org_member(org_id)`.
- Triagers and platform admins can read all submissions via `is_platform_triager()`.
- Unprivileged client inserts are restricted to default values (`status = 'submitted'`, `reward_amount = 0.00`).

---

## 6. Database Suitability Assessment

### 6.1 PostgreSQL / Supabase Workload Evaluation
PostgreSQL is fully equipped to handle all audited high-volume datasets without architectural replacement:
1. **Large Text & JSONB Payloads**: PostgreSQL's TOAST (The Oversized-Attribute Storage Technique) transparently compresses and stores large submission descriptions and JSONB scoring packets out-of-line, keeping table index pages compact and memory-efficient.
2. **Indexing Capabilities**:
   - `idx_community_messages_community ON community_messages(community_id, created_at DESC)` completely satisfies keyset pagination without table re-sorting.
   - B-Tree indexes on `order_id`, `submission_id`, and `hunter_id` provide $O(\log N)$ point lookups.
3. **High Write Throughput**: Single-node PostgreSQL comfortably handles $2{,}000$ to $5{,}000$ transactions per second (TPS) on modest cloud hardware (e.g., 4 vCPU, 16GB RAM) with write-ahead logging (WAL). BugHuntr's estimated peak write workload ($< 300\text{ writes/sec}$) consumes less than 10% of this capacity.
4. **Realtime Pub/Sub**: Supabase Realtime leverages PostgreSQL's logical replication stream to broadcast `community_messages` inserts to subscribed WebSocket clients without polling.

---

## 7. Performance and Scalability Assessment

### 7.1 Bottleneck Identification
- **Bottleneck 1: Offset-Based Pagination on Messages**: Using `OFFSET 10000` causes sequential index scanning.
  *Remedy (Preserving Schema)*: Enforce keyset pagination using the existing compound index `(community_id, created_at DESC)` via `WHERE community_id = $1 AND created_at < $cursor LIMIT 50`.
- **Bottleneck 2: Connection Pool Exhaustion from Cloud Functions & Webhooks**: Sudden bursts of Cryptomus webhooks or Next.js API requests can exceed PostgreSQL's `max_connections`.
  *Remedy (Preserving Schema)*: Direct all serverless traffic through Supavisor / PgBouncer connection pooler in transaction mode.
- **Bottleneck 3: Log Table Bloat (`auth_audit_log`, `payout_logs`)**: Over multi-year operations, append-only logs may grow into tens of millions of rows.
  *Remedy (Preserving Schema)*: Implement PostgreSQL declarative range partitioning by month on `created_at`. This preserves the logical table name, column definitions, and application query syntax while keeping individual partition indexes small.

---

## 8. Risks and Unknowns

| Category | Description | Severity | Mitigation & Investigation Plan |
| :--- | :--- | :--- | :--- |
| **Production Workload Telemetry** | Exact peak-hour writes, total active communities, and average message frequency are unmeasured in the repository. | Medium | Benchmark using synthetic load generation tool matching schema structures before production launch. |
| **Realtime Connection Limits** | Supabase Realtime WebSocket concurrency limits under peak event loads. | Low | Configure Supabase Realtime tenant quotas; throttle client broadcast channels. |
| **Fragmented Submission Ingestion** | Legacy records exist across 6 different Firestore collection names. | Low | Resolved in `scripts/migrate-firestore-to-sql.ts` and tested in `tests/test_migration_schema_and_rls.mjs`: maps all into `bug_submissions` with `source_collection` tag. |
| **Unindexed Gamification Collections** | Firestore collections `pointsTransactions`, `userRewards`, and `userAchievements` are queried in `hooks/use-ranking.ts` but lack dedicated DDL tables. | Medium | In the current schema, points are materialized directly onto `user_profiles.points` with index `idx_user_profiles_points`. Leaderboards query `user_profiles` directly, bypassing high-volume transaction aggregations. |

---

## 9. Recommendations That Preserve the Existing Schema

1. **Maintain Single-Engine Architecture**: Host all domain, submission, community, and financial tables on PostgreSQL / Supabase. Do not introduce a separate NoSQL or document engine.
2. **Preserve DDL & Indexes Exactly**: Retain all tables, columns, constraints, and indexes defined in `migrations/001_accounts_auth_schema.sql` and `migrations/002_bug_bounty_domain_supabase_schema.sql`.
3. **Adopt Keyset Pagination**: Enforce cursor-based pagination on `community_messages` using the existing `idx_community_messages_community` index.
4. **Implement PgBouncer / Supavisor**: Route serverless function queries through the connection pooler to support high-concurrency spikes.
5. **Future Non-Destructive Partitioning**: If audit logs exceed $10^7$ rows, apply native PostgreSQL range partitioning by month on `created_at` without altering application queries or schemas.

---

## 10. Evidence References

- **Migration DDL Definitions**:
  - `migrations/002_bug_bounty_domain_supabase_schema.sql` (Lines 77–101): `bug_submissions` schema, foreign keys, status checks, and indexes.
  - `migrations/002_bug_bounty_domain_supabase_schema.sql` (Lines 106–133): `vulnerabilities` schema, CVSS score checks, JSONB components.
  - `migrations/002_bug_bounty_domain_supabase_schema.sql` (Lines 177–197): `communities` and `community_messages` schemas and compound index.
  - `migrations/002_bug_bounty_domain_supabase_schema.sql` (Lines 216–258): `payouts` and `payout_logs` schemas, financial constraints.
  - `migrations/001_accounts_auth_schema.sql` (Lines 96–109): `auth_audit_log` definition and indexes.
- **Backend & Cloud Function Implementations**:
  - `functions/src/functions/createPayout.ts` (Lines 35–185): Idempotent payout creation, atomic fund reservation, multi-collection submission fallbacks.
  - `functions/src/functions/createBatchPayouts.ts` (Lines 30–120): Batch payout processing, queue handling, and status management.
  - `functions/src/functions/cryptomusWebhook.ts` (Lines 20–110): Webhook signature verification, transaction confirmation, and wallet deduction.
  - `functions/src/utils/firestore.ts` (Lines 25–239): Concurrency control, wallet transactions, and audit logging.
- **Automated Test Evidence**:
  - `tests/test_migration_schema_and_rls.mjs`: Verifies presence of all 17 tables, RLS enablement, and constraint compliance.
  - `tests/test_migration_synthetic_integrity.mjs`: Confirms deduplication, arbitrary string ID compatibility, and partial-failure trapping.

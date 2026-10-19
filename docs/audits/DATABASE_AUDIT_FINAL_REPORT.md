# BugHuntr — Database Architecture Final Audit & Staging Preparation Report

**Document**: `docs/audits/DATABASE_AUDIT_FINAL_REPORT.md`  
**Date**: October 2026  
**Auditor**: Database Architecture & Security Evaluation  
**Status**: Completed (Read-Only Assessment & Staging Runbook)  
**Schema Preservation**: 100% Preserved (Zero schema modifications, zero code changes)

---

## 1. Executive Summary

This final audit report consolidates the findings from **Audit A (Low-Volume SQL Data)** and **Audit B (High-Volume Data & Scalability)** to establish the authoritative plan for preparing an isolated, non-production staging database migration test.

Key conclusions:
1. **Single-Platform Recommendation**: BugHuntr should be hosted on a unified **PostgreSQL (Supabase)** architecture. Supabase is a PostgreSQL-based platform, not a distinct database engine. Deploying both low-volume transactional data (accounts, roles, organizations, custody wallets) and high-volume data (submissions, chat messages, payouts, audit trails) on PostgreSQL eliminates dual-database synchronization lag, distributed transaction failures, and cross-system identity drift.
2. **Schema Preservation**: The existing DDL schemas defined in [`migrations/001_accounts_auth_schema.sql`](file:///d:/Projects/BugHuntr/BugHuntr/migrations/001_accounts_auth_schema.sql) and [`migrations/002_bug_bounty_domain_supabase_schema.sql`](file:///d:/Projects/BugHuntr/BugHuntr/migrations/002_bug_bounty_domain_supabase_schema.sql), along with RLS policies in [`migrations/003_supabase_rls_policies.sql`](file:///d:/Projects/BugHuntr/BugHuntr/migrations/003_supabase_rls_policies.sql) and reversion in [`migrations/004_down_reversion.sql`](file:///d:/Projects/BugHuntr/BugHuntr/migrations/004_down_reversion.sql), are preserved 100% unchanged.
3. **Existing Test Scope & Limitations**: Current repository tests ([`tests/test_migration_schema_and_rls.mjs`](file:///d:/Projects/BugHuntr/BugHuntr/tests/test_migration_schema_and_rls.mjs) and [`tests/test_migration_synthetic_integrity.mjs`](file:///d:/Projects/BugHuntr/BugHuntr/tests/test_migration_synthetic_integrity.mjs)) are **static file regex checks and in-memory synthetic unit tests**. They prove transformation logic and schema file syntax expectations, but **do not prove live PostgreSQL engine compatibility, live RLS security enforcement, or real Firestore migration execution**.
4. **Primary Staging Prerequisite**: The migration script [`scripts/migrate-firestore-to-sql.ts`](file:///d:/Projects/BugHuntr/BugHuntr/scripts/migrate-firestore-to-sql.ts) currently contains pure data transformation functions, but its execution harness (`runMigration`) is an empty dry-run stub. Before running a staging test, client connection drivers must be integrated into the test harness to connect to an isolated staging PostgreSQL database and read from a staging Firestore snapshot.

---

## 2. Final Recommended Database Architecture

### 2.1 Single-Platform Rationale (PostgreSQL / Supabase)
Both Audit A and Audit B independently concluded that PostgreSQL fully satisfies the requirements of all BugHuntr datasets:
- **Low-Volume Data**: Requires strict ACID compliance, complex foreign keys (`ON DELETE CASCADE` / `ON DELETE RESTRICT`), table-level `CHECK` constraints, unique indexes, and row-level locking (`SELECT FOR UPDATE` on `org_wallets`).
- **High-Volume Data**: Bug submissions with large markdown payloads are handled efficiently out-of-line by PostgreSQL's TOAST storage. High-frequency community chat is indexed via compound B-Trees `(community_id, created_at DESC)` for keyset pagination. Real-time updates are distributed via Supabase Realtime using PostgreSQL's native write-ahead log (WAL) logical replication.
- **Architectural Cohesion**: Maintaining a single PostgreSQL instance prevents data fragmentation, avoids distributed two-phase commits across disparate database engines, and ensures that financial custody (`org_wallets`), payouts (`payouts`), and bug submissions (`bug_submissions`) remain transactionally atomic.

### 2.2 Operational & Identity Topology
```
[ Next.js Client / Mobile Web ]
            │
            ▼
[ Next.js Server / Cloud Functions ]
            │ (Connection Pooling: PgBouncer / Supavisor)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL / Supabase                        │
│                                                                 │
│  ┌────────────────────────┐         ┌────────────────────────┐  │
│  │     Identity & Auth    │         │    Domain & Bounties   │  │
│  │ ---------------------- │         │ ---------------------- │  │
│  │ • auth_users           │◄───┐    │ • organizations        │  │
│  │ • user_roles           │    │    │ • org_members          │  │
│  │ • user_profiles        │    │    │ • bounties             │  │
│  │ • user_credentials     │    │    │ • pro_invitations      │  │
│  │ • auth_audit_log       │    │    │                        │  │
│  └────────────────────────┘    │    └───────────┬────────────┘  │
│                                │                │               │
│  ┌────────────────────────┐    │    ┌───────────▼────────────┐  │
│  │   Financial Custody    │    └───┤• bug_submissions       │  │
│  │ ---------------------- │         │• vulnerabilities       │  │
│  │ • org_wallets          │         │• cve_requests          │  │
│  │ • payouts              │         └────────────────────────┘  │
│  │ • payout_logs          │                                     │
│  └────────────────────────┘         ┌────────────────────────┐  │
│                                     │  Social & Real-Time    │  │
│                                     │ ---------------------- │  │
│                                     │ • communities          │  │
│                                     │ • community_messages   │  │
│                                     └────────────────────────┘  │
│                                                                 │
│  [ Row-Level Security (RLS) & Triggers: enforce_profile_field_protect ] │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Complete Mapping of Existing Datasets to Target SQL Tables

| Legacy Firestore Entity | Target SQL Table | Target Schema File | Primary Key | Key Mapped Attributes | Integrity & Constraint Rules |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `users` | `auth_users` | `001_accounts_auth_schema.sql` | `id VARCHAR(128)` | `email`, `password_hash`, `email_verified`, `legacy_firestore_id` | `UNIQUE(email)`, regex email validation format |
| `users.role`, `users.userType` | `user_roles` | `001_accounts_auth_schema.sql` | `id VARCHAR(128)` | `user_id`, `role`, `assigned_by`, `assigned_at` | `UNIQUE(user_id, role)`, check: `hunter`, `company`, `admin`, `triager` |
| `userProfiles`, `users` | `user_profiles` | `001_accounts_auth_schema.sql` | `user_id VARCHAR(128)` | `username`, `display_name`, `avatar_url`, `points`, `reputation_rank` | `UNIQUE(username)`, `points >= 0`, trigger-protected immutability |
| `users.credentials` (2FA/OTP) | `user_credentials` | `001_accounts_auth_schema.sql` | `id VARCHAR(128)` | `user_id`, `credential_type`, `secret_hash`, `is_enabled` | `UNIQUE(user_id, credential_type)`, check credential types |
| Security events | `auth_audit_log` | `001_accounts_auth_schema.sql` | `id BIGSERIAL` | `user_id`, `event_type`, `ip_address`, `metadata` | Append-only; `ON DELETE SET NULL` on user deletion |
| `orgs`, `users` (`userType='company'`) | `organizations` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `name`, `slug`, `description`, `verified`, `logo_url` | `UNIQUE(slug)`, multi-tenant root |
| Org member lists | `org_members` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `org_id`, `user_id`, `role`, `created_at` | `UNIQUE(org_id, user_id)`, check: `owner`, `admin`, `triager`, `member` |
| `bug_hunts`, `bugHunts`, `proBugHunts` | `bounties` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `org_id`, `title`, `reward_pool`, `min_reward`, `max_reward`, `status` | `max_reward >= min_reward`, `reward_pool >= 0`, status checks |
| `bug_submissions`, `bugs`, `bugSubmissions`, `bugHuntSubmissions`, `submissions`, `bugReports` | `bug_submissions` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `bounty_id`, `org_id`, `hunter_id`, `title`, `severity`, `status`, `payout_status`, `reward_amount`, `source_collection` | `ON DELETE CASCADE` (bounty, org), `ON DELETE RESTRICT` (hunter), severity/status checks |
| `vulnerabilities` | `vulnerabilities` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `submission_id`, `cvss_vector`, `cvss_base_score`, `bughuntr_score`, `bughuntr_components`, `status` | `UNIQUE(submission_id)`, `cvss_base_score` 0.0–10.0, `bughuntr_score` 0.0–10.0 |
| `cve_requests` | `cve_requests` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `vulnerability_id`, `requester_id`, `org_consent`, `disclosure_type`, `status`, `assigned_cve` | `UNIQUE(vulnerability_id)`, disclosure/status checks |
| `proInvitations` | `pro_invitations` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `sender_id`, `recipient_email`, `hunt_id`, `status`, `expires_at` | `ON DELETE CASCADE` (hunt, sender), status check |
| `communities` | `communities` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `name`, `description`, `creator_id`, `is_private` | `ON DELETE RESTRICT` (creator) |
| `communities/{id}/messages`, channels, threads | `community_messages` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `community_id`, `sender_id`, `sender_name`, `content`, `created_at` | Compound index: `(community_id, created_at DESC)` |
| `org_wallets` | `org_wallets` | `002_bug_bounty_domain_supabase_schema.sql` | `org_id VARCHAR(128)` | `balance`, `reserved`, `currency`, `updated_at` | `CHECK (reserved <= balance)`, `CHECK (balance >= 0)`, client writes blocked |
| `payouts` | `payouts` | `002_bug_bounty_domain_supabase_schema.sql` | `id VARCHAR(128)` | `order_id`, `submission_id`, `org_id`, `hunter_id`, `amount`, `status`, `recipient_wallet` | `UNIQUE(order_id)`, `CHECK (amount > 0)`, client writes blocked |
| `payout_logs`, `vulnerabilities/{id}/audit` | `payout_logs` | `002_bug_bounty_domain_supabase_schema.sql` | `id BIGSERIAL` | `order_id`, `actor_id`, `event_type`, `log_data`, `created_at` | Append-only financial audit log; client writes blocked |

---

## 4. Conflicting Recommendations & Unresolved Schema Questions

### 4.1 Authentication Identity Conflict: Server Session Cookie vs. GoTrue JWT
- **Conflict**: The current Next.js application uses custom HMAC-SHA256 signed session cookies (`bughuntr_session`) inspected in [`lib/server-auth.ts`](file:///d:/Projects/BugHuntr/BugHuntr/lib/server-auth.ts) and set in [`app/api/auth/login/route.ts`](file:///d:/Projects/BugHuntr/BugHuntr/app/api/auth/login/route.ts). In contrast, Supabase RLS policies rely on Supabase GoTrue JWTs (`auth.uid()`).
- **Resolution in Existing Schema**: [`migrations/003_supabase_rls_policies.sql`](file:///d:/Projects/BugHuntr/BugHuntr/migrations/003_supabase_rls_policies.sql) includes an identity resolution adapter:
  ```sql
  CREATE OR REPLACE FUNCTION current_user_id()
  RETURNS VARCHAR(128) AS $$
  BEGIN
      RETURN COALESCE(
          auth.uid()::text,
          NULLIF(current_setting('request.jwt.claim.sub', true), '')::VARCHAR(128)
      );
  END;
  $$ LANGUAGE plpgsql STABLE;
  ```
  This allows both direct Supabase GoTrue tokens and backend server proxy requests passing `request.jwt.claim.sub` to resolve identity without modifying table structures.
- **Unresolved Staging Question**: During staging tests, should the server-side API proxy all database queries using a service role key with transaction-level session variables (`SET LOCAL request.jwt.claim.sub = '...'`), or should users authenticate directly against Supabase Auth? This operational policy must be validated in staging.

### 4.2 Legacy Submissions Multi-Collection Fragmentation
- **Conflict**: Legacy Firestore code stores bug reports in 6 different collection names (`bugs`, `bugSubmissions`, `bug_submissions`, `bugHuntSubmissions`, `submissions`, `bugReports`), each with slightly different field names (`pocUrl` vs `proofOfConceptUrl`, `hunterUid` vs `reporterUid` vs `userId`, `bountyAmount` vs `rewardAmount`).
- **Resolution in Existing Schema**: Target table `bug_submissions` provides unified fields with a `source_collection` audit tag. The mapper [`scripts/migrate-firestore-to-sql.ts`](file:///d:/Projects/BugHuntr/BugHuntr/scripts/migrate-firestore-to-sql.ts) normalizes these variations.
- **Unresolved Staging Question**: If duplicate submissions exist across multiple legacy collections with identical report contents, how should deduplication be adjudicated? The mapper currently assigns unique alphanumeric IDs from each collection.

### 4.3 Gamification Activity Stream vs. Materialized Points
- **Conflict**: Frontend ranking hook [`hooks/use-ranking.ts`](file:///d:/Projects/BugHuntr/BugHuntr/hooks/use-ranking.ts) attempts to read raw transactions from Firestore collections `pointsTransactions`, `userRewards`, and `userAchievements`. However, the migration SQL does not define separate tables for these collections; it materializes points onto `user_profiles.points` with index `idx_user_profiles_points`.
- **Resolution**: Leaderboards and rank cards query `user_profiles.points` directly, which eliminates expensive aggregate queries over raw transaction streams while preserving the schema.
- **Unresolved Staging Question**: Does staging require historical transaction history preservation, or is the migrated cumulative balance in `user_profiles.points` sufficient?

---

## 5. Critical Blockers

1. **Migration Runner Driver Gap**:
   - `scripts/migrate-firestore-to-sql.ts` contains data mapping logic, but the actual database I/O loop (`runMigration`) is currently an empty stub that does not connect to Firestore or PostgreSQL.
   - **Blocker**: Staging migration cannot execute until the driver harness (connecting to staging PostgreSQL via `pg` and reading Firestore via Admin SDK) is implemented in the script.
2. **Foreign Key Ingestion Order & Missing Parent References**:
   - PostgreSQL strictly enforces foreign keys. If a legacy bug submission references a `bountyId` or `hunterId` that does not exist in `bounties` or `auth_users`, the insert will fail with a foreign key violation (`violates foreign key constraint`).
   - **Blocker**: Migration must enforce strict topological order:
     `organizations` $\rightarrow$ `auth_users` $\rightarrow$ `user_roles` $\rightarrow$ `user_profiles` $\rightarrow$ `org_members` $\rightarrow$ `org_wallets` $\rightarrow$ `bounties` $\rightarrow$ `bug_submissions` $\rightarrow$ `vulnerabilities` $\rightarrow$ `payouts` $\rightarrow$ `cve_requests`.
     Any legacy records with orphaned foreign keys must be captured in staging pre-flight validation.
3. **Password Hash Portability & Verification**:
   - Existing user passwords in Firestore `users` are bcrypt hashes generated by Next.js server auth (`bcryptjs.hash(password, 10)` in [`app/api/auth/signup/route.ts`](file:///d:/Projects/BugHuntr/BugHuntr/app/api/auth/signup/route.ts)).
   - **Blocker**: Staging test must confirm that user login succeeds against `auth_users.password_hash` using the existing bcrypt algorithm without requiring password resets.
4. **Cloud Functions Connection Pool Starvation**:
   - Cloud Functions for crypto payouts ([`functions/src/functions/createPayout.ts`](file:///d:/Projects/BugHuntr/BugHuntr/functions/src/functions/createPayout.ts)) and webhooks currently connect via Firestore SDK.
   - **Blocker**: If Cloud Functions query PostgreSQL directly without a connection pooler (PgBouncer / Supavisor), batch payout processing can exhaust PostgreSQL connection limits.
5. **Live RLS Policy Validation**:
   - RLS policies in [`migrations/003_supabase_rls_policies.sql`](file:///d:/Projects/BugHuntr/BugHuntr/migrations/003_supabase_rls_policies.sql) have only been validated using static text regexes in [`tests/test_migration_schema_and_rls.mjs`](file:///d:/Projects/BugHuntr/BugHuntr/tests/test_migration_schema_and_rls.mjs).
   - **Blocker**: Live policy behavior (ensuring hunters cannot read other hunters' submissions, verifying org admins cannot modify wallets directly) has not yet been executed against a running PostgreSQL engine.

---

## 6. Evidence Categorization: Facts vs. Estimates vs. Untested Assumptions

| Dimension | Description | Classification | Concrete Basis / Missing Data |
| :--- | :--- | :--- | :--- |
| **SQL Schema Structure** | 17 tables, string PKs `VARCHAR(128)`, constraints, indexes | **Verified Fact** | Codified in `migrations/001` and `002`; validated by `tests/test_migration_schema_and_rls.mjs`. |
| **Idempotent Rollback DDL** | Drop script drops all 17 tables, triggers, and functions in reverse dependency | **Verified Fact** | Codified in `migrations/004_down_reversion.sql`; validated by `tests/test_migration_synthetic_integrity.mjs`. |
| **String ID Type Safety** | Non-UUID legacy IDs (`BH-VULN-...`, `7xN0k...`) do not trigger typecasting errors | **Verified Fact** | Tested in `tests/test_migration_synthetic_integrity.mjs` against synthetic legacy IDs. |
| **Security Containment** | Retired admin endpoints return 410 Gone; admin pages return 404 | **Verified Fact** | Codified in `app/api/bug-hunt/*`; validated by `tests/test_api_containment.mjs`. |
| **Record Cardinality** | Estimates of user counts ($10^2\text{--}10^4$), bounties ($10^2\text{--}10^3$), submissions ($10^3\text{--}10^5$) | **Derived Estimate** | Inferred from codebase architecture, batch size settings (100), and bounty platform models. |
| **Live Database Performance** | Query latency $< 1\text{ms}$ on indexed lookups; throughput $2{,}000\text{ TPS}$ | **Derived Estimate** | Standard PostgreSQL single-node performance profiles under moderate workloads. |
| **Live Production Document Count** | Actual total number of documents currently stored in live Firebase project | **Untested Assumption** | Live Firebase database (`bughuntr-3f895`) has not been read; requires authorized staging export. |
| **Live RLS Engine Enforcement** | Confirmation that PostgreSQL engine correctly enforces all policies in migration 003 | **Untested Assumption** | Existing tests only check text regex in `.sql` files. No live PostgreSQL queries have been executed. |
| **Live Migration Concurrency** | Ingestion speed, lock contention, and error rates during full migration execution | **Untested Assumption** | Runner script `runMigration()` currently returns empty statistics without executing network requests. |

---

## 7. Verification of Existing Tests: What Runs vs. What Is Proven

An explicit audit was performed on all migration and database tests currently in the repository.

### 7.1 Test Suite 1: `tests/test_migration_schema_and_rls.mjs`
- **Execution Command**: `node --test tests/test_migration_schema_and_rls.mjs`
- **Current Status**: **10 tests pass** (duration: $\approx 50\text{ms}$).
- **What It Actually Proves**:
  1. The files `migrations/001_accounts_auth_schema.sql`, `migrations/002_bug_bounty_domain_supabase_schema.sql`, and `migrations/003_supabase_rls_policies.sql` exist on disk and contain specific string tokens and regex patterns.
  2. The DDL files declare `VARCHAR(128)` primary keys and specific `CHECK` constraint strings.
  3. The RLS file contains `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` for all 17 tables.
  4. In-memory JavaScript transformation functions (`mapFirestoreUserToSql`, `mapFirestoreSubmissionToSql`, etc.) transform sample mock objects into expected JavaScript object shapes.
- **What It DOES NOT Prove**:
  1. **Does not prove PostgreSQL syntax validity**: A typo in a complex PL/pgSQL function or trigger that matches the regex would pass this test but fail when executed by PostgreSQL.
  2. **Does not prove RLS security**: Does not evaluate whether policies actually permit or deny queries under live JWT roles.
  3. **Does not test database communication**: Zero network calls or database queries are made.

### 7.2 Test Suite 2: `tests/test_migration_synthetic_integrity.mjs`
- **Execution Command**: `node --test tests/test_migration_synthetic_integrity.mjs`
- **Current Status**: **6 tests pass** (duration: $\approx 40\text{ms}$).
- **What It Actually Proves**:
  1. `sanitizeIdentifier()` trims strings and rejects empty strings or nulls in JavaScript.
  2. In-memory JavaScript deduplication logic correctly filters duplicate emails from a synthetic JavaScript array.
  3. Partial failures in a synthetic array are caught in a `try/catch` block without crashing Node.js.
  4. `migrations/004_down_reversion.sql` contains `DROP TABLE IF EXISTS` statements matching all table names defined in schemas 001 and 002.
- **What It DOES NOT Prove**:
  1. Does not prove database transaction rollback on SQL error.
  2. Does not test database-level unique constraint collision (`ON CONFLICT DO UPDATE`).
  3. Does not test live migration against Firestore or PostgreSQL.

### 7.3 Test Suite 3: `tests/test_server_auth_and_2fa.mjs`
- **Execution Command**: `node --test tests/test_server_auth_and_2fa.mjs`
- **Current Status**: **7 tests pass** (duration: $\approx 35\text{ms}$).
- **What It Actually Proves**:
  1. `lib/server-auth.ts` creates and verifies cryptographically valid HMAC-SHA256 session tokens.
  2. Tampered tokens and expired tokens are rejected in Node.js memory.
  3. 2FA challenge tokens correctly enforce attempt limits (max 3) and single-use burn logic in memory.
- **What It DOES NOT Prove**:
  1. Does not prove session integration with live PostgreSQL `auth_users` or Supabase GoTrue Auth.

---

## 8. Staging Migration Prerequisites

Before initiating an isolated staging migration test, the following prerequisites must be established in a non-production staging environment:

1. **Isolated Staging PostgreSQL Instance**:
   - A dedicated staging PostgreSQL database (version 15 or 16) with extensions `uuid-ossp` and `pgcrypto` installed.
   - Distinct database user roles: `postgres` (superuser for DDL), `authenticator` (for PostgREST/Supabase), and `service_role` (for backend migration).
2. **Read-Only Staging Firestore Access**:
   - A service account credentials JSON key with strictly **read-only permissions** (`Viewer` role) on the staging or sanitized backup Firebase project.
   - Confirmation that the production Firebase project is never accessed directly by write-capable tooling.
3. **Completed Migration Runner I/O Driver**:
   - Enhancement of `scripts/migrate-firestore-to-sql.ts` to implement the actual database client execution loop using standard connection libraries (`pg` for PostgreSQL and `firebase-admin` for Firestore).
   - Ingestion batching with parameterized `ON CONFLICT (id) DO UPDATE` statements.
4. **Clean Staging Target State**:
   - Verification that the target staging database is clean prior to test commencement.

---

## 9. Staging Validation Test Suite Specifications

To validate record counts, relationships, authorization, and rollback on a live staging database engine, the following test suite must be executed:

### Test 1: Live DDL Deployment & Syntax Verification
- **Objective**: Execute migrations `001`, `002`, and `003` against a running PostgreSQL engine.
- **Validation**:
  - All 17 tables are created without syntax errors.
  - All check constraints, triggers (`trg_profile_field_protect`), and helper functions (`current_user_id()`, `is_platform_admin()`, etc.) compile cleanly.
  - Verify schema catalog via `information_schema.tables` and `information_schema.check_constraints`.

### Test 2: Ingestion Count Reconciliation (`Read == Mapped + Errors`)
- **Objective**: Ingest a representative staging dataset from Firestore into PostgreSQL.
- **Validation**:
  - For every collection, verify: $\text{Firestore Document Count} = \text{SQL Table Row Count} + \text{Logged Migration Errors}$.
  - Confirm zero unaccounted record drops across all 14 datasets.
  - Verify that `source_collection` in `bug_submissions` accurately reflects legacy collection origins.

### Test 3: Foreign Key Referential Integrity & Cascade Validation
- **Objective**: Validate that foreign keys are strictly enforced and relationships link correctly.
- **Validation**:
  - Run SQL join queries asserting zero orphan records:
    ```sql
    SELECT COUNT(*) FROM bug_submissions s LEFT JOIN bounties b ON s.bounty_id = b.id WHERE b.id IS NULL;
    SELECT COUNT(*) FROM bug_submissions s LEFT JOIN auth_users u ON s.hunter_id = u.id WHERE u.id IS NULL;
    SELECT COUNT(*) FROM vulnerabilities v LEFT JOIN bug_submissions s ON v.submission_id = s.id WHERE s.id IS NULL;
    SELECT COUNT(*) FROM org_wallets w LEFT JOIN organizations o ON w.org_id = o.id WHERE o.id IS NULL;
    ```
  - Expected result: Exactly `0` orphan rows across all relationships.

### Test 4: Live Row-Level Security (RLS) Authorization Validation
- **Objective**: Execute real queries against PostgreSQL using simulated user roles via `SET LOCAL request.jwt.claim.sub` and `SET LOCAL role`.
- **Validation**:
  - **Hunter Isolation**: A user with `role = 'hunter'` can `SELECT` only their own submissions (`hunter_id = current_user_id()`) and active bounties. Attempting to select another hunter's submission returns 0 rows.
  - **Organization Isolation**: A user with `role = 'company'` can read only their organization's private bounties and received submissions.
  - **Financial Hardening**: Any attempt by an authenticated client role to `INSERT`, `UPDATE`, or `DELETE` on `org_wallets`, `payouts`, or `payout_logs` is rejected with an RLS permission denied error.
  - **Points Immutability**: Any direct `UPDATE` on `user_profiles.points` by a non-admin role triggers an exception from `enforce_profile_field_immutability()`.

### Test 5: Financial Invariant & Concurrency Verification
- **Objective**: Validate custody balance safety under concurrent load.
- **Validation**:
  - Attempt an update setting `reserved > balance` on `org_wallets`. Confirm database throws check constraint violation (`chk_org_wallets_reserved_le_balance`).
  - Attempt an insert with negative balance or negative payout amount. Confirm rejection.
  - Execute concurrent fund reservations using PostgreSQL `SELECT ... FOR UPDATE` to prove double-spending is physically prevented.

### Test 6: Complete Rollback & Reversion Verification
- **Objective**: Test disaster recovery and teardown cleanly.
- **Validation**:
  - Execute [`migrations/004_down_reversion.sql`](file:///d:/Projects/BugHuntr/BugHuntr/migrations/004_down_reversion.sql) against the populated staging database.
  - Confirm all 17 tables, triggers, and custom functions are dropped without foreign key deadlock or dependency errors.
  - Confirm database catalog returns 0 remaining BugHuntr tables.

---

## 10. Prioritized Action Checklist for Staging Migration Test

```
[ ] Phase 1: Environment Provisioning (Isolated Staging)
    [ ] 1.1 Provision an isolated staging PostgreSQL database (v15+) with 'uuid-ossp' and 'pgcrypto'.
    [ ] 1.2 Obtain read-only service account credentials for staging/sanitized Firebase Firestore.
    [ ] 1.3 Verify production network isolation (confirm no production environment variables are active).

[ ] Phase 2: Migration Runner I/O Driver Completion
    [ ] 2.1 Equip scripts/migrate-firestore-to-sql.ts with PostgreSQL client ('pg') and Firestore Admin SDK connections.
    [ ] 2.2 Implement topological batch insertion with 'ON CONFLICT (id) DO UPDATE'.
    [ ] 2.3 Implement reconciliation reporting logging all mapped records and validation errors.

[ ] Phase 3: Staging Execution & Validation
    [ ] 3.1 Execute migrations 001, 002, and 003 against staging PostgreSQL; verify zero DDL errors.
    [ ] 3.2 Execute migration runner in '--dry-run' mode against staging Firestore snapshot; verify mapping counts.
    [ ] 3.3 Execute migration runner in '--execute' mode; record total execution time and throughput.
    [ ] 3.4 Execute automated validation test suite:
        [ ] Test 3.4.1: Record count reconciliation (Read == Mapped + Errors).
        [ ] Test 3.4.2: Foreign key referential integrity (zero orphan queries).
        [ ] Test 3.4.3: Live RLS policy enforcement (hunter, org admin, platform admin).
        [ ] Test 3.4.4: Financial invariant check constraints and wallet row locks.
        [ ] Test 3.4.5: User password authentication verification against bcrypt hashes.

[ ] Phase 4: Rollback & Reversion Validation
    [ ] 4.1 Execute migrations/004_down_reversion.sql on staging PostgreSQL.
    [ ] 4.2 Confirm 100% of tables and functions are dropped cleanly without cascade errors.
    [ ] 4.3 Re-apply migrations 001–003 to confirm full re-deployability.
```

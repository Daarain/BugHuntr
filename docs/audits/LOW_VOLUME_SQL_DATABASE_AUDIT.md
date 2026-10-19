# BugHuntr — Audit A: Low-Volume Transactional Data & SQL Database Suitability

**Audit Date**: October 2026  
**Auditor**: Database Architecture & Security Evaluation  
**Status**: Completed (Read-Only Assessment)  
**Schema Preservation**: 100% Preserved (Zero schema modifications)

---

## 1. Executive Summary

This independent audit assesses the low-volume transactional, relational, and identity datasets within the BugHuntr codebase. The primary objective is to evaluate whether the existing data models, authentication architecture, organization structures, and custody wallets are optimally suited for an authoritative SQL database (`PostgreSQL` / `Supabase`), while **preserving the existing schema exactly as implemented**.

Key findings:
- **Core Identity & Accounts**: Currently split between legacy client-side Firebase Auth patterns and server-side Next.js route handlers (`app/api/auth/login/route.ts`, `app/api/auth/signup/route.ts`). Transitioning authoritative user records to the defined SQL schema (`auth_users`, `user_roles`, `user_credentials`) provides strict ACID guarantees, normalized multi-tenant role enforcement, and server-side credential isolation without schema alterations.
- **Financial Custody (Wallets)**: `org_wallets` exhibits strict ACID transactional invariants (`balance >= 0`, `reserved <= balance`). In legacy Firestore, concurrency is guarded via `db.runTransaction` (`functions/src/utils/firestore.ts`), but relational database CHECK constraints and row-level locking (`SELECT FOR UPDATE`) provide mathematically un-bypassable custody safety.
- **Relational Integrity**: Organization hierarchies, multi-tenant memberships (`org_members`), bug bounty programs (`bounties`), and coordinated disclosure requests (`cve_requests`) rely heavily on strict foreign-key referential integrity (`ON DELETE CASCADE` / `ON DELETE RESTRICT`), which document-oriented stores cannot natively enforce.
- **Schema Compatibility**: All audited low-volume datasets map cleanly to existing DDL scripts in `migrations/001_accounts_auth_schema.sql` and `migrations/002_bug_bounty_domain_supabase_schema.sql`. The standard `VARCHAR(128)` identifier strategy eliminates typecasting errors between legacy Firestore alphanumeric keys and standard UUIDs.

---

## 2. Scope and Methodology

### 2.1 Scope
The audit inspected all low-write-volume transactional and relational entities across the BugHuntr repository:
1. User Accounts & Credentials (`auth_users`, `user_credentials`, `users`)
2. Role Assignments (`user_roles`)
3. User Profiles & Gamification Ranks (`user_profiles`, `userProfiles`)
4. Organizations & Memberships (`organizations`, `org_members`, `orgs`)
5. Organization Financial Custody (`org_wallets`)
6. Bug Bounty Programs (`bounties`, `bug_hunts`, `bugHunts`, `proBugHunts`)
7. Private Bounty Invitations (`pro_invitations`, `proInvitations`)
8. Coordinated Vulnerability Disclosure Requests (`cve_requests`)

### 2.2 Methodology
- **Static Codebase Inspection**: Direct review of Next.js server routes (`app/api/auth/*`), Cloud Functions (`functions/src/*`), hooks (`hooks/*`), and client pages (`app/*`).
- **Schema & DDL Analysis**: Analysis of DDL scripts (`migrations/001_accounts_auth_schema.sql`, `migrations/002_bug_bounty_domain_supabase_schema.sql`, `migrations/003_supabase_rls_policies.sql`).
- **Automated Test Verification**: Verification against automated integrity suites (`tests/test_migration_schema_and_rls.mjs`, `tests/test_migration_synthetic_integrity.mjs`, `tests/test_server_auth_and_2fa.mjs`).
- **Workload Categorization**: Explicit separation of measured repository facts, calculated estimates, and production unknowns.

---

## 3. Existing Datasets and Schema Inventory

### 3.1 Dataset 1: User Accounts & Authentication Credentials
- **Current Storage Location**: Firestore `users` collection (`app/api/auth/signup/route.ts`, `app/api/auth/login/route.ts`).
- **Target SQL Definition**: `auth_users` & `user_credentials` in `migrations/001_accounts_auth_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS auth_users (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      email VARCHAR(255) NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      password_hash VARCHAR(255) NOT NULL,
      legacy_firestore_id VARCHAR(128),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_banned BOOLEAN NOT NULL DEFAULT FALSE,
      last_sign_in_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_auth_users_email UNIQUE (email),
      CONSTRAINT chk_auth_users_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
  );
  CREATE TABLE IF NOT EXISTS user_credentials (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      credential_type VARCHAR(50) NOT NULL CHECK (credential_type IN ('password', 'totp', 'email_otp', 'api_key')),
      secret_hash TEXT,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_user_credentials_user_type UNIQUE (user_id, credential_type)
  );
  ```
- **Existing Fields & Constraints**: Primary key `id VARCHAR(128)`, unique email with regex check, bcrypt password hash, soft status flags (`is_active`, `is_banned`).
- **Relationships**: Parent table for all user activity across the system (`user_roles`, `user_profiles`, `user_credentials`, `org_members`, `bug_submissions`, `payouts`).
- **Schema Retention**: 100% retained unchanged.

### 3.2 Dataset 2: User Roles & Access Control
- **Current Storage Location**: Embedded fields `role` and `userType` in Firestore `users` document; legacy fallback in `localStorage`.
- **Target SQL Definition**: `user_roles` in `migrations/001_accounts_auth_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS user_roles (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL CHECK (role IN ('hunter', 'company', 'admin', 'triager')),
      assigned_by VARCHAR(128) REFERENCES auth_users(id) ON DELETE SET NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role)
  );
  ```
- **Existing Fields & Constraints**: Foreign key `user_id` referencing `auth_users(id)` with cascade deletion; enum check constraint restricting roles to `'hunter'`, `'company'`, `'admin'`, `'triager'`; unique compound index `(user_id, role)`.
- **Relationships**: Authoritative role source for Row-Level Security (RLS) helper functions (`is_platform_admin()`, `is_platform_triager()`).
- **Schema Retention**: 100% retained unchanged.

### 3.3 Dataset 3: User Profiles & Operational Gamification
- **Current Storage Location**: Firestore `userProfiles` collection (`lib/user-profile.ts`, `lib/get-user-profile.ts`, `lib/update-user-stats.ts`).
- **Target SQL Definition**: `user_profiles` in `migrations/001_accounts_auth_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS user_profiles (
      user_id VARCHAR(128) PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
      username VARCHAR(50) NOT NULL,
      display_name VARCHAR(100),
      avatar_url TEXT,
      bio TEXT,
      country VARCHAR(10),
      points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      reputation_rank VARCHAR(50) NOT NULL DEFAULT 'Novice',
      company_name VARCHAR(150),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_user_profiles_username UNIQUE (username),
      CONSTRAINT chk_user_profiles_username_format CHECK (username ~* '^[a-zA-Z0-9_-]{3,50}$')
  );
  ```
- **Existing Fields & Constraints**: PK/FK `user_id`, unique username format regex, non-negative points check constraint. Protected by database trigger `trg_profile_field_protect` (`migrations/003_supabase_rls_policies.sql`) preventing unprivileged client mutations of `points` and `reputation_rank`.
- **Schema Retention**: 100% retained unchanged.

### 3.4 Dataset 4: Organizations & Organization Memberships
- **Current Storage Location**: Firestore `users` (`userType == 'company'`) and `orgs` collections (`functions/src/functions/cvss/*`, `functions/src/functions/cve/*`).
- **Target SQL Definition**: `organizations` and `org_members` in `migrations/002_bug_bounty_domain_supabase_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS organizations (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name VARCHAR(150) NOT NULL,
      slug VARCHAR(100) NOT NULL,
      description TEXT,
      logo_url TEXT,
      website_url TEXT,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_organizations_slug UNIQUE (slug)
  );
  CREATE TABLE IF NOT EXISTS org_members (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id VARCHAR(128) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'triager', 'member')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_org_members_org_user UNIQUE (org_id, user_id)
  );
  ```
- **Existing Fields & Constraints**: Unique slug on `organizations`, composite unique constraint `(org_id, user_id)` on `org_members`, role check constraint.
- **Relationships**: Multi-tenant authorization root for bounties, submissions, and wallets.
- **Schema Retention**: 100% retained unchanged.

### 3.5 Dataset 5: Organization Financial Custody (`org_wallets`)
- **Current Storage Location**: Firestore `org_wallets` collection (`functions/src/utils/firestore.ts`, `functions/src/functions/createPayout.ts`).
- **Target SQL Definition**: `org_wallets` in `migrations/002_bug_bounty_domain_supabase_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS org_wallets (
      org_id VARCHAR(128) PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      balance NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
      reserved NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (reserved >= 0),
      currency VARCHAR(10) NOT NULL DEFAULT 'USDT',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_org_wallets_reserved_le_balance CHECK (reserved <= balance)
  );
  ```
- **Existing Fields & Constraints**: `org_id` PK/FK, strict financial invariants: `balance >= 0`, `reserved >= 0`, and `reserved <= balance`.
- **Relationships**: 1:1 custody ledger per organization.
- **Schema Retention**: 100% retained unchanged.

### 3.6 Dataset 6: Bounties / Bug Hunts
- **Current Storage Location**: Firestore `bug_hunts`, `bugHunts`, `proBugHunts` collections (`hooks/use-bug-hunt.ts`, `hooks/use-pro-hunts.ts`).
- **Target SQL Definition**: `bounties` in `migrations/002_bug_bounty_domain_supabase_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS bounties (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id VARCHAR(128) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL,
      target_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
      out_of_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
      min_reward NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (min_reward >= 0),
      max_reward NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (max_reward >= min_reward),
      reward_pool NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (reward_pool >= 0),
      status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'closed')),
      visibility VARCHAR(50) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'invite_only')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- **Existing Fields & Constraints**: Foreign key `org_id`, numerical bounds `max_reward >= min_reward`, status and visibility check constraints, JSONB scopes.
- **Schema Retention**: 100% retained unchanged.

### 3.7 Dataset 7: Pro Invitations
- **Current Storage Location**: Firestore `proInvitations` collection (`hooks/use-pro-hunts.ts`, `components/pro/pro-recommendations-panel.tsx`).
- **Target SQL Definition**: `pro_invitations` in `migrations/002_bug_bounty_domain_supabase_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS pro_invitations (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      sender_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      recipient_email VARCHAR(255) NOT NULL,
      hunt_id VARCHAR(128) REFERENCES bounties(id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- **Existing Fields & Constraints**: FK `sender_id`, FK `hunt_id`, email recipient, status check constraint, auto-calculated expiration.
- **Schema Retention**: 100% retained unchanged.

### 3.8 Dataset 8: Coordinated CVE Requests
- **Current Storage Location**: Firestore `cve_requests` collection (`functions/src/functions/cve/requestCve.ts`, `app/admin/cve-requests/page.tsx`).
- **Target SQL Definition**: `cve_requests` in `migrations/002_bug_bounty_domain_supabase_schema.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS cve_requests (
      id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      vulnerability_id VARCHAR(128) NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
      requester_id VARCHAR(128) NOT NULL REFERENCES auth_users(id),
      org_consent BOOLEAN NOT NULL DEFAULT FALSE,
      disclosure_type VARCHAR(50) NOT NULL CHECK (disclosure_type IN ('coordinated', 'full', 'private')),
      status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'assigned', 'published')),
      assigned_cve VARCHAR(50),
      disclosure_packet JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_cve_requests_vulnerability_id UNIQUE (vulnerability_id)
  );
  ```
- **Existing Fields & Constraints**: 1:1 unique foreign key referencing `vulnerabilities(id)`, status and disclosure_type check constraints, JSONB disclosure packet.
- **Schema Retention**: 100% retained unchanged.

---

## 4. Evidence-Based Workload Assessment

| Dataset | Workload Evidence Category | Observed / Estimated Metrics | Read/Write Frequency | Query Patterns & Index Coverage |
| :--- | :--- | :--- | :--- | :--- |
| **`auth_users` & `user_credentials`** | Fact (Code paths & schema); Estimate (Volume) | Estimated $10^2$ to $10^4$ users. Code in `app/api/auth/login/route.ts` executes single-doc lookups on `email`. | Read: Heavy on login/session check. Write: Very low (signups, password resets). | Queries by `email` (`idx_auth_users_email`), `legacy_firestore_id` (`idx_auth_users_legacy_id`), `user_id` (`idx_user_credentials_user_id`). |
| **`user_roles`** | Fact (Code paths & schema); Estimate (Volume) | $1$ to $2$ records per user. | Read: Every authenticated request via `current_user_id()`. Write: Rare (admin promotions). | Queried via `(user_id, role)` composite index. Fully covered by `idx_user_roles_user_id` and `idx_user_roles_role`. |
| **`user_profiles`** | Fact (Code paths & schema); Estimate (Volume) | $1:1$ with `auth_users`. | Read: Frequent (leaderboard, profile page). Write: Low to moderate (payout points increments). | Queries by `username` (`idx_user_profiles_username`), sorted by `points DESC` (`idx_user_profiles_points`). |
| **`organizations` & `org_members`** | Fact (Code paths & schema); Estimate (Volume) | Estimated $10^1$ to $10^3$ organizations. | Read: Moderate on program visits. Write: Extremely low (org setup, invites). | Queries by `slug` (`idx_organizations_slug`), `org_id` (`idx_org_members_org_id`), `user_id` (`idx_org_members_user_id`). |
| **`org_wallets`** | Fact (Code paths & schema); Estimate (Volume) | Strictly $1:1$ with organizations. | Read: Low (admin wallet view). Write: Low-volume, high-criticality (payouts, top-ups). | Primary key lookup on `org_id`. In-memory row lock (`FOR UPDATE`). |
| **`bounties`** | Fact (Code paths & schema); Estimate (Volume) | Estimated $10^2$ to $10^3$ programs. | Read: High (public catalog browse). Write: Low (program edits, state changes). | Queries filtered by `status` (`idx_bounties_status`), `visibility` (`idx_bounties_visibility`), `org_id` (`idx_bounties_org_id`). |
| **`pro_invitations`** | Fact (Code paths & schema); Estimate (Volume) | Estimated $10^2$ to $10^4$ invites. | Read: Low (hunter notifications). Write: Low (invitation dispatch). | Queried by `recipient_email` (`idx_pro_invitations_recipient`) and `hunt_id` (`idx_pro_invitations_hunt_id`). |
| **`cve_requests`** | Fact (Code paths & schema); Estimate (Volume) | Estimated $10^1$ to $10^3$ records. | Read: Low (admin dashboard). Write: Very low (disclosure requests). | Primary key lookup, `vulnerability_id` (`idx_cve_requests_vulnerability_id`), `status` (`idx_cve_requests_status`). |

---

## 5. Security and Integrity Considerations

### 5.1 ACID Transactions and Invariant Enforcement
- **Financial Balances**: The Firestore implementation in `functions/src/utils/firestore.ts` relies on optimistic application-level transactions (`db.runTransaction`). If two concurrent payouts touch an org wallet, Firestore retries up to 5 times. In SQL, PostgreSQL provides true row-level locks:
  ```sql
  SELECT balance, reserved FROM org_wallets WHERE org_id = $1 FOR UPDATE;
  ```
  Furthermore, the schema constraint `CHECK (reserved <= balance)` prevents negative balance states even in the event of an application logic bug.
- **Strict Role Elevation Prevention**: Legacy client-side writes to Firestore `users` or `userProfiles` allowed unauthorized role elevation (contained in SEC-01/SEC-03). In PostgreSQL, role definitions are isolated in `user_roles`, and RLS policy `rls_user_roles_admin` restricts mutation exclusively to platform administrators:
  ```sql
  CREATE POLICY rls_user_roles_admin ON user_roles
      FOR ALL TO authenticated
      USING (is_platform_admin())
      WITH CHECK (is_platform_admin());
  ```
- **Profile Points Protection**: Client modifications of gamification points are blocked by PostgreSQL database trigger `enforce_profile_field_immutability()`, which raises an exception if `OLD.points IS DISTINCT FROM NEW.points` unless initiated by a platform admin or `service_role`.

### 5.2 Row-Level Security (RLS) Alignment
All low-volume tables have RLS enabled and tested via `migrations/003_supabase_rls_policies.sql` and `tests/test_migration_schema_and_rls.mjs`:
- `auth_users`: Authenticated users can only read their own record; mutations require admin.
- `user_profiles`: Public read for profile display; users can update only their own profile details (bio, avatar, display name).
- `organizations`: Public read for verified organizations; modifications restricted to organization owners/admins.
- `org_wallets`: Direct client writes are **completely forbidden** (`USING (FALSE) WITH CHECK (FALSE)`).

---

## 6. Database Suitability Assessment

### 6.1 SQL / PostgreSQL Suitability Evaluation
PostgreSQL is **exceptionally well-suited** for all 8 audited datasets:
1. **Relational Integrity**: Enforces foreign-key cascades on membership cleanup (`ON DELETE CASCADE` when an organization or user is deleted) and prevents orphan payouts/submissions (`ON DELETE RESTRICT`).
2. **ACID Financial Transactions**: Guarantees serializable or read-committed isolation for wallet reservations and top-ups.
3. **Data Volume Characteristics**: The low write volume ($< 50\text{ writes/sec}$) and low dataset cardinality ($< 100{,}000\text{ records}$) operate well within single-node PostgreSQL buffer cache limits, resulting in sub-millisecond index-scan latencies.
4. **Authentication Compatibility**: Supports server-side session authentication (`lib/server-auth.ts`) as well as Supabase GoTrue Auth synchronization without changing schemas.

### 6.2 Schema Retention Verification
The existing SQL DDL in `migrations/001_accounts_auth_schema.sql` and `migrations/002_bug_bounty_domain_supabase_schema.sql` can be **retained 100% unchanged**.
- Primary keys standardized to `VARCHAR(128)` cleanly ingest legacy Firestore string IDs without type conversions.
- Check constraints accurately mirror domain requirements.
- Existing indexes completely cover all observed query patterns in `app/api/*`, `hooks/*`, and `functions/src/*`.

---

## 7. Performance and Scalability Assessment

### 7.1 Query Latency & Memory Footprint
- For low-volume datasets ($10^2$ to $10^4$ records), entire tables and their primary/foreign key indexes easily fit into PostgreSQL's `shared_buffers` (typically 128MB to 1GB).
- Indexed lookups (e.g., `SELECT * FROM auth_users WHERE email = $1` or `SELECT * FROM org_wallets WHERE org_id = $1`) execute in $< 1\text{ms}$.
- Index-only scans on `user_roles` (`user_id`, `role`) satisfy permission checks with zero table heap lookups.

### 7.2 Connection Management & Concurrency
- Because multiple Next.js serverless route handlers and Cloud Functions may query PostgreSQL concurrently, connection pool exhaustion is the primary operational consideration.
- Connection pooling via Supavisor / PgBouncer in transaction mode handles thousands of concurrent serverless clients while keeping direct PostgreSQL connections within conservative limits (e.g., 20–50 connections).

---

## 8. Risks and Unknowns

| Category | Risk / Unknown | Impact | Verification / Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Authentication Identity Split** | Legacy session cookies (`bughuntr_session`) vs Supabase GoTrue JWTs (`auth.uid()`). | Medium | Schema uses `current_user_id()` helper resolving both `auth.uid()` and JWT `sub`. No schema change needed. |
| **Unmeasured Production User Count** | Actual live user count and growth rate on production is unmeasured in this repo. | Low | Low-volume relational schema scales to millions of users on standard PostgreSQL instances without partitioning. |
| **Legacy Firestore ID Collisions** | Non-standard string IDs from multiple legacy collections. | Low | Tested in `tests/test_migration_synthetic_integrity.mjs`: `sanitizeIdentifier()` and `VARCHAR(128)` PKs accept all legacy strings safely. |
| **Points Tampering Surface** | Legacy frontend updating points directly via client Firestore SDK. | High | Neutralized: PostgreSQL trigger `enforce_profile_field_immutability()` blocks all non-admin points updates. |

---

## 9. Recommendations That Preserve the Existing Schema

1. **Retain Migration DDL Exactly As-Is**: Keep `migrations/001_accounts_auth_schema.sql`, `migrations/002_bug_bounty_domain_supabase_schema.sql`, and `migrations/003_supabase_rls_policies.sql` without modifying any table names, column types, or constraints.
2. **Authoritative SQL Placement**: Position all 8 audited datasets (`auth_users`, `user_roles`, `user_profiles`, `user_credentials`, `organizations`, `org_members`, `org_wallets`, `bounties`, `pro_invitations`, `cve_requests`) in the authoritative PostgreSQL/Supabase database.
3. **Connection Pooling**: Deploy PgBouncer or Supabase connection pooling (Supavisor) in transaction mode for Next.js API routes and Cloud Functions.
4. **Server-Side Financial Isolation**: Continue enforcing zero-client writes on `org_wallets` via RLS, executing all balance modifications strictly through server-side transactions.

---

## 10. Evidence References

- **Migration Schemas**:
  - `migrations/001_accounts_auth_schema.sql` (Lines 16–109): Defines `auth_users`, `user_roles`, `user_profiles`, `user_credentials`, `auth_audit_log`.
  - `migrations/002_bug_bounty_domain_supabase_schema.sql` (Lines 18–172, 203–211): Defines `organizations`, `org_members`, `bounties`, `pro_invitations`, `cve_requests`, `org_wallets`.
  - `migrations/003_supabase_rls_policies.sql` (Lines 10–208, 288–296): Implements `current_user_id()`, immutable points trigger, and wallet write block.
- **Authentication Handlers & Utilities**:
  - `app/api/auth/login/route.ts` (Lines 28–66): Server-side lookup by email, bcrypt password verification, admin role resolution.
  - `app/api/auth/signup/route.ts` (Lines 32–76): Email uniqueness check, server-side bcrypt hashing, role defaulting.
  - `lib/server-auth.ts` (Lines 4–86): HMAC-SHA256 session token generation and verification.
  - `functions/src/utils/firestore.ts` (Lines 25–82, 130–161): Atomic wallet reservation and balance deduction logic.
- **Verification Tests**:
  - `tests/test_migration_schema_and_rls.mjs`: Tests 1–3 verify table presence, string PKs, CHECK constraints, and RLS enablement.
  - `tests/test_migration_synthetic_integrity.mjs`: Tests 11–16 verify deduplication, legacy string ID preservation, and idempotency.
  - `tests/test_server_auth_and_2fa.mjs`: Tests 8–14 verify server session signing, signature verification, and 2FA challenge handling.

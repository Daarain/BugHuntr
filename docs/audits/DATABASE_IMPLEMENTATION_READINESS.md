# BugHuntr — Database Implementation Readiness Checklist
## Dual-Database Architecture: SQL (Supabase PostgreSQL) & MongoDB

**Document**: `docs/audits/DATABASE_IMPLEMENTATION_READINESS.md`  
**Date**: October 2026  
**Status**: Authoritative Readiness Checklist & Pre-Implementation Specification  
**Assessment Type**: Read-Only Inspection & Gap Analysis  
**Scope Preservation**: Zero application code modified, zero dependencies installed, zero migrations executed  

---

## 1. Executive Summary

This readiness specification establishes the objective technical prerequisites, dependency graph, and gap analysis required before commencing code changes or database deployments for BugHuntr's finalized dual-database architecture:
- **SQL (Supabase PostgreSQL)**: Restricted strictly to user identity, accounts, credentials, roles, 2FA, and authentication-security audit logs.
- **MongoDB**: Authoritative for all other application domain data, including organizations, bug hunts, bug reports, submissions, vulnerabilities, custody wallets, payouts, payout logs, gamification balances, and community collaboration.

Every prerequisite across the 8 required technical domains has been evaluated against direct repository evidence and classified into one of three empirical tiers:
1. **Verified from Repository Evidence**: Codified in existing schemas, scripts, routes, or passing unit test assertions.
2. **Missing**: Required software libraries, connection modules, scripts, or schemas that currently do not exist in the codebase.
3. **Unknown / Requires Environment Confirmation**: External infrastructure properties, production database statistics, or live network configurations that cannot be established from repository files alone.

---

## 2. Prerequisite Evaluation & Verification Matrix

| Area # | Technical Prerequisite Domain | Repository Evidence & Analysis | Classification | Status & Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **1.1** | **PostgreSQL Connection Driver** | Root `package.json` contains `firebase: ^12.3.0`, `bcryptjs: ^3.0.2`, `axios: ^1.13.2`. Neither `pg`, `@types/pg`, nor `@supabase/supabase-js` is installed. | **Missing** | Install `pg` (or `@supabase/supabase-js`) in root `package.json`. |
| **1.2** | **MongoDB Connection Driver** | Neither `mongodb` nor `mongoose` is listed in root `package.json` or `functions/package.json`. | **Missing** | Install `mongodb` driver in root and functions packages. |
| **1.3** | **Connection String Configuration** | Code search confirms environment variables `POSTGRES_URL`, `DATABASE_URL`, `SUPABASE_URL`, and `MONGODB_URI` are completely absent from codebase. | **Missing** | Define `.env.example` containing isolated connection strings for staging/dev. |
| **1.4** | **Database Client Singletons & Pooling** | No connection pooling modules exist in `lib/`. Server routes lack connection management (Supavisor / `pg.Pool` or cached `MongoClient`). | **Missing** | Create `lib/db/postgres.ts` and `lib/db/mongodb.ts` connection factories. |
| **2.1** | **MongoDB Replica Set for Transactions** | In MongoDB, multi-document ACID transactions (`session.withTransaction`) are physically permitted **only** on a Replica Set. Standalone nodes throw runtime errors. | **Unknown / Requires Environment Confirmation** | Repository lacks Docker compose, Helm, or Atlas manifests. Staging and production infrastructure must be verified as a Replica Set. |
| **2.2** | **Conditional Atomic Wallet Updates** | In `functions/src/utils/firestore.ts`, balance checks use Firestore transactions. Equivalent MongoDB atomic expressions (`$inc` with `$expr: { $gte: [...] }`) are not yet written. | **Missing** | Author MongoDB wallet repository module using atomic conditional filters. |
| **3.1** | **Bcrypt Password Hash Compatibility** | `app/api/auth/signup/route.ts#L49` uses `bcrypt.hash(password, 10)`. Target `auth_users` table specifies `password_hash VARCHAR(255) NOT NULL`. Hash format matches bcrypt standard. | **Verified from Repository Evidence** | Codified in server auth and schema `001`. |
| **3.2** | **Live PostgreSQL Auth Verification** | Login route currently executes Firestore queries (`collection(db, "users")`). Zero live queries have been run against PostgreSQL `auth_users`. | **Unknown / Requires Environment Confirmation** | Live authentication against PostgreSQL remains untested until staging DB is online. |
| **3.3** | **Session Cookie Verification Logic** | `lib/server-auth.ts` creates and verifies HMAC-SHA256 `bughuntr_session` cookies in Node.js memory. Tested and passing in `tests/test_server_auth_and_2fa.mjs`. | **Verified from Repository Evidence** | Verified by existing Node.js test suite. |
| **4.1** | **User ID String Type Compatibility** | `migrations/001` declares `id VARCHAR(128)` and `legacy_firestore_id VARCHAR(128)`. `tests/test_migration_synthetic_integrity.mjs` proves string IDs do not trigger UUID errors. | **Verified from Repository Evidence** | Verified by synthetic integrity test. |
| **4.2** | **Cross-Database User References** | MongoDB application documents reference `auth_users.id` as string fields (`hunter_id`, `user_id`, `actor_id`, `sender_id`). Standard string matching avoids binary conversions. | **Verified from Repository Evidence** | Documented in schema specifications. |
| **4.3** | **Batch User Profile Resolution** | No application gateway helper exists to batch-resolve `user_profiles` from PostgreSQL for lists of MongoDB submissions. | **Missing** | Implement `getUserProfilesBatch(userIds: string[])` in `lib/db/users.ts`. |
| **5.1** | **Submission Multi-Collection Aliasing** | Submissions are fragmented across 6 collections: `bugs`, `bugSubmissions`, `bug_submissions`, `bugHuntSubmissions`, `submissions`, `bugReports`. | **Verified from Repository Evidence** | Confirmed by code usages in `app/submit/page.tsx` and `createBatchPayouts.ts`. |
| **5.2** | **Dual-Write Pattern on Bug Submission** | `app/submit/page.tsx#L461` writes primary bug report to `bugs`, then line 483 writes a secondary pointer document to `bugSubmissions` with field `bugId`. | **Verified from Repository Evidence** | Directly verified in `app/submit/page.tsx`. |
| **5.3** | **Deduplication & Pointer Resolution Tooling** | `scripts/migrate-firestore-to-sql.ts` is an empty dry-run stub. It contains no logic to resolve `bugSubmissions.bugId` to `bugs.id` or preserve alias pointers. | **Missing** | Build pre-flight deduplication mapper with alias lookup table. |
| **5.4** | **Orphan Submission Reference Audit** | Exact document count of legacy payouts and vulnerabilities referencing pointer documents vs primary documents in live Firestore is unknown. | **Unknown / Requires Environment Confirmation** | Requires read-only audit script execution against a sanitized Firebase export. |
| **6.1** | **Payout Idempotency Keys** | `functions/src/functions/createPayout.ts#L258` generates deterministic `order_id = generateOrderId(submissionId, huntId)`. Target schema enforces unique `order_id`. | **Verified from Repository Evidence** | Codified in validation utilities and schema. |
| **6.2** | **Webhook Replay Protection** | `functions/src/functions/cryptomusWebhook.ts` checks signature and verifies status transition before balance deduction. | **Verified from Repository Evidence** | Codified in webhook handler. |
| **6.3** | **Reconciliation Daemon Migration** | `functions/src/functions/reconcilePayouts.ts` currently uses Firestore SDK (`db.collection("payouts")`). MongoDB query equivalent does not exist. | **Missing** | Update reconciliation daemon to query MongoDB `payouts` collection. |
| **6.4** | **Payment Gateway Sandbox Credentials** | `functions/src/utils/cryptomus-client.ts#L265` reads `functions.config().cryptomus`. Staging API credentials are not present in repository. | **Unknown / Requires Environment Confirmation** | Requires staging merchant ID and payout API key for Cryptomus sandbox. |
| **7.1** | **Topological Migration Sequence** | Ingestion sequence is defined: SQL Identity $\rightarrow$ Mongo Orgs/Wallets $\rightarrow$ Mongo Bounties $\rightarrow$ Mongo Submissions $\rightarrow$ Mongo Payouts $\rightarrow$ Mongo Gamification. | **Verified from Repository Evidence** | Formally specified in Section 8 of the Integration Plan. |
| **7.2** | **SQL Rollback DDL Script** | `migrations/004_down_reversion.sql` exists and cleanly drops tables and triggers. Tested in `tests/test_migration_synthetic_integrity.mjs`. | **Verified from Repository Evidence** | Verified by synthetic integrity test suite. |
| **7.3** | **MongoDB Rollback & Reset Script** | No script exists to cleanly drop or revert migrated MongoDB collections without dropping entire database. | **Missing** | Create `scripts/rollback-mongo.ts` dropping target application collections. |
| **7.4** | **Staging Database Provisioning** | Dedicated staging PostgreSQL and MongoDB instances are not yet provisioned. | **Unknown / Requires Environment Confirmation** | Staging cloud infrastructure must be provisioned. |
| **8.1** | **Static Schema & In-Memory Test Suite** | 23 unit tests pass across `test_migration_schema_and_rls.mjs`, `test_migration_synthetic_integrity.mjs`, and `test_server_auth_and_2fa.mjs`. | **Verified from Repository Evidence** | Passes locally via `node --test`. |
| **8.2** | **Live Database Integration Tests** | Zero integration tests exist that connect to real PostgreSQL or MongoDB instances to test queries, transactions, or RLS enforcement. | **Missing** | Implement integration test suites with test containers or staging DBs. |

---

## 3. Detailed Technical Domain Analysis

### 3.1 Domain 1: Database Drivers & Connection Infrastructure
- **Existing State**: The application is configured exclusively for client-side Firebase (`firebaseConfig.js`) and server-side Firebase Admin (`functions/package.json`). Root `package.json` contains no relational database client (`pg`, `postgres`, `@supabase/supabase-js`) and no MongoDB client (`mongodb`, `mongoose`).
- **Gaps Identified**:
  - Direct database queries from Next.js server actions cannot execute.
  - Connection pooling is absent. Without a connection pooler like Supavisor / PgBouncer for PostgreSQL and a cached singleton client (`global._mongoClientPromise`) for MongoDB, serverless route handlers will rapidly exhaust database connection limits.
- **Classification**: **Missing**.

### 3.2 Domain 2: MongoDB Deployment Requirements for Financial Transactions
- **Existing State**: Financial workflows (`createPayout`, `createBatchPayouts`, `cryptomusWebhook`) require atomic balance reservations and deductions on `org_wallets`.
- **Infrastructure Constraint**:
  - Multi-document transactions (`client.startSession()`, `session.withTransaction(...)`) in MongoDB **strictly require a Replica Set**.
  - A standalone MongoDB instance (such as a default local Docker container or single developer node) throws:
    `MongoServerError: Transaction numbers are only allowed on a replica set member or mongos`.
  - The repository contains no deployment descriptor indicating whether the target MongoDB instance is MongoDB Atlas (which is always a replica set) or a self-hosted instance.
- **Classification**: **Unknown / Requires Environment Confirmation**.

### 3.3 Domain 3: Authentication and Legacy Password-Hash Compatibility
- **Existing State**:
  - `app/api/auth/signup/route.ts#L49` hashes passwords using `bcryptjs.hash(password, 10)`.
  - `app/api/auth/login/route.ts#L50` validates credentials using `bcryptjs.compare(password, userDoc.password)`.
  - SQL schema `001_accounts_auth_schema.sql` defines `password_hash VARCHAR(255) NOT NULL` in table `auth_users`.
- **Compatibility Analysis**:
  - Bcrypt hashes are self-contained strings containing algorithm identifier, cost factor, salt, and hash (e.g. `$2a$10$...` or `$2b$10$...`).
  - Storing these directly into PostgreSQL `auth_users.password_hash` allows seamless password verification via the existing Next.js server auth route without forcing user password resets.
  - Verification of actual login against a running PostgreSQL database has not yet been executed.
- **Classification**: Schema and algorithm compatibility is **Verified from Repository Evidence**; live SQL authentication is **Unknown / Requires Environment Confirmation**.

### 3.4 Domain 4: User ID Compatibility Between SQL and MongoDB
- **Existing State**:
  - `migrations/001_accounts_auth_schema.sql` declares primary keys as `VARCHAR(128)` defaulting to `gen_random_uuid()::text`.
  - It also includes column `legacy_firestore_id VARCHAR(128)`.
  - `tests/test_migration_synthetic_integrity.mjs` verifies that non-UUID legacy identifiers (e.g., Firestore auto-generated strings `7xN0kP9zQ2a` or custom IDs `BH-USER-001`) insert cleanly without triggering PostgreSQL UUID syntax errors (`invalid input syntax for type uuid`).
- **Compatibility Analysis**:
  - MongoDB documents natively accept string `_id` values or standard BSON ObjectIds.
  - Storing `hunter_id`, `org_id`, `user_id`, and `created_by` as `VARCHAR(128)` UTF-8 strings in MongoDB documents ensures 100% interoperability with `auth_users.id`.
- **Classification**: **Verified from Repository Evidence**.

### 3.5 Domain 5: Legacy Firestore Collection Mapping & Submission Preservation
- **Existing State**:
  - Bug reports are fragmented across 6 collections: `bugs`, `bugSubmissions`, `bug_submissions`, `bugHuntSubmissions`, `submissions`, `bugReports`.
  - `app/submit/page.tsx` contains a double-write pattern: line 461 writes to `bugs` and line 483 writes to `bugSubmissions` with field `bugId = bugDocRef.id`.
  - `functions/src/functions/createBatchPayouts.ts#L171-L182` performs sequential fallback checks across 4 different collection names to find referenced submissions.
- **Gaps Identified**:
  - If records in `bugSubmissions` are dropped blindly during migration, existing payout records in `payouts` that point to `bugSubmissions.id` instead of `bugs.id` will become unresolvable orphans.
  - Migration script `scripts/migrate-firestore-to-sql.ts` is an empty stub without pointer reconciliation logic.
- **Classification**: Fragmentation is **Verified from Repository Evidence**; reconciliation tooling is **Missing**; live orphan counts are **Unknown / Requires Environment Confirmation**.

### 3.6 Domain 6: Payment Safety, Idempotency, and Concurrency
- **Existing State**:
  - `functions/src/functions/createPayout.ts` implements idempotency via `order_id = generateOrderId(submissionId, huntId)`.
  - In Firestore, fund reservation is guarded by `db.runTransaction` in `functions/src/utils/firestore.ts`.
  - `functions/src/functions/cryptomusWebhook.ts` verifies HMAC-MD5 signatures and updates status idempotently.
  - `functions/src/functions/reconcilePayouts.ts` runs a periodic reconciliation check.
- **Gaps Identified**:
  - All payment utilities are written exclusively for Firestore Admin SDK.
  - MongoDB equivalents using `session.withTransaction` or atomic filter expressions (`$inc` with preconditions) have not been implemented.
- **Classification**: Business logic and idempotency patterns are **Verified from Repository Evidence**; MongoDB payment driver implementations are **Missing**; live payment sandbox credentials are **Unknown / Requires Environment Confirmation**.

### 3.7 Domain 7: Migration Ordering, Staging Verification, and Rollback
- **Existing State**:
  - Topological migration sequence is specified in Section 8 of the Integration Plan:
    `SQL Identity` $\rightarrow$ `Mongo Orgs & Wallets` $\rightarrow$ `Mongo Bounties` $\rightarrow$ `Mongo Submissions` $\rightarrow$ `Mongo Payouts` $\rightarrow$ `Mongo Gamification`.
  - SQL rollback script `migrations/004_down_reversion.sql` exists and was validated synthetically.
- **Gaps Identified**:
  - Migration runner script `scripts/migrate-firestore-to-sql.ts` is a dry-run stub.
  - No MongoDB collection creation or schema validation scripts exist.
  - No MongoDB rollback script exists.
- **Classification**: Topological plan and SQL down-script are **Verified from Repository Evidence**; runner tools and MongoDB scripts are **Missing**; staging environments are **Unknown / Requires Environment Confirmation**.

### 3.8 Domain 8: Test Coverage & Verification Gaps
- **Existing State**:
  - Existing automated tests in `tests/`:
    - `tests/test_migration_schema_and_rls.mjs` (10 passing regex and mock mapping tests)
    - `tests/test_migration_synthetic_integrity.mjs` (6 passing synthetic array and reversion tests)
    - `tests/test_server_auth_and_2fa.mjs` (7 passing in-memory crypto and token tests)
    - `tests/test_api_containment.mjs` (passing HTTP 410 containment tests)
- **Verification Gap**:
  - These tests execute entirely in Node.js memory.
  - Zero live database connections are tested.
  - PostgreSQL DDL syntax, RLS enforcement, and MongoDB transaction rollbacks remain unproven against real database engines.
- **Classification**: Unit test harness is **Verified from Repository Evidence**; live integration test suites are **Missing**.

---

## 4. Implementation Dependency Graph

The technical dependencies dictate a strict phase sequence. Attempting migration or feature development before completing foundational driver modules creates unrecoverable build and connection failures:

```
[ Phase 1: Foundational Database Infrastructure ]
  ├─ Step 1.1: Install drivers (pg, mongodb) & create .env.example
  ├─ Step 1.2: Implement connection singletons & pools (lib/db/postgres.ts, lib/db/mongodb.ts)
  └─ Step 1.3: Run connection smoke tests (verify MongoDB Replica Set transaction support)
                         │
                         ▼
[ Phase 2: Schema Deployment & Migration Tooling ]
  ├─ Step 2.1: Deploy migrations/001 + curated 003 RLS to Staging PostgreSQL
  ├─ Step 2.2: Execute MongoDB schema & index initialization scripts on Staging MongoDB
  ├─ Step 2.3: Build dual migration runners (migrate-to-sql.ts & migrate-to-mongo.ts)
  └─ Step 2.4: Build pre-flight deduplication mapper with alias preservation
                         │
                         ▼
[ Phase 3: Staging Migration Execution & Validation ]
  ├─ Step 3.1: Execute dry-run migration against sanitized Firestore backup
  ├─ Step 3.2: Reconcile counts: Firestore_Docs == Mapped_SQL + Mapped_Mongo + Errors
  ├─ Step 3.3: Verify zero orphan references between SQL auth_users and Mongo documents
  └─ Step 3.4: Test live user login against PostgreSQL auth_users using migrated bcrypt hashes
                         │
                         ▼
[ Phase 4: Financial & Application Service Layer ]
  ├─ Step 4.1: Implement MongoDB atomic wallet operations & multi-document payout transactions
  ├─ Step 4.2: Migrate Cloud Functions (createPayout, cryptomusWebhook, reconcilePayouts)
  └─ Step 4.3: Migrate Next.js API routes & frontend data hooks
```

---

## 5. Safest First Implementation Task Recommendation

### 5.1 Recommended First Task
> [!IMPORTANT]
> **Recommended Task**: **Phase 1A — Database Driver Installation and Pooled Connection Infrastructure**
> 
> Specifically:
> 1. Add `pg`, `@types/pg`, and `mongodb` dependencies to `package.json` on an isolated feature branch.
> 2. Create `.env.example` documenting `POSTGRES_URL` (with PgBouncer pooling parameters) and `MONGODB_URI`.
> 3. Implement isolated, reusable connection singleton modules:
>    - `lib/db/postgres.ts`: Exports a pooled `pg.Pool` instance configured with connection limits and error event listeners.
>    - `lib/db/mongodb.ts`: Exports a cached `MongoClient` singleton promise (`global._mongoClientPromise`) adhering to Next.js serverless connection caching best practices.
> 4. Author a lightweight, standalone connection validation script (`scripts/test-db-connections.ts`) that executes `SELECT 1;` on PostgreSQL and `db.admin().ping()` + replica set topology inspection (`db.admin().command({ replSetGetStatus: 1 })`) on MongoDB.

### 5.2 Rationale: Why This Must Precede All Other Tasks
1. **Zero Production Risk & Non-Destructive**: Installing drivers and creating connection helper modules modifies no existing application routes, touches no legacy Firestore code, and introduces zero downtime.
2. **Hard Prerequisite for Every Subsequent Step**: Neither SQL DDL validation, MongoDB index initialization, migration runner execution, nor transaction safety tests can run without database connection drivers.
3. **Resolves the Primary Architectural Unknown (PREREQ-01)**: Executing the connection validation script against the staging MongoDB environment immediately confirms whether the target deployment is a Replica Set supporting multi-document transactions. If the environment is a standalone node, the team discovers this before writing transaction-dependent payment code.

---

## 6. Objective Acceptance Criteria for Implementation Phases

### Phase 1: Database Drivers & Infrastructure
- [ ] `pg` and `mongodb` drivers installed cleanly with zero dependency conflicts.
- [ ] `lib/db/postgres.ts` successfully connects to staging PostgreSQL and executes `SELECT NOW();`.
- [ ] `lib/db/mongodb.ts` successfully connects to staging MongoDB and executes ping command.
- [ ] Verification script outputs MongoDB cluster topology; confirms Replica Set is active.

### Phase 2: Schema Readiness & Migration Tooling
- [ ] Schema `001_accounts_auth_schema.sql` applied to staging PostgreSQL with zero errors; catalog check confirms 5 tables (`auth_users`, `user_roles`, `user_profiles`, `user_credentials`, `auth_audit_log`).
- [ ] Schema `002_bug_bounty_domain_supabase_schema.sql` is confirmed **excluded** from PostgreSQL.
- [ ] Staging MongoDB collections initialized with required compound unique indexes (e.g., `{ order_id: 1 }` on `payouts`, `{ org_id: 1, user_id: 1 }` on `org_members`).
- [ ] Migration runners report 100% mapped counts in dry-run mode against sanitized Firestore export.

### Phase 3: Staging Migration & Reconciliation
- [ ] Record count reconciliation passes:
  $$\text{Firestore Export Count} = \text{SQL Rows Ingested} + \text{MongoDB Docs Ingested} + \text{Documented Exclusions}$$
- [ ] Zero unresolvable pointer references across `payouts.submission_id`, `vulnerabilities.submission_id`, and `bug_submissions._id`.
- [ ] Zero broken user references between MongoDB `hunter_id` / `user_id` and SQL `auth_users.id`.
- [ ] Automated login test succeeds against migrated `auth_users` using existing bcrypt passwords without password reset prompts.

### Phase 4: Financial Concurrency & Payout Safety
- [ ] Multi-threaded test executing 50 concurrent payout attempts against a single `org_wallets` document results in zero over-allocations and zero negative balances.
- [ ] Simulated network abort during payout creation triggers automatic transaction rollback, releasing reserved wallet balance cleanly.
- [ ] Webhook replay test with duplicate Cryptomus payload executes idempotently with zero duplicate deductions.
- [ ] Reversion test: `migrations/004_down_reversion.sql` drops SQL identity tables cleanly; MongoDB rollback script clears staging collections cleanly.

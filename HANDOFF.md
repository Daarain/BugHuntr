# BugHuntr — Complete Backend Migration & Firebase Decommissioning Handoff Document

**Workspace:** `D:\Projects\BugHuntr-Integration`  
**Branch:** `test_blockchain`  
**Date:** October 2026  
**Status:** Firebase Decommissioning Complete in Active Application — SQL & MongoDB Active Backend  

---

## 1. Executive Summary & Purpose

This handoff document provides the receiving engineer with the complete architectural context, ownership boundaries, verified test suites, safety invariants, and exact execution commands for the BugHuntr dual-database migration (PostgreSQL + MongoDB).

**Key Milestone Achieved:**
Firebase has been completely decommissioned from the Next.js application runtime and dependency tree:
1. `firebase`, `firebase-function`, and `@types/firebase` packages have been removed from `package.json` and pruned from `pnpm-lock.yaml`.
2. `firebaseConfig.js` has been permanently removed after verifying zero active consumers.
3. The active backend is 100% powered by Supabase PostgreSQL (Identity, Authentication, 2FA, Roles, Audit Logs) and MongoDB (Bug Hunts, Submissions, Wallets, Payouts, Vulnerabilities, Communities, Gamification).
4. All 7 offline regression test suites (including the new 7-test decommissioning suite), full TypeScript compilation (`npx tsc --noEmit`), and Next.js production build (`npm run build`, 72 routes) are passing with exit code 0.

---

## 2. Architecture & Database Ownership Boundaries

BugHuntr uses a dual-database architecture with distinct ownership boundaries:

### A. PostgreSQL (Supabase) — Identity, Authentication & Security
- **Authoritative Data**:
  - `auth_users`: Core user accounts, email, password hash, status, timestamps.
  - `user_profiles`: User display names, usernames, avatars, bio, links.
  - `user_roles`: Role assignments (`user`, `admin`, `triager`, `company`, `hunter`).
  - `user_credentials`: 2FA secrets (TOTP) and backup credentials.
  - `auth_audit_logs`: Append-only security audit events (logins, password resets, 2FA challenges).
- **Identifier Contract**:
  - All user IDs are stored as `VARCHAR(128)` strings (not UUIDs) to preserve legacy Firestore document IDs (`usr_...` or alphanumeric) without binary conversion or cast errors.
- **Security & Authorization**:
  - Row Level Security (RLS) is defined across all SQL tables (`migrations/003_supabase_rls_policies.sql`).
  - Strict production fail-closed session security in `lib/server-auth.ts`: Requires `SESSION_SECRET` $\ge$ 32 characters; rejects known default/insecure keys in production.
  - Direct PostgreSQL authentication:
    - Signup (`app/api/auth/signup/route.ts`) creates accounts strictly in `authRepository.createUser(...)`.
    - Login (`app/api/auth/login/route.ts`) authenticates strictly against `authRepository.findUserByEmail(...)`.
    - Both routes fail closed cleanly (HTTP 503) if the PostgreSQL database is unavailable.

### B. MongoDB — Application Domain & Financial Ledgers
- **Authoritative Data**:
  - `organizations` & `org_members`: Company workspaces, memberships, and tenant permissions.
  - `org_wallets`, `payouts`, `payout_logs`: Custody balance tracking, atomic balance reservation/deduction, Cryptomus payout lifecycle, idempotency key enforcement (`order_id`).
  - `bug_hunts`, `pro_hunts`, `pro_invitations`: Bounty programs, private pro-hunt invitations, hunter caps.
  - `bug_submissions`: Reports, severity assessments, steps, deduplicated aliases (`bugs`, `bugSubmissions`, `bug_submissions`, `bugHuntSubmissions`, `submissions`, `bugReports`).
  - `vulnerabilities` & `cve_requests`: CVSS v3.1 vector calculations, score verification, triage lifecycle, CVE ID dispatch.
  - `user_points_balance` & `gamification_logs`: Hunter reputation tiers (E through S), leaderboard points, reward store redemptions.
  - `communities`, `community_memberships`, `community_messages`: Private/public communities, random invite tokens, member channels, collaboration threads.
- **Identity Linkage**:
  - MongoDB documents reference PostgreSQL user IDs as string foreign keys (`hunter_id`, `user_id`, `actor_id`, `sender_id`, `createdBy`).
  - Cross-database user details are resolved via `AuthRepository.getUserProfilesBatch(userIds: string[])`.

---

## 3. Completed Decommissioning Changes & Key Files

| Category | Primary Files | Description of Completed Work |
| :--- | :--- | :--- |
| **Package Dependencies** | `package.json`<br>`pnpm-lock.yaml` | Removed `firebase`, `firebase-function`, and `@types/firebase` dependencies; pruned lockfile cleanly via `pnpm install`. |
| **Configuration Removal** | `firebaseConfig.js` (deleted) | Removed obsolete Firebase client configuration file after verifying zero consumers in active code. |
| **Authentication Routes** | `app/api/auth/signup/route.ts`<br>`app/api/auth/login/route.ts` | Removed all Firestore fallback queries and imports (`db`, `collection`, `query`). Enforced authoritative PostgreSQL authentication via `AuthRepository` with fail-closed 503 behavior when unconfigured. |
| **Client Auth Hooks** | `hooks/use-auth.ts`<br>`hooks/use-auth.d.ts` | Removed `onAuthStateChanged` and Firebase Auth SDK dependency. Wired directly to `/api/auth/me` session endpoint, preserving `AuthUser` contract (`uid`, `email`, `displayName`, `role`, `org`, `customClaims`). |
| **UI Cleanups** | `app/leaderboard/page.tsx` | Decoupled state and filter logic from legacy `firestoreUsers` terminology; wired directly to `/api/rankings/leaderboard` MongoDB endpoint. |
| **Diagnostics & Tests** | `scripts/test-db-connections.ts`<br>`tests/test_firebase_replacement.mjs` | Dynamic DB imports inside connection blocks; added comprehensive boundary and decommissioning tests asserting zero active Firebase imports, package removals, and config absence. |
| **SQL Schemas** | `migrations/001_accounts_auth_schema.sql`<br>`migrations/002_bug_bounty_domain_supabase_schema.sql`<br>`migrations/003_supabase_rls_policies.sql`<br>`migrations/004_down_reversion.sql` | DDL for auth and domain schemas; string ID compatibility; full RLS policies; complete down-reversion script. |
| **Migration Scripts** | `scripts/migrate-firestore-to-sql.ts`<br>`scripts/migrate-firestore-to-mongo.ts` | Firestore ingestion runners; Phase 6A multi-collection submission pointer resolution; timestamp normalization; dry-run default safety (zero Firebase SDK dependencies). |
| **Database Repositories** | `lib/db/postgres.ts`<br>`lib/db/mongodb.ts`<br>`lib/db/types.ts`<br>`lib/db/auth-repository.ts`<br>`lib/db/repositories/*.ts` | Connection pooling singletons, repository patterns for PostgreSQL auth and MongoDB collections, atomic balance operations. |

---

## 4. Remaining Firebase References Classification

Per verification across all project files:

| Classification | File / Location | Rationale / Justification |
| :--- | :--- | :--- |
| **Active Application Dependencies** | **None (0)** | Zero active runtime dependency on Firebase in `app/`, `components/`, `lib/`, `hooks/`, or `package.json`. |
| **Required Migration-Source Tooling** | `scripts/migrate-firestore-to-sql.ts`<br>`scripts/migrate-firestore-to-mongo.ts` | Parse legacy Firestore exports/JSON dumps into PostgreSQL and MongoDB. They require zero Firebase SDK packages. |
| **Historical Schema Mapping Fields** | `lib/db/auth-repository.ts`<br>`types/payout.ts` | `legacy_firestore_id` and `firestoreStatus` fields maintained in types and SQL schema for historical data lineage and audit trace. |
| **External Standalone Functions** | `functions/` (Cloud Functions) | Standalone Firebase Functions package with its own isolated `functions/package.json`. All business operations have already been mirrored into Next.js App Router API routes (`/api/functions/cve/requestCve`, `/api/functions/cvss/approveCvss`, `/api/payouts/`, etc.). File storage is handled by Cloudinary (`/api/cloudinary/upload`). |

---

## 5. Verified Test Suites & Actual Results

All tests were executed locally in `D:\Projects\BugHuntr-Integration` on branch `test_blockchain`:

| Test Suite | Command | Tests Run | Result | Exit Code |
| :--- | :--- | :--- | :--- | :--- |
| **Firebase Decommissioning & Boundaries** | `npx tsx --test tests/test_firebase_replacement.mjs` | 7 | 7 Passed | **0** |
| **Server Auth & 2FA Suite** | `npx tsx --test tests/test_server_auth_and_2fa.mjs` | 7 | 7 Passed | **0** |
| **Staging Diagnostic Safety Guards** | `node --test tests/test_staging_diagnostic_guards.mjs` | 26 | 26 Passed | **0** |
| **SQL Schema & RLS Policies** | `node --test tests/test_migration_schema_and_rls.mjs` | 10 | 10 Passed | **0** |
| **Synthetic Migration Integrity (SQL)** | `node --test tests/test_migration_synthetic_integrity.mjs` | 6 | 6 Passed | **0** |
| **Synthetic Migration (MongoDB)** | `node --test tests/test_mongo_migration_synthetic.mjs` | 9 | 9 Passed | **0** |
| **Database Repositories (Postgres & Mongo)** | `npx tsx --test tests/test_postgres_auth_repository.mjs tests/test_mongo_repositories.mjs tests/test_transfer_reward_mongo.mjs tests/test_wallets_and_payouts.mjs tests/test_bug_hunts_and_submissions.mjs` | 35 | 35 Passed | **0** |
| **Application Domain Repositories & APIs** | `npx tsx --test tests/test_vulnerabilities_and_cve.mjs tests/test_community_and_collaboration.mjs tests/test_pro_hunts_and_invitations.mjs tests/test_rankings_and_gamification.mjs tests/test_user_profiles_and_settings.mjs tests/test_access_control_and_privacy.mjs tests/test_auth_security_remediation.mjs tests/test_navbar_notification_polling.mjs tests/test_server_client_boundaries.mjs` | 62 | 62 Passed | **0** |
| **API Containment & Upload Validation** | `node --test tests/test_api_containment.mjs tests/test_upload_validation.mjs` | 19 | 19 Passed | **0** |
| **Live Database Diagnostic Runner** | `node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-db-connections.ts` | 3 Stages | Static, Connect, & Transaction Verified | **0** |
| **Live Database Integration Verification** | `node --env-file=.env node_modules/tsx/dist/cli.mjs --test tests/test_live_db_integration.mjs` | 9 | 9 Passed (with clean isolated teardown) | **0** |
| **TypeScript Typecheck** | `npx tsc --noEmit` | Full project | Clean / 0 errors | **0** |
| **Next.js Production Build** | `npm run build` | 72 Routes | All static & dynamic routes compiled successfully (Turbopack) | **0** |

---

## 6. What Remains Unverified & Precise Reasons

1. **Live Production Data Migration (`--execute`)**:
   - *Reason*: Live production data ingestion was intentionally not executed during implementation turns. It requires an authorized production maintenance window, full pre-migration snapshots of Firestore, PostgreSQL, and MongoDB, and formal reconciliation.
2. **Live Cryptomus External Webhook Dispatch**:
   - *Reason*: Safety rules prohibit contacting live payment gateways or triggering external financial side-effects. Verification was performed with cryptographic signature validation, reservation rollbacks, and payload mocks.

---

## 7. Required Staging Configuration Variables

To run live database diagnostics or execute staging migrations, configure the following environment variable **names only** (never commit or expose secret values):

```bash
# Safety Guard Flags
RUN_STAGING_DB_PROBE=true
APP_ENV=staging                        # Must be 'staging' or 'development'

# PostgreSQL / Supabase Allowlist Configuration
POSTGRES_URL=                          # Connection string
EXPECTED_STAGING_PG_HOST=              # Approved pooler or direct host
EXPECTED_STAGING_PG_DB=                # Database name (e.g., 'postgres')
EXPECTED_STAGING_PG_PROJECT_REF=       # Project reference (required for pooler)

# MongoDB Replica Set Allowlist Configuration
MONGODB_URI=                           # Connection URI
EXPECTED_STAGING_MONGO_HOST=           # Primary cluster host or SRV seed
EXPECTED_STAGING_MONGO_DB=             # Target database name
EXPECTED_STAGING_MONGO_REPLICA_SET=    # Target replica set name (e.g., 'atlas-*-shard-0')

# Server Security
SESSION_SECRET=                        # Minimum 32-character high-entropy secret
INTERNAL_API_SECRET=                   # Administrative API key
```

---

## 8. Safe Commands for Receiving Developer

### A. Run All Offline Tests
```powershell
# Run Firebase decommissioning and boundary tests
npx tsx --test tests/test_firebase_replacement.mjs

# Run synthetic migration integrity tests
node --test tests/test_migration_schema_and_rls.mjs tests/test_migration_synthetic_integrity.mjs tests/test_mongo_migration_synthetic.mjs tests/test_staging_diagnostic_guards.mjs

# Run all repository and security test suites
npx tsx --test tests/test_server_auth_and_2fa.mjs tests/test_postgres_auth_repository.mjs tests/test_mongo_repositories.mjs tests/test_wallets_and_payouts.mjs tests/test_bug_hunts_and_submissions.mjs tests/test_vulnerabilities_and_cve.mjs tests/test_community_and_collaboration.mjs tests/test_pro_hunts_and_invitations.mjs tests/test_rankings_and_gamification.mjs tests/test_user_profiles_and_settings.mjs tests/test_access_control_and_privacy.mjs tests/test_auth_security_remediation.mjs tests/test_navbar_notification_polling.mjs tests/test_server_client_boundaries.mjs

# Run full project type check and production build
npx tsc --noEmit
npm run build
```

### B. Run Staging Connection & Topology Diagnostic
```powershell
# Verify staging environment connectivity and multi-document transaction readiness
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-db-connections.ts
```

### C. Run Live Staging Integration Test
```powershell
# Execute live repository CRUD and isolated teardown against verified staging targets
node --env-file=.env node_modules/tsx/dist/cli.mjs --test tests/test_live_db_integration.mjs
```

### D. Execute Firestore Ingestion in Dry-Run Mode
```powershell
npx tsx scripts/migrate-firestore-to-sql.ts --dry-run
npx tsx scripts/migrate-firestore-to-mongo.ts --dry-run
```

---

## 9. Rollback Conditions & Safety Invariants

- **Never execute `migrations/004_down_reversion.sql`** during normal operations. It drops all tables and triggers.
- If live migration is executed and reconciliation errors occur, abort immediately and restore from pre-migration snapshots.

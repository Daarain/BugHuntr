# BugHuntr — Database Migration Architecture & Security Transition

## 1. Executive Summary

This specification establishes the target architecture, security controls, entity mappings, and non-destructive execution runbook for migrating BugHuntr from legacy Firebase Firestore to a decoupled, production-grade architecture:
1. **Accounts & Authentication**: Authoritative SQL database (`PostgreSQL`).
2. **Bug Bounty Domain, Social & Financial Operations**: Supabase (`PostgreSQL`) with comprehensive Row-Level Security (RLS).

---

## 2. Identifier Strategy & Legacy Data Compatibility

### 2.1 The Legacy ID Challenge
In Firestore, document IDs are arbitrary alphanumeric strings (e.g., `BH-VULN-submission_abc123`, `BH-PAYOUT-sub-101-hunt-1`, `7xN0kP9zQ2a`). Declaring strict PostgreSQL `UUID` primary keys caused fatal typecasting errors (`invalid input syntax for type uuid`).

### 2.2 Adopted Standard: String-Compatible Primary Keys (`VARCHAR(128)`)
- **Primary & Foreign Keys**: Standardized on `VARCHAR(128)` across all SQL schemas.
- **New Record Generation**: Automatically defaults to `gen_random_uuid()::text`.
- **Legacy Ingestion**: Ingests existing Firestore string IDs directly without type conversions or broken relationship links.
- **Audit Consistency**: Preserves existing external order IDs, vulnerability trackers, and payment logs (`BH-PAYOUT-...`, `BH-VULN-...`).

---

## 3. Supabase Auth & RLS Identity Architecture

### 3.1 Resolving `auth.uid()` Mismatch
In Supabase, client requests carry a JWT issued by Supabase Auth (GoTrue), where `auth.uid()` returns the user's identifier. To prevent locking out users whose identities are migrated from Firebase:
1. **Identity Resolution Helper**:
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
2. **GoTrue Synchronization**:
   During migration execution, user credentials are synchronized with Supabase's `auth.users` system table using Supabase Admin API or direct ingestion, preserving password hashes so users can authenticate and obtain valid Supabase JWTs matching their `auth_users.id`.
3. **Trigger-Enforced Immutability**:
   `enforce_profile_field_immutability()` strictly blocks client modification of `points` and `reputation_rank`.

---

## 4. Complete Active Collection Mapping

Every active collection in BugHuntr is mapped to a concrete SQL table:

| Firestore Collection | Target Table | Primary Key | Key Mapped Fields | Ownership & RLS Scope |
|---|---|---|---|---|
| `users` | `auth_users`, `user_roles` | `id VARCHAR(128)` | `email`, `password_hash`, `role`, `userType` | User itself or platform admin |
| `userProfiles` | `user_profiles` | `user_id VARCHAR(128)` | `username`, `display_name`, `points`, `reputation_rank` | Public read, user update (points protected by trigger) |
| `bug_hunts` | `bounties` | `id VARCHAR(128)` | `org_id`, `title`, `reward_pool`, `status`, `scope` | Organization admin manage; public active read |
| `bug_submissions`, `bugs`, `bugSubmissions` | `bug_submissions` | `id VARCHAR(128)` | `bounty_id`, `hunter_id`, `severity`, `status`, `reward_amount` | Hunter & Org isolation; client writes locked to draft/unpaid |
| `vulnerabilities` | `vulnerabilities` | `id VARCHAR(128)` | `submission_id`, `cvss_vector`, `bughuntr_score`, `status` | Triagers manage; Submitter & Org read |
| `cve_requests` | `cve_requests` | `id VARCHAR(128)` | `vulnerability_id`, `requester_id`, `org_consent`, `status` | Triager & Org consent required |
| `proInvitations` | `pro_invitations` | `id VARCHAR(128)` | `sender_id`, `recipient_email`, `hunt_id`, `status` | Sender, Recipient, & Admin access |
| `communities` | `communities` | `id VARCHAR(128)` | `name`, `description`, `creator_id`, `is_private` | Public communities public read; private locked |
| `communities/{id}/messages` | `community_messages` | `id VARCHAR(128)` | `community_id`, `sender_id`, `content`, `created_at` | Community members only |
| `org_wallets` | `org_wallets` | `org_id VARCHAR(128)` | `balance`, `reserved`, `currency` | Org admins read; **ALL CLIENT WRITES DENIED** |
| `payouts` | `payouts`, `payout_logs` | `id VARCHAR(128)` | `order_id`, `submission_id`, `amount`, `status`, `recipient_wallet` | Hunter/Org read; **ALL CLIENT WRITES DENIED** |

---

## 5. Non-Destructive Migration Runbook

> [!IMPORTANT]
> **Safety Guarantee**: The migration runner is strictly READ-ONLY on Firebase. No Firestore documents, user records, bug submissions, or payout histories will be deleted or altered.

### Step 1: Pre-Flight Dry Run
Validates schema mapping against synthetic and real Firestore record shapes without writing:
```bash
npx tsx scripts/migrate-firestore-to-sql.ts --dry-run
```

### Step 2: Verification Mode
Audits foreign key integrity, cross-collection references, and email uniqueness:
```bash
npx tsx scripts/migrate-firestore-to-sql.ts --verify-only
```

### Step 3: Apply DDL Schemas in Sequence
```sql
\i migrations/001_accounts_auth_schema.sql
\i migrations/002_bug_bounty_domain_supabase_schema.sql
\i migrations/003_supabase_rls_policies.sql
```

### Step 4: Batch Data Ingestion
Ingests mapped records idempotently (`ON CONFLICT DO UPDATE`):
```bash
npx tsx scripts/migrate-firestore-to-sql.ts --execute
```

### Step 5: Rollback Runbook (Disaster Recovery)
If an anomaly is detected, revert the SQL target database idempotently:
```sql
\i migrations/004_down_reversion.sql
```
Firebase data remains untouched and continuously operational as the system of record.

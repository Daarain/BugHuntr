# BugHuntr — Shared User Identity & Authorization Contract
## Authoritative Identity Boundary: PostgreSQL (SQL Auth) & MongoDB (Application Domain)

**Document**: `docs/IDENTITY_CONTRACT.md`  
**Author**: PostgreSQL / Supabase Migration Implementation Agent  
**Consumer**: MongoDB Application Agent, Application Gateway, API Services  
**Status**: Authoritative Architectural Contract  
**Version**: 1.0.0 (October 2026)  

---

## 1. Executive Summary & Architectural Boundary

Under the confirmed BugHuntr dual-database architecture:
1. **PostgreSQL (Supabase)** is the **sole authoritative persistence engine** for:
   - User identity, emails, and account records (`auth_users`)
   - Bcrypt password hashes and account status flags (`auth_users.password_hash`, `is_active`, `is_banned`)
   - Authoritative user roles and permissions (`user_roles`: `hunter`, `company`, `admin`, `triager`)
   - Two-factor authentication credentials, TOTP secrets, and recovery codes (`user_credentials`)
   - Basic user profiles (`user_profiles`: `username`, `display_name`, `avatar_url`, `bio`, `country`, `company_name`)
   - Immutable security and authentication audit event logs (`auth_audit_log`)

2. **MongoDB** is the **sole authoritative persistence engine** for:
   - All application-domain workflows: bounties (`bug_hunts`), submissions (`bug_submissions`), triaged findings (`vulnerabilities`, `vulnerabilities_audit`), CVE requests (`cve_requests`)
   - Financial custody and ledgers: custody wallets (`org_wallets`), payouts (`payouts`, `payout_logs`, `batch_payout_jobs`)
   - Gamification and ranking: points balances (`user_points_balances`), transactions (`points_transactions`), badges (`user_achievements`)
   - Collaboration and social feeds: communities (`communities`), memberships (`community_memberships`), messages (`community_messages`)

> [!IMPORTANT]
> **Zero Direct Database Joins**: There are no cross-database distributed queries or foreign keys between PostgreSQL and MongoDB. The Application Gateway coordinates between the two databases using the **Stable User ID Contract** defined herein.

---

## 2. Canonical User ID Contract

### 2.1 Storage Type and Representation
- **Type**: UTF-8 String (`VARCHAR(128)` in PostgreSQL, `string` BSON type in MongoDB).
- **Prohibited Conversions**:
  - **NEVER** convert, cast, or store user IDs as MongoDB `ObjectId` (e.g. `ObjectId("...")`).
  - **NEVER** declare strict SQL `UUID` columns without `VARCHAR(128)` compatibility.
- **Generation Rule**:
  - New users generated in SQL default to `gen_random_uuid()::text` (UUID v4 string, e.g. `c7b3d8e0-4e32-4d51-8761-8b2bfa123456`).
- **Legacy Ingestion Preservation**:
  - Legacy Firestore alphanumeric string identifiers (e.g. `7xN0kP9zQ2a`, `BH-USER-001`, `submission_abc123`) are preserved directly in `auth_users.id` and populated in `auth_users.legacy_firestore_id`.
  - MongoDB documents referencing legacy user IDs remain 100% valid without data migration or broken links.
- **Case Sensitivity**: Exact case-sensitive matching.

---

## 3. MongoDB Cross-Database Reference Directory

Every MongoDB collection that references a user must store the SQL user ID as a plain string matching `auth_users.id`. The following directory specifies the canonical field names:

| MongoDB Collection | Document Field | Field Type | References SQL Entity | Purpose / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **`org_members`** | `user_id` | `string` | `auth_users.id` | Member identity in organization |
| **`bug_submissions`** | `hunter_id` | `string` | `auth_users.id` | Bug hunter who submitted the report |
| **`vulnerabilities`** | `triaged_by` | `string` | `auth_users.id` | Staff triager who reviewed the finding |
| **`vulnerabilities_audit`**| `actor_uid` | `string` | `auth_users.id` | User who made a scoring/vector change |
| **`cve_requests`** | `requested_by` | `string` | `auth_users.id` | Submitter or triager requesting CVE |
| **`org_wallets`** | *(N/A)* | *(N/A)* | `organizations._id` | Wallets are keyed by `org_id` |
| **`payouts`** | `hunter_uid` | `string` | `auth_users.id` | Recipient user receiving bounty |
| **`payout_logs`** | `actor_id` | `string` | `auth_users.id` | Operator or system actor initiating payout |
| **`batch_payout_jobs`** | `created_by` | `string` | `auth_users.id` | Admin who initiated batch payout |
| **`user_points_balances`**| `_id`, `user_id` | `string` | `auth_users.id` | User receiving points / ranking |
| **`points_transactions`** | `user_id` | `string` | `auth_users.id` | User receiving points adjustment |
| **`user_achievements`** | `user_id` | `string` | `auth_users.id` | User unlocking badge/achievement |
| **`pro_invitations`** | `sender_id`, `hunter_id` | `string` | `auth_users.id` | Sender admin and recipient hunter |
| **`pro_applications`** | `hunter_id` | `string` | `auth_users.id` | Hunter applying for private hunt |
| **`pro_ndas`** | `hunter_id` | `string` | `auth_users.id` | Hunter signing non-disclosure agreement |
| **`communities`** | `creator_id` | `string` | `auth_users.id` | User who created community |
| **`community_memberships`**| `user_id` | `string` | `auth_users.id` | Member in community |
| **`community_messages`** | `sender_id` | `string` | `auth_users.id` | Message author |

---

## 4. Session Token & Gateway Identity Contract

### 4.1 Session Cookie Specification
- **Cookie Name**: `bughuntr_session`
- **Transport**: HTTP-only, Secure (in production), SameSite: `lax`, Path: `/`, Max-Age: `7 days`
- **Format**: `base64url(payload).hmac_sha256(payload, SESSION_SECRET)`
- **Header Alternative**: `Authorization: Bearer <session_token>`

### 4.2 Decoded Session User Payload (`SessionUser`)
```typescript
interface SessionUser {
  id: string;               // Matches auth_users.id (VARCHAR(128))
  email: string;            // Normalized lowercase email
  username: string;         // Clean username from user_profiles
  role: "user" | "admin" | "triager";
  userType: "hunter" | "company";
}
```

### 4.3 Verifying Sessions at Server Gateways
Use the provided `lib/server-auth.ts` helper:
```typescript
import { getSessionFromRequest } from "@/lib/server-auth";

export async function GET(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session.authenticated || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: userId, role, userType } = session.user;
  // Use userId to scope MongoDB operations:
  // e.g., db.collection("bug_submissions").find({ hunter_id: userId })
}
```

---

## 5. Profile Hydration & Batch Resolution Pattern

When MongoDB queries return documents (such as submissions, leaderboards, or comments) that need hunter profile information (display name, username, avatar):

1. Collect unique user string IDs from the MongoDB documents:
   ```typescript
   const hunterIds = Array.from(new Set(submissions.map(s => s.hunter_id)));
   ```
2. Batch query PostgreSQL `user_profiles` in a single query:
   ```typescript
   import { getUserProfilesBatch } from "@/lib/db/users";

   const profileMap = await getUserProfilesBatch(hunterIds);
   // Returns Map<string, UserProfile> where key is auth_users.id
   ```
3. Hydrate the response documents:
   ```typescript
   const hydratedSubmissions = submissions.map(sub => ({
     ...sub,
     hunter: profileMap.get(sub.hunter_id) || {
       username: "Unknown Hunter",
       displayName: "Anonymous",
       avatarUrl: null
     }
   }));
   ```

### 5.1 SQL Batch Query Implementation
```sql
SELECT 
  user_id,
  username,
  display_name,
  avatar_url,
  bio,
  country,
  points,
  reputation_rank,
  company_name
FROM user_profiles
WHERE user_id = ANY($1);
```

---

## 6. Role Authorization & Scoping Invariants

Because PostgreSQL RLS does not protect MongoDB collections directly, **the Application Gateway must enforce authorization scoping filters**:

1. **Hunters**:
   - MUST only read submissions where `{ hunter_id: sessionUser.id }`.
   - MUST only read payouts where `{ hunter_uid: sessionUser.id }`.
   - MUST NOT modify points balances, wallets, or vulnerability severity scores directly.

2. **Organizations / Enterprise Companies**:
   - MUST only read submissions for bounties owned by their organization: `{ org_id: sessionUser.orgId }`.
   - Wallets (`org_wallets`) and Payout execution (`createPayout`) require enterprise admin verification.

3. **Triagers**:
   - `role === "triager" || role === "admin"`
   - Permitted to update `vulnerabilities`, assign CVSS scores, and manage `cve_requests`.

4. **Platform Administrators**:
   - `role === "admin"`
   - Enforces Two-Factor Authentication (2FA) verification challenge prior to issuing session cookie.

---

## 7. Migration Coordination & Contact Points

- **PostgreSQL Repository File**: [`lib/db/auth-repository.ts`](file:///d:/Projects/BugHuntr-AgentWorkspace-Postgres/lib/db/auth-repository.ts)
- **Profile Resolution Helpers**: [`lib/db/users.ts`](file:///d:/Projects/BugHuntr-AgentWorkspace-Postgres/lib/db/users.ts)
- **Session Verification Helper**: [`lib/server-auth.ts`](file:///d:/Projects/BugHuntr-AgentWorkspace-Postgres/lib/server-auth.ts)
- **2FA Challenge & Verify**: [`lib/auth-2fa.ts`](file:///d:/Projects/BugHuntr-AgentWorkspace-Postgres/lib/auth-2fa.ts)
- **PostgreSQL DDL Migration**: [`migrations/001_accounts_auth_schema.sql`](file:///d:/Projects/BugHuntr-AgentWorkspace-Postgres/migrations/001_accounts_auth_schema.sql)

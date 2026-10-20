# BugHuntr Security Audit — Original Findings & Verification Inventory

This document consolidates the initial unverified security audit claims, our verification results against the actual source code on `test_blockchain`, and their current containment/resolution status prior to database migration.

---

## 1. Audit Findings Matrix

| Finding ID | Claimed Vulnerability | Target Files | Verification Result | Containment / Status |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Authentication based on mutable client-side `localStorage` | `components/auth/auth-context.tsx`, `hooks/use-auth.ts` | **Confirmed Partial**: Firebase Client Auth was initialized, but fallback mock auth read user role from localStorage without server verification. | **Contained**: Protected API routes enforce server-side validation; migration to Supabase Auth scheduled for Phase 2. |
| **SEC-02** | Unauthenticated administrative & debug endpoints | `app/api/bug-hunt/*`, `app/api/bug-review` | **Confirmed Real**: Routes accepted unauthenticated requests or shared-secret bypasses and directly mutated Firestore. | **Resolved**: Permanently retired with unconditional HTTP `410 Gone`. |
| **SEC-03** | Unauthorized privilege escalation via client-side pages | `app/admin-test/page.tsx`, `app/admin-utils/page.tsx`, `app/admin-migration/page.tsx`, `app/test-points/page.tsx`, `app/debug/page.tsx` | **Confirmed Real**: Pages contained forms calling client-side functions to update Firestore `userProfiles` roles and points. | **Resolved**: Diagnostic queries and forms removed; pages unconditionally return `notFound()`. Backing libs throw unconditionally. |
| **SEC-04** | Client-side wallet, reward, and payout mutations | `hooks/use-payout.ts`, `functions/src/functions/createPayout.ts` | **Confirmed Real**: Race conditions allowed concurrent double-spend payouts via Cryptomus before submission status updated. | **Resolved**: Implemented atomic pre-payment Firestore transaction (`db.runTransaction`) reserving funds, checking balance, and locking submission status. |
| **SEC-05** | SSRF & DNS Rebinding in report detection | `report-detection.py` | **Confirmed Real**: TOCTOU gap between DNS resolution check and `requests.get()` allowed DNS rebinding to internal IP addresses. | **Resolved**: Implemented custom `urllib3` transport-level IP pinning (`PinnedIPAdapter`) binding TCP sockets directly to validated IPs while preserving TLS SNI. |
| **SEC-06** | Fragmented submission and vulnerability data models | `bugReports`, `vulnerabilities`, `submissions`, `bug_submissions` | **Confirmed Real**: Multiple collections represent the same entity with schema discrepancies. | **Documented Blocker**: Handled in containment via multi-collection fallbacks; consolidated schema to be migrated in Phase 2. |
| **SEC-07** | Firestore security rules discrepancy & missing `userProfiles` rule | `firestore.rules`, `firestore-community.rules`, `firestore-payout.rules` | **Confirmed Real**: 3 fragmented rules files; `userProfiles` collection lacked explicit rules, permitting client SDK writes. | **Documented Blocker**: Client write surfaces neutralized in application code; full RLS policies planned for Phase 2. |
| **SEC-08** | Missing or unexported Cloud Functions | `functions/src/functions/cvss/*`, `functions/src/functions/cve/*` | **Confirmed Real**: CVSS and CVE functions were implemented in source files but omitted from `functions/src/index.ts` exports. | **Preserved**: Source implementations retained; export alignment pending architecture review. |
| **SEC-09** | Frontend/backend API contract mismatches | `app/api/*`, `hooks/*` | **Confirmed Real**: `/api/bug-hunt/*` had zero frontend callers. | **Resolved**: Orphaned routes decommissioned with HTTP 410. |
| **SEC-10** | Potentially exposed API credentials or secrets | `.env*`, `render.yaml` | **Verified Safe**: Secrets are kept in environment variables; `.gitignore` properly excludes `.env*` and service account keys. | **Maintained**: No credential exposure; rotation procedures documented for production kickoff. |

---

## 2. Test & Verification Baseline

All security containment measures are backed by automated tests:
1. `tests/test_ssrf_mitigation.py` (9 tests passing) — Tests SSRF blocklists, DNS rebinding socket pinning, and redirect safety.
2. `tests/test_api_containment.mjs` (7 tests passing) — Tests unconditional HTTP 410 on retired endpoints and unconditional throws on retired admin utilities.
3. `functions/src/__tests__/payout-concurrency.test.ts` (5 tests passing) — Tests atomic reservation, double-spend prevention, and status locking.
4. `functions/src/__tests__/cryptomus-client.test.ts` (7 tests passing) — Tests Cryptomus signature verification and webhook authentication.

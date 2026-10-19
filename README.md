# BugHuntr

BugHuntr is an enterprise-grade collaborative bug bounty ecosystem connecting security researchers, ethical hackers, and organizations. The platform enables organizations to host structured bug bounty programs and allows hunters to discover targets, submit reproducible vulnerability reports, collaborate on security triage, and receive cryptocurrency payouts.

[![Next.js 16](https://img.shields.io/badge/Next.js-16%20Turbopack-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-336791?style=for-the-badge&logo=postgresql)](https://supabase.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb)](https://mongodb.com/)

---

## ✨ Features

- **Enterprise Security & Authentication:** PostgreSQL-backed user identity with bcrypt hashing, TOTP/Email 2FA, signed session cookies, and strict Role-Based Access Control (`hunter`, `company`, `admin`, `triager`).
- **Target Marketplace & Bug Hunts:** Discover and browse active public and private bug bounty programs with tiered payout configurations.
- **Secure Vulnerability Submission:** Structured report submission pipeline with magic-byte file upload validation, SSRF mitigation, and duplicate report prevention.
- **CVSS v3.1 Scoring & CVE Workflow:** Automated and manual CVSS scoring engine with heuristic recommendations and formal CVE request workflows.
- **Cryptocurrency Payouts:** Non-custodial organization escrow wallets, balance reservations, and automated batch crypto payouts powered by Cryptomus.
- **Community Collaboration:** Real-time discussion channels, threads, solutions, and community leaderboards.
- **Audit Logging & Privacy:** Immutable audit trails for authentication events with strict multi-tenant data containment.

---

## 🛠️ Architecture & Tech Stack

- **Frontend:** Next.js 16 (App Router with Turbopack), React 19, TypeScript, Tailwind CSS, shadcn/ui, Radix UI.
- **Backend API:** Next.js Serverless Route Handlers with cryptographic session verification and input validation (Zod).
- **Primary Databases:**
  - **PostgreSQL (Supabase):** Authoritative store for Auth & Identity (`auth_users`, `user_roles`, `user_profiles`, `user_credentials`, `auth_audit_log`).
  - **MongoDB Atlas:** Authoritative store for Application Domains (`organizations`, `bug_hunts`, `bug_submissions`, `vulnerabilities`, `org_wallets`, `payouts`, `communities`).
- **Microservices & AI Utilities:** Python Flask services for OCR document verification and multimodal fake report detection.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20 or later recommended; v18+ supported)
- [pnpm](https://pnpm.io/installation) (v9 or later)
- [Python](https://www.python.org/) (v3.10 or later)
- A PostgreSQL connection string (Supabase) and MongoDB connection string (MongoDB Atlas)

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/Daarain/BugHuntr.git
cd BugHuntr

# Install dependencies using pnpm
pnpm install
```

### 2. Environment Configuration

Copy the template environment file to `.env`:

```bash
cp .env.example .env
```

Configure your credentials in `.env` (never commit `.env` to version control):
- `POSTGRES_URL`: Supabase connection pooler URL (port 6543)
- `MONGODB_URI`: MongoDB Atlas cluster SRV connection string
- `SESSION_SECRET`: Cryptographically strong 64-hex-character secret
- `AUTH_2FA_SECRET` / `INTERNAL_API_SECRET`: Internal API security tokens

### 3. Database Schema Setup

Apply initial PostgreSQL schema and RLS policies:
- Run `migrations/001_accounts_auth_schema.sql` on your PostgreSQL database.
- Run `migrations/002_bug_bounty_domain_supabase_schema.sql`.
- Run `migrations/003_supabase_rls_policies.sql`.

Verify connectivity:
```bash
npx tsx scripts/test-db-connections.ts
```

### 4. Running the Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to access the application.

---

## 📜 Available Scripts

| Script | Command | Purpose |
|---|---|---|
| **dev** | `pnpm dev` | Starts local Next.js development server with Turbopack |
| **build** | `pnpm build` | Compiles optimized production build |
| **start** | `pnpm start` | Runs the production server |
| **lint** | `pnpm lint` | Performs TypeScript compilation and typecheck validation |
| **typecheck** | `pnpm typecheck` | Validates TypeScript types across the entire project |
| **test** | `pnpm test` | Executes all automated unit, boundary, and domain regression test suites |

---

## 📂 Project Structure

```
.
├── app/                  # Next.js App Router (pages and API route handlers)
│   ├── api/              # Secure backend API route handlers
│   ├── admin/            # Administrative review and triage dashboards
│   └── (features)/       # Feature pages: /feed, /submit, /my-wallet, /leaderboard
├── components/           # Modular React components grouped by feature domain
├── docs/                 # Architectural documentation, guides, and migration audit trails
│   ├── audits/           # Security and database audit evidence
│   ├── guides/           # Operational guides, CVSS quick reference, and payout manual
│   └── manifests/        # Feature indexes and implementation manifests
├── functions/            # Cloud Functions and concurrency tests
├── hooks/                # Custom React hooks for client state and data fetching
├── lib/                  # Core application libraries
│   ├── auth/             # Session issuance, 2FA, and API credential guards
│   ├── security/         # File magic-byte validation, SSRF mitigation, Cryptomus crypto
│   ├── db/               # PostgreSQL & MongoDB connection pools and repositories
│   ├── services/         # Domain business services (rewards, gamification, stats)
│   └── cvss/             # CVSS v3.1 calculation and scoring engine
├── migrations/           # Versioned SQL migration scripts
├── scripts/              # Diagnostic tools and database connectivity probes
├── tests/                # Automated unit, integration, security, and E2E suites
└── types/                # TypeScript shared domain interfaces and declarations
```

---

## 🔒 Security & Data Safety

- Client write access to databases is strictly forbidden; all mutations occur via validated server routes.
- File uploads are validated via magic-byte header inspection, restricting MIME types and preventing path traversal.
- SSRF mitigation validates destination IP addresses and blocks private, link-local, and loopback IP ranges.
- Full verification and test evidence is maintained in [`docs/audits/`](docs/audits/).
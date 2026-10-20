-- ============================================================================
-- 002_bug_bounty_domain_supabase_schema.sql
-- BugHuntr Phase C: Bug Bounty Domain, Communities, Invitations & Financial Schema
-- Target: Supabase / PostgreSQL (Domain Database)
-- Strategy: String-compatible (VARCHAR(128)) primary keys and foreign keys
--           supporting legacy Firestore document IDs and standard UUIDs.
--           Complete coverage for: bug_hunts, bug_submissions, bugs,
--           bugSubmissions, proInvitations, communities, messages, wallets, payouts.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Table: organizations
-- Company accounts sponsoring bug bounties.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- ----------------------------------------------------------------------------
-- 2. Table: org_members
-- Multi-tenant organization membership and permissions.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_members (
    id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    org_id VARCHAR(128) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'triager', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_org_members_org_user UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members(user_id);

-- ----------------------------------------------------------------------------
-- 3. Table: bounties (Bug Hunts / Programs)
-- Maps Firestore 'bug_hunts' collection.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_bounties_org_id ON bounties(org_id);
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_visibility ON bounties(visibility);

-- ----------------------------------------------------------------------------
-- 4. Table: bug_submissions
-- Maps Firestore 'bug_submissions', 'bugs', and 'bugSubmissions' collections.
-- ----------------------------------------------------------------------------
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
    source_collection VARCHAR(50) NOT NULL DEFAULT 'bug_submissions', -- 'bugs' | 'bugSubmissions' | 'bug_submissions'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bug_submissions_bounty_id ON bug_submissions(bounty_id);
CREATE INDEX IF NOT EXISTS idx_bug_submissions_org_id ON bug_submissions(org_id);
CREATE INDEX IF NOT EXISTS idx_bug_submissions_hunter_id ON bug_submissions(hunter_id);
CREATE INDEX IF NOT EXISTS idx_bug_submissions_status ON bug_submissions(status);
CREATE INDEX IF NOT EXISTS idx_bug_submissions_payout_status ON bug_submissions(payout_status);

-- ----------------------------------------------------------------------------
-- 5. Table: vulnerabilities
-- Triaged vulnerabilities with CVSS 3.1 & BugHuntr algorithmic scoring.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_vulnerabilities_submission_id ON vulnerabilities(submission_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_org_id ON vulnerabilities(org_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_status ON vulnerabilities(status);

-- ----------------------------------------------------------------------------
-- 6. Table: cve_requests
-- Coordinated CVE assignment tracking.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_cve_requests_vulnerability_id ON cve_requests(vulnerability_id);
CREATE INDEX IF NOT EXISTS idx_cve_requests_status ON cve_requests(status);

-- ----------------------------------------------------------------------------
-- 7. Table: pro_invitations
-- Maps Firestore 'proInvitations' collection.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_pro_invitations_recipient ON pro_invitations(recipient_email);
CREATE INDEX IF NOT EXISTS idx_pro_invitations_hunt_id ON pro_invitations(hunt_id);

-- ----------------------------------------------------------------------------
-- 8. Table: communities & community_messages
-- Maps Firestore 'communities' and 'communities/{id}/messages' subcollections.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_community_messages_community ON community_messages(community_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 9. Table: org_wallets
-- Organization fund custody for bounty payouts.
-- Enforces strictly non-negative balance and atomic reserved balance.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_wallets (
    org_id VARCHAR(128) PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    balance NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    reserved NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (reserved >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'USDT',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_org_wallets_reserved_le_balance CHECK (reserved <= balance)
);

-- ----------------------------------------------------------------------------
-- 10. Table: payouts
-- Cryptographic payout records. Mirrors Cryptomus integration.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_payouts_order_id ON payouts(order_id);
CREATE INDEX IF NOT EXISTS idx_payouts_submission_id ON payouts(submission_id);
CREATE INDEX IF NOT EXISTS idx_payouts_org_id ON payouts(org_id);
CREATE INDEX IF NOT EXISTS idx_payouts_hunter_id ON payouts(hunter_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);

-- ----------------------------------------------------------------------------
-- 11. Table: payout_logs
-- Append-only immutable payout lifecycle and reconciliation audit trail.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payout_logs (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(100) NOT NULL,
    actor_id VARCHAR(128),
    event_type VARCHAR(100) NOT NULL,
    log_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_logs_order_id ON payout_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_payout_logs_created_at ON payout_logs(created_at);

-- ----------------------------------------------------------------------------
-- 12. Triggers for automatic updated_at maintenance
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_organizations_updated ON organizations;
CREATE TRIGGER trg_organizations_updated
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_bounties_updated ON bounties;
CREATE TRIGGER trg_bounties_updated
BEFORE UPDATE ON bounties
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_bug_submissions_updated ON bug_submissions;
CREATE TRIGGER trg_bug_submissions_updated
BEFORE UPDATE ON bug_submissions
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_vulnerabilities_updated ON vulnerabilities;
CREATE TRIGGER trg_vulnerabilities_updated
BEFORE UPDATE ON vulnerabilities
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_cve_requests_updated ON cve_requests;
CREATE TRIGGER trg_cve_requests_updated
BEFORE UPDATE ON cve_requests
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_pro_invitations_updated ON pro_invitations;
CREATE TRIGGER trg_pro_invitations_updated
BEFORE UPDATE ON pro_invitations
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_communities_updated ON communities;
CREATE TRIGGER trg_communities_updated
BEFORE UPDATE ON communities
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_org_wallets_updated ON org_wallets;
CREATE TRIGGER trg_org_wallets_updated
BEFORE UPDATE ON org_wallets
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_payouts_updated ON payouts;
CREATE TRIGGER trg_payouts_updated
BEFORE UPDATE ON payouts
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

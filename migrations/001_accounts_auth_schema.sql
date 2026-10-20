-- ============================================================================
-- 001_accounts_auth_schema.sql
-- BugHuntr Phase C: Core Accounts, Identity, Roles, and Credentials Schema
-- Target: PostgreSQL / SQL Auth Database
-- Strategy: String-compatible (VARCHAR(128)) primary keys and foreign keys
--           supporting both legacy Firestore IDs and standard UUIDs without type errors.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Table: auth_users
-- Core identity and credentials table. Replaces mutable client-side auth.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
CREATE INDEX IF NOT EXISTS idx_auth_users_legacy_id ON auth_users(legacy_firestore_id);
CREATE INDEX IF NOT EXISTS idx_auth_users_created_at ON auth_users(created_at);

-- ----------------------------------------------------------------------------
-- 2. Table: user_roles
-- Authoritative role storage. Prevents client-side role tampering.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
    id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(128) NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('hunter', 'company', 'admin', 'triager')),
    assigned_by VARCHAR(128) REFERENCES auth_users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- ----------------------------------------------------------------------------
-- 3. Table: user_profiles
-- Public and operational profile metadata.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_points ON user_profiles(points DESC);

-- ----------------------------------------------------------------------------
-- 4. Table: user_credentials
-- Two-factor authentication, API keys, and session secrets.
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);

-- ----------------------------------------------------------------------------
-- 5. Table: auth_audit_log
-- Immutable security audit log for logins, password updates, and role assignments.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(128) REFERENCES auth_users(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_log_user_id ON auth_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_created_at ON auth_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_event_type ON auth_audit_log(event_type);

-- ----------------------------------------------------------------------------
-- 6. Trigger: update timestamps automatically
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auth_users_updated ON auth_users;
CREATE TRIGGER trg_auth_users_updated
BEFORE UPDATE ON auth_users
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_user_profiles_updated ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated
BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_user_credentials_updated ON user_credentials;
CREATE TRIGGER trg_user_credentials_updated
BEFORE UPDATE ON user_credentials
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

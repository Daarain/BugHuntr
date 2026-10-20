-- ============================================================================
-- 004_down_reversion.sql
-- BugHuntr Phase C: Idempotent Rollback / Reversion Script
-- Target: SQL / Supabase Database
-- Safely tears down tables, policies, triggers, and functions in reverse dependency order.
-- ============================================================================

-- 1. Drop Financial Tables & Policies
DROP TABLE IF EXISTS payout_logs CASCADE;
DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS org_wallets CASCADE;

-- 2. Drop Social & Collaboration Tables & Policies
DROP TABLE IF EXISTS community_messages CASCADE;
DROP TABLE IF EXISTS communities CASCADE;
DROP TABLE IF EXISTS pro_invitations CASCADE;

-- 3. Drop Domain Tables & Policies
DROP TABLE IF EXISTS cve_requests CASCADE;
DROP TABLE IF EXISTS vulnerabilities CASCADE;
DROP TABLE IF EXISTS bug_submissions CASCADE;
DROP TABLE IF EXISTS bounties CASCADE;
DROP TABLE IF EXISTS org_members CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

-- 4. Drop Accounts & Auth Tables & Policies
DROP TABLE IF EXISTS auth_audit_log CASCADE;
DROP TABLE IF EXISTS user_credentials CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS auth_users CASCADE;

-- 5. Drop Custom Triggers & Helper Functions
DROP FUNCTION IF EXISTS enforce_profile_field_immutability() CASCADE;
DROP FUNCTION IF EXISTS is_org_admin(VARCHAR(128)) CASCADE;
DROP FUNCTION IF EXISTS is_org_member(VARCHAR(128)) CASCADE;
DROP FUNCTION IF EXISTS is_platform_triager() CASCADE;
DROP FUNCTION IF EXISTS is_platform_admin() CASCADE;
DROP FUNCTION IF EXISTS current_user_id() CASCADE;
DROP FUNCTION IF EXISTS update_timestamp_column() CASCADE;

-- ============================================================================
-- 003_supabase_rls_policies.sql
-- BugHuntr Phase C: Row-Level Security (RLS) & Multi-Tenant Access Policies
-- Target: Supabase / PostgreSQL
-- Replaces insecure client-side mutations with cryptographic, server-enforced RLS.
-- Identity Model: Uses current_user_id() resolving Supabase auth.uid()::text or JWT sub.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper Function: Current User Identity Resolution
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS VARCHAR(128) AS $$
BEGIN
    RETURN COALESCE(
        auth.uid()::text,
        NULLIF(current_setting('request.jwt.claim.sub', true), '')::VARCHAR(128)
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- 2. Enable RLS on ALL tables (Complete Domain & Active Collections)
-- ----------------------------------------------------------------------------
ALTER TABLE auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vulnerabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cve_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pro_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE org_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 3. Role and Membership Resolution Helpers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = current_user_id()
        AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_platform_triager()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = current_user_id()
        AND role IN ('triager', 'admin')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_org_member(target_org_id VARCHAR(128))
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM org_members
        WHERE org_id = target_org_id
        AND user_id = current_user_id()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_org_admin(target_org_id VARCHAR(128))
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM org_members
        WHERE org_id = target_org_id
        AND user_id = current_user_id()
        AND role IN ('owner', 'admin')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 4. RLS Policies: auth_users & user_roles
-- ----------------------------------------------------------------------------
CREATE POLICY rls_auth_users_select ON auth_users
    FOR SELECT TO authenticated
    USING (id = current_user_id() OR is_platform_admin());

CREATE POLICY rls_auth_users_mutate ON auth_users
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

CREATE POLICY rls_user_roles_select ON user_roles
    FOR SELECT TO authenticated
    USING (user_id = current_user_id() OR is_platform_admin());

CREATE POLICY rls_user_roles_admin ON user_roles
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

-- ----------------------------------------------------------------------------
-- 5. RLS Policies: user_profiles
-- ----------------------------------------------------------------------------
CREATE POLICY rls_user_profiles_select ON user_profiles
    FOR SELECT TO public
    USING (TRUE);

CREATE POLICY rls_user_profiles_update ON user_profiles
    FOR UPDATE TO authenticated
    USING (user_id = current_user_id())
    WITH CHECK (user_id = current_user_id());

CREATE OR REPLACE FUNCTION enforce_profile_field_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.points IS DISTINCT FROM NEW.points OR OLD.reputation_rank IS DISTINCT FROM NEW.reputation_rank) THEN
        IF NOT is_platform_admin() AND current_user <> 'service_role' THEN
            RAISE EXCEPTION 'Unauthorized: Direct modification of points or reputation rank is prohibited.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_profile_field_protect ON user_profiles;
CREATE TRIGGER trg_profile_field_protect
BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION enforce_profile_field_immutability();

-- ----------------------------------------------------------------------------
-- 6. RLS Policies: organizations & org_members
-- ----------------------------------------------------------------------------
CREATE POLICY rls_organizations_select ON organizations
    FOR SELECT TO public
    USING (verified = TRUE OR is_org_member(id) OR is_platform_admin());

CREATE POLICY rls_organizations_manage ON organizations
    FOR UPDATE TO authenticated
    USING (is_org_admin(id) OR is_platform_admin())
    WITH CHECK (is_org_admin(id) OR is_platform_admin());

CREATE POLICY rls_org_members_select ON org_members
    FOR SELECT TO authenticated
    USING (is_org_member(org_id) OR is_platform_admin());

CREATE POLICY rls_org_members_admin ON org_members
    FOR ALL TO authenticated
    USING (is_org_admin(org_id) OR is_platform_admin())
    WITH CHECK (is_org_admin(org_id) OR is_platform_admin());

-- ----------------------------------------------------------------------------
-- 7. RLS Policies: bounties
-- ----------------------------------------------------------------------------
CREATE POLICY rls_bounties_select ON bounties
    FOR SELECT TO public
    USING (status = 'active' OR is_org_member(org_id) OR is_platform_admin());

CREATE POLICY rls_bounties_mutate ON bounties
    FOR ALL TO authenticated
    USING (is_org_admin(org_id) OR is_platform_admin())
    WITH CHECK (is_org_admin(org_id) OR is_platform_admin());

-- ----------------------------------------------------------------------------
-- 8. RLS Policies: bug_submissions
-- ----------------------------------------------------------------------------
CREATE POLICY rls_bug_submissions_select ON bug_submissions
    FOR SELECT TO authenticated
    USING (
        hunter_id = current_user_id() OR
        is_org_member(org_id) OR
        is_platform_triager()
    );

CREATE POLICY rls_bug_submissions_insert ON bug_submissions
    FOR INSERT TO authenticated
    WITH CHECK (
        hunter_id = current_user_id() AND
        status = 'submitted' AND
        payout_status = 'unpaid' AND
        reward_amount = 0.00
    );

CREATE POLICY rls_bug_submissions_update ON bug_submissions
    FOR UPDATE TO authenticated
    USING (
        is_org_admin(org_id) OR
        is_platform_triager()
    )
    WITH CHECK (
        is_org_admin(org_id) OR
        is_platform_triager()
    );

-- ----------------------------------------------------------------------------
-- 9. RLS Policies: vulnerabilities & cve_requests
-- ----------------------------------------------------------------------------
CREATE POLICY rls_vulnerabilities_select ON vulnerabilities
    FOR SELECT TO authenticated
    USING (
        is_org_member(org_id) OR
        is_platform_triager() OR
        EXISTS (SELECT 1 FROM bug_submissions s WHERE s.id = submission_id AND s.hunter_id = current_user_id())
    );

CREATE POLICY rls_vulnerabilities_mutate ON vulnerabilities
    FOR ALL TO authenticated
    USING (is_platform_triager())
    WITH CHECK (is_platform_triager());

CREATE POLICY rls_cve_requests_select ON cve_requests
    FOR SELECT TO authenticated
    USING (
        requester_id = current_user_id() OR
        is_platform_triager() OR
        EXISTS (
            SELECT 1 FROM vulnerabilities v
            WHERE v.id = vulnerability_id AND is_org_member(v.org_id)
        )
    );

CREATE POLICY rls_cve_requests_insert ON cve_requests
    FOR INSERT TO authenticated
    WITH CHECK (
        requester_id = current_user_id() OR is_platform_triager()
    );

CREATE POLICY rls_cve_requests_update ON cve_requests
    FOR UPDATE TO authenticated
    USING (is_platform_triager() OR EXISTS (
        SELECT 1 FROM vulnerabilities v
        WHERE v.id = vulnerability_id AND is_org_admin(v.org_id)
    ));

-- ----------------------------------------------------------------------------
-- 10. RLS Policies: pro_invitations, communities, community_messages
-- ----------------------------------------------------------------------------
CREATE POLICY rls_pro_invitations_select ON pro_invitations
    FOR SELECT TO authenticated
    USING (
        sender_id = current_user_id() OR
        recipient_email = (SELECT email FROM auth_users WHERE id = current_user_id()) OR
        is_platform_admin()
    );

CREATE POLICY rls_pro_invitations_mutate ON pro_invitations
    FOR ALL TO authenticated
    USING (sender_id = current_user_id() OR is_platform_admin())
    WITH CHECK (sender_id = current_user_id() OR is_platform_admin());

CREATE POLICY rls_communities_select ON communities
    FOR SELECT TO authenticated
    USING (is_private = FALSE OR creator_id = current_user_id() OR is_platform_admin());

CREATE POLICY rls_communities_mutate ON communities
    FOR ALL TO authenticated
    USING (creator_id = current_user_id() OR is_platform_admin())
    WITH CHECK (creator_id = current_user_id() OR is_platform_admin());

CREATE POLICY rls_community_messages_select ON community_messages
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM communities c
        WHERE c.id = community_id AND (c.is_private = FALSE OR c.creator_id = current_user_id() OR is_platform_admin())
    ));

CREATE POLICY rls_community_messages_insert ON community_messages
    FOR INSERT TO authenticated
    WITH CHECK (sender_id = current_user_id());

-- ----------------------------------------------------------------------------
-- 11. RLS Policies: org_wallets, payouts & payout_logs (FINANCIAL HARDENING)
-- DIRECT CLIENT MUTATIONS ARE STRICTLY FORBIDDEN!
-- ----------------------------------------------------------------------------
CREATE POLICY rls_org_wallets_select ON org_wallets
    FOR SELECT TO authenticated
    USING (is_org_admin(org_id) OR is_platform_admin());

CREATE POLICY rls_org_wallets_block_client_writes ON org_wallets
    FOR ALL TO authenticated
    USING (FALSE)
    WITH CHECK (FALSE);

CREATE POLICY rls_payouts_select ON payouts
    FOR SELECT TO authenticated
    USING (
        hunter_id = current_user_id() OR
        is_org_admin(org_id) OR
        is_platform_admin()
    );

CREATE POLICY rls_payouts_block_client_writes ON payouts
    FOR ALL TO authenticated
    USING (FALSE)
    WITH CHECK (FALSE);

CREATE POLICY rls_payout_logs_select ON payout_logs
    FOR SELECT TO authenticated
    USING (is_platform_admin());

CREATE POLICY rls_payout_logs_block_client_writes ON payout_logs
    FOR ALL TO authenticated
    USING (FALSE)
    WITH CHECK (FALSE);

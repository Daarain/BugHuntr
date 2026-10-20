/**
 * PostgreSQL / Supabase Auth & Identity Repository Abstraction
 *
 * Scoped strictly to PostgreSQL-owned domain:
 * - User identity and account credentials (bcrypt hashes)
 * - User roles and permissions (hunter, company, admin, triager)
 * - Basic user profiles (username, display name, avatar, bio, company metadata)
 * - Two-factor authentication credentials & configuration
 * - Immutable authentication and security audit logs
 *
 * Implements the stable string User ID contract (VARCHAR(128)).
 */

import crypto from "crypto";
import type { Pool, PoolClient } from "pg";
import { getPostgresPool } from "./postgres";

export type RoleType = "hunter" | "company" | "admin" | "triager";
export type CredentialType = "password" | "totp" | "email_otp" | "api_key";

export interface AuthUser {
  id: string;
  email: string;
  email_verified: boolean;
  password_hash: string;
  legacy_firestore_id?: string | null;
  is_active: boolean;
  is_banned: boolean;
  last_sign_in_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  role: RoleType;
  assigned_by?: string | null;
  assigned_at: Date;
}

export interface UserProfile {
  user_id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  country?: string | null;
  points?: number;
  reputation_rank?: string;
  company_name?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserCredential {
  id: string;
  user_id: string;
  credential_type: CredentialType;
  secret_hash?: string | null;
  is_enabled: boolean;
  last_verified_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuthAuditLogEntry {
  id?: number;
  user_id?: string | null;
  event_type: string;
  ip_address?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, any>;
  created_at?: Date;
}

export interface AuthUserWithProfileAndRoles extends AuthUser {
  roles: RoleType[];
  profile?: UserProfile | null;
}

export interface CreateUserParams {
  id?: string;
  email: string;
  passwordHash: string;
  username: string;
  displayName?: string | null;
  role?: RoleType;
  userType?: "hunter" | "company";
  companyName?: string | null;
  legacyFirestoreId?: string | null;
  emailVerified?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export class DuplicateAccountError extends Error {
  public readonly field: "email" | "username";

  constructor(message: string, field: "email" | "username") {
    super(message);
    this.name = "DuplicateAccountError";
    this.field = field;
  }
}

export class AuthRepository {
  private customPool?: Pool;

  constructor(pool?: Pool) {
    this.customPool = pool;
  }

  setPool(pool?: Pool): void {
    this.customPool = pool;
  }

  private getPool(): Pool {
    return this.customPool || getPostgresPool();
  }

  /**
   * Creates a user atomically within a database transaction:
   * 1. Inserts into auth_users (stable string ID)
   * 2. Inserts into user_roles
   * 3. Inserts into user_profiles
   * 4. Logs user_created event in auth_audit_log
   */
  async createUser(params: CreateUserParams): Promise<AuthUserWithProfileAndRoles> {
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userId = params.id?.trim() || crypto.randomUUID();
      const normalizedEmail = params.email.trim().toLowerCase();
      const cleanUsername = params.username.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
      const effectiveRole: RoleType = params.role || (params.userType === "company" ? "company" : "hunter");
      const displayName = params.displayName?.trim() || cleanUsername;
      const companyName = params.companyName?.trim() || null;
      const legacyFirestoreId = params.legacyFirestoreId?.trim() || null;
      const emailVerified = Boolean(params.emailVerified);

      // 1. Insert auth_users
      const insertUserSql = `
        INSERT INTO auth_users (
          id, email, email_verified, password_hash, legacy_firestore_id,
          is_active, is_banned, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, NOW(), NOW())
        RETURNING *;
      `;
      let userRes;
      try {
        userRes = await client.query(insertUserSql, [
          userId,
          normalizedEmail,
          emailVerified,
          params.passwordHash,
          legacyFirestoreId,
        ]);
      } catch (err: any) {
        if (err.code === "23505") {
          throw new DuplicateAccountError("An account with this email address already exists.", "email");
        }
        throw err;
      }

      const createdUser = userRes.rows[0];

      // 2. Insert user_roles
      const insertRoleSql = `
        INSERT INTO user_roles (id, user_id, role, assigned_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id, role) DO NOTHING;
      `;
      await client.query(insertRoleSql, [crypto.randomUUID(), userId, effectiveRole]);

      // 3. Insert user_profiles
      const insertProfileSql = `
        INSERT INTO user_profiles (
          user_id, username, display_name, company_name, points, reputation_rank, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 0, 'Novice', NOW(), NOW())
        RETURNING *;
      `;
      let profileRes;
      try {
        profileRes = await client.query(insertProfileSql, [
          userId,
          cleanUsername,
          displayName,
          companyName,
        ]);
      } catch (err: any) {
        if (err.code === "23505") {
          throw new DuplicateAccountError("An account with this username already exists.", "username");
        }
        throw err;
      }

      const createdProfile = profileRes.rows[0];

      // 4. Record security audit log
      const insertAuditSql = `
        INSERT INTO auth_audit_log (user_id, event_type, ip_address, user_agent, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW());
      `;
      await client.query(insertAuditSql, [
        userId,
        "user_signup",
        params.ipAddress || null,
        params.userAgent || null,
        JSON.stringify({
          role: effectiveRole,
          email: normalizedEmail,
          username: cleanUsername,
        }),
      ]);

      await client.query("COMMIT");

      return {
        ...createdUser,
        roles: [effectiveRole],
        profile: createdProfile,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves user identity, roles, and basic profile by email.
   */
  async findUserByEmail(email: string): Promise<AuthUserWithProfileAndRoles | null> {
    const pool = this.getPool();
    const normalizedEmail = email.trim().toLowerCase();

    const sql = `
      SELECT
        u.*,
        p.username,
        p.display_name,
        p.avatar_url,
        p.bio,
        p.country,
        p.points,
        p.reputation_rank,
        p.company_name,
        COALESCE(
          array_agg(r.role) FILTER (WHERE r.role IS NOT NULL),
          ARRAY[]::VARCHAR[]
        ) as roles
      FROM auth_users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE LOWER(u.email) = $1
      GROUP BY u.id, p.user_id;
    `;

    const res = await pool.query(sql, [normalizedEmail]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      email_verified: row.email_verified,
      password_hash: row.password_hash,
      legacy_firestore_id: row.legacy_firestore_id,
      is_active: row.is_active,
      is_banned: row.is_banned,
      last_sign_in_at: row.last_sign_in_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      roles: (row.roles || []) as RoleType[],
      profile: row.username
        ? {
            user_id: row.id,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            bio: row.bio,
            country: row.country,
            points: row.points,
            reputation_rank: row.reputation_rank,
            company_name: row.company_name,
            created_at: row.created_at,
            updated_at: row.updated_at,
          }
        : null,
    };
  }

  /**
   * Retrieves user identity, roles, and basic profile by stable string ID.
   */
  async findUserById(id: string): Promise<AuthUserWithProfileAndRoles | null> {
    const pool = this.getPool();
    const cleanId = id.trim();

    const sql = `
      SELECT
        u.*,
        p.username,
        p.display_name,
        p.avatar_url,
        p.bio,
        p.country,
        p.points,
        p.reputation_rank,
        p.company_name,
        COALESCE(
          array_agg(r.role) FILTER (WHERE r.role IS NOT NULL),
          ARRAY[]::VARCHAR[]
        ) as roles
      FROM auth_users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE u.id = $1
      GROUP BY u.id, p.user_id;
    `;

    const res = await pool.query(sql, [cleanId]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      email_verified: row.email_verified,
      password_hash: row.password_hash,
      legacy_firestore_id: row.legacy_firestore_id,
      is_active: row.is_active,
      is_banned: row.is_banned,
      last_sign_in_at: row.last_sign_in_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      roles: (row.roles || []) as RoleType[],
      profile: row.username
        ? {
            user_id: row.id,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            bio: row.bio,
            country: row.country,
            points: row.points,
            reputation_rank: row.reputation_rank,
            company_name: row.company_name,
            created_at: row.created_at,
            updated_at: row.updated_at,
          }
        : null,
    };
  }

  /**
   * Retrieves profile by username.
   */
  async findProfileByUsername(username: string): Promise<UserProfile | null> {
    const pool = this.getPool();
    const cleanUsername = username.trim();

    const sql = `
      SELECT * FROM user_profiles
      WHERE LOWER(username) = LOWER($1);
    `;

    const res = await pool.query(sql, [cleanUsername]);
    if (res.rows.length === 0) return null;
    return res.rows[0] as UserProfile;
  }

  /**
   * High-performance batch profile resolution for Application Gateway / MongoDB references.
   * Resolves list of userIds to Map<userId, UserProfile> in a single SQL query.
   */
  async getUserProfilesBatch(userIds: string[]): Promise<Map<string, UserProfile>> {
    const profileMap = new Map<string, UserProfile>();
    if (!userIds || userIds.length === 0) return profileMap;

    const cleanIds = Array.from(new Set(userIds.map((id) => id.trim()).filter(Boolean)));
    if (cleanIds.length === 0) return profileMap;

    const pool = this.getPool();
    const sql = `
      SELECT user_id, username, display_name, avatar_url, bio, country, points, reputation_rank, company_name, created_at, updated_at
      FROM user_profiles
      WHERE user_id = ANY($1);
    `;

    const res = await pool.query(sql, [cleanIds]);
    for (const row of res.rows) {
      profileMap.set(row.user_id, row as UserProfile);
    }
    return profileMap;
  }

  /**
   * Updates public/application profile details for a user in user_profiles.
   * Enforces that identity and security fields cannot be modified through this method.
   */
  async updateProfile(
    userId: string,
    updates: {
      displayName?: string | null;
      avatarUrl?: string | null;
      bio?: string | null;
      country?: string | null;
      companyName?: string | null;
    }
  ): Promise<UserProfile | null> {
    const pool = this.getPool();
    const cleanUserId = userId.trim();

    // Verify user exists in auth_users
    const userRes = await pool.query(`SELECT id, username FROM auth_users WHERE id = $1`, [cleanUserId]);
    if (userRes.rows.length === 0) return null;
    const user = userRes.rows[0];

    // Ensure profile row exists
    const existing = await pool.query(`SELECT * FROM user_profiles WHERE user_id = $1`, [cleanUserId]);
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO user_profiles (user_id, username, display_name, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING;`,
        [cleanUserId, user.username, user.username]
      );
    }

    const sets: string[] = [];
    const values: any[] = [cleanUserId];
    let idx = 2;

    if (updates.displayName !== undefined) {
      sets.push(`display_name = $${idx++}`);
      values.push(updates.displayName ? updates.displayName.trim() : null);
    }
    if (updates.avatarUrl !== undefined) {
      sets.push(`avatar_url = $${idx++}`);
      values.push(updates.avatarUrl ? updates.avatarUrl.trim() : null);
    }
    if (updates.bio !== undefined) {
      sets.push(`bio = $${idx++}`);
      values.push(updates.bio ? updates.bio.trim() : null);
    }
    if (updates.country !== undefined) {
      sets.push(`country = $${idx++}`);
      values.push(updates.country ? updates.country.trim() : null);
    }
    if (updates.companyName !== undefined) {
      sets.push(`company_name = $${idx++}`);
      values.push(updates.companyName ? updates.companyName.trim() : null);
    }

    if (sets.length === 0) {
      const res = await pool.query(`SELECT * FROM user_profiles WHERE user_id = $1`, [cleanUserId]);
      return (res.rows[0] as UserProfile) || null;
    }

    sets.push(`updated_at = NOW()`);
    const sql = `
      UPDATE user_profiles
      SET ${sets.join(", ")}
      WHERE user_id = $1
      RETURNING *;
    `;

    const res = await pool.query(sql, values);
    return (res.rows[0] as UserProfile) || null;
  }

  /**
   * Updates last sign-in timestamp for user.
   */
  async updateLastSignIn(userId: string): Promise<void> {
    const pool = this.getPool();
    const sql = `UPDATE auth_users SET last_sign_in_at = NOW(), updated_at = NOW() WHERE id = $1;`;
    await pool.query(sql, [userId.trim()]);
  }

  /**
   * Assigns a role to a user.
   */
  async assignUserRole(userId: string, role: RoleType, assignedBy?: string): Promise<void> {
    const pool = this.getPool();
    const sql = `
      INSERT INTO user_roles (id, user_id, role, assigned_by, assigned_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id, role) DO NOTHING;
    `;
    await pool.query(sql, [crypto.randomUUID(), userId.trim(), role, assignedBy?.trim() || null]);
  }

  /**
   * Retrieves all roles assigned to a user.
   */
  async getUserRoles(userId: string): Promise<RoleType[]> {
    const pool = this.getPool();
    const sql = `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY assigned_at ASC;`;
    const res = await pool.query(sql, [userId.trim()]);
    return res.rows.map((r: any) => r.role as RoleType);
  }

  /**
   * Retrieves 2FA or API key credentials for a user.
   */
  async getUserCredentials(userId: string, credentialType?: CredentialType): Promise<UserCredential[]> {
    const pool = this.getPool();
    let sql = `SELECT * FROM user_credentials WHERE user_id = $1`;
    const params: any[] = [userId.trim()];

    if (credentialType) {
      sql += ` AND credential_type = $2`;
      params.push(credentialType);
    }

    const res = await pool.query(sql, params);
    return res.rows as UserCredential[];
  }

  /**
   * Configures or updates a user credential (e.g. TOTP or Email OTP).
   */
  async setUserCredential(
    userId: string,
    credentialType: CredentialType,
    secretHash: string,
    isEnabled: boolean = true
  ): Promise<UserCredential> {
    const pool = this.getPool();
    const sql = `
      INSERT INTO user_credentials (
        id, user_id, credential_type, secret_hash, is_enabled, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (user_id, credential_type) DO UPDATE
      SET secret_hash = EXCLUDED.secret_hash,
          is_enabled = EXCLUDED.is_enabled,
          updated_at = NOW()
      RETURNING *;
    `;

    const res = await pool.query(sql, [
      crypto.randomUUID(),
      userId.trim(),
      credentialType,
      secretHash,
      isEnabled,
    ]);
    return res.rows[0] as UserCredential;
  }

  /**
   * Appends an immutable security record to auth_audit_log.
   */
  async recordAuthAuditLog(entry: AuthAuditLogEntry): Promise<void> {
    const pool = this.getPool();
    const sql = `
      INSERT INTO auth_audit_log (user_id, event_type, ip_address, user_agent, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW());
    `;

    await pool.query(sql, [
      entry.user_id ? entry.user_id.trim() : null,
      entry.event_type.trim(),
      entry.ip_address || null,
      entry.user_agent || null,
      JSON.stringify(entry.metadata || {}),
    ]);
  }
}

// Default singleton instance
export const authRepository = new AuthRepository();

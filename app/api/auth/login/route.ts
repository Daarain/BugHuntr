import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { setSessionCookie, type SessionUser } from "@/lib/server-auth";
import {
  createChallengeToken,
  verifyChallengeToken,
  isEmailTransportConfigured,
} from "@/lib/auth-2fa";
import { authRepository } from "@/lib/db/auth-repository";
import { enforceRateLimit } from "@/lib/security/rate-limiter";

function isPostgresConfigured(): boolean {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  return Boolean(url && url.trim().length > 0);
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, {
      action: "login",
      limit: 15,
      windowSeconds: 900,
    });
    if (rateLimitResponse) return rateLimitResponse;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const email = body.email.trim().toLowerCase();
    const password = body.password;
    const { twoFactorCode, challengeToken } = body;

    let userFound = false;
    let userId: string = "";
    let userEmail: string = email;
    let username: string = "";
    let isActualAdmin = false;
    let isTriager = false;
    let isCompany = false;
    let organizationId: string | undefined = undefined;
    let companyName: string | undefined = undefined;

    if (!isPostgresConfigured()) {
      return NextResponse.json(
        { error: "Authentication service unavailable: PostgreSQL authentication backend is required." },
        { status: 503 }
      );
    }

    // Authoritative PostgreSQL / Supabase lookup
    const pgUser = await authRepository.findUserByEmail(email);
    if (!pgUser) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    if (!pgUser.password_hash) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    if (!pgUser.is_active || pgUser.is_banned) {
      return NextResponse.json(
        { error: "This account has been deactivated or suspended." },
        { status: 403 }
      );
    }

    const isPasswordValid = await bcrypt.compare(password, pgUser.password_hash);
    if (!isPasswordValid) {
      // Log failed attempt
      await authRepository.recordAuthAuditLog({
        user_id: pgUser.id,
        event_type: "login_failed_password",
        ip_address: request.headers.get("x-forwarded-for") || null,
        user_agent: request.headers.get("user-agent") || null,
      }).catch(() => {});

      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    userFound = true;
    userId = pgUser.id;
    userEmail = pgUser.email;
    isActualAdmin = pgUser.roles.includes("admin");
    isTriager = pgUser.roles.includes("triager");
    isCompany = pgUser.roles.includes("company");
    username = pgUser.profile?.username || email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
    if (isCompany && pgUser.profile?.company_name) {
      companyName = pgUser.profile.company_name.trim();
      organizationId = companyName;
    }

    if (!userFound) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // 3. Enforce 2FA for all accounts that have it enabled or are admins
    const userCredentials = await authRepository.getUserCredentials(userId).catch(() => []);
    const hasEnabled2FA = userCredentials.some(
      (c) => c.is_enabled && (c.credential_type === "totp" || c.credential_type === "email_otp")
    );
    const requires2FA = isActualAdmin || hasEnabled2FA;

    if (requires2FA) {
      if (!twoFactorCode || !challengeToken) {
        if (!isEmailTransportConfigured()) {
          return NextResponse.json(
            {
              error: "Two-factor authentication provider is unconfigured.",
              requires2FA: true,
            },
            { status: 503 }
          );
        }

        const otp = crypto.randomInt(100000, 1000000).toString();
        const newChallengeToken = createChallengeToken(userEmail, otp);

        return NextResponse.json(
          {
            requires2FA: true,
            challengeToken: newChallengeToken,
            message: isActualAdmin
              ? "Two-factor authentication required for administrator accounts."
              : "Two-factor authentication is required for this account.",
          },
          { status: 200 }
        );
      }

      // Verify submitted 2FA code
      const verifyResult = verifyChallengeToken(challengeToken, userEmail, twoFactorCode);
      if (!verifyResult.valid) {
        return NextResponse.json(
          {
            error: verifyResult.error || "Invalid 2FA code.",
            requires2FA: true,
            attemptsRemaining: verifyResult.attemptsRemaining,
            newChallengeToken: verifyResult.newChallengeToken,
          },
          { status: 400 }
        );
      }
    }

    // 4. Update last sign in and log success if Postgres is active
    if (isPostgresConfigured() && userId) {
      await authRepository.updateLastSignIn(userId).catch(() => {});
      await authRepository.recordAuthAuditLog({
        user_id: userId,
        event_type: "login_success",
        ip_address: request.headers.get("x-forwarded-for") || null,
        user_agent: request.headers.get("user-agent") || null,
        metadata: { isActualAdmin },
      }).catch(() => {});
    }

    // 5. Establish secure server-side session
    const role = isActualAdmin ? "admin" : (isTriager ? "triager" : "user");
    const userType = isCompany ? "company" : "hunter";

    const sessionUser: SessionUser = {
      id: userId,
      email: userEmail,
      username,
      role,
      userType,
    };

    if (organizationId) {
      sessionUser.organizationId = organizationId;
      sessionUser.orgId = organizationId;
    }
    if (companyName) {
      sessionUser.companyName = companyName;
    }

    const response = NextResponse.json(
      {
        success: true,
        user: sessionUser,
        message: "Authentication successful.",
      },
      { status: 200 }
    );

    setSessionCookie(response, sessionUser);
    return response;
  } catch (error) {
    console.error("Server login error:", error);
    return NextResponse.json(
      { error: "Internal server authentication error." },
      { status: 500 }
    );
  }
}

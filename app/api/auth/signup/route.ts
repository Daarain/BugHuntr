import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { setSessionCookie, type SessionUser } from "@/lib/server-auth";
import { authRepository, DuplicateAccountError } from "@/lib/db/auth-repository";
import { enforceRateLimit } from "@/lib/security/rate-limiter";

function isPostgresConfigured(): boolean {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  return Boolean(url && url.trim().length > 0);
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, {
      action: "signup",
      limit: 10,
      windowSeconds: 900,
    });
    if (rateLimitResponse) return rateLimitResponse;
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Request body is required." }, { status: 400 });
    }

    const { username, email, password, name, userType, companyName } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanUsername = (username || normalizedEmail.split("@")[0])
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    // Privilege escalation prevention: NEVER grant admin role via public signup!
    const effectiveUserType = userType === "company" ? "company" : "hunter";
    const effectiveSessionRole: "user" = "user";
    const effectiveDbRole = effectiveUserType === "company" ? "company" : "hunter";

    // Hash password on server
    const hashedPassword = await bcrypt.hash(password, 10);

    let sessionUserId: string;

    if (!isPostgresConfigured()) {
      return NextResponse.json(
        { error: "Authentication service unavailable: PostgreSQL authentication backend is required." },
        { status: 503 }
      );
    }

    // Authoritative PostgreSQL / Supabase User Creation
    try {
      const created = await authRepository.createUser({
        email: normalizedEmail,
        passwordHash: hashedPassword,
        username: cleanUsername,
        displayName: name || cleanUsername,
        role: effectiveDbRole,
        userType: effectiveUserType,
        companyName: effectiveUserType === "company" ? companyName || null : null,
        ipAddress: request.headers.get("x-forwarded-for") || null,
        userAgent: request.headers.get("user-agent") || null,
      });
      sessionUserId = created.id;
    } catch (err: any) {
      if (err instanceof DuplicateAccountError || err.code === "23505") {
        return NextResponse.json(
          { error: err.message || "An account with this email address already exists." },
          { status: 409 }
        );
      }
      throw err;
    }

    const sessionUser: SessionUser = {
      id: sessionUserId,
      email: normalizedEmail,
      username: cleanUsername,
      role: effectiveSessionRole,
      userType: effectiveUserType,
    };

    if (effectiveUserType === "company" && companyName && typeof companyName === "string" && companyName.trim().length > 0) {
      const cleanCompany = companyName.trim();
      sessionUser.organizationId = cleanCompany;
      sessionUser.orgId = cleanCompany;
      sessionUser.companyName = cleanCompany;
    }

    const response = NextResponse.json(
      {
        success: true,
        user: sessionUser,
        message: "Account created successfully.",
      },
      { status: 201 }
    );

    setSessionCookie(response, sessionUser);
    return response;
  } catch (error) {
    console.error("Server signup error:", error);
    return NextResponse.json(
      { error: "Internal server error during account creation." },
      { status: 500 }
    );
  }
}

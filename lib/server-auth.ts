import crypto from "crypto";
import { NextRequest, type NextResponse } from "next/server";
import { authRepository } from "@/lib/db/auth-repository";

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  role: "user" | "admin" | "triager" | "company" | "hunter";
  userType?: "hunter" | "company" | string;
  organizationId?: string;
  orgId?: string;
  companyName?: string;
}

export async function getServerSession(
  request: Request | NextRequest
): Promise<{ user: SessionUser } | null> {
  const { authenticated, user } = getSessionFromRequest(request);
  if (!authenticated || !user) return null;

  // Authoritative server-side account validation (ban/deactivation/role check)
  const isPgConfigured = Boolean(
    (process.env.POSTGRES_URL || process.env.DATABASE_URL)?.trim()
  );

  if (isPgConfigured && user.id) {
    try {
      const activeUser = await authRepository.findUserById(user.id);
      if (!activeUser || !activeUser.is_active || activeUser.is_banned) {
        return null;
      }
      // Re-sync authoritative roles
      const roles = activeUser.roles || [];
      const isActualAdmin = roles.includes("admin");
      const isTriager = roles.includes("triager");
      const isCompany = roles.includes("company");
      user.role = isActualAdmin ? "admin" : (isTriager ? "triager" : (isCompany ? "company" : "user"));
    } catch {
      // In offline testing or temporary DB unavailability, allow verified token session
    }
  }

  return { user };
}

interface SessionPayload extends SessionUser {
  iat: number;
  exp: number;
}

const SESSION_COOKIE_NAME = "bughuntr_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MIN_SECRET_LENGTH = 32;

const KNOWN_INSECURE_SECRETS = new Set([
  "bughuntr_server_session_fallback_secret_key_2026",
  "secret",
  "changeme",
  "password",
  "12345678",
  "fallback_secret_key",
  "dev_secret",
]);

const VALID_ROLES = new Set(["user", "admin", "triager", "company", "hunter"]);

export function getSessionSecret(): string {
  const isProduction = process.env.NODE_ENV === "production";
  const rawSecret = process.env.SESSION_SECRET?.trim() || "";
  const secret = rawSecret;

  if (isProduction) {
    if (!secret) {
      throw new Error(
        "Server configuration error: SESSION_SECRET is missing. In production, a secure secret of at least 32 characters must be configured."
      );
    }
    if (secret.length < MIN_SECRET_LENGTH || KNOWN_INSECURE_SECRETS.has(secret)) {
      throw new Error(
        "Server configuration error: SESSION_SECRET is unsafe. Production secret must be at least 32 characters and cannot be a default or placeholder key."
      );
    }
    return secret;
  }

  // Safe development and test fallback
  if (secret) {
    return secret;
  }
  return "bughuntr_dev_test_session_fallback_secret_only_for_local_development_32chars";
}

function sign(payloadStr: string): string {
  const secret = getSessionSecret();
  return crypto.createHmac("sha256", secret).update(payloadStr).digest("hex");
}

export function createSessionToken(user: SessionUser): string {
  if (!user || typeof user !== "object") {
    throw new Error("Invalid user object provided to createSessionToken.");
  }
  if (!user.id || typeof user.id !== "string" || user.id.trim().length === 0) {
    throw new Error("Cannot create session: User ID is required.");
  }
  if (!user.email || typeof user.email !== "string" || !user.email.includes("@")) {
    throw new Error("Cannot create session: Valid user email is required.");
  }
  if (!user.role || !VALID_ROLES.has(user.role)) {
    throw new Error(`Cannot create session: Invalid role '${user.role}'.`);
  }

  const now = Date.now();
  const effectiveOrgId = (user.organizationId || user.orgId)?.trim() || undefined;

  const payload: SessionPayload = {
    id: user.id.trim(),
    email: user.email.trim().toLowerCase(),
    username: (user.username || user.email.split("@")[0]).trim(),
    role: user.role,
    userType: user.userType || (user.role === "company" ? "company" : "hunter"),
    iat: now,
    exp: now + SESSION_DURATION_MS,
  };

  if (effectiveOrgId) {
    payload.organizationId = effectiveOrgId;
    payload.orgId = effectiveOrgId;
  }
  if (user.companyName && typeof user.companyName === "string" && user.companyName.trim().length > 0) {
    payload.companyName = user.companyName.trim();
  }

  const payloadStr = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadStr).toString("base64url");
  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string): { valid: boolean; user?: SessionUser; error?: string } {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Invalid token format." };
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, error: "Invalid token format." };
  }

  const [encodedPayload, signature] = parts;

  let expectedSignature: string;
  try {
    expectedSignature = sign(encodedPayload);
  } catch (err: any) {
    // Fail closed if server auth is misconfigured
    return { valid: false, error: err.message || "Server authentication configuration error." };
  }

  const expectedSigBuf = Buffer.from(expectedSignature, "utf8");
  const actualSigBuf = Buffer.from(signature, "utf8");

  if (
    expectedSigBuf.length !== actualSigBuf.length ||
    !crypto.timingSafeEqual(expectedSigBuf, actualSigBuf)
  ) {
    return { valid: false, error: "Token signature verification failed." };
  }

  try {
    const payloadStr = Buffer.from(encodedPayload, "base64url").toString("utf-8");
    const payload: SessionPayload = JSON.parse(payloadStr);

    if (typeof payload !== "object" || payload === null) {
      return { valid: false, error: "Malformed session token payload." };
    }

    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") {
      return { valid: false, error: "Invalid token timestamps." };
    }

    const now = Date.now();
    if (now > payload.exp) {
      return { valid: false, error: "Session token expired." };
    }

    // Guard against tokens claiming future issuance beyond reasonable clock skew (60s)
    if (payload.iat > now + 60000) {
      return { valid: false, error: "Token issued in the future." };
    }

    if (!payload.id || typeof payload.id !== "string" || payload.id.trim().length === 0) {
      return { valid: false, error: "Missing user ID in session payload." };
    }

    if (!payload.email || typeof payload.email !== "string" || !payload.email.includes("@")) {
      return { valid: false, error: "Missing or invalid email in session payload." };
    }

    if (!payload.role || !VALID_ROLES.has(payload.role)) {
      return { valid: false, error: `Invalid role '${payload.role}' in session payload.` };
    }

    const user: SessionUser = {
      id: payload.id.trim(),
      email: payload.email.trim().toLowerCase(),
      username: (payload.username || "").trim(),
      role: payload.role,
      userType: payload.userType || (payload.role === "company" ? "company" : "hunter"),
    };

    const effectiveOrgId = (payload.organizationId || payload.orgId)?.trim() || undefined;
    if (effectiveOrgId) {
      user.organizationId = effectiveOrgId;
      user.orgId = effectiveOrgId;
    }

    if (payload.companyName && typeof payload.companyName === "string" && payload.companyName.trim().length > 0) {
      user.companyName = payload.companyName.trim();
    }

    return {
      valid: true,
      user,
    };
  } catch {
    return { valid: false, error: "Malformed session token payload." };
  }
}

export function getSessionFromRequest(request: Request | NextRequest): { authenticated: boolean; user?: SessionUser } {
  let cookieHeader: string | null = null;

  if (request instanceof NextRequest) {
    const cookie = request.cookies.get(SESSION_COOKIE_NAME);
    if (cookie?.value) {
      const result = verifySessionToken(cookie.value);
      if (result.valid && result.user) {
        return { authenticated: true, user: result.user };
      }
    }
  }

  cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
    if (match && match[1]) {
      const result = verifySessionToken(match[1]);
      if (result.valid && result.user) {
        return { authenticated: true, user: result.user };
      }
    }
  }

  // Also support Authorization: Bearer <token> for API clients
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const result = verifySessionToken(token);
    if (result.valid && result.user) {
      return { authenticated: true, user: result.user };
    }
  }

  return { authenticated: false };
}

export function setSessionCookie(response: NextResponse, user: SessionUser): void {
  const token = createSessionToken(user);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Validates internal admin authorization for sensitive API endpoints.
 * Fails closed if INTERNAL_API_SECRET is unset or empty, or if header does not match.
 */
export function validateInternalApiAuth(request: Request | NextRequest): { authorized: boolean; response?: NextResponse } {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || secret.trim().length === 0) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Endpoint is restricted: Server authentication secret is not configured." },
        { status: 401 }
      ),
    };
  }

  const authHeader = request.headers.get("x-internal-admin-key") || request.headers.get("x-api-key");
  const bearerHeader = request.headers.get("authorization");
  const token = authHeader || (bearerHeader?.startsWith("Bearer ") ? bearerHeader.slice(7) : null);

  if (!token) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Unauthorized: Missing administrative credentials." },
        { status: 401 }
      ),
    };
  }

  const expectedBuffer = Buffer.from(secret);
  const actualBuffer = Buffer.from(token);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Unauthorized: Invalid administrative credentials." },
        { status: 403 }
      ),
    };
  }

  return { authorized: true };
}

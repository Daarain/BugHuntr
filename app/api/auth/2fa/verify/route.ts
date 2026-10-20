import { NextRequest, NextResponse } from "next/server";
import { verifyChallengeToken } from "@/lib/auth-2fa";
import { enforceRateLimit } from "@/lib/security/rate-limiter";

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, {
      action: "2fa_verify",
      limit: 15,
      windowSeconds: 900,
    });
    if (rateLimitResponse) return rateLimitResponse;
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Request body is required." }, { status: 400 });
    }

    const { email, challengeToken, code } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    if (!challengeToken || typeof challengeToken !== "string") {
      return NextResponse.json(
        { error: "Challenge token is required. Please request a new verification code." },
        { status: 400 }
      );
    }

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return NextResponse.json({ error: "Verification code is required." }, { status: 400 });
    }

    const result = verifyChallengeToken(challengeToken, email, code);

    if (!result.valid) {
      return NextResponse.json(
        {
          error: result.error || "Verification failed.",
          attemptsRemaining: result.attemptsRemaining,
          newChallengeToken: result.newChallengeToken,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        verified: true,
        verifiedTicket: result.verifiedTicket,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("2FA Verify error:", error);
    return NextResponse.json(
      { error: "Internal server error verifying 2FA code." },
      { status: 500 }
    );
  }
}

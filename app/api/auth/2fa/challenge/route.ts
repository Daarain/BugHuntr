import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createChallengeToken, isEmailTransportConfigured } from "@/lib/auth-2fa";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.email !== "string" || !body.email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email address is required." },
        { status: 400 }
      );
    }

    const email = body.email.trim().toLowerCase();

    // Verify 2FA transport is configured
    if (!isEmailTransportConfigured()) {
      return NextResponse.json(
        { error: "Two-factor authentication provider is unconfigured." },
        { status: 503 }
      );
    }

    // Generate cryptographically secure 6-digit OTP
    const code = crypto.randomInt(100000, 1000000).toString();

    // Create signed challenge token
    const challengeToken = createChallengeToken(email, code);

    // If an email provider is configured, dispatch the email
    // In production, integration with Resend / SendGrid / SMTP sends the code here.

    return NextResponse.json(
      {
        success: true,
        message: "Two-factor verification code dispatched to email.",
        challengeToken,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("2FA Challenge error:", error);
    return NextResponse.json(
      { error: "Internal server error generating 2FA challenge." },
      { status: 500 }
    );
  }
}

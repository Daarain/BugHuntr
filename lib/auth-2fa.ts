import crypto from "crypto";

export interface TwoFactorPayload {
  challengeId: string;
  email: string;
  expiresAt: number;
  attemptsLeft: number;
  salt: string;
  codeHash: string;
}

const USED_CHALLENGES = new Set<string>();

export function isEmailTransportConfigured(): boolean {
  const {
    SMTP_HOST,
    RESEND_API_KEY,
    SENDGRID_API_KEY,
    EMAIL_SERVER_HOST,
    MAILGUN_API_KEY,
  } = process.env;

  return Boolean(
    (SMTP_HOST && SMTP_HOST.trim()) ||
    (RESEND_API_KEY && RESEND_API_KEY.trim()) ||
    (SENDGRID_API_KEY && SENDGRID_API_KEY.trim()) ||
    (EMAIL_SERVER_HOST && EMAIL_SERVER_HOST.trim()) ||
    (MAILGUN_API_KEY && MAILGUN_API_KEY.trim())
  );
}

function get2FASecret(): string {
  const secret = process.env.AUTH_2FA_SECRET || process.env.INTERNAL_API_SECRET;
  if (!secret || secret.trim().length === 0) {
    // Fallback secret for development if neither is configured
    return "bughuntr_2fa_default_secure_secret_fallback_2026";
  }
  return secret.trim();
}

function signPayload(payloadStr: string): string {
  const secret = get2FASecret();
  return crypto.createHmac("sha256", secret).update(payloadStr).digest("hex");
}

export function createChallengeToken(email: string, code: string): string {
  const secret = get2FASecret();
  const salt = crypto.randomBytes(16).toString("hex");
  const codeHash = crypto
    .createHmac("sha256", secret)
    .update(`${code}:${salt}`)
    .digest("hex");

  const payload: TwoFactorPayload = {
    challengeId: crypto.randomUUID(),
    email: email.trim().toLowerCase(),
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    attemptsLeft: 3,
    salt,
    codeHash,
  };

  const payloadStr = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadStr).toString("base64url");
  const signature = signPayload(payloadStr);

  return `${encodedPayload}.${signature}`;
}

export function verifyChallengeToken(
  token: string,
  email: string,
  inputCode: string
): {
  valid: boolean;
  error?: string;
  attemptsRemaining?: number;
  newChallengeToken?: string;
  verifiedTicket?: string;
} {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false, error: "Invalid challenge token format." };
  }

  const [encodedPayload, signature] = token.split(".");
  let payloadStr: string;
  let payload: TwoFactorPayload;

  try {
    payloadStr = Buffer.from(encodedPayload, "base64url").toString("utf-8");
    payload = JSON.parse(payloadStr);
  } catch {
    return { valid: false, error: "Malformed challenge token payload." };
  }

  // Verify HMAC signature
  const expectedSignature = signPayload(payloadStr);
  const expectedSigBuffer = Buffer.from(expectedSignature);
  const actualSigBuffer = Buffer.from(signature);

  if (
    expectedSigBuffer.length !== actualSigBuffer.length ||
    !crypto.timingSafeEqual(expectedSigBuffer, actualSigBuffer)
  ) {
    return { valid: false, error: "Challenge token signature validation failed." };
  }

  // Check replay
  if (USED_CHALLENGES.has(payload.challengeId)) {
    return { valid: false, error: "Challenge token has already been used." };
  }

  // Check expiration
  if (Date.now() > payload.expiresAt) {
    return { valid: false, error: "2FA verification code has expired. Please request a new code." };
  }

  // Check email
  if (payload.email !== email.trim().toLowerCase()) {
    return { valid: false, error: "Challenge token does not match user email." };
  }

  // Check attempts
  if (payload.attemptsLeft <= 0) {
    return {
      valid: false,
      error: "Maximum verification attempts exceeded. Please request a new code.",
      attemptsRemaining: 0,
    };
  }

  // Verify code
  const secret = get2FASecret();
  const inputHash = crypto
    .createHmac("sha256", secret)
    .update(`${inputCode.trim()}:${payload.salt}`)
    .digest("hex");

  const expectedHashBuffer = Buffer.from(payload.codeHash);
  const actualHashBuffer = Buffer.from(inputHash);

  const isMatch =
    expectedHashBuffer.length === actualHashBuffer.length &&
    crypto.timingSafeEqual(expectedHashBuffer, actualHashBuffer);

  if (!isMatch) {
    const attemptsRemaining = payload.attemptsLeft - 1;
    if (attemptsRemaining <= 0) {
      USED_CHALLENGES.add(payload.challengeId);
      return {
        valid: false,
        error: "Invalid 2FA code. Maximum attempts exceeded. Please request a new code.",
        attemptsRemaining: 0,
      };
    }

    // Issue updated token with decremented attempts
    const updatedPayload: TwoFactorPayload = {
      ...payload,
      attemptsLeft: attemptsRemaining,
    };
    const updatedPayloadStr = JSON.stringify(updatedPayload);
    const updatedEncoded = Buffer.from(updatedPayloadStr).toString("base64url");
    const updatedSig = signPayload(updatedPayloadStr);
    const newChallengeToken = `${updatedEncoded}.${updatedSig}`;

    return {
      valid: false,
      error: `Invalid 2FA code. ${attemptsRemaining} attempt${attemptsRemaining > 1 ? "s" : ""} remaining.`,
      attemptsRemaining,
      newChallengeToken,
    };
  }

  // Mark challenge as used to prevent replay
  USED_CHALLENGES.add(payload.challengeId);

  // Generate verified ticket
  const ticketPayload = JSON.stringify({
    challengeId: payload.challengeId,
    email: payload.email,
    verifiedAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  const ticketEncoded = Buffer.from(ticketPayload).toString("base64url");
  const ticketSig = signPayload(ticketPayload);
  const verifiedTicket = `${ticketEncoded}.${ticketSig}`;

  return { valid: true, verifiedTicket };
}

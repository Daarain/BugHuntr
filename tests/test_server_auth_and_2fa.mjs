import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createSessionToken,
  verifySessionToken,
  getSessionSecret,
} from "../lib/server-auth.ts";
import {
  createChallengeToken,
  verifyChallengeToken,
  isEmailTransportConfigured,
} from "../lib/auth-2fa.ts";

test("Server Auth: creates valid cryptographically signed session token", () => {
  const user = {
    id: "user-12345",
    email: "hunter@bughuntr.io",
    username: "elite_hunter",
    role: "user",
    userType: "hunter",
  };

  const token = createSessionToken(user);
  assert.ok(token);
  assert.ok(token.includes("."));

  const verification = verifySessionToken(token);
  assert.equal(verification.valid, true);
  assert.equal(verification.user.id, user.id);
  assert.equal(verification.user.email, user.email);
  assert.equal(verification.user.role, "user");
});

test("Server Auth: rejects forged or tampered session token (signature failure)", () => {
  const user = {
    id: "user-12345",
    email: "hunter@bughuntr.io",
    username: "elite_hunter",
    role: "user",
    userType: "hunter",
  };

  const token = createSessionToken(user);
  const [payload, sig] = token.split(".");

  // Tamper with payload to elevate role to admin
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  decoded.role = "admin";
  const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
  const forgedToken = `${forgedPayload}.${sig}`;

  const result = verifySessionToken(forgedToken);
  assert.equal(result.valid, false);
  assert.match(result.error, /Token signature verification failed/);
});

test("Server Auth: rejects expired session token", () => {
  const now = Date.now();
  const expiredPayload = {
    id: "user-old",
    email: "old@bughuntr.io",
    username: "old_user",
    role: "user",
    userType: "hunter",
    iat: now - 100000,
    exp: now - 1000, // expired 1s ago
  };

  const payloadStr = JSON.stringify(expiredPayload);
  const encodedPayload = Buffer.from(payloadStr).toString("base64url");
  const signature = crypto.createHmac("sha256", getSessionSecret()).update(encodedPayload).digest("hex");
  const expiredToken = `${encodedPayload}.${signature}`;

  const result = verifySessionToken(expiredToken);
  assert.equal(result.valid, false);
  assert.match(result.error, /Session token expired/);
});

test("Server Auth 2FA: challenge generation and verification works as expected", () => {
  const email = "admin@company.com";
  const code = "654321";
  const token = createChallengeToken(email, code);

  assert.ok(token);
  assert.ok(token.includes("."));

  // Verify correct code succeeds
  const success = verifyChallengeToken(token, email, code);
  assert.equal(success.valid, true);
  assert.ok(success.verifiedTicket);
});

test("Server Auth 2FA: rejects incorrect code and enforces attempt limit (max 3)", () => {
  const email = "admin@company.com";
  const code = "654321";
  let token = createChallengeToken(email, code);

  // Attempt 1: wrong code
  let res1 = verifyChallengeToken(token, email, "000000");
  assert.equal(res1.valid, false);
  assert.equal(res1.attemptsRemaining, 2);
  assert.ok(res1.newChallengeToken);
  token = res1.newChallengeToken;

  // Attempt 2: wrong code
  let res2 = verifyChallengeToken(token, email, "111111");
  assert.equal(res2.valid, false);
  assert.equal(res2.attemptsRemaining, 1);
  assert.ok(res2.newChallengeToken);
  token = res2.newChallengeToken;

  // Attempt 3: wrong code -> lockout
  let res3 = verifyChallengeToken(token, email, "222222");
  assert.equal(res3.valid, false);
  assert.equal(res3.attemptsRemaining, 0);
  assert.match(res3.error, /Maximum attempts exceeded/);
});

test("Server Auth 2FA: burns token on successful verification to prevent replay", () => {
  const email = "admin@company.com";
  const code = "987654";
  const token = createChallengeToken(email, code);

  // First verification succeeds
  const first = verifyChallengeToken(token, email, code);
  assert.equal(first.valid, true);

  // Second verification with the same token must fail (replay blocked)
  const replay = verifyChallengeToken(token, email, code);
  assert.equal(replay.valid, false);
  assert.match(replay.error, /already been used/);
});

test("Server Auth 2FA: rejects challenge tokens where email does not match", () => {
  const email = "admin@company.com";
  const token = createChallengeToken(email, "123456");

  const mismatch = verifyChallengeToken(token, "attacker@evil.com", "123456");
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.error, /does not match user email/);
});

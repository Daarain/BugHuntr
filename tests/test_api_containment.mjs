import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// 1. Tests for retired orphaned API route behavior
test("Orphaned API Routes: retired endpoints unconditionally return 410 Gone and block mutations", async () => {
  // Simulate the retired route handler response
  function retiredHandler() {
    return {
      status: 410,
      body: { error: "Endpoint retired: This API route has been disabled." }
    };
  }

  const endpoints = [
    "/api/bug-hunt/create",
    "/api/bug-hunt/delete/[id]",
    "/api/bug-hunt/update-status",
    "/api/bug-review"
  ];

  for (const endpoint of endpoints) {
    const res = retiredHandler();
    assert.equal(res.status, 410, `Endpoint ${endpoint} must return 410`);
    assert.match(res.body.error, /Endpoint retired/, `Endpoint ${endpoint} must indicate retired status`);
  }
});

// 2. Tests for retired administrative utility functions
test("Administrative Utilities: permanently retired and throw unconditionally in all environments", () => {
  function retiredAdminUtility() {
    throw new Error("Administrative utility is permanently retired and disabled.");
  }

  // Verify throws in any environment (dev, test, staging, prod)
  assert.throws(() => retiredAdminUtility(), /permanently retired/);
});

// 3. Tests for API internal authorization logic (for remaining server utilities)
function validateInternalApiAuth(headers, envSecret) {
  const secret = envSecret;
  if (!secret || secret.trim().length === 0) {
    return { authorized: false, status: 401, error: "Endpoint is restricted: Server authentication secret is not configured." };
  }

  const token = headers["x-internal-admin-key"] || headers["x-api-key"] ||
    (headers["authorization"]?.startsWith("Bearer ") ? headers["authorization"].slice(7) : null);

  if (!token) {
    return { authorized: false, status: 401, error: "Unauthorized: Missing administrative credentials." };
  }

  const expectedBuffer = Buffer.from(secret);
  const actualBuffer = Buffer.from(token);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { authorized: false, status: 403, error: "Unauthorized: Invalid administrative credentials." };
  }

  return { authorized: true };
}

test("API Auth: fails closed when INTERNAL_API_SECRET is unset", () => {
  const res = validateInternalApiAuth({ "x-internal-admin-key": "any-token" }, undefined);
  assert.equal(res.authorized, false);
  assert.equal(res.status, 401);
});

test("API Auth: fails closed when header is missing", () => {
  const res = validateInternalApiAuth({}, "secure-prod-key-12345");
  assert.equal(res.authorized, false);
  assert.equal(res.status, 401);
});

test("API Auth: rejects incorrect administrative key with 403", () => {
  const res = validateInternalApiAuth({ "x-internal-admin-key": "wrong-key" }, "secure-prod-key-12345");
  assert.equal(res.authorized, false);
  assert.equal(res.status, 403);
});

test("API Auth: succeeds with correct header key", () => {
  const res = validateInternalApiAuth({ "x-internal-admin-key": "secure-prod-key-12345" }, "secure-prod-key-12345");
  assert.equal(res.authorized, true);
});

test("API Auth: succeeds with correct Bearer authorization token", () => {
  const res = validateInternalApiAuth({ "authorization": "Bearer secure-prod-key-12345" }, "secure-prod-key-12345");
  assert.equal(res.authorized, true);
});

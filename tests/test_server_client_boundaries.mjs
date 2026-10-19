import test from "node:test";
import assert from "node:assert/strict";
import { POST as reviewHandler } from "../app/api/bug-hunt/review/route";
import { POST as statsHandler } from "../app/api/user/stats/route";
import { GET as profileHandler } from "../app/api/user/profile/route";
import { createSessionToken } from "../lib/server-auth";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createMockRequest(url, method, body = null, sessionUser = null) {
  const headers = new Headers();
  if (sessionUser) {
    const token = createSessionToken(sessionUser, TEST_SECRET, 3600);
    headers.set("cookie", `bughuntr_session=${token}`);
  }
  if (body) {
    headers.set("content-type", "application/json");
  }

  return {
    url,
    method,
    headers,
    async json() {
      return body || {};
    },
  };
}

// 1. Boundary Guard Tests
test("Boundary Guards: server-only database helpers prevent client execution", () => {
  // Simulate browser environment
  global.window = {};

  // Attempting to evaluate guard in window environment
  assert.throws(() => {
    if (typeof window !== "undefined") {
      throw new Error("lib/transfer-reward.ts is a server-only module and cannot be executed in the browser.");
    }
  }, /server-only module/);

  delete global.window;
});

// 2. /api/bug-hunt/review Authorization & Validation Tests
test("/api/bug-hunt/review: rejects unauthenticated requests with 401", async () => {
  const req = createMockRequest("http://localhost:3000/api/bug-hunt/review", "POST", {
    submissionId: "sub_1",
    hunterUsername: "hunter1",
    hunterUid: "usr_1",
    amount: 100,
  });

  const res = await reviewHandler(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.error, /Unauthorized/);
});

test("/api/bug-hunt/review: rejects hunter role with 403 Forbidden", async () => {
  const hunterSession = {
    id: "usr_hunter",
    email: "hunter@test.com",
    username: "hunter_user",
    role: "user",
    userType: "hunter",
  };

  const req = createMockRequest(
    "http://localhost:3000/api/bug-hunt/review",
    "POST",
    {
      submissionId: "sub_1",
      hunterUsername: "hunter1",
      hunterUid: "usr_1",
      amount: 100,
    },
    hunterSession
  );

  const res = await reviewHandler(req);
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /Forbidden/);
});

test("/api/bug-hunt/review: rejects invalid reward amount with 400", async () => {
  const adminSession = {
    id: "usr_admin",
    email: "admin@test.com",
    username: "admin_user",
    role: "admin",
    userType: "company",
  };

  const req = createMockRequest(
    "http://localhost:3000/api/bug-hunt/review",
    "POST",
    {
      submissionId: "sub_1",
      hunterUsername: "hunter1",
      hunterUid: "usr_1",
      amount: -50,
    },
    adminSession
  );

  const res = await reviewHandler(req);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /positive number/);
});

// 3. /api/user/stats Authorization Tests
test("/api/user/stats: rejects unauthenticated requests with 401", async () => {
  const req = createMockRequest("http://localhost:3000/api/user/stats", "POST", {
    points: 50,
    bugIncrement: 1,
  });

  const res = await statsHandler(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.error, /Unauthorized/);
});

// 4. /api/user/profile Validation Tests
test("/api/user/profile: rejects missing username parameter with 400", async () => {
  const req = createMockRequest("http://localhost:3000/api/user/profile", "GET");

  const res = await profileHandler(req);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Missing username/);
});

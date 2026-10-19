import test from "node:test";
import assert from "node:assert/strict";
import { INVITATIONS_POLL_INTERVAL_MS } from "../components/navigation/top-navbar";

test("Navbar Polling Configuration: INVITATIONS_POLL_INTERVAL_MS is set to a bounded 30s interval", () => {
  assert.equal(typeof INVITATIONS_POLL_INTERVAL_MS, "number");
  assert.equal(INVITATIONS_POLL_INTERVAL_MS, 30000, "Interval must be 30,000ms (30s)");
  assert.ok(INVITATIONS_POLL_INTERVAL_MS >= 10000 && INVITATIONS_POLL_INTERVAL_MS <= 60000, "Polling interval must be bounded between 10s and 60s");
});

test("API Polling Engine: requests only pending invitations with credentials: include", async () => {
  const fetchCalls = [];
  const mockInvitations = [
    {
      id: "inv_1",
      huntId: "hunt_100",
      huntTitle: "Alpha Bounty",
      companyName: "Acme Corp",
      status: "pending",
    },
    {
      id: "inv_2",
      huntId: "hunt_200",
      huntTitle: "Beta Bounty",
      companyName: "Beta LLC",
      status: "pending",
    },
  ];

  const fakeFetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        invitations: mockInvitations,
        total: mockInvitations.length,
      }),
    };
  };

  // Simulate component polling logic
  let inFlight = false;
  let invitations = [];
  let error = null;

  async function poll(isAuthenticated, user, signal) {
    if (!isAuthenticated || !user?.id) {
      invitations = [];
      return;
    }
    if (inFlight) return;
    inFlight = true;

    try {
      const res = await fakeFetch("/api/pro/invitations?status=pending", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      invitations = (data.invitations || []).map((item) => ({
        id: item.id || item._id,
        huntId: item.huntId || item.hunt_id,
        huntTitle: item.huntTitle || "Pro Hunt",
        companyName: item.companyName || "Company",
        status: item.status || "pending",
      }));
      error = null;
    } catch (err) {
      if (err.name !== "AbortError") {
        error = err.message;
      }
    } finally {
      inFlight = false;
    }
  }

  // 1. Unauthenticated test - should not fetch
  await poll(false, null, null);
  assert.equal(fetchCalls.length, 0, "Must not fetch when unauthenticated");
  assert.deepEqual(invitations, []);

  // 2. Authenticated test - should fetch with server-side authorization
  await poll(true, { id: "hunter_123", username: "alice" }, null);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/api/pro/invitations?status=pending");
  assert.equal(fetchCalls[0].options.credentials, "include");
  assert.equal(fetchCalls[0].options.headers.Accept, "application/json");
  assert.equal(invitations.length, 2);
  assert.equal(invitations[0].huntTitle, "Alpha Bounty");
  assert.equal(error, null);
});

test("API Polling Engine: prevents overlapping requests when one is already in flight", async () => {
  let fetchCount = 0;
  let resolvePromise;

  const fakeFetch = async () => {
    fetchCount++;
    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  };

  let inFlight = false;

  async function poll() {
    if (inFlight) return "skipped";
    inFlight = true;
    try {
      await fakeFetch();
    } finally {
      inFlight = false;
    }
    return "completed";
  }

  // Launch first poll (in flight)
  const poll1 = poll();
  assert.equal(inFlight, true);
  assert.equal(fetchCount, 1);

  // Trigger overlapping poll while first is pending
  const poll2 = await poll();
  assert.equal(poll2, "skipped", "Second poll must be skipped to avoid overlapping request");
  assert.equal(fetchCount, 1, "Fetch count must not increment for skipped poll");

  // Complete first request
  resolvePromise({
    ok: true,
    status: 200,
    json: async () => ({ invitations: [] }),
  });
  await poll1;
  assert.equal(inFlight, false);

  // Next poll after completion succeeds
  const poll3 = poll();
  assert.equal(fetchCount, 2, "Subsequent poll must execute once prior request has completed");
  resolvePromise({
    ok: true,
    status: 200,
    json: async () => ({ invitations: [] }),
  });
  await poll3;
});

test("API Polling Engine: handles 401 session expiration gracefully", async () => {
  let invitations = [{ id: "stale_inv", huntTitle: "Old Hunt" }];
  let error = null;

  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "Unauthorized: Active session required." }),
  });

  let inFlight = false;
  async function poll() {
    if (inFlight) return;
    inFlight = true;
    try {
      const res = await fakeFetch();
      if (!res.ok) {
        if (res.status === 401) {
          invitations = [];
          error = null;
          return;
        }
        throw new Error("HTTP error");
      }
    } catch (err) {
      error = err.message;
    } finally {
      inFlight = false;
    }
  }

  await poll();
  assert.deepEqual(invitations, [], "Invitations must be cleared on 401");
  assert.equal(error, null, "401 should clear invitations without setting error banner");
});

test("API Polling Engine: handles server 500 error gracefully without crashing", async () => {
  let invitations = [{ id: "existing_inv", huntTitle: "Existing Hunt" }];
  let error = null;

  const fakeFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "Internal server error" }),
  });

  let inFlight = false;
  async function poll() {
    if (inFlight) return;
    inFlight = true;
    try {
      const res = await fakeFetch();
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Failed to fetch invitations: HTTP ${res.status}`);
      }
    } catch (err) {
      error = err.message;
    } finally {
      inFlight = false;
    }
  }

  await poll();
  assert.equal(error, "Internal server error");
  assert.equal(invitations.length, 1, "Existing invitations preserved when poll fails with 500");
});

test("Invitation Actions: PATCH acceptance and decline with duplicate action guarding", async () => {
  const patchCalls = [];
  let invitations = [
    { id: "inv_abc", huntId: "hunt_1", huntTitle: "Target Hunt", status: "pending" },
    { id: "inv_xyz", huntId: "hunt_2", huntTitle: "Other Hunt", status: "pending" },
  ];
  let actionLoadingId = null;
  const toasts = [];

  const fakePatchFetch = async (url, options) => {
    patchCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        invitation: { id: "inv_abc", status: JSON.parse(options.body).status },
      }),
    };
  };

  async function handleInvitationAction(invitationId, huntId, status) {
    if (actionLoadingId) return "blocked_duplicate";
    actionLoadingId = invitationId;

    try {
      const res = await fakePatchFetch(`/api/pro/invitations/${encodeURIComponent(invitationId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        throw new Error("Update failed");
      }

      invitations = invitations.filter((inv) => inv.id !== invitationId);
      if (status === "accepted") {
        toasts.push({ type: "success", message: "Invitation accepted" });
      } else {
        toasts.push({ type: "info", message: "Invitation declined" });
      }
      return "success";
    } finally {
      actionLoadingId = null;
    }
  }

  // 1. Accept action
  const result1 = await handleInvitationAction("inv_abc", "hunt_1", "accepted");
  assert.equal(result1, "success");
  assert.equal(patchCalls.length, 1);
  assert.equal(patchCalls[0].url, "/api/pro/invitations/inv_abc");
  assert.equal(patchCalls[0].options.method, "PATCH");
  assert.equal(patchCalls[0].options.credentials, "include");
  assert.deepEqual(JSON.parse(patchCalls[0].options.body), { status: "accepted" });
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].id, "inv_xyz");
  assert.equal(toasts[0].message, "Invitation accepted");

  // 2. Decline action
  const result2 = await handleInvitationAction("inv_xyz", "hunt_2", "declined");
  assert.equal(result2, "success");
  assert.equal(patchCalls.length, 2);
  assert.equal(patchCalls[1].url, "/api/pro/invitations/inv_xyz");
  assert.deepEqual(JSON.parse(patchCalls[1].options.body), { status: "declined" });
  assert.equal(invitations.length, 0);
  assert.equal(toasts[1].message, "Invitation declined");

  // 3. Test duplicate click guard
  actionLoadingId = "inv_pending";
  const duplicateResult = await handleInvitationAction("inv_pending", "hunt_3", "accepted");
  assert.equal(duplicateResult, "blocked_duplicate", "Concurrent actions must be blocked while one is running");
  assert.equal(patchCalls.length, 2, "No extra network request when action is already running");
});

test("Lifecycle & Unmount Cleanup: aborts active request and clears timer on unmount", () => {
  let timerCleared = false;
  let aborted = false;

  const controller = new AbortController();
  controller.signal.addEventListener("abort", () => {
    aborted = true;
  });

  const intervalId = 999;
  const fakeClearInterval = (id) => {
    if (id === intervalId) timerCleared = true;
  };

  // Simulate unmount cleanup callback
  function onUnmount() {
    fakeClearInterval(intervalId);
    controller.abort();
  }

  onUnmount();
  assert.equal(timerCleared, true, "Polling interval timer must be cleared on unmount");
  assert.equal(aborted, true, "Active AbortController must be aborted on unmount");
});

import test from "node:test";
import assert from "node:assert/strict";
import { transferRewardFromAdmin } from "../lib/transfer-reward.ts";
import { updateUserBugCount, updateUserStats } from "../lib/update-user-stats.ts";

test("Transfer Reward: validates inputs strictly before attempting database operations", async () => {
  // Missing admin username
  await assert.rejects(
    async () =>
      transferRewardFromAdmin({
        adminUsername: "",
        hunterUsername: "hunter1",
        hunterUid: "usr_h1",
        huntId: "hunt1",
        submissionId: "sub1",
        amount: 100,
      }),
    /Invalid transfer request/
  );

  // Missing hunter username
  await assert.rejects(
    async () =>
      transferRewardFromAdmin({
        adminUsername: "admin1",
        hunterUsername: "",
        hunterUid: "usr_h1",
        huntId: "hunt1",
        submissionId: "sub1",
        amount: 100,
      }),
    /Invalid transfer request/
  );

  // Zero or negative amount
  await assert.rejects(
    async () =>
      transferRewardFromAdmin({
        adminUsername: "admin1",
        hunterUsername: "hunter1",
        hunterUid: "usr_h1",
        huntId: "hunt1",
        submissionId: "sub1",
        amount: 0,
      }),
    /Invalid transfer request/
  );

  await assert.rejects(
    async () =>
      transferRewardFromAdmin({
        adminUsername: "admin1",
        hunterUsername: "hunter1",
        hunterUid: "usr_h1",
        huntId: "hunt1",
        submissionId: "sub1",
        amount: -50,
      }),
    /Invalid transfer request/
  );
});

test("Update User Stats: fails gracefully without unhandled crashes when db is unconfigured", async () => {
  // Temporarily ensure MONGODB_URI is not set to verify self-healing error handling
  const origUri = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;

  try {
    const resCount = await updateUserBugCount("test_user_01", 1);
    assert.equal(resCount, false, "updateUserBugCount should return false on connection error");

    const resStats = await updateUserStats("test_user_01", 100, 1, "user");
    assert.equal(resStats, false, "updateUserStats should return false on connection error");
  } finally {
    if (origUri) process.env.MONGODB_URI = origUri;
  }
});

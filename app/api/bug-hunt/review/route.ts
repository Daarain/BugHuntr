import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import { transferRewardFromAdmin } from "@/lib/transfer-reward";

/**
 * Secure Server-side Bug Hunt Review & Bounty Payout Endpoint
 *
 * Replaces direct client-side database calls with authenticated, authorized
 * server-side execution:
 * 1. Requires valid session cookie (bughuntr_session).
 * 2. Requires administrative or triager privileges.
 * 3. Verifies submission exists, verifies hunter ownership & tenancy, prevents duplicate payouts.
 * 4. Atomically reserves org wallet funds and awards hunter points/payout in MongoDB.
 */
export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized: Active session required." },
        { status: 401 }
      );
    }

    // Role authorization check: only admins or triagers can approve submissions and award payouts
    if (session.user.role !== "admin" && session.user.role !== "triager") {
      return NextResponse.json(
        { error: "Forbidden: Administrative or triager role required." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const {
      huntId,
      submissionId,
      hunterUsername,
      hunterUid,
      amount,
      status,
      reviewNotes,
    } = body;

    if (!submissionId || typeof submissionId !== "string") {
      return NextResponse.json({ error: "Missing or invalid submissionId" }, { status: 400 });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "Reward amount must be a positive number" }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const submissionsRepo = new SubmissionsRepository(db);

    // 1. Verify submission exists
    const submission = await submissionsRepo.getById(submissionId);
    if (!submission) {
      return NextResponse.json({ error: `Submission not found: ${submissionId}` }, { status: 404 });
    }

    // 2. Server-side ownership and tenancy verification: hunterUid must match submission author
    if (hunterUid && submission.hunter_id && submission.hunter_id !== hunterUid) {
      return NextResponse.json(
        { error: "Forbidden: Hunter UID does not match submission author" },
        { status: 403 }
      );
    }

    // 3. Verify hunt association if specified
    if (huntId && submission.bounty_id && submission.bounty_id !== huntId) {
      return NextResponse.json(
        { error: "Invalid request: Submission does not belong to specified bounty hunt" },
        { status: 400 }
      );
    }

    // 4. Check existing payout status to prevent duplicate payouts
    if (submission.payout_status === "paid" || submission.payout_status === "processing") {
      return NextResponse.json(
        { error: `Submission ${submissionId} has already been paid or is actively processing a payout` },
        { status: 409 }
      );
    }

    // 5. Validate reward amount against submission reward if configured
    if (submission.reward_amount !== undefined && submission.reward_amount > 0) {
      const authorizedAmount = submission.reward_amount >= 1000000
        ? submission.reward_amount / 1000000
        : submission.reward_amount;
      if (amount !== authorizedAmount && amount !== submission.reward_amount) {
        return NextResponse.json(
          { error: `Invalid reward amount: requested ${amount}, but authorized submission reward is ${authorizedAmount}` },
          { status: 400 }
        );
      }
    }

    // Derive hunter info from verified submission record
    const resolvedHunterUid = submission.hunter_id || hunterUid;
    const resolvedHunterUsername = hunterUsername || submission.hunter_id || "hunter";

    // Mark payout status as processing
    await submissionsRepo.updatePayoutStatus(submissionId, "processing");

    try {
      const success = await transferRewardFromAdmin({
        adminUsername: session.user.username,
        hunterUsername: resolvedHunterUsername,
        hunterUid: resolvedHunterUid,
        huntId: huntId || submission.bounty_id || "",
        submissionId,
        amount,
        orgWalletId: submission.org_id || undefined,
      });

      // Update submission status, reviewer, notes, and transition to paid
      const targetStatus = status || "approved";
      await submissionsRepo.updateStatus(submissionId, targetStatus, session.user.id, reviewNotes);
      await submissionsRepo.updatePayoutStatus(submissionId, "paid");

      return NextResponse.json({
        success,
        message: "Reward transferred and payout logged successfully.",
      });
    } catch (err: any) {
      await submissionsRepo.updatePayoutStatus(submissionId, "failed");
      throw err;
    }
  } catch (error: any) {
    console.error("Bug review transfer error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process reward transfer." },
      { status: 500 }
    );
  }
}

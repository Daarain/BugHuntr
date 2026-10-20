/**
 * /api/payouts
 *
 * Authenticated endpoints for payouts:
 * - GET: List payouts with strict hunter & organization isolation
 * - POST: Create and initiate a crypto payout for an approved bug submission
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { PayoutsRepository } from "@/lib/db/repositories/payouts.repo";
import { WalletsRepository } from "@/lib/db/repositories/wallets.repo";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import { dispatchCryptomusPayout } from "@/lib/cryptomus";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedHunterUid = searchParams.get("hunterUid");
    const requestedOrgId = searchParams.get("orgId");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const db = await getMongoDatabase();
    const payoutsRepo = new PayoutsRepository(db);

    // Enforce hunter isolation: hunters can ONLY see their own payouts
    if (session.user.role === "hunter") {
      if (requestedHunterUid && requestedHunterUid !== session.user.id) {
        return NextResponse.json(
          { error: "Forbidden: Hunters cannot view payouts for other users" },
          { status: 403 }
        );
      }
      const list = await payoutsRepo.listByHunter(session.user.id, limit);
      return NextResponse.json({ payouts: list });
    }

    // Enforce organization isolation: companies can ONLY see their own organization's payouts
    if (session.user.role === "company") {
      const userOrgId = session.user.organizationId || session.user.orgId;
      if (requestedOrgId && requestedOrgId !== userOrgId) {
        return NextResponse.json(
          { error: "Forbidden: Not authorized to view payouts for other organizations" },
          { status: 403 }
        );
      }
      const targetOrg = requestedOrgId || userOrgId;
      if (!targetOrg) {
        return NextResponse.json({ error: "Organization not found for session" }, { status: 400 });
      }
      const list = await payoutsRepo.listByOrg(targetOrg, limit);
      return NextResponse.json({ payouts: list });
    }

    // Admin role
    if (requestedHunterUid) {
      const list = await payoutsRepo.listByHunter(requestedHunterUid, limit);
      return NextResponse.json({ payouts: list });
    }
    if (requestedOrgId) {
      const list = await payoutsRepo.listByOrg(requestedOrgId, limit);
      return NextResponse.json({ payouts: list });
    }

    const all = await payoutsRepo.listAll(limit);
    return NextResponse.json({ payouts: all });
  } catch (error: any) {
    console.error("GET /api/payouts error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Role check: Only admin or company org-admin can initiate payouts
    const isPlatformAdmin = session.user.role === "admin";
    const isCompany = session.user.role === "company";

    if (!isPlatformAdmin && !isCompany) {
      return NextResponse.json(
        { error: "Forbidden: Only administrators or company managers can initiate payouts" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const {
      submissionId,
      huntId,
      orgId,
      hunterUid,
      hunterWallet,
      amount,
      currency = "USDC",
      network = "POLYGON",
    } = body;

    // Required fields check
    if (!submissionId || !huntId || !orgId || !hunterUid || !hunterWallet || amount === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: submissionId, huntId, orgId, hunterUid, hunterWallet, amount" },
        { status: 400 }
      );
    }

    // Tenancy isolation check for company role
    if (isCompany) {
      const sessionOrgId = session.user.organizationId || session.user.orgId;
      if (sessionOrgId !== orgId) {
        return NextResponse.json(
          { error: "Forbidden: Caller is not authorized to disburse funds for this organization" },
          { status: 403 }
        );
      }
    }

    // Validate amount
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid amount: must be a positive number" },
        { status: 400 }
      );
    }

    // Validate wallet address
    const evmPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!evmPattern.test(hunterWallet)) {
      return NextResponse.json(
        { error: "Invalid wallet address: must be a valid Polygon/Ethereum 0x address" },
        { status: 400 }
      );
    }

    const db = await getMongoDatabase();
    const walletsRepo = new WalletsRepository(db);
    const payoutsRepo = new PayoutsRepository(db);
    const submissionsRepo = new SubmissionsRepository(db);

    // 1. Check idempotency: order_id format prevents duplicate payouts
    const order_id = `BH-PAYOUT-${submissionId}`;
    const existingPayout = await payoutsRepo.getByOrderId(order_id);
    if (existingPayout) {
      return NextResponse.json({
        success: true,
        order_id: existingPayout.order_id,
        status: existingPayout.status,
        cryptomus_payout_id: existingPayout.cryptomus_payout_id,
        message: "Payout already exists for this submission",
        isExisting: true,
      });
    }

    // 2. Validate submission eligibility: Submission MUST exist in repository
    const submission = await submissionsRepo.getById(submissionId);
    if (!submission) {
      return NextResponse.json(
        { error: `Submission not found: ${submissionId}` },
        { status: 404 }
      );
    }

    // Ownership & Tenancy Verification:
    // Ensure the submission belongs to the specified hunter UID
    if (submission.hunter_id && submission.hunter_id !== hunterUid) {
      return NextResponse.json(
        { error: "Forbidden: Hunter UID does not match submission author" },
        { status: 403 }
      );
    }

    // Ensure the submission belongs to the organization whose wallet will be debited
    if (submission.org_id && submission.org_id !== orgId) {
      return NextResponse.json(
        { error: "Forbidden: Submission does not belong to specified organization" },
        { status: 403 }
      );
    }

    // Ensure the submission corresponds to the specified bounty hunt
    if (submission.bounty_id && submission.bounty_id !== huntId) {
      return NextResponse.json(
        { error: "Invalid request: Submission does not belong to specified bounty hunt" },
        { status: 400 }
      );
    }

    const subStatus = (submission.status || "").toLowerCase();
    const approvedStatuses = ["approved", "accepted", "eligible_for_payout", "triaged", "resolved"];
    if (!approvedStatuses.includes(subStatus)) {
      return NextResponse.json(
        { error: `Submission is not approved for payout (current status: ${submission.status})` },
        { status: 412 }
      );
    }

    if (submission.payout_status === "paid" || submission.payout_status === "processing") {
      return NextResponse.json(
        { error: `Submission ${submissionId} has already been paid or is actively processing a payout` },
        { status: 409 }
      );
    }

    // 3. Atomically reserve funds in organization wallet
    // Amount in micro-units if not already scaled (assume standard micro-units if <= 100000000)
    const amountMicroUnits = numAmount < 1000000 ? Math.floor(numAmount * 1000000) : numAmount;

    // Validate payout amount against authorized submission reward if configured
    if (submission.reward_amount !== undefined && submission.reward_amount > 0) {
      const expectedMicro = submission.reward_amount < 1000000
        ? Math.floor(submission.reward_amount * 1000000)
        : submission.reward_amount;
      if (amountMicroUnits !== expectedMicro) {
        return NextResponse.json(
          { error: `Invalid payout amount: requested ${numAmount}, but authorized submission reward is ${submission.reward_amount}` },
          { status: 400 }
        );
      }
    }

    // Check if wallet exists, or create demo wallet for demo_org_001
    let wallet = await walletsRepo.getWallet(orgId);
    if (!wallet && orgId === "demo_org_001") {
      wallet = await walletsRepo.createWallet({
        org_id: orgId,
        balance: 10000000000,
        reserved: 0,
        currency,
        network,
      });
    }

    if (!wallet) {
      return NextResponse.json(
        { error: `Organization wallet not found for orgId: ${orgId}` },
        { status: 404 }
      );
    }

    const reservation = await walletsRepo.reserveFunds(orgId, amountMicroUnits);
    if (!reservation.success) {
      return NextResponse.json(
        { error: reservation.error || "Insufficient funds in organization wallet" },
        { status: 412 }
      );
    }

    // 4. Create payout record with status 'pending_created'
    const newPayout = {
      _id: order_id,
      order_id,
      huntId,
      submissionId,
      orgId,
      hunterUid,
      hunterWallet,
      amount: amountMicroUnits,
      currency,
      network,
      status: "pending_created" as const,
      createdBy: session.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await payoutsRepo.createPayout(newPayout);
      await submissionsRepo.updatePayoutStatus(submissionId, "processing", order_id);
    } catch (createErr: any) {
      await walletsRepo.releaseFunds(orgId, amountMicroUnits);
      throw createErr;
    }

    // 5. Call Cryptomus API (or mock)
    try {
      const cryptomusAmount = (amountMicroUnits / 1000000).toFixed(2);
      const cryptomusRes = await dispatchCryptomusPayout({
        amount: cryptomusAmount,
        currency,
        address: hunterWallet,
        order_id,
        network,
      });

      // 6. Update payout status to processing
      const cryptomusUuid = cryptomusRes.result?.uuid || null;
      await payoutsRepo.updateStatus(order_id, "processing", {
        cryptomus_payout_id: cryptomusUuid || undefined,
        cryptomus_response: cryptomusRes,
      });

      await payoutsRepo.logEvent({
        order_id,
        eventType: "payout_dispatched",
        actorUid: session.user.id,
        data: {
          request: body,
          cryptomusResponse: cryptomusRes,
        },
      });

      return NextResponse.json({
        success: true,
        order_id,
        status: "processing",
        cryptomus_payout_id: cryptomusUuid,
        message: "Payout initiated successfully",
      });
    } catch (cryptoErr: any) {
      // Release reserved funds if gateway definitively rejected
      await walletsRepo.releaseFunds(orgId, amountMicroUnits);
      await payoutsRepo.updateStatus(order_id, "failed", {
        error: { code: "CRYPTOMUS_ERROR", message: cryptoErr.message },
      });

      if (submission) {
        await submissionsRepo.updatePayoutStatus(submissionId, "failed");
      }

      await payoutsRepo.logEvent({
        order_id,
        eventType: "payout_dispatch_failed",
        actorUid: session.user.id,
        data: { error: cryptoErr.message },
      });

      return NextResponse.json(
        { error: `Payment gateway error: ${cryptoErr.message}` },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error("POST /api/payouts error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

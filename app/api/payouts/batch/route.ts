/**
 * /api/payouts/batch
 *
 * Authenticated endpoint for creating batch payouts from CSV/array data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { PayoutsRepository } from "@/lib/db/repositories/payouts.repo";
import { WalletsRepository } from "@/lib/db/repositories/wallets.repo";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isPlatformAdmin = session.user.role === "admin";
    const isCompany = session.user.role === "company";

    if (!isPlatformAdmin && !isCompany) {
      return NextResponse.json(
        { error: "Forbidden: Only administrators or company managers can create batch payouts" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { orgId, payouts } = body;

    if (!orgId || !Array.isArray(payouts) || payouts.length === 0) {
      return NextResponse.json(
        { error: "orgId and non-empty payouts array are required" },
        { status: 400 }
      );
    }

    if (payouts.length > 1000) {
      return NextResponse.json(
        { error: "Maximum 1000 payouts per batch allowed" },
        { status: 400 }
      );
    }

    if (isCompany) {
      const sessionOrgId = session.user.organizationId || session.user.orgId;
      if (sessionOrgId !== orgId) {
        return NextResponse.json(
          { error: "Forbidden: Not authorized to create payouts for another organization" },
          { status: 403 }
        );
      }
    }

    const db = await getMongoDatabase();
    const walletsRepo = new WalletsRepository(db);
    const payoutsRepo = new PayoutsRepository(db);
    const submissionsRepo = new SubmissionsRepository(db);

    const wallet = await walletsRepo.getWallet(orgId);
    if (!wallet && orgId !== "demo_org_001") {
      return NextResponse.json(
        { error: `Organization wallet not found for orgId: ${orgId}` },
        { status: 404 }
      );
    }

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await payoutsRepo.createBatchJob({
      _id: batchId,
      batch_id: batchId,
      org_id: orgId,
      created_by: session.user.id,
      status: "processing",
      total_rows: payouts.length,
      processed: 0,
      errors: [],
      created_at: new Date(),
    });

    const results = {
      totalRows: payouts.length,
      queued: 0,
      failed: 0,
      errors: [] as Array<{ row: number; error: string }>,
    };

    const evmPattern = /^0x[a-fA-F0-9]{40}$/;

    for (let i = 0; i < payouts.length; i++) {
      const item = payouts[i];
      try {
        if (!item.submissionId || !item.huntId || !item.hunterUid || !item.hunterWallet || !item.amount) {
          throw new Error("Missing required fields in payout row");
        }

        if (!evmPattern.test(item.hunterWallet)) {
          throw new Error(`Invalid wallet address format: ${item.hunterWallet}`);
        }

        const numAmount = Number(item.amount);
        if (isNaN(numAmount) || numAmount <= 0) {
          throw new Error(`Invalid amount: ${item.amount}`);
        }

        const amountMicro = numAmount < 1000000 ? Math.floor(numAmount * 1000000) : numAmount;

        // Verify submission exists
        const sub = await submissionsRepo.getById(item.submissionId);
        if (!sub) {
          throw new Error(`Submission not found: ${item.submissionId}`);
        }

        // Ownership & Tenancy Verification
        if (sub.hunter_id && sub.hunter_id !== item.hunterUid) {
          throw new Error(`Hunter UID mismatch for submission ${item.submissionId}`);
        }

        if (sub.org_id && sub.org_id !== orgId) {
          throw new Error(`Submission ${item.submissionId} does not belong to organization ${orgId}`);
        }

        if (sub.bounty_id && item.huntId && sub.bounty_id !== item.huntId) {
          throw new Error(`Submission ${item.submissionId} does not belong to bounty hunt ${item.huntId}`);
        }

        const status = (sub.status || "").toLowerCase();
        const approved = ["approved", "accepted", "eligible_for_payout", "triaged", "resolved"];
        if (!approved.includes(status)) {
          throw new Error(`Submission not approved for payout: status is ${sub.status}`);
        }
        if (sub.payout_status === "paid" || sub.payout_status === "processing") {
          throw new Error(`Submission ${item.submissionId} already paid or processing`);
        }

        // Validate payout amount against authorized submission reward if configured
        if (sub.reward_amount !== undefined && sub.reward_amount > 0) {
          const expectedMicro = sub.reward_amount < 1000000
            ? Math.floor(sub.reward_amount * 1000000)
            : sub.reward_amount;
          if (amountMicro !== expectedMicro) {
            throw new Error(`Amount mismatch for submission ${item.submissionId}: requested ${numAmount}, authorized ${sub.reward_amount}`);
          }
        }

        // Check idempotency before reserving funds
        const orderId = `BH-PAYOUT-${item.submissionId}`;
        const existingPayout = await payoutsRepo.getByOrderId(orderId);
        if (existingPayout) {
          throw new Error(`Payout order ${orderId} already exists`);
        }

        // Reserve funds
        const reservation = await walletsRepo.reserveFunds(orgId, amountMicro);
        if (!reservation.success) {
          throw new Error(`Insufficient funds: ${reservation.error}`);
        }

        try {
          await payoutsRepo.createPayout({
            _id: orderId,
            order_id: orderId,
            huntId: item.huntId,
            submissionId: item.submissionId,
            orgId,
            hunterUid: item.hunterUid,
            hunterWallet: item.hunterWallet,
            amount: amountMicro,
            currency: "USDC",
            network: "POLYGON",
            status: "pending_created",
            createdBy: session.user.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          await submissionsRepo.updatePayoutStatus(item.submissionId, "processing", orderId);
        } catch (createErr: any) {
          await walletsRepo.releaseFunds(orgId, amountMicro);
          throw createErr;
        }

        results.queued++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({
          row: i + 1,
          error: err.message,
        });
      }
    }

    await payoutsRepo.updateBatchJob(batchId, {
      status: results.failed === results.totalRows ? "failed" : "completed",
      processed: results.queued,
      errors: results.errors,
    });

    await payoutsRepo.logEvent({
      eventType: "batch_payout_created",
      actorUid: session.user.id,
      data: {
        batchId,
        orgId,
        totalRows: results.totalRows,
        queued: results.queued,
        failed: results.failed,
      },
    });

    return NextResponse.json({
      success: true,
      batchId,
      ...results,
    });
  } catch (error: any) {
    console.error("POST /api/payouts/batch error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

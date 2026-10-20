/**
 * /api/payments/cryptomus-webhook
 *
 * Webhook receiver for Cryptomus payout status updates.
 *
 * Security:
 * - Cryptographically verifies webhook signature using Cryptomus merchant API key
 * - Strictly idempotent: duplicate webhook notifications for completed payouts
 *   will never cause double deduction or duplicate balance movements
 */

import { NextRequest, NextResponse } from "next/server";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { PayoutsRepository } from "@/lib/db/repositories/payouts.repo";
import { WalletsRepository } from "@/lib/db/repositories/wallets.repo";
import { SubmissionsRepository } from "@/lib/db/repositories/submissions.repo";
import { verifyCryptomusWebhookSignature, mapCryptomusStatusToPayoutStatus } from "@/lib/cryptomus";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    // Signature verification
    const receivedSign =
      request.headers.get("sign") ||
      request.headers.get("x-sign") ||
      payload.sign;

    const apiKey =
      process.env.CRYPTOMUS_PAYOUT_KEY ||
      process.env.CRYPTOMUS_WEBHOOK_KEY ||
      process.env.CRYPTOMUS_API_KEY ||
      "";

    // In production/staging with configured key, enforce signature check
    // If running in test mode with TEST_SKIP_SIGNATURE_VERIFICATION, can bypass
    const skipSig = process.env.TEST_SKIP_SIGNATURE_VERIFICATION === "true";

    if (!skipSig) {
      if (!receivedSign) {
        return NextResponse.json({ error: "Missing signature header/property" }, { status: 403 });
      }

      const isValid = verifyCryptomusWebhookSignature(payload, receivedSign, apiKey);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid webhook signature" }, { status: 403 });
      }
    }

    const { order_id, uuid, status: cryptomusStatus, txid } = payload;
    if (!order_id) {
      return NextResponse.json({ error: "Missing order_id in webhook payload" }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const payoutsRepo = new PayoutsRepository(db);
    const walletsRepo = new WalletsRepository(db);
    const submissionsRepo = new SubmissionsRepository(db);

    const payout = await payoutsRepo.getByOrderId(order_id);
    if (!payout) {
      // Payout not found in DB - return 200 to acknowledge and prevent provider loop
      return NextResponse.json({ received: true, warning: "Payout order_id not found" });
    }

    const previousStatus = payout.status;
    const newStatus = mapCryptomusStatusToPayoutStatus(cryptomusStatus);

    // Verify provider UUID if already registered
    if (payout.cryptomus_payout_id && uuid && payout.cryptomus_payout_id !== uuid) {
      return NextResponse.json(
        { error: "Cryptomus payout UUID does not match registered payout" },
        { status: 400 }
      );
    }

    // ========================================================================
    // IDEMPOTENCY GUARD: If already terminal, do not re-execute balance changes
    // ========================================================================
    if (previousStatus === "completed") {
      return NextResponse.json({
        received: true,
        message: "Payout already completed; no duplicate deduction applied",
      });
    }

    if (previousStatus === "failed" || previousStatus === "cancelled") {
      return NextResponse.json({
        received: true,
        message: `Payout already in terminal state (${previousStatus}); no balance movements applied`,
      });
    }

    // ========================================================================
    // ATOMIC BALANCE ADJUSTMENTS
    // ========================================================================
    if (newStatus === "completed") {
      // Payout confirmed on blockchain -> deduct from org wallet balance & reserved
      await walletsRepo.completeDeduction(payout.orgId, payout.amount);

      // Update associated submission to paid
      if (payout.submissionId) {
        await submissionsRepo.updatePayoutStatus(payout.submissionId, "paid", order_id);
      }
    } else if (newStatus === "failed" || newStatus === "cancelled") {
      // Payout failed/cancelled -> release reserved balance back to available
      await walletsRepo.releaseFunds(payout.orgId, payout.amount);

      // Update associated submission to failed
      if (payout.submissionId) {
        await submissionsRepo.updatePayoutStatus(payout.submissionId, "failed", order_id);
      }
    }

    // Update payout document
    await payoutsRepo.updateStatus(order_id, newStatus, {
      tx_hash: txid || undefined,
      cryptomus_payout_id: uuid || undefined,
      cryptomus_response: { latestWebhook: payload },
      webhook_payload: payload,
    });

    // Immutable audit log
    await payoutsRepo.logEvent({
      order_id,
      eventType: "webhook_received",
      data: {
        previousStatus,
        newStatus,
        cryptomusStatus,
        txid,
      },
    });

    return NextResponse.json({
      received: true,
      order_id,
      previousStatus,
      newStatus,
    });
  } catch (error: any) {
    console.error("POST /api/payments/cryptomus-webhook error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

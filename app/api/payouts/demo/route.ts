/**
 * /api/payouts/demo
 *
 * Simulates demo payout scenarios (success, processing, failure)
 * for the interactive payout demo page (/payout-demo).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { PayoutsRepository } from "@/lib/db/repositories/payouts.repo";
import { WalletsRepository } from "@/lib/db/repositories/wallets.repo";

export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Forbidden: Demo payout simulation endpoint is strictly disabled in production." },
        { status: 403 }
      );
    }

    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      amount = "100",
      hunterWallet = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      scenario = "success", // "success" | "processing" | "failed"
      orgId = "demo_org_001",
    } = body;

    // Strict security guard: Cannot target or debit non-demo organizations
    const DEMO_ORG_ID = "demo_org_001";
    if (orgId !== DEMO_ORG_ID) {
      return NextResponse.json(
        { error: "Forbidden: Demo payout simulator can only execute against demo_org_001" },
        { status: 403 }
      );
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100000) {
      return NextResponse.json({ error: "Invalid payout amount: must be between 1 and 100,000" }, { status: 400 });
    }

    const evmPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!evmPattern.test(hunterWallet)) {
      return NextResponse.json(
        { error: "Invalid wallet address format: must be valid 0x EVM address" },
        { status: 400 }
      );
    }

    const amountMicroUnits = Math.floor(parsedAmount * 1000000);
    const db = await getMongoDatabase();
    const walletsRepo = new WalletsRepository(db);
    const payoutsRepo = new PayoutsRepository(db);

    // Ensure demo wallet exists
    let wallet = await walletsRepo.getWallet(orgId);
    if (!wallet) {
      wallet = await walletsRepo.createWallet({
        org_id: orgId,
        balance: 10000000000,
        reserved: 0,
        currency: "USDC",
        network: "POLYGON",
      });
    }

    const orderId = `BH-PAYOUT-DEMO-${Date.now()}`;
    const txHash =
      scenario === "success"
        ? `0xdemo${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
        : null;

    const statusMap = {
      success: "completed" as const,
      failed: "failed" as const,
      processing: "processing" as const,
    };

    const newPayout = {
      _id: orderId,
      order_id: orderId,
      orgId,
      huntId: "demo_hunt_001",
      submissionId: "demo_sub_001",
      hunterUid: session.user.id || "demo_hunter",
      hunterWallet,
      amount: amountMicroUnits,
      currency: "USDC",
      network: "POLYGON",
      status: statusMap[scenario as keyof typeof statusMap] || "processing",
      createdBy: session.user.id || "demo_admin",
      tx_hash: txHash || undefined,
      cryptomus_payout_id: `demo_${Math.random().toString(36).slice(2, 10)}`,
      cryptomus_response: {
        demo: true,
        scenario,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await payoutsRepo.createPayout(newPayout);

    if (scenario === "success") {
      // Deduct from demo org wallet
      await walletsRepo.reserveFunds(orgId, amountMicroUnits);
      await walletsRepo.completeDeduction(orgId, amountMicroUnits);
    }

    const updatedWallet = await walletsRepo.getWallet(orgId);

    return NextResponse.json({
      success: true,
      payout: newPayout,
      wallet: updatedWallet
        ? {
            balance: updatedWallet.balance,
            reserved: updatedWallet.reserved,
            available: updatedWallet.balance - updatedWallet.reserved,
          }
        : null,
    });
  } catch (error: any) {
    console.error("POST /api/payouts/demo error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

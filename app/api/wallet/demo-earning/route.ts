/**
 * /api/wallet/demo-earning
 *
 * Simulates a demo bounty earning for the authenticated hunter.
 * Safe for development and testing environments.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { WalletsRepository } from "@/lib/db/repositories/wallets.repo";
import { PayoutsRepository } from "@/lib/db/repositories/payouts.repo";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";

export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Forbidden: Demo earning simulation is strictly disabled in production." },
        { status: 403 }
      );
    }

    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getMongoDatabase();
    const walletsRepo = new WalletsRepository(db);
    const userWallet = await walletsRepo.getUserWallet(session.user.id);

    if (!userWallet?.wallet_address) {
      return NextResponse.json(
        { error: "Please save your wallet address before creating demo earnings" },
        { status: 400 }
      );
    }

    const payoutsRepo = new PayoutsRepository(db);
    const gamificationRepo = new GamificationRepository(db);

    const demoAmount = Math.floor(Math.random() * 500) + 50; // ₹50-₹550
    const amountMicroUnits = demoAmount * 1000000;
    const orderId = `BH-PAYOUT-DEMO-${session.user.id}-${Date.now()}`;

    const payoutDoc = {
      _id: orderId,
      order_id: orderId,
      orgId: "demo_org_001",
      huntId: `demo_hunt_${Date.now()}`,
      submissionId: `demo_sub_${Date.now()}`,
      hunterUid: session.user.id,
      hunterWallet: userWallet.wallet_address,
      amount: amountMicroUnits,
      currency: "USDC",
      network: "POLYGON",
      status: "completed" as const,
      createdBy: "demo_admin",
      tx_hash: `0xdemo${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`,
      cryptomus_payout_id: `demo_${Math.random().toString(36).slice(2, 10)}`,
      cryptomus_response: {
        demo: true,
        scenario: "hunter_demo",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await payoutsRepo.createPayout(payoutDoc);

    // Also update gamification points
    await gamificationRepo.addPoints(session.user.id, demoAmount, {
      username: session.user.username || session.user.email,
      reason: "Demo Bounty Earning",
    });

    return NextResponse.json({
      success: true,
      amount: demoAmount,
      amountMicroUnits,
      order_id: orderId,
    });
  } catch (error: any) {
    console.error("POST /api/wallet/demo-earning error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

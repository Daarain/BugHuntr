/**
 * /api/wallet
 *
 * Authenticated endpoints for:
 * 1. GET: Fetching current hunter's wallet and earnings, or organization wallet (with role check)
 * 2. POST: Updating current hunter's crypto wallet address
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { WalletsRepository } from "@/lib/db/repositories/wallets.repo";
import { PayoutsRepository } from "@/lib/db/repositories/payouts.repo";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");

    const db = await getMongoDatabase();
    const walletsRepo = new WalletsRepository(db);

    if (orgId) {
      // Organization wallet inspection
      const isPlatformAdmin = session.user.role === "admin";
      const isOrgMember =
        session.user.role === "company" &&
        (session.user.organizationId === orgId || session.user.orgId === orgId);

      if (!isPlatformAdmin && !isOrgMember) {
        return NextResponse.json(
          { error: "Forbidden: Not authorized to access this organization wallet" },
          { status: 403 }
        );
      }

      let wallet = await walletsRepo.getWallet(orgId);
      if (!wallet) {
        // If demo org, lazily create with demo balance
        if (orgId === "demo_org_001") {
          wallet = await walletsRepo.createWallet({
            org_id: orgId,
            balance: 10000000000,
            reserved: 0,
            currency: "USDC",
            network: "POLYGON",
          });
        } else {
          return NextResponse.json({ error: "Organization wallet not found" }, { status: 404 });
        }
      }

      return NextResponse.json({
        wallet: {
          orgId: wallet.org_id,
          currency: wallet.currency,
          network: wallet.network,
          balance: wallet.balance,
          reserved: wallet.reserved,
          available: wallet.balance - wallet.reserved,
          updatedAt: wallet.updated_at ? new Date(wallet.updated_at).toISOString() : new Date().toISOString(),
        },
      });
    }

    // Hunter wallet & summary stats
    const payoutsRepo = new PayoutsRepository(db);
    const gamificationRepo = new GamificationRepository(db);

    const userWallet = await walletsRepo.getUserWallet(session.user.id);
    const payouts = await payoutsRepo.listByHunter(session.user.id, 500);

    const completed = payouts.filter((p) => p.status === "completed");
    const pending = payouts.filter(
      (p) => p.status === "pending_created" || p.status === "processing"
    );
    const failed = payouts.filter((p) => p.status === "failed");

    const totalEarnings = completed.reduce((sum, p) => sum + (p.amount || 0), 0);
    const gamificationBalance = await gamificationRepo.getPointsBalance(session.user.id);

    return NextResponse.json({
      walletAddress: userWallet?.wallet_address || "",
      savedWalletAddress: userWallet?.wallet_address || "",
      network: userWallet?.network || "POLYGON",
      totalEarnings,
      walletBalance: gamificationBalance?.points || 0,
      completedCount: completed.length,
      pendingCount: pending.length,
      failedCount: failed.length,
    });
  } catch (error: any) {
    console.error("GET /api/wallet error:", error);
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

    const body = await request.json().catch(() => ({}));
    const { walletAddress, network = "POLYGON" } = body;

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json(
        { error: "walletAddress is required" },
        { status: 400 }
      );
    }

    // Validate EVM address (Polygon/Ethereum)
    const evmPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!evmPattern.test(walletAddress)) {
      return NextResponse.json(
        { error: "Invalid Polygon/Ethereum wallet address format (must be 0x followed by 40 hex characters)" },
        { status: 400 }
      );
    }

    const db = await getMongoDatabase();
    const walletsRepo = new WalletsRepository(db);

    const updated = await walletsRepo.upsertUserWallet(session.user.id, {
      wallet_address: walletAddress,
      network,
      username: session.user.username || session.user.email,
    });

    return NextResponse.json({
      success: true,
      wallet: {
        userId: updated.user_id,
        walletAddress: updated.wallet_address,
        network: updated.network,
        updatedAt: updated.updated_at ? new Date(updated.updated_at).toISOString() : new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("POST /api/wallet error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

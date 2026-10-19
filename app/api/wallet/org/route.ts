/**
 * /api/wallet/org
 *
 * Authenticated endpoints for organization wallet lifecycle:
 * - GET: Fetch org wallet details
 * - POST: Initialize or top up organization wallet balance
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { WalletsRepository } from "@/lib/db/repositories/wallets.repo";
import { PayoutsRepository } from "@/lib/db/repositories/payouts.repo";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId") || "demo_org_001";

    const isPlatformAdmin = session.user.role === "admin";
    const isOrgMember =
      session.user.role === "company" &&
      (session.user.organizationId === orgId || session.user.orgId === orgId);
    const isDemo = orgId === "demo_org_001";

    if (!isPlatformAdmin && !isOrgMember && !isDemo) {
      return NextResponse.json(
        { error: "Forbidden: Not authorized to view this organization wallet" },
        { status: 403 }
      );
    }

    const db = await getMongoDatabase();
    const walletsRepo = new WalletsRepository(db);

    let wallet = await walletsRepo.getWallet(orgId);
    if (!wallet && isDemo) {
      wallet = await walletsRepo.createWallet({
        org_id: orgId,
        balance: 10000000000,
        reserved: 0,
        currency: "USDC",
        network: "POLYGON",
      });
    }

    if (!wallet) {
      return NextResponse.json({ error: "Organization wallet not found" }, { status: 404 });
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
  } catch (error: any) {
    console.error("GET /api/wallet/org error:", error);
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
    const {
      orgId = "demo_org_001",
      balance = 10000000000,
      currency = "USDC",
      network = "POLYGON",
      action = "initialize", // "initialize" | "topup"
      amount = 0,
    } = body;

    const isPlatformAdmin = session.user.role === "admin";
    const isOrgMember =
      session.user.role === "company" &&
      (session.user.organizationId === orgId || session.user.orgId === orgId);
    const isDemo = orgId === "demo_org_001";

    if (!isPlatformAdmin && !isOrgMember && !isDemo) {
      return NextResponse.json(
        { error: "Forbidden: Not authorized to modify this organization wallet" },
        { status: 403 }
      );
    }

    const db = await getMongoDatabase();
    const walletsRepo = new WalletsRepository(db);
    const payoutsRepo = new PayoutsRepository(db);

    if (action === "topup") {
      if (typeof amount !== "number" || amount <= 0) {
        return NextResponse.json({ error: "Invalid top-up amount" }, { status: 400 });
      }

      await walletsRepo.recordTopUp(orgId, amount, {
        recordedBy: session.user.id,
        notes: body.notes || "Admin Top-up",
      });

      await payoutsRepo.logEvent({
        eventType: "wallet_topup",
        actorUid: session.user.id,
        data: { orgId, amount },
      });
    } else {
      // initialize or reset
      await walletsRepo.createWallet({
        org_id: orgId,
        balance,
        reserved: 0,
        currency,
        network,
      });

      await payoutsRepo.logEvent({
        eventType: "wallet_initialized",
        actorUid: session.user.id,
        data: { orgId, balance, currency, network },
      });
    }

    const updated = await walletsRepo.getWallet(orgId);

    return NextResponse.json({
      success: true,
      wallet: updated
        ? {
            orgId: updated.org_id,
            currency: updated.currency,
            network: updated.network,
            balance: updated.balance,
            reserved: updated.reserved,
            available: updated.balance - updated.reserved,
            updatedAt: updated.updated_at ? new Date(updated.updated_at).toISOString() : new Date().toISOString(),
          }
        : null,
    });
  } catch (error: any) {
    console.error("POST /api/wallet/org error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

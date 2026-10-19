/**
 * /api/payouts/[id]
 *
 * Authenticated endpoint to retrieve an individual payout by order_id
 * with strict role and tenancy authorization.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { PayoutsRepository } from "@/lib/db/repositories/payouts.repo";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Payout order_id is required" }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const payoutsRepo = new PayoutsRepository(db);
    const payout = await payoutsRepo.getByOrderId(id);

    if (!payout) {
      return NextResponse.json({ error: "Payout not found" }, { status: 404 });
    }

    // Role & tenancy authorization check
    const isPlatformAdmin = session.user.role === "admin";
    const isRecipientHunter =
      session.user.role === "hunter" && payout.hunterUid === session.user.id;
    const isPayingCompany =
      session.user.role === "company" &&
      (payout.orgId === session.user.organizationId || payout.orgId === session.user.orgId);

    if (!isPlatformAdmin && !isRecipientHunter && !isPayingCompany) {
      return NextResponse.json(
        { error: "Forbidden: Not authorized to view this payout record" },
        { status: 403 }
      );
    }

    return NextResponse.json({ payout });
  } catch (error: any) {
    console.error("GET /api/payouts/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { ProRepository } from "@/lib/db/repositories/pro.repo";
import type { ProInvitationDoc } from "@/lib/db/types";
import { type ProInvitation } from "@/types/pro";
import { mockProHunts } from "@/data/mock-pro-data";
import { mapDocToProInvitation } from "@/lib/pro-utils";

/**
 * GET /api/pro/invitations
 * Lists pro invitations with strict role-based access control.
 *
 * Query params:
 * - huntId: filter by specific hunt (company/admin)
 * - status: "pending", "accepted", "declined", or comma-separated list
 * - limit: max records to return (default 50, max 200)
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const huntId = searchParams.get("huntId") || undefined;
    const statusParam = searchParams.get("status") || undefined;
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10), 1), 200);

    const isCompany = session.user.userType === "company";
    const isAdmin = session.user.role === "admin";
    const isHunter = !isCompany && !isAdmin;

    const db = await getMongoDatabase();
    const repo = new ProRepository(db);

    let docs: ProInvitationDoc[] = [];

    if (isHunter) {
      // Researchers may ONLY access invitations sent to their own user ID or username
      docs = await repo.listInvitations({
        hunterId: session.user.id,
        hunterUsername: session.user.username,
        status: statusParam,
        huntId,
        limit,
      });
    } else if (isCompany) {
      // Companies may only view invitations for hunts they manage
      if (huntId) {
        const hunt = await repo.getHuntById(huntId);
        const targetCompanyId = session.user.orgId || session.user.organizationId || session.user.id;
        if (hunt && hunt.companyId !== targetCompanyId && hunt.createdBy !== session.user.id) {
          return NextResponse.json({ error: "Forbidden: You do not manage this bug hunt." }, { status: 403 });
        }
        docs = await repo.listInvitations({
          huntId,
          status: statusParam,
          limit,
        });
      } else {
        // Find all hunts owned by this company, then fetch invitations
        const targetCompanyId = session.user.orgId || session.user.organizationId || session.user.id;
        const companyHunts = await repo.listHunts({ companyId: targetCompanyId });
        const huntIds = companyHunts.map((h) => h._id);

        if (huntIds.length > 0) {
          const allDocs: ProInvitationDoc[] = [];
          for (const hid of huntIds) {
            const hinvs = await repo.listInvitations({ huntId: hid, status: statusParam, limit });
            allDocs.push(...hinvs);
          }
          docs = allDocs.slice(0, limit);
        }
      }
    } else {
      // Admins may view any invitations
      docs = await repo.listInvitations({
        huntId,
        status: statusParam,
        limit,
      });
    }

    const mapped = docs.map(mapDocToProInvitation);

    return NextResponse.json({
      invitations: mapped,
      total: mapped.length,
    });
  } catch (error: any) {
    console.error("GET /api/pro/invitations error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/pro/invitations
 * Issues an invitation to a private Pro Bug Hunt. Requires company or admin session.
 */
export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    const isCompany = session.user.userType === "company";
    const isAdmin = session.user.role === "admin";

    if (!isCompany && !isAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Only companies and administrators can issue Pro Bug Hunt invitations." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
    }

    const {
      huntId,
      huntTitle,
      companyName,
      hunterId,
      hunterName,
      hunterUsername,
      recipientEmail,
    } = body;

    if (!huntId || typeof huntId !== "string" || huntId.trim().length === 0) {
      return NextResponse.json({ error: "huntId is required." }, { status: 400 });
    }

    if (!hunterId && !hunterUsername && !recipientEmail) {
      return NextResponse.json(
        { error: "At least one target recipient identifier (hunterId, hunterUsername, or recipientEmail) is required." },
        { status: 400 }
      );
    }

    const db = await getMongoDatabase();
    const repo = new ProRepository(db);

    // Verify hunt existence & authorization
    let resolvedHuntTitle = huntTitle;
    let resolvedCompanyName = companyName;

    const hunt = await repo.getHuntById(huntId);
    if (hunt) {
      resolvedHuntTitle = hunt.title;
      resolvedCompanyName = hunt.companyName;

      // Ownership enforcement for company users
      if (isCompany) {
        const targetCompanyId = session.user.orgId || session.user.organizationId || session.user.id;
        if (hunt.companyId !== targetCompanyId && hunt.createdBy !== session.user.id) {
          return NextResponse.json({ error: "Forbidden: You do not own this Pro Bug Hunt." }, { status: 403 });
        }
      }
    } else {
      // Check mock hunts fallback for dev/prototype
      const mockHunt = mockProHunts.find((h) => h.id === huntId);
      if (mockHunt) {
        resolvedHuntTitle = mockHunt.title;
        resolvedCompanyName = mockHunt.companyName;
      }
    }

    // Check for duplicate pending/accepted invitation to prevent duplicate spam
    const existing = await repo.listInvitations({
      huntId,
      hunterId: hunterId || undefined,
      hunterUsername: hunterUsername || undefined,
      status: ["pending", "accepted"],
    });

    if (existing.length > 0) {
      return NextResponse.json(
        {
          error: "An active invitation for this researcher and hunt already exists.",
          invitation: mapDocToProInvitation(existing[0]),
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days expiration
    const invId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const token = `inv_token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const newDoc: ProInvitationDoc = {
      _id: invId,
      hunt_id: huntId.trim(),
      hunt_title: resolvedHuntTitle || "Pro Bug Hunt",
      company_name: resolvedCompanyName || (session.user as any).companyName || "Security Partner",
      sender_id: session.user.id,
      invited_by: session.user.username || session.user.email || session.user.id,
      hunter_id: hunterId ? String(hunterId).trim() : undefined,
      hunter_name: hunterName ? String(hunterName).trim() : undefined,
      hunter_username: hunterUsername ? String(hunterUsername).trim() : undefined,
      recipient_email: recipientEmail ? String(recipientEmail).trim().toLowerCase() : undefined,
      token,
      status: "pending",
      created_at: now,
      expires_at: expiresAt,
    };

    const created = await repo.createInvitation(newDoc);
    const mapped = mapDocToProInvitation(created);

    return NextResponse.json({ invitation: mapped }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/pro/invitations error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

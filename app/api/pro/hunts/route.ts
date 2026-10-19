import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { ProRepository } from "@/lib/db/repositories/pro.repo";
import type { ProHuntDoc } from "@/lib/db/types";
import { type ProHunt } from "@/types/pro";
import { mockProHunts } from "@/data/mock-pro-data";

function mapDocToProHunt(doc: ProHuntDoc): ProHunt {
  return {
    id: doc._id,
    companyId: doc.companyId,
    companyName: doc.companyName,
    title: doc.title,
    description: doc.description,
    allowedTargetSegments: doc.allowedTargetSegments || [],
    ndaTemplateId: doc.ndaTemplateId || "nda_standard",
    ndaTemplateText: doc.ndaTemplateText || "",
    requireKYC: Boolean(doc.requireKYC),
    requireCerts: Boolean(doc.requireCerts),
    allowBids: Boolean(doc.allowBids),
    minRank: (doc.minRank || "C") as "C" | "B" | "A" | "S",
    minHuntsParticipated: doc.minHuntsParticipated || 0,
    requiredCertifications: doc.requiredCertifications || [],
    rewards: doc.rewards || { critical: 1000, high: 500, medium: 200, low: 50 },
    maxHunters: doc.maxHunters || 50,
    currentHunters: doc.currentHunters || 0,
    status: doc.status || "active",
    startsAt: doc.startsAt || doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    endsAt: doc.endsAt || "",
    createdAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    updatedAt: doc.updated_at ? new Date(doc.updated_at).toISOString() : new Date().toISOString(),
    inviteOnly: doc.inviteOnly ?? true,
    createdBy: doc.createdBy,
  };
}

/**
 * GET /api/pro/hunts
 * Lists Pro Bug Hunts from MongoDB merged with mock data for continuity.
 */
export async function GET(request: NextRequest) {
  try {
    const db = await getMongoDatabase();
    const repo = new ProRepository(db);

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const status = searchParams.get("status");
    const viewMode = searchParams.get("viewMode");
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "100", 10), 1), 250);

    const persistedDocs = await repo.listHunts({
      companyId: companyId || undefined,
      status: status || undefined,
      limit,
    });

    const persistedHunts: ProHunt[] = persistedDocs.map(mapDocToProHunt);

    // Merge mock data and persisted data, persisted takes precedence
    const seen = new Set<string>();
    const merged: ProHunt[] = [];

    for (const h of persistedHunts) {
      if (!seen.has(h.id)) {
        seen.add(h.id);
        merged.push(h);
      }
    }

    for (const h of mockProHunts) {
      if (!seen.has(h.id)) {
        // If companyId filter is active, only include matching mock hunts
        if (companyId && h.companyId !== companyId) continue;
        if (status && status !== "all" && h.status !== status) continue;
        seen.add(h.id);
        merged.push(h);
      }
    }

    // Role-based visibility filtering
    const session = getSessionFromRequest(request);
    let result = merged;

    if (viewMode === "manage") {
      if (!session.authenticated || !session.user) {
        return NextResponse.json({ error: "Unauthorized: Active session required for manage view." }, { status: 401 });
      }

      const isCompany = session.user.userType === "company";
      const isAdmin = session.user.role === "admin";

      if (!isCompany && !isAdmin) {
        return NextResponse.json({ error: "Forbidden: Researcher accounts cannot manage Pro Bug Hunts." }, { status: 403 });
      }

      if (isCompany) {
        const targetCompanyId = session.user.orgId || session.user.organizationId || session.user.id;
        result = result.filter((h) => h.companyId === targetCompanyId);
      } else if (isAdmin && companyId) {
        result = result.filter((h) => h.companyId === companyId);
      }
    }

    return NextResponse.json({
      hunts: result,
      total: result.length,
    });
  } catch (error: any) {
    console.error("GET /api/pro/hunts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/pro/hunts
 * Creates a new Pro Bug Hunt program. Requires company or admin session.
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
        { error: "Forbidden: Only verified companies and administrators can create Pro Bug Hunts." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
    }

    const {
      title,
      description,
      allowedTargetSegments,
      ndaTemplateId,
      ndaTemplateText,
      requireKYC,
      requireCerts,
      allowBids,
      minRank,
      minHuntsParticipated,
      requiredCertifications,
      rewards,
      maxHunters,
      startsAt,
      endsAt,
      inviteOnly,
    } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Hunt title is required." }, { status: 400 });
    }

    if (!description || typeof description !== "string") {
      return NextResponse.json({ error: "Hunt description is required." }, { status: 400 });
    }

    // Derive company identity securely from session
    const companyId = isAdmin && body.companyId ? String(body.companyId).trim() : (session.user.orgId || session.user.organizationId || session.user.id);
    const companyName = isAdmin && body.companyName ? String(body.companyName).trim() : ((session.user as any).companyName || session.user.username || "TechCorp Security");
    const createdBy = session.user.id;
    const now = new Date();

    const huntId = `prohunt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newDoc: ProHuntDoc = {
      _id: huntId,
      companyId,
      companyName,
      title: title.trim(),
      description: description.trim(),
      allowedTargetSegments: Array.isArray(allowedTargetSegments) ? allowedTargetSegments : [],
      ndaTemplateId: ndaTemplateId || "nda_standard",
      ndaTemplateText: ndaTemplateText || "",
      requireKYC: Boolean(requireKYC),
      requireCerts: Boolean(requireCerts),
      allowBids: Boolean(allowBids),
      minRank: (minRank || "C") as "C" | "B" | "A" | "S",
      minHuntsParticipated: Number(minHuntsParticipated) || 0,
      requiredCertifications: Array.isArray(requiredCertifications) ? requiredCertifications : [],
      rewards: rewards || { critical: 1000, high: 500, medium: 200, low: 50 },
      maxHunters: Number(maxHunters) || 50,
      currentHunters: 0,
      status: "active",
      startsAt: startsAt || now.toISOString(),
      endsAt: endsAt || "",
      inviteOnly: inviteOnly ?? true,
      createdBy,
      created_at: now,
      updated_at: now,
    };

    const db = await getMongoDatabase();
    const repo = new ProRepository(db);

    const created = await repo.createHunt(newDoc);
    const mapped = mapDocToProHunt(created);

    return NextResponse.json({ hunt: mapped }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/pro/hunts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/pro/hunts
 * Updates an existing Pro Bug Hunt program.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.id) {
      return NextResponse.json({ error: "Hunt ID is required." }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const repo = new ProRepository(db);

    const existing = await repo.getHuntById(body.id);
    if (!existing) {
      return NextResponse.json({ error: "Pro Bug Hunt not found." }, { status: 404 });
    }

    // Ownership check: must be admin or hunt creator/company
    const isAdmin = session.user.role === "admin";
    const isOwner =
      existing.createdBy === session.user.id ||
      existing.companyId === session.user.orgId ||
      existing.companyId === session.user.organizationId ||
      existing.companyId === session.user.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: "Forbidden: You do not own this Pro Bug Hunt." }, { status: 403 });
    }

    const { id, _id, createdBy, created_at, companyId, ...updates } = body;
    await repo.updateHunt(body.id, updates);

    const updated = await repo.getHuntById(body.id);
    return NextResponse.json({ success: true, hunt: updated ? mapDocToProHunt(updated) : null });
  } catch (error: any) {
    console.error("PATCH /api/pro/hunts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

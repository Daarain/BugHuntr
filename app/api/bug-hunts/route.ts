import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { HuntsRepository } from "@/lib/db/repositories/hunts.repo";
import type { BugHuntDoc } from "@/lib/db/types";

function mapDocToBugHunt(doc: BugHuntDoc) {
  return {
    id: doc._id,
    title: doc.title,
    description: doc.description,
    company: doc.org_id,
    scope: doc.target_scope || [],
    categories: doc.categories || [],
    difficulty: doc.difficulty || "intermediate",
    status: doc.status,
    startDate: doc.startDate || doc.created_at?.toISOString() || "",
    endDate: doc.endDate || "",
    maxParticipants: doc.maxParticipants,
    currentParticipants: doc.currentParticipants || 0,
    createdBy: doc.createdBy,
    createdAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    updatedAt: doc.updated_at ? new Date(doc.updated_at).toISOString() : new Date().toISOString(),
    rewards: doc.rewards || { critical: 0, high: 0, medium: 0, low: 0 },
    rewardTypes: ["cash"],
    rewardDetails: {
      cash: `${doc.rewards?.critical || 0} max critical payout`,
      certificates: "Standard certificate",
      internship: "Opportunity considered",
      jobs: "Opportunity considered",
    },
    rules: doc.rules || [],
    assets: doc.assets || [],
    submissions: [],
  };
}

/**
 * GET /api/bug-hunts
 * Lists active bug bounty programs from MongoDB.
 */
export async function GET(request: NextRequest) {
  try {
    const db = await getMongoDatabase();
    const repo = new HuntsRepository(db);

    const { searchParams } = new URL(request.url);
    const difficulty = searchParams.get("difficulty") as BugHuntDoc["difficulty"] | null;
    const category = searchParams.get("category") || undefined;
    const status = searchParams.get("status");
    const orgId = searchParams.get("orgId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    let docs: BugHuntDoc[];

    if (orgId) {
      docs = await repo.listByOrg(orgId, limit);
    } else if (status === "all") {
      const session = getSessionFromRequest(request);
      if (session.authenticated && (session.user?.role === "admin" || session.user?.userType === "company")) {
        docs = await repo.listAll(limit);
      } else {
        docs = await repo.listActive({ difficulty: difficulty || undefined, category, limit });
      }
    } else {
      docs = await repo.listActive({ difficulty: difficulty || undefined, category, limit });
    }

    return NextResponse.json(docs.map(mapDocToBugHunt));
  } catch (error: any) {
    console.error("List bug hunts error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list bug hunts" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bug-hunts
 * Creates a new bug bounty program in MongoDB.
 * Enforces company/admin role authorization.
 */
export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    if (session.user.role !== "admin" && session.user.userType !== "company") {
      return NextResponse.json(
        { error: "Forbidden: Only companies and platform administrators may create bug bounty programs." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      title,
      description,
      company,
      scope,
      categories,
      difficulty,
      rewards,
      rules,
      assets,
      maxParticipants,
      startDate,
      endDate,
    } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!description || typeof description !== "string") {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    const db = await getMongoDatabase();
    const repo = new HuntsRepository(db);

    const huntId = `hunt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    let orgId: string;
    const sessionOrg = session.user.orgId || session.user.organizationId;
    const sessionOrgFallback = sessionOrg || session.user.username;

    if (session.user.role === "admin") {
      orgId = (company && typeof company === "string" && company.trim().length > 0)
        ? company.trim()
        : sessionOrgFallback;
    } else {
      // Company role: must be bound strictly to authenticated organization context
      if (company && typeof company === "string" && company.trim().length > 0) {
        const requestedOrg = company.trim();
        if (sessionOrg && requestedOrg !== sessionOrg) {
          return NextResponse.json(
            { error: "Forbidden: Cannot create bug bounty programs for another organization." },
            { status: 403 }
          );
        }
        if (!sessionOrg && requestedOrg !== session.user.username) {
          return NextResponse.json(
            { error: "Forbidden: Cannot create bug bounty programs for another organization." },
            { status: 403 }
          );
        }
      }

      if (!sessionOrgFallback) {
        return NextResponse.json(
          { error: "Missing organization context: Company account has no assigned organization." },
          { status: 403 }
        );
      }
      orgId = sessionOrgFallback;
    }

    const huntDoc: BugHuntDoc = {
      _id: huntId,
      org_id: orgId,
      title: title.trim(),
      description: description.trim(),
      target_scope: Array.isArray(scope) ? scope : [],
      out_of_scope: [],
      rewards: rewards || { critical: 1000, high: 500, medium: 250, low: 50 },
      status: "active",
      visibility: "public",
      difficulty: difficulty || "intermediate",
      categories: Array.isArray(categories) ? categories : ["Web Application"],
      rules: Array.isArray(rules) ? rules : [],
      assets: Array.isArray(assets) ? assets : [],
      createdBy: session.user.id, // Stable string ID per Identity Contract
      currentParticipants: 0,
      maxParticipants: typeof maxParticipants === "number" ? maxParticipants : undefined,
      startDate: startDate || new Date().toISOString(),
      endDate: endDate || "",
      created_at: new Date(),
      updated_at: new Date(),
    };

    const created = await repo.createHunt(huntDoc);
    return NextResponse.json(mapDocToBugHunt(created), { status: 201 });
  } catch (error: any) {
    console.error("Create bug hunt error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create bug hunt" },
      { status: 500 }
    );
  }
}

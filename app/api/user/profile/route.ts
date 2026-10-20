import { NextRequest, NextResponse } from "next/server";
import { getUserProfileByUsername, getUserProfileById } from "@/lib/db/users";
import { authRepository } from "@/lib/db/auth-repository";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";

/**
 * User Profile API
 *
 * GET: Resolves user profile by username query param or current authenticated session.
 * Backed by authoritative PostgreSQL user_profiles store with MongoDB gamification fallback.
 *
 * PATCH: Updates editable profile fields for the authenticated user (or admin).
 * Strictly guards against privilege escalation: roles, points, permissions, and credentials cannot be modified.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const usernameParam = searchParams.get("username");

    let targetUsername = usernameParam?.trim() || null;
    let targetUserId: string | null = null;

    if (!targetUsername) {
      // Fallback to active session
      const session = getSessionFromRequest(request);
      if (session.authenticated && session.user) {
        targetUsername = session.user.username;
        targetUserId = session.user.id;
      }
    }

    if (!targetUsername && !targetUserId) {
      return NextResponse.json(
        { error: "Missing username parameter or active session" },
        { status: 400 }
      );
    }

    // 1. Authoritative PostgreSQL profile resolution
    try {
      let pgProfile = null;
      if (targetUsername) {
        pgProfile = await getUserProfileByUsername(targetUsername);
      } else if (targetUserId) {
        pgProfile = await getUserProfileById(targetUserId);
      }

      if (pgProfile) {
        return NextResponse.json({
          id: pgProfile.user_id,
          userId: pgProfile.user_id,
          username: pgProfile.username,
          displayName: pgProfile.display_name || pgProfile.username,
          name: pgProfile.display_name || pgProfile.username,
          avatarUrl: pgProfile.avatar_url || "",
          avatar: pgProfile.avatar_url || "",
          bio: pgProfile.bio || "",
          country: pgProfile.country || "",
          points: pgProfile.points || 0,
          reputationRank: pgProfile.reputation_rank || "Novice",
          companyName: pgProfile.company_name || "",
          createdAt: pgProfile.created_at,
        });
      }
    } catch (pgError) {
      console.warn("PostgreSQL profile lookup failed, trying MongoDB fallback:", pgError);
    }

    // 2. MongoDB gamification profile fallback
    try {
      const db = await getMongoDatabase();
      const gamificationRepo = new GamificationRepository(db);

      let balance = null;
      if (targetUsername) {
        balance = await gamificationRepo.getPointsBalanceByUsername(targetUsername);
      } else if (targetUserId) {
        balance = await gamificationRepo.getPointsBalance(targetUserId);
      }

      if (balance) {
        return NextResponse.json({
          id: balance.user_id,
          userId: balance.user_id,
          username: balance.username || targetUsername || "hunter",
          displayName: balance.username || targetUsername || "hunter",
          name: balance.username || targetUsername || "hunter",
          avatarUrl: "",
          avatar: "",
          bio: "",
          country: "",
          points: balance.points || 0,
          reputationRank: balance.reputation_rank || "Novice",
          companyName: "",
          createdAt: balance.last_activity || new Date(),
        });
      }
    } catch {
      // Continue to 404
    }

    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  } catch (error: any) {
    console.error("Profile API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized: Active session required." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    // Privilege Escalation Guard: Reject attempts to manipulate security fields
    const FORBIDDEN_FIELDS = [
      "role",
      "roles",
      "points",
      "reputation_rank",
      "reputationRank",
      "email",
      "verified",
      "user_type",
      "userType",
      "two_factor_enabled",
      "password",
      "passwordHash",
    ];

    for (const field of FORBIDDEN_FIELDS) {
      if (field in body) {
        return NextResponse.json(
          { error: `Protected field '${field}' cannot be modified via profile update.` },
          { status: 400 }
        );
      }
    }

    // Authorization & Tenant Check: User can only update their own profile unless admin
    let targetUserId = session.user.id;
    if (body.userId && body.userId !== session.user.id) {
      if (session.user.role !== "admin") {
        return NextResponse.json(
          { error: "Forbidden: You cannot modify another user's profile." },
          { status: 403 }
        );
      }
      targetUserId = body.userId;
    }

    // Input validation on editable fields
    const displayName = body.displayName ?? body.name ?? body.display_name;
    const avatarUrl = body.avatarUrl ?? body.avatar ?? body.avatar_url;
    const bio = body.bio;
    const country = body.country;
    const companyName = body.companyName ?? body.company_name;

    if (displayName !== undefined && (typeof displayName !== "string" || displayName.length > 100)) {
      return NextResponse.json(
        { error: "Display name must be a string up to 100 characters." },
        { status: 400 }
      );
    }

    if (avatarUrl !== undefined && (typeof avatarUrl !== "string" || avatarUrl.length > 2000)) {
      return NextResponse.json(
        { error: "Avatar URL must be a valid URL string up to 2000 characters." },
        { status: 400 }
      );
    }

    if (bio !== undefined && (typeof bio !== "string" || bio.length > 1000)) {
      return NextResponse.json(
        { error: "Bio must be a string up to 1000 characters." },
        { status: 400 }
      );
    }

    if (country !== undefined && (typeof country !== "string" || country.length > 10)) {
      return NextResponse.json(
        { error: "Country code must be a string up to 10 characters." },
        { status: 400 }
      );
    }

    if (companyName !== undefined && (typeof companyName !== "string" || companyName.length > 150)) {
      return NextResponse.json(
        { error: "Company name must be a string up to 150 characters." },
        { status: 400 }
      );
    }

    // Update in authoritative PostgreSQL
    let updatedProfile = null;
    try {
      updatedProfile = await authRepository.updateProfile(targetUserId, {
        displayName: displayName !== undefined ? displayName : undefined,
        avatarUrl: avatarUrl !== undefined ? avatarUrl : undefined,
        bio: bio !== undefined ? bio : undefined,
        country: country !== undefined ? country : undefined,
        companyName: companyName !== undefined ? companyName : undefined,
      });
    } catch (pgError) {
      console.warn("PostgreSQL profile update failed:", pgError);
    }

    if (!updatedProfile) {
      // In-memory / synthetic fallback response if PG is unconfigured
      return NextResponse.json({
        success: true,
        profile: {
          id: targetUserId,
          userId: targetUserId,
          username: session.user.username,
          displayName: displayName || session.user.username,
          avatarUrl: avatarUrl || "",
          bio: bio || "",
          country: country || "",
          companyName: companyName || "",
        },
      });
    }

    return NextResponse.json({
      success: true,
      profile: {
        id: updatedProfile.user_id,
        userId: updatedProfile.user_id,
        username: updatedProfile.username,
        displayName: updatedProfile.display_name,
        name: updatedProfile.display_name,
        avatarUrl: updatedProfile.avatar_url,
        avatar: updatedProfile.avatar_url,
        bio: updatedProfile.bio,
        country: updatedProfile.country,
        points: updatedProfile.points || 0,
        reputationRank: updatedProfile.reputation_rank || "Novice",
        companyName: updatedProfile.company_name,
        updatedAt: updatedProfile.updated_at,
      },
    });
  } catch (error: any) {
    console.error("Profile update API error:", error);
    return NextResponse.json(
      { error: "Internal server error during profile update." },
      { status: 500 }
    );
  }
}

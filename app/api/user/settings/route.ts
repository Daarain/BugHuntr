import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";
import { getMongoDatabase } from "@/lib/db/mongodb";
import { PreferencesRepository, DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/db/repositories/preferences.repo";

/**
 * User Settings & Preferences API
 *
 * GET: Retrieves application preferences (notifications, theme) for the authenticated session user.
 * PATCH: Updates preferences in MongoDB user_preferences collection with schema validation.
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session.authenticated || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized: Active session required." },
        { status: 401 }
      );
    }

    const db = await getMongoDatabase();
    const repo = new PreferencesRepository(db);
    const prefs = await repo.getPreferences(session.user.id);

    return NextResponse.json({
      userId: session.user.id,
      notifications: prefs?.notifications || DEFAULT_NOTIFICATION_PREFERENCES,
      theme: prefs?.theme || "system",
      updatedAt: prefs?.updated_at || new Date(),
    });
  } catch (error: any) {
    console.error("Settings GET API error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve user settings." },
      { status: 500 }
    );
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

    const { notifications, theme } = body;

    // Validate theme if provided
    if (theme !== undefined && !["light", "dark", "system"].includes(theme)) {
      return NextResponse.json(
        { error: "Theme must be one of: 'light', 'dark', 'system'." },
        { status: 400 }
      );
    }

    // Validate notifications if provided
    if (notifications !== undefined) {
      if (typeof notifications !== "object" || notifications === null) {
        return NextResponse.json(
          { error: "Notifications must be an object." },
          { status: 400 }
        );
      }

      for (const [key, val] of Object.entries(notifications)) {
        if (typeof val !== "boolean") {
          return NextResponse.json(
            { error: `Notification setting '${key}' must be a boolean.` },
            { status: 400 }
          );
        }
      }
    }

    const db = await getMongoDatabase();
    const repo = new PreferencesRepository(db);

    const updated = await repo.updatePreferences(session.user.id, {
      notifications,
      theme,
    });

    return NextResponse.json({
      success: true,
      settings: {
        userId: session.user.id,
        notifications: updated.notifications,
        theme: updated.theme,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error: any) {
    console.error("Settings PATCH API error:", error);
    return NextResponse.json(
      { error: "Failed to update user settings." },
      { status: 500 }
    );
  }
}

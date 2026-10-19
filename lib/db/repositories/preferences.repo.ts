/**
 * User Preferences Repository (MongoDB)
 *
 * Implements persistent storage for user UI settings, notification subscriptions,
 * and application preferences.
 *
 * Logical user reference: user_preferences.user_id -> SQL auth_users.id (string).
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type { UserPreferencesDoc, UserNotificationPreferences } from "../types";

export const DEFAULT_NOTIFICATION_PREFERENCES: UserNotificationPreferences = {
  emailAlerts: true,
  pushNotifications: true,
  bugUpdates: true,
  communityMessages: false,
  weeklyDigest: true,
};

export class PreferencesRepository {
  private collection: Collection<UserPreferencesDoc>;

  constructor(db: Db) {
    this.collection = db.collection<UserPreferencesDoc>("user_preferences");
  }

  /**
   * Retrieves user preferences by stable user ID.
   */
  async getPreferences(userId: string, session?: ClientSession): Promise<UserPreferencesDoc | null> {
    return this.collection.findOne({ user_id: userId }, { session });
  }

  /**
   * Upserts user preferences (notifications and theme).
   */
  async updatePreferences(
    userId: string,
    updates: {
      notifications?: Partial<UserNotificationPreferences>;
      theme?: "light" | "dark" | "system";
    },
    session?: ClientSession
  ): Promise<UserPreferencesDoc> {
    const existing = await this.getPreferences(userId, session);
    const now = new Date();

    const mergedNotifications: UserNotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(existing?.notifications || {}),
      ...(updates.notifications || {}),
    };

    const updateSet: any = {
      user_id: userId,
      notifications: mergedNotifications,
      updated_at: now,
    };

    if (updates.theme) {
      updateSet.theme = updates.theme;
    }

    await this.collection.updateOne(
      { user_id: userId },
      {
        $set: updateSet,
        $setOnInsert: {
          _id: userId,
          created_at: now,
        },
      },
      { upsert: true, session }
    );

    return {
      _id: userId,
      user_id: userId,
      notifications: mergedNotifications,
      theme: updates.theme || existing?.theme || "system",
      created_at: existing?.created_at || now,
      updated_at: now,
    };
  }
}

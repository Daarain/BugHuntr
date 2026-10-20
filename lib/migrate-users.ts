/**
 * User migration utilities - permanently retired and disabled.
 */

export async function migrateUserProfilesWithUsernames(): Promise<{ success: boolean; updatedCount?: number; error?: string }> {
  throw new Error("Administrative utility is permanently retired and disabled.");
}

export async function updateUserRole(_username: string, _role: "user" | "admin"): Promise<{ success: boolean; error?: string }> {
  throw new Error("Administrative utility is permanently retired and disabled.");
}
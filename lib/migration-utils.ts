/**
 * User and role migration utilities - permanently retired and disabled.
 */

export async function migrateUsernamesFromEmails(): Promise<{ updated: number; created: number }> {
  throw new Error("Administrative utility is permanently retired and disabled.");
}

export async function updateUserRole(
  _username: string,
  _role: "user" | "admin",
  _companyName?: string
): Promise<void> {
  throw new Error("Administrative utility is permanently retired and disabled.");
}
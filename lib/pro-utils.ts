// BugHuntr Pro Utility Functions
import { type ProRecommendation, type HunterEligibility, type ProInvitation } from "@/types/pro";
import type { ProInvitationDoc } from "@/lib/db/types";

// Rank scoring weights
const RANK_SCORES: Record<string, number> = {
  S: 100,
  A: 75,
  B: 50,
  C: 25,
  D: 10,
};

// Calculate hunter score for recommendations
export function calculateHunterScore(
  rank: string,
  reputation: number,
  huntsParticipated: number,
  successRate: number,
  certifications: string[],
  requiredCerts: string[]
): number {
  let score = 0;

  // Rank contribution (40%)
  score += (RANK_SCORES[rank] || 0) * 0.4;

  // Reputation contribution (25%)
  score += (reputation / 5) * 25;

  // Experience contribution (20%)
  score += Math.min(huntsParticipated / 100, 1) * 20;

  // Success rate contribution (10%)
  score += successRate * 10;

  // Certification match (5%)
  const certMatch =
    requiredCerts.length > 0
      ? requiredCerts.filter((rc) => certifications.includes(rc)).length /
        requiredCerts.length
      : 1;
  score += certMatch * 5;

  return Math.round(score * 10) / 10;
}

// Generate reason tags for recommendations
export function generateReasonTags(
  rank: string,
  reputation: number,
  huntsParticipated: number,
  successRate: number,
  certifications: string[],
  requiredCerts: string[]
): string[] {
  const reasons: string[] = [];

  if (RANK_SCORES[rank] >= 75) {
    reasons.push(`Elite ${rank}-rank hunter`);
  } else if (RANK_SCORES[rank] >= 50) {
    reasons.push(`Experienced ${rank}-rank hunter`);
  }

  if (reputation >= 4.5) {
    reasons.push(`Excellent reputation (${reputation}/5)`);
  } else if (reputation >= 4.0) {
    reasons.push(`Strong reputation (${reputation}/5)`);
  }

  if (huntsParticipated >= 100) {
    reasons.push(`Highly active (${huntsParticipated} hunts)`);
  } else if (huntsParticipated >= 50) {
    reasons.push(`Active participant (${huntsParticipated} hunts)`);
  } else if (huntsParticipated >= 25) {
    reasons.push(`Regular participant (${huntsParticipated} hunts)`);
  }

  if (successRate >= 0.8) {
    reasons.push(`High success rate (${Math.round(successRate * 100)}%)`);
  } else if (successRate >= 0.6) {
    reasons.push(`Good success rate (${Math.round(successRate * 100)}%)`);
  }

  const matchedCerts = requiredCerts.filter((rc) =>
    certifications.includes(rc)
  );
  if (matchedCerts.length > 0) {
    reasons.push(`Certified: ${matchedCerts.join(", ")}`);
  }

  return reasons;
}

// Check if hunter meets eligibility requirements
export function checkEligibility(
  rank: string,
  huntsParticipated: number,
  certifications: string[],
  minRank: string = "B",
  minHunts: number = 25,
  requiredCerts: string[] = []
): HunterEligibility {
  const missingRequirements: string[] = [];
  const reasons: string[] = [];

  // Check rank
  const rankValue = RANK_SCORES[rank] || 0;
  const minRankValue = RANK_SCORES[minRank] || 0;

  if (rankValue < minRankValue) {
    missingRequirements.push(
      `Must be ${minRank}-rank or higher (currently ${rank}-rank)`
    );
  } else {
    reasons.push(`✓ Meets rank requirement (${rank}-rank)`);
  }

  // Check hunts participated
  if (huntsParticipated < minHunts) {
    missingRequirements.push(
      `Must have participated in ${minHunts}+ hunts (currently ${huntsParticipated})`
    );
  } else {
    reasons.push(`✓ Meets experience requirement (${huntsParticipated} hunts)`);
  }

  // Check certifications
  if (requiredCerts.length > 0) {
    const missingCerts = requiredCerts.filter(
      (rc) => !certifications.includes(rc)
    );
    if (missingCerts.length > 0) {
      missingRequirements.push(
        `Required certifications: ${missingCerts.join(", ")}`
      );
    } else {
      reasons.push(
        `✓ Has required certifications: ${requiredCerts.join(", ")}`
      );
    }
  } else {
    reasons.push(`✓ No specific certifications required`);
  }

  return {
    isEligible: missingRequirements.length === 0,
    rank,
    huntsParticipated,
    certifications,
    reasons,
    missingRequirements,
  };
}

// Generate a mock JWT token (for prototype)
export function generateMockAccessToken(
  huntId: string,
  hunterId: string,
  allowedSegments: string[],
  expiresInHours: number = 24
): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      huntId,
      hunterId,
      allowedSegments,
      iat: Date.now(),
      exp: Date.now() + expiresInHours * 60 * 60 * 1000,
    })
  );
  const signature = btoa(`mock_signature_${huntId}_${hunterId}`);
  return `${header}.${payload}.${signature}`;
}

// Verify mock token (for prototype)
export function verifyMockAccessToken(token: string): {
  valid: boolean;
  payload?: any;
  error?: string;
} {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Invalid token format" };
    }

    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp < Date.now()) {
      return { valid: false, error: "Token expired" };
    }

    return { valid: true, payload };
  } catch (error) {
    return { valid: false, error: "Token verification failed" };
  }
}

// Generate signature hash for NDA
export function generateNDASignatureHash(
  ndaText: string,
  hunterId: string,
  timestamp: string
): string {
  // Simple hash function for prototype (in production use crypto.subtle.digest)
  const content = `${ndaText}${hunterId}${timestamp}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `sha256_${Math.abs(hash).toString(16)}`;
}

// Format currency
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Calculate days remaining
export function getDaysRemaining(endDate: string): number {
  const end = new Date(endDate);
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

// Format date range
export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  return `${start.toLocaleDateString(
    "en-US",
    options
  )} - ${end.toLocaleDateString("en-US", options)}`;
}

// ============================
// ROLE-BASED PERMISSION CHECKS
// ============================

export interface UserPermissions {
  canCreateHunts: boolean;
  canManageHunts: boolean;
  canReviewApplications: boolean;
  canSendInvitations: boolean;
  canManageSubscriptions: boolean;
  canViewRecommendations: boolean;
  canApplyToHunts: boolean;
  canViewOwnApplications: boolean;
  canBrowseHunts: boolean;
  isCompany: boolean;
  isHunter: boolean;
  isAdmin: boolean;
}

export function getUserPermissions(
  role: "user" | "admin",
  userType: "company" | "hunter"
): UserPermissions {
  const isAdmin = role === "admin";
  // Treat system admins as company-equivalent for permissions
  const isCompany = userType === "company" || isAdmin;
  // Admins should not be treated as hunters even if userType === 'hunter'
  const isHunter = userType === "hunter" && !isAdmin;

  return {
    // Company permissions (admins get company permissions)
    canCreateHunts: isCompany,
    canManageHunts: isCompany,
    canReviewApplications: isCompany,
    canSendInvitations: isCompany,
    canManageSubscriptions: isCompany,
    canViewRecommendations: isCompany,

    // Hunter permissions (admins are excluded)
    canApplyToHunts: isHunter,
    canViewOwnApplications: isHunter,

    // Shared permissions
    canBrowseHunts: true, // Everyone can browse

    // Role flags
    isCompany,
    isHunter,
    isAdmin,
  };
}

// Check if user can access Pro features
export function canAccessProFeatures(
  role: "user" | "admin",
  userType: "company" | "hunter",
  hasSubscription: boolean = false
): boolean {
  // Admins always have access
  if (role === "admin") return true;

  // Companies need subscription
  if (userType === "company") return hasSubscription;

  // Hunters need to meet eligibility (checked separately)
  return true;
}

// Get user type display name
export function getUserTypeDisplay(userType: "company" | "hunter"): string {
  return userType === "company" ? "Company" : "Hunter";
}

// Get role badge color
export function getRoleBadgeColor(role: "user" | "admin"): string {
  return role === "admin" ? "bg-purple-600" : "bg-blue-600";
}

// Get user type badge color
export function getUserTypeBadgeColor(userType: "company" | "hunter"): string {
  return userType === "company" ? "bg-amber-600" : "bg-green-600";
}

export function mapDocToProInvitation(doc: ProInvitationDoc): ProInvitation {
  return {
    id: doc._id,
    huntId: doc.hunt_id,
    huntTitle: doc.hunt_title || "Pro Bug Hunt",
    companyName: doc.company_name || "Security Partner",
    hunterId: doc.hunter_id,
    hunterName: doc.hunter_name || doc.hunter_username || "Researcher",
    hunterUsername: doc.hunter_username,
    email: doc.recipient_email,
    token: doc.token,
    invitedBy: doc.invited_by || doc.sender_id || "Platform",
    status: doc.status,
    invitedAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    expiresAt: doc.expires_at ? new Date(doc.expires_at).toISOString() : new Date().toISOString(),
    acceptedAt: doc.responded_at ? new Date(doc.responded_at).toISOString() : undefined,
  };
}

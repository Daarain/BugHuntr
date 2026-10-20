/**
 * BugHuntr Internal Scoring System
 *
 * BugHuntr uses an internal severity score that multiplies the CVSS base score
 * with organization and asset-specific factors to determine reward tiers and
 * auto-rejection thresholds.
 *
 * Formula:
 * BugHuntrScore = clamp(CVSS_base * EM * BIM * CF, 0, 10)
 */

export interface BugHuntrScoringFactors {
  exploitabilityModifier?: number; // default: 1.0
  businessImpactMultiplier?: number; // default: 1.0
  confidenceFactor?: number; // default: 0.85
}

export interface BugHuntrScoreBreakdown {
  score: number; // Final clamped score (0.0 - 10.0)
  cvssBase: number;
  exploitabilityModifier: number;
  businessImpactMultiplier: number;
  confidenceFactor: number;
  version: string;
}

export interface RewardTierConfig {
  minScore: number;
  maxScore: number;
  rewardMultiplier: number;
  tierName: string;
  description: string;
}

export interface OrgPayoutPolicy {
  minScoreToPay: number;
  rewardMultiplierTable: RewardTierConfig[];
  baseRewardPerSubmission?: number;
}

/**
 * Compute the BugHuntr internal severity score
 */
export function computeBugHuntrScore(
  cvssBase: number,
  factors: BugHuntrScoringFactors = {}
): BugHuntrScoreBreakdown {
  const em = factors.exploitabilityModifier ?? 1.0;
  const bim = factors.businessImpactMultiplier ?? 1.0;
  const cf = factors.confidenceFactor ?? 0.85;

  if (cvssBase < 0 || cvssBase > 10) {
    throw new Error("CVSS base score must be between 0 and 10");
  }
  if (em < 0.5 || em > 2.0) {
    throw new Error("Exploitability modifier must be between 0.5 and 2.0");
  }
  if (bim < 0.5 || bim > 2.0) {
    throw new Error("Business impact multiplier must be between 0.5 and 2.0");
  }
  if (cf < 0.7 || cf > 1.0) {
    throw new Error("Confidence factor must be between 0.7 and 1.0");
  }

  const rawScore = cvssBase * em * bim * cf;
  const clampedScore = Math.max(0, Math.min(10, rawScore));
  const finalScore = Math.round(clampedScore * 10) / 10;

  return {
    score: finalScore,
    cvssBase,
    exploitabilityModifier: em,
    businessImpactMultiplier: bim,
    confidenceFactor: cf,
    version: "BH-v1.0",
  };
}

/**
 * Derive default scoring factors based on organization and asset type
 */
export function getDefaultScoringFactorsForAsset(
  assetType: string,
  orgAssetImportanceMap?: Record<string, number>
): BugHuntrScoringFactors {
  const bimMap = orgAssetImportanceMap || {
    payment_system: 2.0,
    authentication: 1.8,
    admin_panel: 1.6,
    api_endpoint: 1.4,
    user_data: 1.3,
    web_app: 1.2,
    internal_system: 1.0,
    public_api: 1.1,
    documentation: 0.8,
    staging: 0.5,
  };

  const bim = bimMap[assetType] ?? 1.0;

  return {
    exploitabilityModifier: 1.0,
    businessImpactMultiplier: bim,
    confidenceFactor: 0.85,
  };
}

/**
 * Increase exploitability modifier if a public or known exploit exists
 */
export function adjustForExploitability(
  baseFactors: BugHuntrScoringFactors,
  hasPublicPoC: boolean = false,
  isKnownVulnerability: boolean = false
): BugHuntrScoringFactors {
  let em = baseFactors.exploitabilityModifier ?? 1.0;

  if (isKnownVulnerability) {
    em = Math.min(1.2, em + 0.1);
  }
  if (hasPublicPoC) {
    em = Math.min(1.2, em + 0.1);
  }

  return {
    ...baseFactors,
    exploitabilityModifier: em,
  };
}

/**
 * Adjust confidence factor based on PoC quality
 */
export function adjustForProofOfConcept(
  baseFactors: BugHuntrScoringFactors,
  pocType?: string
): BugHuntrScoringFactors {
  let cf = baseFactors.confidenceFactor ?? 0.85;

  if (pocType === "full_working_exploit") {
    cf = 1.0;
  } else if (pocType === "partial_poc") {
    cf = 0.9;
  } else if (pocType === "theoretical") {
    cf = 0.7;
  } else {
    cf = 0.85;
  }

  return {
    ...baseFactors,
    confidenceFactor: cf,
  };
}

export const DEFAULT_REWARD_TIER_TABLE: RewardTierConfig[] = [
  {
    minScore: 9.0,
    maxScore: 10.0,
    rewardMultiplier: 2.0,
    tierName: "CRITICAL",
    description: "Critical severity - immediate payout, public disclosure priority",
  },
  {
    minScore: 7.0,
    maxScore: 8.99,
    rewardMultiplier: 1.5,
    tierName: "HIGH",
    description: "High severity - elevated reward",
  },
  {
    minScore: 4.0,
    maxScore: 6.99,
    rewardMultiplier: 1.0,
    tierName: "MEDIUM",
    description: "Medium severity - standard reward",
  },
  {
    minScore: 0.1,
    maxScore: 3.99,
    rewardMultiplier: 0.25,
    tierName: "LOW",
    description: "Low severity - reduced reward (often auto-rejected by policy)",
  },
  {
    minScore: 0,
    maxScore: 0,
    rewardMultiplier: 0,
    tierName: "NONE",
    description: "No impact - no reward",
  },
];

export function mapScoreToRewardTier(
  bughuntrScore: number,
  rewardTable: RewardTierConfig[] = DEFAULT_REWARD_TIER_TABLE
): RewardTierConfig | null {
  const sorted = [...rewardTable].sort((a, b) => b.minScore - a.minScore);
  for (const tier of sorted) {
    if (bughuntrScore >= tier.minScore && bughuntrScore <= tier.maxScore) {
      return tier;
    }
  }
  return null;
}

export function computeRewardAmount(
  bughuntrScore: number,
  policy: OrgPayoutPolicy
): { rewardCents: number; tier: RewardTierConfig } | null {
  if (bughuntrScore < policy.minScoreToPay) {
    return null;
  }

  const tier = mapScoreToRewardTier(
    bughuntrScore,
    policy.rewardMultiplierTable
  );
  if (!tier) {
    return null;
  }

  const baseReward = policy.baseRewardPerSubmission ?? 10000;
  const rewardCents = Math.round(baseReward * tier.rewardMultiplier);

  return { rewardCents, tier };
}

export function explainScore(breakdown: BugHuntrScoreBreakdown): string {
  const lines: string[] = [
    `BugHuntr Severity Score: ${breakdown.score} / 10.0`,
    ``,
    `Calculation:`,
    `  CVSS Base Score:              ${breakdown.cvssBase}`,
    `  × Exploitability Modifier:    ${breakdown.exploitabilityModifier} (PoC status)`,
    `  × Business Impact Multiplier: ${breakdown.businessImpactMultiplier} (asset importance)`,
    `  × Confidence Factor:          ${breakdown.confidenceFactor} (proof quality)`,
    `  ─────────────────────────────────────────────`,
    `  = Final Score (clamped):      ${breakdown.score}`,
    ``,
    `Version: ${breakdown.version}`,
  ];

  return lines.join("\n");
}

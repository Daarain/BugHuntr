/**
 * CVSS v3.1 Engine
 *
 * This module implements CVSS v3.1 base score calculation as per NIST standard.
 * Reference: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-113.pdf
 *
 * CVSS Vector Format: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
 *
 * Metrics:
 * - AV (Attack Vector): N=Network, A=Adjacent, L=Local, P=Physical
 * - AC (Attack Complexity): L=Low, H=High
 * - PR (Privileges Required): N=None, L=Low, H=High
 * - UI (User Interaction): N=None, R=Required
 * - S (Scope): U=Unchanged, C=Changed
 * - C (Confidentiality): H=High, L=Low, N=None
 * - I (Integrity): H=High, L=Low, N=None
 * - A (Availability): H=High, L=Low, N=None
 */

export interface CvssVector {
  AV: "N" | "A" | "L" | "P";
  AC: "L" | "H";
  PR: "N" | "L" | "H";
  UI: "N" | "R";
  S: "U" | "C";
  C: "H" | "L" | "N";
  I: "H" | "L" | "N";
  A: "H" | "L" | "N";
}

interface CvssScoring {
  baseScore: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
}

/**
 * Parse a CVSS v3.1 vector string into structured metrics
 * Example: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
 */
export function parseVectorString(vectorString: string): CvssVector | null {
  try {
    // Remove "CVSS:3.1/" prefix if present
    let vector = vectorString;
    if (vector.startsWith("CVSS:3.1/")) {
      vector = vector.substring("CVSS:3.1/".length);
    }

    const metrics = vector.split("/");
    const parsed: Partial<CvssVector> = {};

    for (const metric of metrics) {
      const [key, value] = metric.split(":");
      if (key && value) {
        (parsed as any)[key] = value;
      }
    }

    // Validate all required metrics are present
    const requiredKeys: (keyof CvssVector)[] = [
      "AV",
      "AC",
      "PR",
      "UI",
      "S",
      "C",
      "I",
      "A",
    ];
    for (const key of requiredKeys) {
      if (!parsed[key]) {
        console.error(`Missing required metric: ${key}`);
        return null;
      }
    }

    return parsed as CvssVector;
  } catch (e) {
    console.error("Failed to parse CVSS vector:", e);
    return null;
  }
}

/**
 * Convert structured vector back to string format
 */
export function vectorToString(vector: CvssVector): string {
  return `CVSS:3.1/AV:${vector.AV}/AC:${vector.AC}/PR:${vector.PR}/UI:${vector.UI}/S:${vector.S}/C:${vector.C}/I:${vector.I}/A:${vector.A}`;
}

/**
 * Compute Attack Vector score component (AV metric)
 * Returns: N=0.85, A=0.62, L=0.55, P=0.2
 */
function scoreAttackVector(av: string): number {
  const scores: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  return scores[av] || 0;
}

/**
 * Compute Attack Complexity score component (AC metric)
 * Returns: L=0.77, H=0.44
 */
function scoreAttackComplexity(ac: string): number {
  return ac === "L" ? 0.77 : 0.44;
}

/**
 * Compute Privileges Required score component (PR metric)
 * Depends on Scope: if Scope=Unchanged: N=0.85, L=0.62, H=0.27
 *                   if Scope=Changed: N=0.85, L=0.68, H=0.5
 */
function scorePrivilegesRequired(pr: string, scopeChanged: boolean): number {
  if (!scopeChanged) {
    const scores: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
    return scores[pr] || 0;
  } else {
    const scores: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
    return scores[pr] || 0;
  }
}

/**
 * Compute User Interaction score component (UI metric)
 * Returns: N=0.85, R=0.62
 */
function scoreUserInteraction(ui: string): number {
  return ui === "N" ? 0.85 : 0.62;
}

/**
 * Compute impact scores for C, I, A metrics
 * Used to determine scope impact multiplier
 */
function scoreImpactMetric(metric: string): number {
  // N (None) = 0, L (Low) = 0.22, H (High) = 0.56
  const scores: Record<string, number> = { N: 0, L: 0.22, H: 0.56 };
  return scores[metric] || 0;
}

/**
 * Calculate the CVSS v3.1 base score (0.0 - 10.0)
 * Formula from NIST: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-113.pdf
 */
export function computeBaseScore(vectorString: string): CvssScoring | null {
  const vector = parseVectorString(vectorString);
  if (!vector) {
    return null;
  }

  try {
    const scopeChanged = vector.S === "C";

    // Step 1: Calculate AV, AC, PR, UI (Attack Vector Component)
    const av = scoreAttackVector(vector.AV);
    const ac = scoreAttackComplexity(vector.AC);
    const pr = scorePrivilegesRequired(vector.PR, scopeChanged);
    const ui = scoreUserInteraction(vector.UI);

    // Step 2: Calculate Impact Sub-Score (ISS)
    const c = scoreImpactMetric(vector.C);
    const i = scoreImpactMetric(vector.I);
    const a = scoreImpactMetric(vector.A);

    const iss = 1 - (1 - c) * (1 - i) * (1 - a);

    // Step 3: Calculate Impact (depends on Scope)
    let impact: number;
    if (!scopeChanged) {
      impact = 6.42 * iss;
    } else {
      impact = 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
    }

    // Step 4: If Impact <= 0, base score is 0
    if (impact <= 0) {
      return { baseScore: 0.0, severity: "NONE" };
    }

    // Step 5: Calculate Exploitability
    const exploitability = 8.22 * av * ac * pr * ui;

    // Step 6: Calculate Base Score
    let baseScore: number;
    if (!scopeChanged) {
      baseScore = Math.min(10, impact + exploitability);
    } else {
      baseScore = Math.min(10, 1.08 * (impact + exploitability));
    }

    // Round to 1 decimal place (FIRST.org roundup)
    baseScore = Math.ceil(Number(baseScore.toFixed(5)) * 10) / 10;

    // Determine severity rating
    let severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
    if (baseScore >= 9.0) severity = "CRITICAL";
    else if (baseScore >= 7.0) severity = "HIGH";
    else if (baseScore >= 4.0) severity = "MEDIUM";
    else if (baseScore > 0) severity = "LOW";
    else severity = "NONE";

    return { baseScore, severity };
  } catch (e) {
    console.error("Error computing base score:", e);
    return null;
  }
}

/**
 * Auto-suggest a CVSS v3.1 vector based on submission metadata
 * This is a heuristic approach for common vulnerability patterns
 *
 * Input factors:
 * - vulnerabilityType: RCE, SQLi, CSRF, XSS, etc.
 * - authenticatedRequired: boolean
 * - userInteractionRequired: boolean
 * - hasPublicPoC: boolean
 * - affectedAssetType: 'api_endpoint', 'web_app', 'internal_system', etc.
 *
 * TODO: This heuristic may need tuning based on empirical data from your organization
 */
export interface SubmissionMetadata {
  vulnerabilityType?: string;
  authenticatedRequired?: boolean;
  userInteractionRequired?: boolean;
  hasPublicPoC?: boolean;
  affectedAssetType?: string;
  impactedSystems?: string[]; // e.g., ['authentication', 'data_access']
}

export function suggestVectorFromSubmission(
  metadata: SubmissionMetadata
): CvssVector {
  const vuln = metadata.vulnerabilityType?.toUpperCase() || "";
  const needsAuth = metadata.authenticatedRequired || false;
  const needsUI = metadata.userInteractionRequired || false;
  const assetType = metadata.affectedAssetType || "web_app";
  // TODO: Use metadata.impactedSystems for more granular impact scoring

  // Base vector (conservative defaults)
  let vector: CvssVector = {
    AV: "N", // Assume network accessible
    AC: "L", // Assume low complexity
    PR: needsAuth ? "L" : "N",
    UI: needsUI ? "R" : "N",
    S: "U", // Default to unchanged scope
    C: "N",
    I: "N",
    A: "N",
  };

  // RCE / Code Execution: High impact across C, I, A
  if (
    vuln.includes("RCE") ||
    vuln.includes("EXEC") ||
    vuln.includes("INJECTION")
  ) {
    vector.C = "H";
    vector.I = "H";
    vector.A = "H";
    vector.S = "C"; // Usually changed scope
  }
  // SQL Injection: Confidentiality & Integrity (data access & modification)
  else if (vuln.includes("SQL")) {
    vector.C = "H";
    vector.I = "H";
    vector.A = "L";
    if (needsAuth) vector.PR = "L";
  }
  // XSS: Confidentiality & Integrity (user impersonation, data theft)
  else if (vuln.includes("XSS") || vuln.includes("CROSS")) {
    vector.C = "H";
    vector.I = "H";
    vector.A = "N";
  }
  // CSRF: Integrity (unauthorized actions on behalf of user)
  else if (vuln.includes("CSRF") || vuln.includes("FORGERY")) {
    vector.C = "N";
    vector.I = "H";
    vector.A = "N";
    vector.UI = "R"; // User interaction required
  }
  // Authentication bypass: High confidentiality, integrity, availability
  else if (vuln.includes("AUTH") || vuln.includes("BYPASS")) {
    vector.AV = "N";
    vector.AC = "L";
    vector.PR = "N";
    vector.UI = "N";
    vector.C = "H";
    vector.I = "H";
    vector.A = "H";
  }
  // Privilege escalation: Integrity at least
  else if (vuln.includes("PRIV") || vuln.includes("ESCALATION")) {
    vector.I = "H";
    vector.C = "H";
    if (!needsAuth) vector.PR = "L";
  }
  // Path traversal / Directory listing: Confidentiality
  else if (
    vuln.includes("PATH") ||
    vuln.includes("TRAVERSAL") ||
    vuln.includes("DIR")
  ) {
    vector.C = "H";
    vector.I = "L";
    vector.A = "N";
  }
  // DoS: Availability impact
  else if (vuln.includes("DOS") || vuln.includes("DENIAL")) {
    vector.A = "H";
    vector.C = "N";
    vector.I = "N";
  }
  // Information Disclosure: Confidentiality
  else if (vuln.includes("DISCLOSURE") || vuln.includes("LEAK")) {
    vector.C = "H";
    vector.I = "N";
    vector.A = "N";
  }

  // Adjust based on asset type
  if (assetType === "internal_system" || assetType === "admin_panel") {
    vector.AV = "A"; // Adjacent network (internal)
  } else if (assetType === "api_endpoint") {
    vector.AV = "N"; // Network
  }

  return vector;
}

/**
 * Validate a CVSS vector string format
 * Returns: { valid: boolean, error?: string }
 */
export function validateVectorString(vectorString: string): {
  valid: boolean;
  error?: string;
} {
  const vector = parseVectorString(vectorString);
  if (!vector) {
    return {
      valid: false,
      error: "Invalid CVSS vector format. Expected CVSS:3.1/AV:X/AC:X/...",
    };
  }

  // Validate each metric value
  const validValues: Record<string, string[]> = {
    AV: ["N", "A", "L", "P"],
    AC: ["L", "H"],
    PR: ["N", "L", "H"],
    UI: ["N", "R"],
    S: ["U", "C"],
    C: ["N", "L", "H"],
    I: ["N", "L", "H"],
    A: ["N", "L", "H"],
  };

  for (const [key, allowedValues] of Object.entries(validValues)) {
    const value = (vector as any)[key];
    if (!value || !allowedValues.includes(value)) {
      return { valid: false, error: `Invalid value for ${key}: ${value}` };
    }
  }

  return { valid: true };
}

/**
 * Get human-readable description of a CVSS vector
 */
export function describeVector(vectorString: string): string {
  const vector = parseVectorString(vectorString);
  if (!vector) return "Invalid vector";

  const descriptions: Record<string, Record<string, string>> = {
    AV: { N: "Network", A: "Adjacent", L: "Local", P: "Physical" },
    AC: { L: "Low", H: "High" },
    PR: { N: "None", L: "Low", H: "High" },
    UI: { N: "None", R: "Required" },
    S: { U: "Unchanged", C: "Changed" },
    C: { N: "None", L: "Low", H: "High" },
    I: { N: "None", L: "Low", H: "High" },
    A: { N: "None", L: "Low", H: "High" },
  };

  const parts: string[] = [];
  for (const [key, value] of Object.entries(vector)) {
    const desc = descriptions[key]?.[value] || value;
    parts.push(`${key}:${desc}`);
  }

  return parts.join(" / ");
}

/**
 * CVSS v3.1 Engine
 *
 * Implements CVSS v3.1 base score calculation as per NIST standard.
 * Reference: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-113.pdf
 *
 * CVSS Vector Format: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
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

export interface CvssScoring {
  baseScore: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
}

/**
 * Parse a CVSS v3.1 vector string into structured metrics
 * Example: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
 */
export function parseVectorString(vectorString: string): CvssVector | null {
  try {
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
        return null;
      }
    }

    return parsed as CvssVector;
  } catch (e) {
    return null;
  }
}

/**
 * Convert structured vector back to string format
 */
export function vectorToString(vector: CvssVector): string {
  return `CVSS:3.1/AV:${vector.AV}/AC:${vector.AC}/PR:${vector.PR}/UI:${vector.UI}/S:${vector.S}/C:${vector.C}/I:${vector.I}/A:${vector.A}`;
}

function scoreAttackVector(av: string): number {
  const scores: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  return scores[av] || 0;
}

function scoreAttackComplexity(ac: string): number {
  return ac === "L" ? 0.77 : 0.44;
}

function scorePrivilegesRequired(pr: string, scopeChanged: boolean): number {
  if (!scopeChanged) {
    const scores: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
    return scores[pr] || 0;
  } else {
    const scores: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
    return scores[pr] || 0;
  }
}

function scoreUserInteraction(ui: string): number {
  return ui === "N" ? 0.85 : 0.62;
}

function scoreImpactMetric(metric: string): number {
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

    const av = scoreAttackVector(vector.AV);
    const ac = scoreAttackComplexity(vector.AC);
    const pr = scorePrivilegesRequired(vector.PR, scopeChanged);
    const ui = scoreUserInteraction(vector.UI);

    const c = scoreImpactMetric(vector.C);
    const i = scoreImpactMetric(vector.I);
    const a = scoreImpactMetric(vector.A);

    const iss = 1 - (1 - c) * (1 - i) * (1 - a);

    let impact: number;
    if (!scopeChanged) {
      impact = 6.42 * iss;
    } else {
      impact = 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
    }

    if (impact <= 0) {
      return { baseScore: 0.0, severity: "NONE" };
    }

    const exploitability = 8.22 * av * ac * pr * ui;

    let baseScore: number;
    if (!scopeChanged) {
      baseScore = Math.min(10, impact + exploitability);
    } else {
      baseScore = Math.min(10, 1.08 * (impact + exploitability));
    }

    baseScore = Math.ceil(Number(baseScore.toFixed(5)) * 10) / 10;

    let severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
    if (baseScore >= 9.0) severity = "CRITICAL";
    else if (baseScore >= 7.0) severity = "HIGH";
    else if (baseScore >= 4.0) severity = "MEDIUM";
    else if (baseScore > 0) severity = "LOW";
    else severity = "NONE";

    return { baseScore, severity };
  } catch (e) {
    return null;
  }
}

export interface SubmissionMetadata {
  vulnerabilityType?: string;
  authenticatedRequired?: boolean;
  userInteractionRequired?: boolean;
  hasPublicPoC?: boolean;
  affectedAssetType?: string;
  impactedSystems?: string[];
}

export function suggestVectorFromSubmission(
  metadata: SubmissionMetadata
): CvssVector {
  const vuln = metadata.vulnerabilityType?.toUpperCase() || "";
  const needsAuth = metadata.authenticatedRequired || false;
  const needsUI = metadata.userInteractionRequired || false;
  const assetType = metadata.affectedAssetType || "web_app";

  let vector: CvssVector = {
    AV: "N",
    AC: "L",
    PR: needsAuth ? "L" : "N",
    UI: needsUI ? "R" : "N",
    S: "U",
    C: "N",
    I: "N",
    A: "N",
  };

  if (
    vuln.includes("RCE") ||
    vuln.includes("EXEC") ||
    vuln.includes("INJECTION")
  ) {
    vector.C = "H";
    vector.I = "H";
    vector.A = "H";
    vector.S = "C";
  } else if (vuln.includes("SQL")) {
    vector.C = "H";
    vector.I = "H";
    vector.A = "L";
    if (needsAuth) vector.PR = "L";
  } else if (vuln.includes("XSS") || vuln.includes("CROSS")) {
    vector.C = "H";
    vector.I = "H";
    vector.A = "N";
  } else if (vuln.includes("CSRF") || vuln.includes("FORGERY")) {
    vector.C = "N";
    vector.I = "H";
    vector.A = "N";
    vector.UI = "R";
  } else if (vuln.includes("AUTH") || vuln.includes("BYPASS")) {
    vector.AV = "N";
    vector.AC = "L";
    vector.PR = "N";
    vector.UI = "N";
    vector.C = "H";
    vector.I = "H";
    vector.A = "H";
  } else if (vuln.includes("PRIV") || vuln.includes("ESCALATION")) {
    vector.I = "H";
    vector.C = "H";
    if (!needsAuth) vector.PR = "L";
  } else if (
    vuln.includes("PATH") ||
    vuln.includes("TRAVERSAL") ||
    vuln.includes("DIR")
  ) {
    vector.C = "H";
    vector.I = "L";
    vector.A = "N";
  } else if (vuln.includes("DOS") || vuln.includes("DENIAL")) {
    vector.A = "H";
    vector.C = "N";
    vector.I = "N";
  } else if (vuln.includes("DISCLOSURE") || vuln.includes("LEAK")) {
    vector.C = "H";
    vector.I = "N";
    vector.A = "N";
  }

  if (assetType === "internal_system" || assetType === "admin_panel") {
    vector.AV = "A";
  } else if (assetType === "api_endpoint") {
    vector.AV = "N";
  }

  return vector;
}

export function validateVectorString(vectorString: string): {
  valid: boolean;
  error?: string;
} {
  const vector = parseVectorString(vectorString);
  if (!vector) {
    return {
      valid: false,
      error: 'Invalid CVSS vector format. Expected "CVSS:3.1/AV:X/AC:X/..."',
    };
  }

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

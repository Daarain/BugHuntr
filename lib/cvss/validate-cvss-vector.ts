/**
 * CVSS Vector Validation Utilities
 */

import {
  validateVectorString,
  parseVectorString,
  CvssVector,
} from "./cvss-engine";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: {
    vector?: CvssVector;
    message?: string;
  };
}

export function validateCvssVector(vectorString: string): ValidationResult {
  if (!vectorString || vectorString.trim().length === 0) {
    return {
      valid: false,
      error: "CVSS vector cannot be empty",
    };
  }

  if (!vectorString.includes("/")) {
    return {
      valid: false,
      error: 'Invalid CVSS format. Expected "CVSS:3.1/AV:X/AC:X/..."',
    };
  }

  const result = validateVectorString(vectorString);
  if (!result.valid) {
    return {
      valid: false,
      error: result.error || "Validation failed",
    };
  }

  const vector = parseVectorString(vectorString);
  if (!vector) {
    return {
      valid: false,
      error: "Could not parse CVSS vector",
    };
  }

  return {
    valid: true,
    details: {
      vector,
      message: "CVSS vector is valid and well-formed",
    },
  };
}

export function isSignificantChange(
  oldVector: CvssVector,
  newVector: CvssVector
): boolean {
  const significantMetrics: (keyof CvssVector)[] = ["C", "I", "A", "AV"];
  for (const metric of significantMetrics) {
    if (oldVector[metric] !== newVector[metric]) {
      return true;
    }
  }
  return false;
}

export interface VectorDiff {
  metric: string;
  oldValue: string;
  newValue: string;
  description: string;
}

export function diffVectors(
  oldVector: CvssVector,
  newVector: CvssVector
): VectorDiff[] {
  const diffs: VectorDiff[] = [];
  const metricDescriptions: Record<string, Record<string, string>> = {
    AV: {
      N: "Network (accessible remotely)",
      A: "Adjacent Network (local network)",
      L: "Local (local system access)",
      P: "Physical (physical access required)",
    },
    AC: {
      L: "Low (easily exploitable)",
      H: "High (hard to exploit)",
    },
    PR: {
      N: "None (no privileges required)",
      L: "Low (low privileges required)",
      H: "High (high privileges required)",
    },
    UI: {
      N: "None (no user interaction)",
      R: "Required (user interaction required)",
    },
    S: {
      U: "Unchanged (no scope change)",
      C: "Changed (scope changes)",
    },
    C: {
      N: "None (no confidentiality impact)",
      L: "Low (partial info leak)",
      H: "High (complete info leak)",
    },
    I: {
      N: "None (no integrity impact)",
      L: "Low (limited modification)",
      H: "High (complete modification)",
    },
    A: {
      N: "None (no availability impact)",
      L: "Low (partial unavailability)",
      H: "High (complete unavailability)",
    },
  };

  for (const metric of Object.keys(newVector)) {
    const key = metric as keyof CvssVector;
    const oldValue = (oldVector as any)[key] as string;
    const newVal = (newVector as any)[key] as string;
    if (oldValue !== newVal) {
      diffs.push({
        metric,
        oldValue,
        newValue: newVal,
        description: `${metric}: ${
          metricDescriptions[metric]?.[oldValue] || oldValue
        } → ${metricDescriptions[metric]?.[newVal] || newVal}`,
      });
    }
  }

  return diffs;
}

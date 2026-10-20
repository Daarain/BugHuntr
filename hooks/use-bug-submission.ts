"use client"

import React, { useState, useCallback } from "react"
import { useEffect } from "react"
import type { BugSubmission } from "@/types/bug-submission"

// Mock data for submissions (in a real app, this would come from an API)
const mockSubmissions: BugSubmission[] = [
  {
    id: "sub-001",
    huntId: "hunt-001",
    huntTitle: "TechCorp Web Application Security Assessment",
    title: "SQL Injection in User Profile Update",
    severity: "critical",
    description:
      "Found SQL injection vulnerability in the user profile update functionality that allows unauthorized database access.",
    stepsToReproduce:
      "1. Navigate to profile settings\n2. Intercept update request\n3. Inject malicious SQL payload\n4. Observe database response",
    impact: "Complete database compromise, user data exposure, potential system takeover",
    proofOfConcept: "Attached screenshots and payload examples demonstrating successful injection",
    attachments: ["screenshot1.png", "payload.txt"],
    submittedBy: "researcher123",
    submittedAt: "2024-01-15T10:30:00Z",
    status: "pending",
  },
  {
    id: "sub-002",
    huntId: "hunt-001",
    huntTitle: "TechCorp Web Application Security Assessment",
    title: "XSS Vulnerability in Comment System",
    severity: "high",
    description: "Stored XSS vulnerability in the comment system allows execution of malicious scripts.",
    stepsToReproduce:
      "1. Post comment with XSS payload\n2. View comment on public page\n3. Script executes in victim's browser",
    impact: "Session hijacking, credential theft, malicious redirects",
    proofOfConcept: "Video demonstration of successful XSS execution",
    attachments: ["xss-demo.mp4"],
    submittedBy: "securitypro",
    submittedAt: "2024-01-14T15:45:00Z",
    status: "under-review",
    adminNotes: "Reviewing impact assessment and reproduction steps",
    reviewedBy: "admin1",
  },
  {
    id: "sub-003",
    huntId: "hunt-002",
    huntTitle: "StartupXYZ API Security Challenge",
    title: "Authentication Bypass in API Endpoint",
    severity: "high",
    description: "API endpoint allows unauthorized access by manipulating JWT tokens.",
    stepsToReproduce:
      "1. Obtain valid JWT token\n2. Modify token payload\n3. Access restricted endpoints\n4. Bypass authentication",
    impact: "Unauthorized access to sensitive user data and admin functions",
    attachments: ["jwt-analysis.pdf"],
    submittedBy: "apihacker",
    submittedAt: "2024-01-13T09:20:00Z",
    status: "approved",
    adminNotes: "Excellent find! Awarded full points for critical security issue.",
    pointsAwarded: 1500,
    reviewedBy: "admin2",
    reviewedAt: "2024-01-14T11:00:00Z",
  },
]


export function useBugSubmission() {
  // Only keep mockSubmissions for fallback/testing
  const [submissions, setSubmissions] = useState<BugSubmission[]>(mockSubmissions);

  const submitBugReport = useCallback((huntId: string, submissionData: Partial<BugSubmission>) => {
    const newSubmission: BugSubmission = {
      id: `sub-${Date.now()}`,
      huntId,
      huntTitle: submissionData.huntTitle || "Unknown Hunt",
      title: submissionData.title || "",
      severity: submissionData.severity || "medium",
      description: submissionData.description || "",
      stepsToReproduce: submissionData.stepsToReproduce || "",
      impact: submissionData.impact || "",
      proofOfConcept: submissionData.proofOfConcept,
      attachments: submissionData.attachments || [],
      submittedBy: submissionData.submittedBy || "anonymous",
      submittedAt: new Date().toISOString(),
      status: "pending",
    };
    setSubmissions((prev) => {
      const updated = [newSubmission, ...prev];
      if (typeof window !== "undefined") {
        localStorage.setItem("bugSubmissions", JSON.stringify(updated));
      }
      return updated;
    });
    return newSubmission;
  }, []);

  const updateSubmissionStatus = useCallback(
    (
      submissionId: string,
      status: BugSubmission["status"],
      adminNotes?: string,
      pointsAwarded?: number,
      reviewedBy?: string,
    ) => {
      setSubmissions((prev) => {
        const updated = prev.map((submission) => {
          if (submission.id === submissionId) {
            return {
              ...submission,
              status,
              adminNotes,
              pointsAwarded,
              reviewedBy,
              reviewedAt: new Date().toISOString(),
            };
          }
          return submission;
        });
        if (typeof window !== "undefined") {
          localStorage.setItem("bugSubmissions", JSON.stringify(updated));
        }
        return updated;
      });
    },
    [],
  );

  // Fetch submissions for a user from server API (backed by MongoDB)
  const getSubmissionsByUser = useCallback(async (userId: string) => {
    if (!userId) return [];
    try {
      const res = await fetch(`/api/bug-submissions?userId=${encodeURIComponent(userId)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const userSubs: BugSubmission[] = await res.json();
        return userSubs;
      }
      return mockSubmissions.filter((submission) => submission.submittedBy === userId);
    } catch (err) {
      // fallback to mockSubmissions if error
      return mockSubmissions.filter((submission) => submission.submittedBy === userId);
    }
  }, []);

  const getSubmissionsByHunt = useCallback(
    (huntId: string) => {
      return submissions.filter((submission) => submission.huntId === huntId)
    },
    [submissions],
  )

  const getSubmissionStats = useCallback(() => {
    return {
      total: submissions.length,
      pending: submissions.filter((s) => s.status === "pending").length,
      underReview: submissions.filter((s) => s.status === "under-review").length,
      approved: submissions.filter((s) => s.status === "approved").length,
      rejected: submissions.filter((s) => s.status === "rejected").length,
    }
  }, [submissions])

  return {
    submissions,
    submitBugReport,
    updateSubmissionStatus,
    getSubmissionsByUser,
    getSubmissionsByHunt,
    getSubmissionStats,
  }
}

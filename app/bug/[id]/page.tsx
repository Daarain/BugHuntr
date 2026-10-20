"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Eye, Calendar, Shield } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";

interface BugReport {
  id: string;
  title: string;
  severity: string;
  category: string;
  company: string;
  summary: string;
  description?: string;
  status: string;
  submittedAt: string;
  submittedBy: string;
  bounty?: number;
  views?: number;
  proofOfConceptUrl?: string;
}

export default function BugDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const bugId = params?.id as string;

  const [bug, setBug] = useState<BugReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("poc");
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    if (!bugId) return;

    const fetchBug = async () => {
      try {
        const res = await fetch(`/api/bug-submissions/${bugId}`, {
          credentials: "include",
        });

        if (res.status === 403) {
          setAccessDenied(true);
          return;
        }

        if (res.ok) {
          const bugData = await res.json();
          setBug(bugData);
        } else {
          setBug(null);
        }
      } catch (err) {
        console.error("Error fetching bug:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchBug();
  }, [bugId]);

  if (loading) {
    return <div className="p-6 text-center">Loading bug details...</div>;
  }

  if (accessDenied) {
    return (
      <div className="p-6 text-center">
        <div className="max-w-md mx-auto">
          <div className="mb-4">
            <Shield className="h-16 w-16 text-[var(--critical)] mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Access Restricted</h2>
            <p className="text-muted-foreground mb-2">
              {user?.role === "admin" && user?.companyName ? 
                "This bug report is from a different company. You can only access bug reports from your own company." :
                "This bug report access is restricted. Company administrators can only view bugs from their own company, and critical/high severity bugs require admin access."}
            </p>
            <p className="text-sm text-muted-foreground">
              {!user ? "Please log in with a company admin account to view this content." : 
               user.role !== "admin" ? "Contact your company administrator for access to restricted bug reports." :
               !user.companyName ? "Please ensure your company information is properly configured." :
               `You can only view bug reports from ${user.companyName}.`}
            </p>
          </div>
          <Button onClick={() => router.push("/feed")} className="w-full">
            Return to Bug Feed
          </Button>
        </div>
      </div>
    );
  }

  if (!bug) {
    return (
      <div className="p-6 text-center">
        <p className="mb-4">Bug not found.</p>
        <Button onClick={() => router.push("/bug-feed")}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row max-w-7xl mx-auto p-6 gap-6">
      {/* Main Content */}
      <div className="flex-1">
        <Button
          variant="ghost"
          onClick={() => router.push("/feed")}
          className="mb-4 flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Bug Feed
        </Button>

        {/* Header */}
        <Card className="p-6 mb-6 bg-muted/20">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="px-2 py-1 text-xs rounded bg-severity-critical text-white font-bold">
              {bug.severity.toUpperCase()}
            </span>
            <span className="px-2 py-1 text-xs rounded bg-primary/20 text-primary">
              {bug.category}
            </span>
            <span className="px-2 py-1 text-xs rounded bg-secondary/20 text-secondary">
              {bug.company}
            </span>
          </div>

          <h1 className="text-2xl font-bold mb-2">{bug.title}</h1>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>@{bug.submittedBy}</span>
            <span className="flex items-center gap-1">
              <Eye className="w-4 h-4" /> {bug.views}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />{" "}
              {bug.submittedAt
                ? new Date(bug.submittedAt).toLocaleString()
                : "Unknown date"}
            </span>
            {typeof bug.bounty === "number" && bug.bounty > 0 && (
              <span className="text-[var(--low)] font-semibold">
                ${bug.bounty}
              </span>
            )}
          </div>
        </Card>

        {/* Tabs */}
        <div className="flex gap-4 border-b border-muted mb-4">
          {["description", "poc", "timeline", "tags"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 px-2 text-sm font-medium ${
                activeTab === tab
                  ? "border-b-2 border-border text-primary"
                  : "text-muted-foreground"
              }`}
            >
              {tab === "description" && "Description"}
              {tab === "poc" && "Proof of Concept"}
              {tab === "timeline" && "Timeline"}
              {tab === "tags" && "Tags"}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <Card className="p-6">
          {activeTab === "description" && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Description</h2>
              <p className="text-muted-foreground">
                {bug.description || "No detailed description provided."}
              </p>
            </div>
          )}

          {activeTab === "poc" && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Proof of Concept</h2>
              {bug.proofOfConceptUrl ? (
                <div className="space-y-2">
                  {/* Check if it's a base64 image */}
                  {bug.proofOfConceptUrl.startsWith("data:image/") ? (
                    <img
                      src={bug.proofOfConceptUrl}
                      alt="Proof of Concept"
                      className="rounded-lg border mt-2 max-h-[500px] object-contain w-full"
                    />
                  ) : /* Check if it's a base64 video */ bug.proofOfConceptUrl.startsWith(
                      "data:video/"
                    ) ? (
                    <video
                      src={bug.proofOfConceptUrl}
                      controls
                      className="rounded-lg border mt-2 max-h-[500px] w-full"
                    />
                  ) : /* Check if it's a regular image URL */ bug.proofOfConceptUrl.match(
                      /\.(jpeg|jpg|png|gif|webp)$/i
                    ) ? (
                    <img
                      src={bug.proofOfConceptUrl}
                      alt="Proof of Concept"
                      className="rounded-lg border mt-2 max-h-[500px] object-contain w-full"
                    />
                  ) : /* Check if it's a regular video URL */ bug.proofOfConceptUrl.match(
                      /\.(mp4|webm|ogg)$/i
                    ) ? (
                    <video
                      src={bug.proofOfConceptUrl}
                      controls
                      className="rounded-lg border mt-2 max-h-[500px] w-full"
                    />
                  ) : (
                    /* Fallback for other URLs */
                    <a
                      href={bug.proofOfConceptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      View Proof of Concept
                    </a>
                  )}

                  {/* Add debug info */}
                  <p className="text-xs text-muted-foreground mt-2">
                    Proof URL: {bug.proofOfConceptUrl.substring(0, 100)}...
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No proof of concept provided.
                </p>
              )}
            </div>
          )}

          {activeTab === "timeline" && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Timeline</h2>
              <p className="text-muted-foreground">
                Timeline events will be shown here...
              </p>
            </div>
          )}

          {activeTab === "tags" && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Tags</h2>
              <div className="flex gap-2">
                <span className="px-2 py-1 rounded bg-muted text-sm">
                  Authentication
                </span>
                <span className="px-2 py-1 rounded bg-muted text-sm">
                  SQL Injection
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Related Vulnerabilities */}
      <div className="w-full lg:w-80">
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">
            Related Vulnerabilities
          </h3>
          <div className="space-y-3">
            {[
              { title: "XSS Vulnerability in Comment System", bounty: 2500 },
              { title: "Server-Side Request Forgery", bounty: 3000 },
              { title: "Privilege Escalation in Admin Panel", bounty: 3500 },
            ].map((vuln, idx) => (
              <div
                key={idx}
                className="p-3 rounded bg-muted/40 hover:bg-muted/60 cursor-pointer"
              >
                <p className="font-medium">{vuln.title}</p>
                <p className="text-[var(--low)] text-sm">${vuln.bounty}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

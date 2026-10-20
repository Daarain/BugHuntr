"use client";
// Utility function for deterministic date formatting
function formatDate(dateString: string) {
  const date = new Date(dateString);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserStatsCards } from "@/components/dashboard/user-stats-cards";
import { BugStatistics } from "@/components/dashboard/bug-statistics";
import { useAuth } from "@/components/auth/auth-context";
import { useBugHunt } from "@/hooks/use-bug-hunt";
import { useBugSubmission } from "@/hooks/use-bug-submission";
import { useUserHunts } from "@/hooks/use-user-hunts";
import { useEffect, useState, useCallback } from "react";


const getSeverityColor = (severity: string) => {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] text-[var(--critical)] border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)]";
    case "high":
      return "bg-[color:color-mix(in_srgb,var(--high)_12%,transparent)] text-[var(--high)] border-[color:color-mix(in_srgb,var(--high)_25%,transparent)]";
    case "medium":
      return "bg-[color:color-mix(in_srgb,var(--medium)_12%,transparent)] text-[var(--medium)] border-[color:color-mix(in_srgb,var(--medium)_25%,transparent)]";
    case "low":
      return "bg-[var(--accent-soft)] text-primary border-[var(--border-light)]";
    default:
      return "bg-gray-500/10 text-gray-500 border-gray-500/20";
  }
};

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case "accepted":
      return "bg-[color:color-mix(in_srgb,var(--low)_12%,transparent)] text-[var(--low)] border-[color:color-mix(in_srgb,var(--low)_25%,transparent)]";
    case "under review":
      return "bg-[var(--accent-soft)] text-primary border-[var(--border-light)]";
    case "triaging":
      return "bg-[color:color-mix(in_srgb,var(--medium)_12%,transparent)] text-[var(--medium)] border-[color:color-mix(in_srgb,var(--medium)_25%,transparent)]";
    case "rejected":
      return "bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] text-[var(--critical)] border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)]";
    default:
      return "bg-gray-500/10 text-gray-500 border-gray-500/20";
  }
};

const getCertificateStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case "active":
      return "bg-[color:color-mix(in_srgb,var(--low)_12%,transparent)] text-[var(--low)] border-[color:color-mix(in_srgb,var(--low)_25%,transparent)]";
    case "expiring":
      return "bg-[color:color-mix(in_srgb,var(--medium)_12%,transparent)] text-[var(--medium)] border-[color:color-mix(in_srgb,var(--medium)_25%,transparent)]";
    case "expired":
      return "bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] text-[var(--critical)] border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)]";
    default:
      return "bg-gray-500/10 text-gray-500 border-gray-500/20";
  }
};

export default function DashboardPage() {
  const { user } = useAuth();
  const { bugHunts, getSubmissionsByUser: getHuntSubmissionsByUser } =
    useBugHunt();
  const { getSubmissionsByUser: getBugSubmissionsByUser } = useBugSubmission();
  const { joinedHunts } = useUserHunts();
  const [profilePoints, setProfilePoints] = useState<number | null>(null);
  const [pointsLoading, setPointsLoading] = useState(true);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [directSubmissions, setDirectSubmissions] = useState<any[]>([]);
  const [showAllSubmitted, setShowAllSubmitted] = useState(false);
  const [showAllJoined, setShowAllJoined] = useState(false);
  const [showAllReported, setShowAllReported] = useState(false);

  const fetchPoints = useCallback(async () => {
    setPointsLoading(true);
    setPointsError(null);
    try {
      if (user?.username) {
        const res = await fetch(`/api/user/profile?username=${encodeURIComponent(user.username)}`, {
          credentials: "include",
        });
        if (res.ok) {
          const profile = await res.json();
          setProfilePoints((profile as any)?.points ?? 0);
        } else {
          setProfilePoints(null);
        }
      } else {
        setProfilePoints(null);
      }
    } catch (err) {
      setPointsError("Failed to load points");
      setProfilePoints(null);
    } finally {
      setPointsLoading(false);
    }
  }, [user?.username]);

  useEffect(() => {
    fetchPoints();

    // Set up an interval to refresh points every 10 seconds
    const interval = setInterval(() => {
      fetchPoints();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchPoints]);

  useEffect(() => {
    const fetchDirectSubmissions = async () => {
      if (!user?.id) {
        setDirectSubmissions([]);
        return;
      }
      try {
        const res = await fetch("/api/bug-submissions", { credentials: "include" });
        if (res.ok) {
          const submissions = await res.json();
          setDirectSubmissions(submissions);
        } else {
          setDirectSubmissions([]);
        }
      } catch (error) {
        console.error("Failed to load bug submissions:", error);
        setDirectSubmissions([]);
      }
    };

    fetchDirectSubmissions();
  }, [user?.id]);

  // Defensive: if not logged in, show nothing
  if (!user)
    return (
      <div className="p-8 text-center">
        Please log in to view your dashboard.
      </div>
    );

  // Bug hunts joined (from local state)
  const joinedHuntIds = joinedHunts.map((h) => h.huntId);
  const joinedHuntObjs = bugHunts.filter((hunt) =>
    joinedHuntIds.includes(hunt.id),
  );
  const joinedLimit = 4;
  const visibleJoinedHunts = showAllJoined
    ? joinedHuntObjs
    : joinedHuntObjs.slice(0, joinedLimit);

  // Bugs reported (submissions in bugHuntSubmissions by user)
  const huntSubmissions = getHuntSubmissionsByUser(user.id) || [];
  const reportedLimit = 4;
  const visibleHuntSubmissions = showAllReported
    ? huntSubmissions
    : huntSubmissions.slice(0, reportedLimit);

  // Bugs submitted (submissions in bugs collection by user)
  const bugSubmissionsByUser = directSubmissions;
  const submittedLimit = 4;
  const visibleBugSubmissions = showAllSubmitted
    ? bugSubmissionsByUser
    : bugSubmissionsByUser.slice(0, submittedLimit);

  return (
    <div className="min-h-full bg-background">
      <div className="app-page-container py-4 md:py-6 lg:py-8 space-y-6 md:space-y-8">
        {/* Top Numbers Row - Real-time Stats */}
        <UserStatsCards username={user.username || user.id || ""} />

        {/* Bug Statistics Section */}
        <BugStatistics />

        {/* Three Sections */}
        <div className="grid grid-cols-1 gap-4 md:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Bug Hunts Joined */}
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🎯</span>
                Bug Hunts Joined
              </CardTitle>
              <CardDescription>
                All bug bounty programs you have joined
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {joinedHuntObjs.length === 0 && (
                  <li className="text-muted-foreground">
                    No bug hunts joined yet.
                  </li>
                )}
                {visibleJoinedHunts.map((hunt) => (
                  <li key={hunt.id} className="text-sm py-1 px-2 rounded hover:bg-[var(--accent-soft)] transition-colors">
                    {hunt.title}
                  </li>
                ))}
              </ul>
              {joinedHuntObjs.length > joinedLimit && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-3 h-auto px-0 text-sm font-medium text-primary hover:text-primary"
                  onClick={() => setShowAllJoined((prev) => !prev)}
                >
                  {showAllJoined ? "Show less" : "See full list"}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Bugs Reported */}
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🐛</span>
                Bugs Reported
              </CardTitle>
              <CardDescription>
                Bugs you have reported in all hunts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {huntSubmissions.length === 0 && (
                  <li className="text-muted-foreground">
                    No bugs reported yet.
                  </li>
                )}
                {visibleHuntSubmissions.map((sub) => (
                  <li key={sub.id} className="text-sm py-1 px-2 rounded hover:bg-[color:color-mix(in_srgb,var(--low)_12%,transparent)] transition-colors">
                    {sub.title}
                  </li>
                ))}
              </ul>
              {huntSubmissions.length > reportedLimit && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-3 h-auto px-0 text-sm font-medium text-primary hover:text-primary"
                  onClick={() => setShowAllReported((prev) => !prev)}
                >
                  {showAllReported ? "Show less" : "See full list"}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Bugs Submitted */}
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">📋</span>
                Bugs Submitted
              </CardTitle>
              <CardDescription>
                Submissions currently under review
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {bugSubmissionsByUser.length === 0 && (
                  <li className="text-muted-foreground">
                    No bugs submitted yet.
                  </li>
                )}
                {visibleBugSubmissions.map((sub) => (
                  <li key={sub.id} className="text-sm py-1 px-2 rounded hover:bg-secondary transition-colors">
                    {sub.title}
                    {sub.status
                      ? ` (${String(sub.status).replace(/-/g, " ")})`
                      : ""}
                  </li>
                ))}
              </ul>
              {bugSubmissionsByUser.length > submittedLimit && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-3 h-auto px-0 text-sm font-medium text-primary hover:text-primary"
                  onClick={() => setShowAllSubmitted((prev) => !prev)}
                >
                  {showAllSubmitted ? "Show less" : "See full list"}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

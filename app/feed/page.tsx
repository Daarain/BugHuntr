"use client";

import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { BugCard } from "@/components/bug-feed/bug-card";
import { FilterControls } from "@/components/bug-feed/filter-controls";
import { BugCardSkeleton } from "@/components/loading/bug-card-skeleton";
import { FadeIn } from "@/components/animations/fade-in";
import React, { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Shield, Users, Award } from "lucide-react";
import { BugHuntCard } from "@/components/bug-hunt/bug-hunt-card";
import { BugHuntFilterControls } from "@/components/bug-hunt/bug-hunt-filter-controls";
import { useBugHunt } from "@/hooks/use-bug-hunt";
import { useSearch } from "@/components/search/search-context";
import { useAuth } from "@/components/auth/auth-context";

export default function BugFeedPage() {
  const { searchTerm, setSuggestions } = useSearch();
  const { user } = useAuth();
  // Removed static hardcoded bug cards. Only dynamic bugs from Firestore will be shown.
  const [selectedSeverity, setSelectedSeverity] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedHuntDifficulty, setSelectedHuntDifficulty] = useState("all");
  const [selectedHuntRewardType, setSelectedHuntRewardType] = useState("all");
  const [selectedHuntStatus, setSelectedHuntStatus] = useState("all");
  const [huntSortBy, setHuntSortBy] = useState("newest");
  const [isLoading, setIsLoading] = useState(false);
  const [allBugs, setAllBugs] = useState<any[]>([]);
  const router = useRouter();

  const { getActiveBugHunts } = useBugHunt();
  const activeBugHunts = getActiveBugHunts() || [];

  // Load submissions from API
  useEffect(() => {
    let mounted = true;
    const fetchBugs = async () => {
      try {
        setIsLoading(true);
        const res = await fetch("/api/bug-submissions", { credentials: "include" });
        if (res.ok && mounted) {
          const data = await res.json();
          const bugs = (Array.isArray(data) ? data : []).map((b: any) => ({
            id: b.id,
            title: b.title,
            severity: b.severity,
            category: b.category || "Web Application",
            company: b.company || "Unknown",
            summary: b.description || "No summary provided.",
            postedTime: b.submittedAt || "",
            date: b.submittedAt,
            isLocked: false,
            author: b.username || b.userId,
            email: "",
            bounty: 0,
            views: 0,
            status: b.status || "pending",
          }));
          setAllBugs(bugs);
        }
      } catch (err) {
        console.error("Failed to load bugs for feed:", err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    fetchBugs();
    return () => {
      mounted = false;
    };
  }, []);

  // Reset severity filter if user loses admin access or company info
  useEffect(() => {
    if (
      (selectedSeverity === "critical" || selectedSeverity === "high") &&
      (!user || user.role !== "admin" || !user.companyName)
    ) {
      setSelectedSeverity("all");
    }
  }, [user, selectedSeverity]);

  const filteredAndSortedBugs = useMemo(() => {
    let filteredBugs = [...allBugs];

    // Debug logging
    console.log("=== DEBUG FILTERING ===");
    console.log("User:", user);
    console.log("All bugs:", allBugs);
    console.log("User role:", user?.role);
    console.log("User company:", user?.companyName);

    // Filter bugs based on user role and company
    filteredBugs = filteredBugs.filter((bug) => {
      // If user is a company admin, only show bugs from their company
      if (user?.role === "admin" && user?.companyName) {
        console.log(
          `Admin filtering: ${bug.title} (${bug.severity}) - Company: ${bug.company} vs User: ${user.companyName}`,
        );
        const hasAccess =
          bug.company?.toLowerCase() === user.companyName?.toLowerCase();
        console.log(`Company access: ${hasAccess}`);
        return hasAccess;
      }

      // For non-admin users, apply original severity-based filtering
      if (bug.severity === "critical" || bug.severity === "high") {
        console.log(
          `Non-admin checking ${bug.severity} bug:`,
          bug.title,
          "- Access denied",
        );
        // Regular users cannot see critical/high severity bugs
        return false;
      }

      // Show low and medium severity bugs to non-admin users
      console.log(`Non-admin user sees ${bug.severity} bug:`, bug.title);
      return true;
    });

    if (searchTerm && searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filteredBugs = filteredBugs.filter(
        (bug) =>
          bug.title?.toLowerCase().includes(term) ||
          bug.summary?.toLowerCase().includes(term) ||
          bug.company?.toLowerCase().includes(term) ||
          bug.category?.toLowerCase().includes(term),
      );
    }

    if (selectedSeverity !== "all") {
      filteredBugs = filteredBugs.filter(
        (bug) => bug.severity === selectedSeverity,
      );
    }

    if (selectedCategory !== "all") {
      filteredBugs = filteredBugs.filter(
        (bug) => bug.category === selectedCategory,
      );
    }

    if (sortBy === "oldest") {
      filteredBugs = [...filteredBugs].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
    } else {
      filteredBugs = [...filteredBugs].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
    }

    return filteredBugs;
  }, [allBugs, selectedSeverity, selectedCategory, sortBy, searchTerm, user]);

  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      setSuggestions([]);
      return;
    }

    const nextSuggestions = filteredAndSortedBugs
      .filter((bug) => bug.title?.toLowerCase().includes(term))
      .slice(0, 6)
      .map((bug) => ({ id: String(bug.id), title: bug.title }));

    setSuggestions(nextSuggestions);
  }, [searchTerm, filteredAndSortedBugs, setSuggestions]);

  // Bug hunt filtering logic
  const filteredBugHunts = useMemo(() => {
    let filtered = [...activeBugHunts];

    if (selectedHuntDifficulty !== "all") {
      filtered = filtered.filter(
        (hunt) => hunt.difficulty === selectedHuntDifficulty,
      );
    }

    if (selectedHuntRewardType !== "all") {
      filtered = filtered.filter((hunt) =>
        hunt.rewardTypes?.includes(selectedHuntRewardType as any),
      );
    }

    if (selectedHuntStatus !== "all") {
      filtered = filtered.filter((hunt) => hunt.status === selectedHuntStatus);
    }

    // Sort bug hunts
    if (huntSortBy === "oldest") {
      filtered = [...filtered].sort(
        (a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      );
    } else if (huntSortBy === "deadline") {
      filtered = [...filtered].sort(
        (a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime(),
      );
    } else {
      filtered = [...filtered].sort(
        (a, b) =>
          new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      );
    }

    return filtered;
  }, [
    activeBugHunts,
    selectedHuntDifficulty,
    selectedHuntRewardType,
    selectedHuntStatus,
    huntSortBy,
  ]);

  const stats = useMemo(() => {
    const totalBugs = allBugs.length;
    const criticalCount = allBugs.filter(
      (bug) => bug.severity === "critical",
    ).length;
    const resolvedCount = allBugs.filter(
      (bug) => bug.status === "resolved",
    ).length;
    const activeHunters = new Set(allBugs.map((bug) => bug.author)).size;

    return {
      total: totalBugs,
      critical: criticalCount,
      resolved: resolvedCount,
      hunters: activeHunters,
    };
  }, [allBugs]);

  const handleClearFilters = () => {
    setSelectedSeverity("all");
    setSelectedCategory("all");
  };

  const handleClearHuntFilters = () => {
    setSelectedHuntDifficulty("all");
    setSelectedHuntRewardType("all");
    setSelectedHuntStatus("all");
  };

  const handleFilterChange = (filterType: string, value: string) => {
    setIsLoading(true);
    setTimeout(() => {
      if (filterType === "severity") {
        // Check if user is authorized to filter by critical/high severity
        if (
          (value === "critical" || value === "high") &&
          (!user || user.role !== "admin" || !user.companyName)
        ) {
          // Reset to "all" if unauthorized
          setSelectedSeverity("all");
        } else {
          setSelectedSeverity(value);
        }
      }
      if (filterType === "category") setSelectedCategory(value);
      if (filterType === "sort") setSortBy(value);
      setIsLoading(false);
    }, 300);
  };

  return (
    <div className="p-4 lg:p-6 pb-20 lg:pb-6">
      <div className="max-w-6xl mx-auto">
        <FadeIn>
          <div className="mb-6 lg:mb-8">
            <h1 className="text-2xl lg:text-3xl font-bold mb-2 text-primary">
              Security Intelligence Feed
            </h1>
            <p className="text-muted-foreground">
              Discover the latest security vulnerabilities and threat
              intelligence from our community
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 lg:mb-8">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-sm text-muted-foreground">
                    Total Reports
                  </span>
                </div>
                <div className="text-2xl font-bold text-primary mt-1">
                  {stats.total}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-severity-critical" />
                  <span className="text-sm text-muted-foreground">
                    Critical
                  </span>
                </div>
                <div className="text-2xl font-bold text-severity-critical mt-1">
                  {stats.critical}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-[var(--low)]" />
                  <span className="text-sm text-muted-foreground">
                    Resolved
                  </span>
                </div>
                <div className="text-2xl font-bold text-[var(--low)] mt-1">
                  {stats.resolved}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-secondary" />
                  <span className="text-sm text-muted-foreground">
                    Active Hunters
                  </span>
                </div>
                <div className="text-2xl font-bold text-secondary mt-1">
                  {stats.hunters}
                </div>
              </CardContent>
            </Card>
          </div>
        </FadeIn>

        {/* Bug Hunt Section */}
        <FadeIn delay={0.25}>
          <div className="mb-8">
            <h2 className="text-3xl lg:text-4xl font-extrabold mb-6 text-primary tracking-tight">
              Active Bug Hunts
            </h2>
            <div className="mb-6">
              <BugHuntFilterControls
                selectedDifficulty={selectedHuntDifficulty}
                selectedRewardType={selectedHuntRewardType}
                selectedStatus={selectedHuntStatus}
                sortBy={huntSortBy}
                onDifficultyChange={setSelectedHuntDifficulty}
                onRewardTypeChange={setSelectedHuntRewardType}
                onStatusChange={setSelectedHuntStatus}
                onSortChange={setHuntSortBy}
                onClearFilters={handleClearHuntFilters}
                totalCount={activeBugHunts.length}
                filteredCount={filteredBugHunts.length}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6 mb-4">
              {filteredBugHunts.slice(0, 6).map((hunt, index) => (
                <BugHuntCard key={hunt.id} hunt={hunt} index={index} />
              ))}
            </div>
            {activeBugHunts.length > 6 && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => router.push("/bug-hunt")}
                >
                  View All Hunts
                </Button>
              </div>
            )}
          </div>
        </FadeIn>

        {/* Bugs Section */}
        <FadeIn delay={0.3}>
          {(!user || user.role !== "admin") && (
            <Card className="mb-6 border-[color:color-mix(in_srgb,var(--medium)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--medium)_10%,transparent)]">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-[var(--medium)] mt-0.5 shrink-0" />
                  <div>
                    <h3 className="font-semibold text-[var(--text-primary)] mb-1">
                      Access Notice
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)]">
                      {user?.role === "admin" && user?.companyName
                        ? `As a company administrator, you can only view bug reports from ${user.companyName}. Critical and high severity bugs from other companies are restricted.`
                        : user?.role === "admin"
                          ? "Please ensure your company information is properly configured to view company-specific bug reports."
                          : "Company administrators can only view bug reports from their own company. Critical and high severity bugs require admin access."}
                      {!user &&
                        " Please log in with a company admin account to view company-specific reports."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <h2 className="text-3xl lg:text-4xl font-extrabold mb-6 text-primary tracking-tight">
            Latest Bugs
          </h2>
          <div className="mb-6 lg:mb-8">
            <FilterControls
              selectedSeverity={selectedSeverity}
              selectedCategory={selectedCategory}
              sortBy={sortBy}
              onSeverityChange={(value) =>
                handleFilterChange("severity", value)
              }
              onCategoryChange={(value) =>
                handleFilterChange("category", value)
              }
              onSortChange={(value) => handleFilterChange("sort", value)}
              onClearFilters={handleClearFilters}
              totalCount={allBugs.length}
              filteredCount={filteredAndSortedBugs.length}
              user={user}
            />
          </div>
        </FadeIn>
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6"
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <BugCardSkeleton key={index} />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6 auto-rows-max"
            >
              {filteredAndSortedBugs.map((bug, index) => (
                <div
                  key={bug.id}
                  id={`bug-${bug.id}`}
                  onClick={() => router.push(`/bug/${bug.id}`)}
                >
                  <BugCard bug={bug} index={index} />
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {!isLoading && filteredAndSortedBugs.length === 0 && (
          <FadeIn delay={0.3}>
            <div className="text-center py-12">
              <div className="text-muted-foreground text-lg mb-2">
                No vulnerabilities found
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Try adjusting your filters to see more results
              </p>
              <Button variant="outline" onClick={handleClearFilters}>
                Clear All Filters
              </Button>
            </div>
          </FadeIn>
        )}
      </div>
    </div>
  );
}

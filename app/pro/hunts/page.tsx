"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProHuntCard } from "@/components/pro/pro-hunt-card";
import { ProEligibilityCard } from "@/components/pro/pro-eligibility-card";
import { ProApplyModal } from "@/components/pro/pro-apply-modal";
import { ProNdaModal } from "@/components/pro/pro-nda-modal";
import { ProRecommendationsPanel } from "@/components/pro/pro-recommendations-panel";
import { Search, Filter, ArrowLeft, Plus, ArrowUpDown } from "lucide-react";
import { useProHunts } from "@/hooks/use-pro-hunts";
import { useProEligibility } from "@/hooks/use-pro-eligibility";
import { mockProHunts } from "@/data/mock-pro-data";
import { type ProHunt, type ProInvitation } from "@/types/pro";
import { useAuth } from "@/components/auth/auth-context";
import { getUserPermissions } from "@/lib/pro-utils";

export default function ProHuntsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");

  const { user } = useAuth();
  const { proHunts, loading, deleteProHunt } = useProHunts();
  const { checkHunterEligibility } = useProEligibility();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("latest");
  const [selectedHunt, setSelectedHunt] = useState<ProHunt | null>(null);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [ndaModalOpen, setNdaModalOpen] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(true);
  const [selectedRecommendationHunt, setSelectedRecommendationHunt] =
    useState<ProHunt | null>(null);
  const [selectedManageHunt, setSelectedManageHunt] = useState<ProHunt | null>(
    null,
  );
  const [acceptedInvites, setAcceptedInvites] = useState<ProInvitation[]>([]);
  const [acceptedInvitesLoading, setAcceptedInvitesLoading] = useState(false);

  // Get user permissions
  const permissions = user
    ? getUserPermissions(user.role, user.userType)
    : null;

  const isAdmin = user?.role === "admin";
  const isCompany = Boolean(permissions?.isCompany) || isAdmin;
  // Company presence indicates company-scoped manage view; admins without a company
  // should still be able to open 'My Hunts' but only see hunts they created.
  const hasCompanyAccount = Boolean(user?.companyId);
  // Fallback: if permissions are missing but the user object contains hunter-specific data
  // (rank or huntsParticipated), treat them as a hunter for the purposes of showing the
  // eligibility card. Admins are explicitly excluded from hunter UI.
  const hasHunterData = Boolean(user?.rank) || Boolean(user?.huntsParticipated);
  const isHunter =
    (Boolean(permissions?.isHunter) || hasHunterData) && !isAdmin;
  const canCreate = Boolean(permissions?.canCreateHunts) || isAdmin;

  // Determine view mode: 'manage' for companies (or admins), 'find' for elite hunters, 'browse' otherwise
  const [viewMode, setViewMode] = useState<"browse" | "manage" | "find">(
    viewParam === "manage" && (hasCompanyAccount || isAdmin)
      ? "manage"
      : viewParam === "find" && (hasCompanyAccount || isAdmin)
        ? "find"
        : "browse",
  );

  // Get hunter data from auth context or use defaults
  const hunterData = {
    id: user?.id || "hunter_current",
    name: user?.username || "CurrentHunter",
    rank: user?.rank || "B",
    huntsParticipated: user?.huntsParticipated || 30,
    certifications: user?.certifications || ["OSCP", "CEH"],
  };

  const eligibility = checkHunterEligibility(
    hunterData.rank,
    hunterData.huntsParticipated,
    hunterData.certifications,
  );

  // Filter hunts based on view mode
  const filteredHunts = proHunts.filter((hunt) => {
    const matchesSearch =
      hunt.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      hunt.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      hunt.companyName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || hunt.status === statusFilter;

    // In manage mode, show hunts for the company if the user has a company account,
    // otherwise if the user is an admin show only hunts they created (createdBy === user.id)
    if (viewMode === "manage") {
      if (hasCompanyAccount) {
        return (
          matchesSearch && matchesStatus && hunt.companyId === user!.companyId
        );
      }
      if (isAdmin) {
        return matchesSearch && matchesStatus && hunt.createdBy === user!.id;
      }
      // If manage mode but neither company nor admin, fall back to nothing
      return false;
    }

    return matchesSearch && matchesStatus;
  });

  const managedHunts = proHunts.filter((hunt) => {
    if (hasCompanyAccount) {
      return hunt.companyId === user!.companyId;
    }
    if (isAdmin) {
      return hunt.createdBy === user!.id;
    }
    return false;
  });

  const rankOrder: Record<string, number> = {
    S: 5,
    A: 4,
    B: 3,
    C: 2,
    D: 1,
    E: 0,
  };

  const getDateValue = (hunt: ProHunt) =>
    new Date(hunt.updatedAt || hunt.createdAt || 0).getTime();

  const sortHunts = (hunts: ProHunt[], mode: string) => {
    const sorted = [...hunts];
    switch (mode) {
      case "oldest":
        return sorted.sort((a, b) => getDateValue(a) - getDateValue(b));
      case "rewards":
        return sorted.sort(
          (a, b) => (b.rewards?.critical || 0) - (a.rewards?.critical || 0),
        );
      case "rank":
        return sorted.sort(
          (a, b) => (rankOrder[b.minRank] ?? 0) - (rankOrder[a.minRank] ?? 0),
        );
      case "latest":
      default:
        return sorted.sort((a, b) => getDateValue(b) - getDateValue(a));
    }
  };

  const sortedManagedHunts = sortHunts(managedHunts, "latest");
  const sortedFilteredHunts =
    viewMode === "find" ? filteredHunts : sortHunts(filteredHunts, sortBy);

  useEffect(() => {
    if (!selectedRecommendationHunt && sortedManagedHunts.length > 0) {
      setSelectedRecommendationHunt(sortedManagedHunts[0]);
    }
  }, [sortedManagedHunts, selectedRecommendationHunt]);

  useEffect(() => {
    if (
      viewMode === "manage" &&
      !selectedManageHunt &&
      sortedManagedHunts.length > 0
    ) {
      setSelectedManageHunt(sortedManagedHunts[0]);
    }
  }, [sortedManagedHunts, selectedManageHunt, viewMode]);

  useEffect(() => {
    let mounted = true;
    if (viewMode !== "manage" || !selectedManageHunt?.id) {
      setAcceptedInvites([]);
      setAcceptedInvitesLoading(false);
      return;
    }

    setAcceptedInvitesLoading(true);

    async function loadAcceptedInvites() {
      try {
        const res = await fetch(
          `/api/pro/invitations?huntId=${encodeURIComponent(selectedManageHunt!.id)}&status=accepted`,
          { credentials: "include" },
        );
        if (res.ok && mounted) {
          const data = await res.json();
          const list = Array.isArray(data?.invitations) ? data.invitations : [];
          setAcceptedInvites(list);
        } else if (mounted) {
          setAcceptedInvites([]);
        }
      } catch (error) {
        console.error("Failed to load accepted invitations:", error);
        if (mounted) setAcceptedInvites([]);
      } finally {
        if (mounted) setAcceptedInvitesLoading(false);
      }
    }

    loadAcceptedInvites();
    return () => {
      mounted = false;
    };
  }, [selectedManageHunt?.id, viewMode]);

  const handleApply = (hunt: ProHunt) => {
    setSelectedHunt(hunt);
    setApplyModalOpen(true);
  };

  const handleViewDetails = (hunt: ProHunt) => {
    // Navigate to hunt details page or open modal
    console.log("View details:", hunt);
  };

  const handleEditHunt = (hunt: ProHunt) => {
    router.push(`/pro/hunts/create?edit=${hunt.id}`);
  };

  const handleDeleteHunt = async (hunt: ProHunt) => {
    const confirmed = window.confirm(
      `Delete "${hunt.title}"? This action cannot be undone.`,
    );
    if (!confirmed) return;
    await deleteProHunt(hunt.id);
  };

  const checkHuntEligibility = (hunt: ProHunt) => {
    return checkHunterEligibility(
      hunterData.rank,
      hunterData.huntsParticipated,
      hunterData.certifications,
      hunt.minRank,
      hunt.minHuntsParticipated,
      hunt.requiredCertifications,
    ).isEligible;
  };

  const handleBackToProDashboard = () => {
    router.push("/pro");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--border-light)]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-[#10151c] dark:text-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Button
              variant="ghost"
              onClick={handleBackToProDashboard}
              className="gap-2 text-muted-foreground hover:text-foreground mb-4"
              data-testid="back-to-pro-btn"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Pro Dashboard
            </Button>
            <h1 className="text-3xl font-black mb-2 text-foreground">
              {viewMode === "manage"
                ? "Manage My Pro Hunts"
                : viewMode === "find"
                  ? "Find Elite Hunters"
                  : "Browse Pro Hunts"}
            </h1>
            <p className="text-muted-foreground">
              {viewMode === "manage"
                ? "View and manage your active Pro hunts"
                : viewMode === "find"
                  ? "Get AI recommendations for hunters based on your hunts"
                  : "Discover elite bug hunting opportunities with premium rewards"}
            </p>
          </div>
          {canCreate && viewMode === "manage" && hasCompanyAccount && (
            <Button
              onClick={() => router.push("/pro/hunts/create")}
              className="bg-primary hover:bg-[var(--accent-hover)]"
              data-testid="create-new-hunt-btn"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Hunt
            </Button>
          )}
        </div>

        {/* View Mode Tabs (only for companies) */}
        {(hasCompanyAccount || isAdmin) && viewMode !== "find" && (
          <Tabs
            value={viewMode}
            onValueChange={(v) =>
              setViewMode(v as "browse" | "manage" | "find")
            }
          >
            <TabsList className="bg-slate-100/80 dark:bg-[#181e26]">
              <TabsTrigger value="browse" data-testid="browse-tab">
                Browse All Hunts
              </TabsTrigger>
              <TabsTrigger value="manage" data-testid="manage-tab">
                My Hunts
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500 dark:text-muted-foreground w-5 h-5" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                viewMode === "find"
                  ? "Search hunters by name, rank, or skill..."
                  : "Search hunts by title, company, or description..."
              }
              className="pl-10 bg-white dark:bg-[#181e26] border-slate-200 dark:border-[#23272f]"
              data-testid="search-hunts-input"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger
              className="w-full md:w-48 bg-white dark:bg-[#181e26] border-slate-200 dark:border-[#23272f]"
              data-testid="status-filter"
            >
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue
                placeholder={viewMode === "find" ? "All Hunters" : "All Status"}
              />
            </SelectTrigger>
            <SelectContent>
              {viewMode === "find" ? (
                <>
                  <SelectItem value="all">All Hunters</SelectItem>
                  <SelectItem value="eligible">Eligible</SelectItem>
                  <SelectItem value="top-rated">Top Rated</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
          {viewMode !== "find" && (
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger
                className="w-full md:w-48 bg-white dark:bg-[#181e26] border-slate-200 dark:border-[#23272f]"
                data-testid="sort-filter"
              >
                <ArrowUpDown className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">Latest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="rewards">Top Rewards</SelectItem>
                <SelectItem value="rank">Highest Rank</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar - Different for each view mode */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 space-y-4">
              {/* Hunter Eligibility Card (visible to system 'user' role in browse mode) */}
              {viewMode === "browse" && user?.role === "user" && (
                <ProEligibilityCard eligibility={eligibility} />
              )}

              {/* Company Actions (only in manage mode for companies) */}
              {viewMode === "manage" && isCompany && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Manage your created hunts. Use edit or delete on each card.
                  </p>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      Accepted hunters
                    </p>
                    <Select
                      value={selectedManageHunt?.id || ""}
                      onValueChange={(value) => {
                        const match = sortedManagedHunts.find(
                          (hunt) => hunt.id === value,
                        );
                        setSelectedManageHunt(match || null);
                      }}
                    >
                      <SelectTrigger className="w-full bg-background dark:bg-[#181e26] border-border dark:border-[#23272f]">
                        <SelectValue
                          placeholder={
                            managedHunts.length
                              ? "Choose a hunt"
                              : "No hunts available"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedManagedHunts.map((hunt) => (
                          <SelectItem key={hunt.id} value={hunt.id}>
                            {hunt.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="rounded-lg border border-border bg-background dark:bg-[#181e26] dark:border-[#23272f] p-3 space-y-2">
                      {acceptedInvitesLoading ? (
                        <p className="text-sm text-muted-foreground">
                          Loading accepted hunters...
                        </p>
                      ) : acceptedInvites.length > 0 ? (
                        acceptedInvites.map((invite) => (
                          <div key={invite.id} className="text-sm">
                            <p className="font-medium text-foreground">
                              {invite.hunterName ||
                                invite.hunterUsername ||
                                invite.hunterId ||
                                "Hunter"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {invite.hunterId ||
                                invite.hunterUsername ||
                                invite.email ||
                                ""}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No accepted hunters yet.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Find Elite Hunters (admin/company) */}
              {viewMode === "find" && isCompany && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2">
                      Select a hunt
                    </p>
                    <Select
                      value={selectedRecommendationHunt?.id || ""}
                      onValueChange={(value) => {
                        const match = sortedManagedHunts.find(
                          (h) => h.id === value,
                        );
                        setSelectedRecommendationHunt(match || null);
                      }}
                    >
                      <SelectTrigger className="w-full bg-background dark:bg-[#181e26] border-border dark:border-[#23272f]">
                        <SelectValue
                          placeholder={
                            managedHunts.length
                              ? "Choose a hunt"
                              : "No hunts available"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedManagedHunts.map((hunt) => (
                          <SelectItem key={hunt.id} value={hunt.id}>
                            {hunt.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => setShowRecommendations((prev) => !prev)}
                    className="w-full bg-primary hover:bg-[var(--accent-hover)]"
                    data-testid="toggle-recommendations-btn"
                    disabled={!selectedRecommendationHunt}
                  >
                    {showRecommendations ? "Hide" : "Show"} AI Recommendations
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-4">
            {viewMode === "find" ? (
              sortedManagedHunts.length === 0 ? (
                <div
                  className="text-center py-12"
                  data-testid="no-hunts-message"
                >
                  <p className="text-muted-foreground text-lg">
                    Create a Pro hunt to get AI recommendations
                  </p>
                  {canCreate && (
                    <Button
                      onClick={() => router.push("/pro/hunts/create")}
                      className="mt-4 bg-primary hover:bg-[var(--accent-hover)]"
                      data-testid="create-first-hunt-btn"
                    >
                      Create Your First Hunt
                    </Button>
                  )}
                </div>
              ) : (
                showRecommendations &&
                selectedRecommendationHunt &&
                isCompany && (
                  <ProRecommendationsPanel
                    huntId={selectedRecommendationHunt.id}
                    huntTitle={selectedRecommendationHunt.title}
                    companyName={selectedRecommendationHunt.companyName}
                    minRank={selectedRecommendationHunt.minRank}
                    minHunts={selectedRecommendationHunt.minHuntsParticipated}
                    requiredCerts={
                      selectedRecommendationHunt.requiredCertifications
                    }
                    searchQuery={searchQuery}
                    hunterFilter={statusFilter}
                    onInvite={(hunterId) => {
                      console.log("Invite hunter:", hunterId);
                    }}
                  />
                )
              )
            ) : filteredHunts.length === 0 ? (
              <div className="text-center py-12" data-testid="no-hunts-message">
                <p className="text-muted-foreground text-lg">
                  {viewMode === "manage"
                    ? "You haven't created any Pro hunts yet"
                    : "No Pro hunts found matching your criteria"}
                </p>
                {viewMode === "manage" && canCreate && (
                  <Button
                    onClick={() => router.push("/pro/hunts/create")}
                    className="mt-4 bg-primary hover:bg-[var(--accent-hover)]"
                    data-testid="create-first-hunt-btn"
                  >
                    Create Your First Hunt
                  </Button>
                )}
              </div>
            ) : (
              sortedFilteredHunts.map((hunt) => (
                <ProHuntCard
                  key={hunt.id}
                  hunt={hunt}
                  onApply={() => handleApply(hunt)}
                  onViewDetails={() => {
                    handleViewDetails(hunt);
                    if (viewMode === "manage") {
                      setSelectedHunt(hunt);
                    }
                  }}
                  isEligible={checkHuntEligibility(hunt)}
                  isManageView={viewMode === "manage"}
                  onEdit={() => handleEditHunt(hunt)}
                  onDelete={() => handleDeleteHunt(hunt)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Apply Modal (only for hunters) */}
      {selectedHunt && isHunter && (
        <ProApplyModal
          open={applyModalOpen}
          onOpenChange={setApplyModalOpen}
          hunt={selectedHunt}
          hunterId={hunterData.id}
          hunterName={hunterData.name}
          hunterRank={hunterData.rank}
        />
      )}

      {/* NDA Modal (only for hunters) */}
      {selectedHunt && isHunter && (
        <ProNdaModal
          open={ndaModalOpen}
          onOpenChange={setNdaModalOpen}
          huntId={selectedHunt.id}
          huntTitle={selectedHunt.title}
          companyName={selectedHunt.companyName}
          ndaText={selectedHunt.ndaTemplateText}
          hunterId={hunterData.id}
          hunterName={hunterData.name}
          onSign={(hash) => {
            console.log("NDA signed with hash:", hash);
          }}
        />
      )}
    </div>
  );
}

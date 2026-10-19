"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Mail, TrendingUp, Award, Shield } from "lucide-react";
import { type ProRecommendation } from "@/types/pro";
import { toast } from "sonner";
import {
  calculateHunterScore,
  checkEligibility,
  generateReasonTags,
} from "@/lib/pro-utils";
import { useAuth } from "@/components/auth/auth-context";

interface ProRecommendationsPanelProps {
  huntId: string;
  huntTitle: string;
  companyName: string;
  minRank: string;
  minHunts: number;
  requiredCerts: string[];
  searchQuery?: string;
  hunterFilter?: string;
  onInvite?: (hunterId: string, hunterName: string) => void;
}

export function ProRecommendationsPanel({
  huntId,
  huntTitle,
  companyName,
  minRank,
  minHunts,
  requiredCerts,
  searchQuery,
  hunterFilter,
  onInvite,
}: ProRecommendationsPanelProps) {
  const { user } = useAuth();
  const [recommendations, setRecommendations] = useState<ProRecommendation[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);
  const [invitedHunterIds, setInvitedHunterIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setLoading(true);

    const fetchHunters = async () => {
      try {
        const res = await fetch("/api/rankings/leaderboard?limit=200");
        if (res.ok) {
          const payload = await res.json();
          const items = Array.isArray(payload?.leaderboard) ? payload.leaderboard : [];
          const allHunters = items.map((data: any) => {
            const hunterName =
              data.username || data.name || data.email || "Hunter";
            const hunterUsername = data.username || hunterName;
            const rank = data.rank || "C";
            const huntsParticipated =
              data.huntsParticipated || data.bugsSubmitted || 0;
            const certifications = Array.isArray(data.certifications)
              ? data.certifications
              : [];
            const reputation = data.reputation || 0;
            const successRate = data.successRate || 0;

            const eligibility = checkEligibility(
              rank,
              huntsParticipated,
              certifications,
              minRank,
              minHunts,
              requiredCerts
            );

            const score = calculateHunterScore(
              rank,
              reputation,
              huntsParticipated,
              successRate,
              certifications,
              requiredCerts
            );

            const reasonTags = generateReasonTags(
              rank,
              reputation,
              huntsParticipated,
              successRate,
              certifications,
              requiredCerts
            );

            return {
              hunterId: data.id || data.userId,
              hunterName,
              hunterUsername,
              score,
              rank,
              reputation,
              huntsParticipated,
              successRate,
              certifications,
              reasonTags,
              matchPercentage: Math.round(score),
              isEligible: eligibility.isEligible,
              missingRequirements: eligibility.missingRequirements,
            };
          });

          setRecommendations(allHunters);
        }
      } catch (err) {
        console.error("Failed to fetch hunters for recommendations:", err);
        setRecommendations([]);
      } finally {
        setLoading(false);
      }
    };

    fetchHunters();
  }, [minRank, minHunts, requiredCerts]);

  useEffect(() => {
    let mounted = true;
    if (!huntId) {
      setInvitedHunterIds(new Set());
      return;
    }

    async function loadInvitations() {
      try {
        const res = await fetch(`/api/pro/invitations?huntId=${encodeURIComponent(huntId)}&status=pending,accepted`, {
          credentials: "include",
        });
        if (res.ok && mounted) {
          const data = await res.json();
          const list = Array.isArray(data?.invitations) ? data.invitations : [];
          const next = new Set<string>();
          list.forEach((inv: any) => {
            if (inv.hunterId) next.add(inv.hunterId);
          });
          setInvitedHunterIds(next);
        }
      } catch (err) {
        console.error("Failed to load invitations for recommendations:", err);
      }
    }

    loadInvitations();
    return () => {
      mounted = false;
    };
  }, [huntId]);

  const handleInvite = async (
    hunterId: string,
    hunterName: string,
    hunterUsername?: string,
  ) => {
    setInviting(hunterId);
    try {
      const res = await fetch("/api/pro/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          huntId,
          huntTitle,
          companyName,
          hunterId,
          hunterName,
          hunterUsername: hunterUsername || hunterName,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to send invitation");
      }

      setInvitedHunterIds((prev) => new Set(prev).add(hunterId));
      toast.success(`Invitation sent to ${hunterName}`);
      onInvite?.(hunterId, hunterName);
    } catch (error: any) {
      toast.error(error?.message || "Failed to send invitation");
    } finally {
      setInviting(null);
    }
  };

  const getRankColor = (rank: string) => {
    switch (rank) {
      case "S":
        return "text-secondary-foreground bg-secondary border-[var(--border-light)]";
      case "A":
        return "text-primary bg-[var(--accent-soft)] border-[var(--border-light)]";
      case "B":
        return "text-[var(--low)] bg-[color:color-mix(in_srgb,var(--low)_12%,transparent)] border-[color:color-mix(in_srgb,var(--low)_25%,transparent)]";
      default:
        return "text-muted-foreground bg-muted border-border";
    }
  };

  const normalizedQuery = (searchQuery || "").trim().toLowerCase();
  const filteredRecommendations = recommendations.filter((rec) => {
    const matchesSearch = normalizedQuery.length
      ? [
          rec.hunterName,
          rec.hunterUsername,
          rec.rank,
          rec.certifications.join(" "),
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(normalizedQuery),
          )
      : true;

    const filterValue = hunterFilter || "all";
    const matchesFilter = (() => {
      switch (filterValue) {
        case "eligible":
          return Boolean(rec.isEligible);
        case "top-rated":
          return rec.matchPercentage >= 75 || rec.reputation >= 4.5;
        case "invited":
          return invitedHunterIds.has(rec.hunterId);
        case "all":
        default:
          return true;
      }
    })();

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6">
      {loading ? (
        <Card className="bg-[#181e26] border-[#23272f]">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Sparkles className="w-16 h-16 text-primary mb-4" />
            <h3 className="text-xl font-bold mb-2">Loading hunters</h3>
            <p className="text-gray-400 text-center mb-6 max-w-md">
              Fetching eligible and ineligible hunters for this hunt.
            </p>
          </CardContent>
        </Card>
      ) : recommendations.length === 0 ? (
        <Card className="bg-[#181e26] border-[#23272f]">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Sparkles className="w-16 h-16 text-primary mb-4" />
            <h3 className="text-xl font-bold mb-2">No hunters found</h3>
            <p className="text-gray-400 text-center mb-6 max-w-md">
              Add hunter profiles to see eligibility and recommendation details.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">
                All Hunters ({filteredRecommendations.length}/
                {recommendations.length})
              </h2>
              <p className="text-gray-400">
                Eligibility is based on the selected hunt requirements
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              {minRank}-rank+, {minHunts}+ hunts
            </Badge>
          </div>

          <div className="grid gap-4">
            {filteredRecommendations.map((rec, index) => (
              <Card
                key={rec.hunterId}
                className="bg-[#181e26] border-[#23272f] hover:border-[var(--border-light)] transition-colors"
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      {/* Rank Badge */}
                      <div className="relative">
                        <Avatar className="w-16 h-16 border-2 border-[var(--border-light)]">
                          <AvatarFallback className="bg-[var(--accent-soft)] text-primary font-bold text-xl">
                            {rec.hunterName.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div
                          className={`absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border-2 border-[#181e26] ${getRankColor(
                            rec.rank,
                          )}`}
                        >
                          {rec.rank}
                        </div>
                      </div>

                      {/* Hunter Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-xl font-bold">
                            {rec.hunterName}
                          </h3>
                          {rec.isEligible ? (
                            <Badge className="bg-[var(--low)] text-white">
                              Eligible
                            </Badge>
                          ) : (
                            <Badge className="bg-[var(--critical)] text-white">
                              Ineligible
                            </Badge>
                          )}
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-6 text-sm text-gray-400 mb-3">
                          <div className="flex items-center gap-1">
                            <TrendingUp className="w-4 h-4" />
                            <span>{rec.huntsParticipated} hunts</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Award className="w-4 h-4" />
                            <span>
                              {rec.reputation.toFixed(1)}/5 reputation
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Shield className="w-4 h-4" />
                            <span>
                              {Math.round(rec.successRate * 100)}% success
                            </span>
                          </div>
                        </div>

                        {/* Match Score */}
                        <div className="mb-3">
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-gray-400">Match Score</span>
                            <span className="font-bold text-[var(--low)]">
                              {rec.matchPercentage}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-primary h-2 rounded-full transition-all"
                              style={{ width: `${rec.matchPercentage}%` }}
                            />
                          </div>
                        </div>

                        {/* Missing Requirements */}
                        {!rec.isEligible && rec.missingRequirements?.length ? (
                          <div className="mb-3">
                            <p className="text-xs text-[var(--critical)] mb-1">
                              Missing requirements:
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {rec.missingRequirements.map((item: string, i: number) => (
                                <Badge
                                  key={`${rec.hunterId}-missing-${i}`}
                                  variant="outline"
                                  className="border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)] text-[var(--critical)]"
                                >
                                  {item}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {/* Reason Tags */}
                        <div className="flex flex-wrap gap-2">
                          {rec.reasonTags.map((tag, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="bg-[#10151c] border-[#23272f] text-gray-300"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>

                        {/* Certifications */}
                        {rec.certifications.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs text-gray-500 mb-1">
                              Certifications:
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {rec.certifications.map((cert) => (
                                <Badge
                                  key={cert}
                                  className="bg-[color:color-mix(in_srgb,var(--medium)_12%,transparent)] text-[var(--high)] border-[color:color-mix(in_srgb,var(--high)_25%,transparent)] text-xs"
                                >
                                  {cert}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Invite Button */}
                    <Button
                      onClick={() =>
                        handleInvite(
                          rec.hunterId,
                          rec.hunterName,
                          rec.hunterUsername,
                        )
                      }
                      disabled={
                        inviting === rec.hunterId ||
                        invitedHunterIds.has(rec.hunterId)
                      }
                      className="bg-primary hover:bg-[var(--accent-hover)] ml-4"
                    >
                      {inviting === rec.hunterId ? (
                        "Sending..."
                      ) : invitedHunterIds.has(rec.hunterId) ? (
                        "Sent"
                      ) : (
                        <>
                          <Mail className="w-4 h-4 mr-2" />
                          Invite
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  type UserRanking,
  type RankTier,
  type PointsTransaction,
  type RewardItem,
  type UserReward,
  type UserAchievement,
  SEVERITY_POINTS,
  RANK_CONFIGS,
  REWARD_CATALOG,
  ACHIEVEMENTS,
  calculateAdvancedRanking,
} from "@/types/ranking";

export function useRanking() {
  const [userRankings, setUserRankings] = useState<UserRanking[]>([]);
  const [pointsTransactions, setPointsTransactions] = useState<PointsTransaction[]>([]);
  const [userRewards, setUserRewards] = useState<UserReward[]>([]);
  const [userAchievements, setUserAchievements] = useState<UserAchievement[]>([]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/rankings/leaderboard?limit=100");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.leaderboard)) {
          setUserRankings(data.leaderboard);
        }
      }
    } catch (error) {
      console.error("Error loading rankings leaderboard:", error);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const res = await fetch("/api/rankings/transactions?limit=50");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.transactions)) {
          setPointsTransactions(data.transactions);
        }
      }
    } catch (error) {
      console.error("Error loading points transactions:", error);
    }
  }, []);

  const fetchRewards = useCallback(async () => {
    try {
      const res = await fetch("/api/rankings/rewards");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.userRewards)) {
          setUserRewards(data.userRewards);
        }
      }
    } catch (error) {
      console.error("Error loading user rewards:", error);
    }
  }, []);

  const fetchAchievements = useCallback(async () => {
    try {
      const res = await fetch("/api/rankings/achievements");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.achievements)) {
          setUserAchievements(data.achievements);
        }
      }
    } catch (error) {
      console.error("Error loading achievements:", error);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();

    const t1 = setTimeout(() => fetchTransactions(), 500);
    const t2 = setTimeout(() => fetchRewards(), 800);
    const t3 = setTimeout(() => fetchAchievements(), 1000);

    // Polling interval for live leaderboard updates
    const interval = setInterval(() => {
      fetchLeaderboard();
    }, 8000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearInterval(interval);
    };
  }, [fetchLeaderboard, fetchTransactions, fetchRewards, fetchAchievements]);

  // Rank calculation utilities
  const calculateRank = (points: number): RankTier => {
    for (const [tier, config] of Object.entries(RANK_CONFIGS)) {
      if (points >= config.minPoints && points <= config.maxPoints) {
        return tier as RankTier;
      }
    }
    return "E";
  };

  const calculateRankProgress = (points: number, currentRank: RankTier) => {
    const currentConfig = RANK_CONFIGS[currentRank];
    const pointsInCurrentRank = points - currentConfig.minPoints;
    const pointsNeededForRank = currentConfig.maxPoints - currentConfig.minPoints;

    if (currentRank === "S") {
      return { rankProgress: 100, nextRankPoints: 0 };
    }

    const rankProgress = Math.min(100, (pointsInCurrentRank / pointsNeededForRank) * 100);
    const nextRankPoints = currentConfig.maxPoints + 1 - points;

    return { rankProgress, nextRankPoints };
  };

  // Add points via server API
  const addPoints = async (
    userId: string,
    bugId: number,
    severity: keyof typeof SEVERITY_POINTS,
    reason: string
  ) => {
    try {
      const res = await fetch("/api/rankings/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          bugId,
          severity,
          reason,
        }),
      });

      if (res.ok) {
        await fetchLeaderboard();
        await fetchTransactions();
        // Trigger achievement check on server
        await fetch("/api/rankings/achievements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ severity }),
        });
        await fetchAchievements();
      }
    } catch (error) {
      console.error("Failed to add points:", error);
    }
  };

  // Redeem rewards via server API
  const redeemReward = async (
    userId: string,
    rewardId: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch("/api/rankings/rewards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        await fetchRewards();
        await fetchLeaderboard();
        await fetchTransactions();
        return { success: true, message: data.message || "Reward redeemed successfully!" };
      }

      return { success: false, message: data.error || data.message || "Failed to redeem reward" };
    } catch (error: any) {
      return { success: false, message: error.message || "Network error while redeeming reward" };
    }
  };

  const isRankHigherOrEqual = (userRank: RankTier, requiredRank: RankTier): boolean => {
    const order: RankTier[] = ["E", "D", "C", "B", "A", "S"];
    return order.indexOf(userRank) >= order.indexOf(requiredRank);
  };

  const getUserRewards = (userId: string) => userRewards.filter((r) => r.userId === userId);
  const getUserAchievements = (userId: string) => userAchievements.filter((a) => a.userId === userId);

  const getAvailableRewards = (userId: string): RewardItem[] => {
    const user = userRankings.find((u) => u.userId === userId);
    if (!user) return [];
    return REWARD_CATALOG.filter((reward) => {
      if (!reward.available) return false;
      if (reward.requiredRank && !isRankHigherOrEqual(user.rank, reward.requiredRank)) return false;
      if (reward.limitedQuantity) {
        const redeemedCount = userRewards.filter((ur) => ur.rewardId === reward.id).length;
        if (redeemedCount >= reward.limitedQuantity) return false;
      }
      return true;
    });
  };

  const getUserRanking = (userId: string) => userRankings.find((u) => u.userId === userId);
  const getLeaderboard = (limit?: number) =>
    limit ? userRankings.slice(0, limit) : userRankings;
  const getRankBenefits = (rank: RankTier) => RANK_CONFIGS[rank].benefits;
  const getWeeklyRequirement = (rank: RankTier) => RANK_CONFIGS[rank].weeklyRequirement || 0;
  const isRankAtRisk = (user: UserRanking) => {
    const requirement = getWeeklyRequirement(user.rank);
    return requirement > 0 && user.weeklyPoints < requirement;
  };

  return {
    userRankings,
    pointsTransactions,
    userRewards,
    userAchievements,
    addPoints,
    getUserRanking,
    getLeaderboard,
    calculateRank,
    calculateRankProgress,
    getRankBenefits,
    getWeeklyRequirement,
    isRankAtRisk,
    calculateAdvancedRanking,
    redeemReward,
    getUserRewards,
    getUserAchievements,
    getAvailableRewards,
    RANK_CONFIGS,
    REWARD_CATALOG,
    ACHIEVEMENTS,
  };
}

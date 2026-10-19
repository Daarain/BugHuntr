/**
 * Gamification & Rankings Repository (MongoDB)
 *
 * Implements user points balances, streak tracking, reputation tiers (E -> S),
 * points transaction event stream, achievements, reward redemptions, and leaderboard aggregations.
 *
 * Cross-database logical user reference: user_points_balances.user_id -> SQL auth_users.id.
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type {
  UserPointsBalanceDoc,
  PointsTransactionDoc,
  UserAchievementDoc,
  UserRewardDoc,
} from "../types";

export interface RankProgressInfo {
  rank: "E" | "D" | "C" | "B" | "A" | "S";
  rankProgress: number;
  nextRankPoints: number;
}

export class GamificationRepository {
  private balancesCol: Collection<UserPointsBalanceDoc>;
  private txCol: Collection<PointsTransactionDoc>;
  private achievementsCol: Collection<UserAchievementDoc>;
  private rewardsCol: Collection<UserRewardDoc>;

  constructor(db: Db) {
    this.balancesCol = db.collection<UserPointsBalanceDoc>("user_points_balances");
    this.txCol = db.collection<PointsTransactionDoc>("points_transactions");
    this.achievementsCol = db.collection<UserAchievementDoc>("user_achievements");
    this.rewardsCol = db.collection<UserRewardDoc>("user_rewards");
  }

  /**
   * Helper to derive rank tier from total points.
   */
  deriveRank(points: number): "E" | "D" | "C" | "B" | "A" | "S" {
    if (points >= 15000) return "S";
    if (points >= 8000) return "A";
    if (points >= 4000) return "B";
    if (points >= 1500) return "C";
    if (points >= 500) return "D";
    return "E";
  }

  /**
   * Helper to calculate rank progress percentage and points required for next tier.
   */
  calculateRankProgress(points: number): RankProgressInfo {
    const rank = this.deriveRank(points);
    const configs: Record<string, { min: number; max: number }> = {
      E: { min: 0, max: 499 },
      D: { min: 500, max: 1499 },
      C: { min: 1500, max: 3999 },
      B: { min: 4000, max: 7999 },
      A: { min: 8000, max: 14999 },
      S: { min: 15000, max: 15000 },
    };

    if (rank === "S") {
      return { rank: "S", rankProgress: 100, nextRankPoints: 0 };
    }

    const { min, max } = configs[rank];
    const pointsInRank = points - min;
    const totalNeeded = max - min;
    const rankProgress = Math.min(100, Math.max(0, Math.floor((pointsInRank / totalNeeded) * 100)));
    const nextRankPoints = max + 1 - points;

    return { rank, rankProgress, nextRankPoints };
  }

  /**
   * Retrieves a user's points balance.
   */
  async getPointsBalance(userId: string, session?: ClientSession): Promise<UserPointsBalanceDoc | null> {
    return this.balancesCol.findOne({ user_id: userId }, { session });
  }

  /**
   * Finds points balance by username (supporting legacy callers).
   */
  async getPointsBalanceByUsername(username: string, session?: ClientSession): Promise<UserPointsBalanceDoc | null> {
    return this.balancesCol.findOne({ username }, { session });
  }

  /**
   * Atomically adds points to a user's balance and re-evaluates reputation tier.
   * Creates initial balance record if user does not have one.
   */
  async addPoints(
    userId: string,
    points: number,
    options?: {
      username?: string;
      bugIncrement?: number;
      reason?: string;
      bugId?: string | number;
      severity?: "critical" | "high" | "medium" | "low";
      multiplier?: number;
    },
    session?: ClientSession
  ): Promise<UserPointsBalanceDoc> {
    const now = new Date();
    const bugInc = options?.bugIncrement ?? 0;

    // Fetch existing for streak calculation
    const existing = await this.getPointsBalance(userId, session);
    let streak = existing?.streak || 0;
    if (existing?.last_activity) {
      const daysDiff = Math.floor((now.getTime() - new Date(existing.last_activity).getTime()) / (1000 * 60 * 60 * 24));
      streak = daysDiff <= 1 ? streak + 1 : 1;
    } else {
      streak = 1;
    }

    // Upsert base document if missing
    await this.balancesCol.updateOne(
      { user_id: userId },
      {
        $setOnInsert: {
          _id: userId,
          user_id: userId,
          username: options?.username || userId,
          points: 0,
          bugs_submitted: 0,
          reputation_rank: "E",
          weekly_points: 0,
          monthly_points: 0,
          streak: 1,
          last_activity: now,
          updated_at: now,
        },
      },
      { upsert: true, session }
    );

    // Atomically increment points and bugs_submitted
    const updated = await this.balancesCol.findOneAndUpdate(
      { user_id: userId },
      {
        $inc: {
          points,
          weekly_points: points,
          monthly_points: points,
          bugs_submitted: bugInc,
        },
        $set: {
          streak,
          last_activity: now,
          updated_at: now,
          ...(options?.username ? { username: options.username } : {}),
        },
      },
      { session, returnDocument: "after" }
    );

    if (!updated) {
      throw new Error(`Failed to update points balance for user ${userId}`);
    }

    // Re-evaluate rank
    const newRank = this.deriveRank(updated.points);
    if (newRank !== updated.reputation_rank) {
      await this.balancesCol.updateOne(
        { user_id: userId },
        { $set: { reputation_rank: newRank } },
        { session }
      );
      updated.reputation_rank = newRank;
    }

    // Record immutable points transaction if reason is specified
    if (options?.reason || points > 0) {
      await this.txCol.insertOne(
        {
          _id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          user_id: userId,
          bug_id: options?.bugId,
          points,
          reason: options?.reason || "Points awarded",
          severity: options?.severity,
          multiplier: options?.multiplier,
          timestamp: now,
        },
        { session }
      );
    }

    return updated;
  }

  /**
   * Atomically deducts points from a user's balance.
   * Ensures points cannot drop below zero.
   */
  async deductPoints(
    userId: string,
    points: number,
    reason: string,
    session?: ClientSession
  ): Promise<{ success: boolean; error?: string; remainingPoints?: number; balanceDoc?: UserPointsBalanceDoc }> {
    if (points <= 0) {
      return { success: false, error: "Deduction amount must be greater than zero" };
    }

    const now = new Date();

    // Atomic findOneAndUpdate with balance check constraint
    const updated = await this.balancesCol.findOneAndUpdate(
      { user_id: userId, points: { $gte: points } },
      {
        $inc: { points: -points },
        $set: { last_activity: now, updated_at: now },
      },
      { session, returnDocument: "after" }
    );

    if (!updated) {
      const current = await this.getPointsBalance(userId, session);
      return {
        success: false,
        error: `Insufficient points: user has ${current?.points || 0} points, required ${points}`,
        remainingPoints: current?.points || 0,
      };
    }

    // Record immutable deduction transaction
    await this.txCol.insertOne(
      {
        _id: `tx_deduct_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        user_id: userId,
        points: -points,
        reason,
        timestamp: now,
      },
      { session }
    );

    return {
      success: true,
      remainingPoints: updated.points,
      balanceDoc: updated,
    };
  }

  /**
   * Lists points transactions for a user chronologically descending.
   */
  async listTransactions(userId: string, limit = 50): Promise<PointsTransactionDoc[]> {
    return this.txCol
      .find({ user_id: userId })
      .sort({ timestamp: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Retrieves leaderboard sorted by totalPoints, weekly_points, or monthly_points descending.
   */
  async getLeaderboard(
    timeframe: "all" | "monthly" | "weekly" = "all",
    limit = 100
  ): Promise<UserPointsBalanceDoc[]> {
    const sortField =
      timeframe === "weekly" ? "weekly_points" : timeframe === "monthly" ? "monthly_points" : "points";

    return this.balancesCol
      .find({})
      .sort({ [sortField]: -1, points: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Unlocks an achievement for a user.
   */
  async unlockAchievement(
    userId: string,
    badgeId: string,
    title: string,
    description: string,
    progress?: number,
    session?: ClientSession
  ): Promise<{ unlocked: boolean; achievement: UserAchievementDoc }> {
    const doc: UserAchievementDoc = {
      _id: `${userId}:${badgeId}`,
      user_id: userId,
      badge_id: badgeId,
      title,
      description,
      unlocked_at: new Date(),
      progress,
    };

    const res = await this.achievementsCol.updateOne(
      { user_id: userId, badge_id: badgeId },
      { $setOnInsert: doc },
      { upsert: true, session }
    );

    const isNew = res.upsertedCount > 0;
    return { unlocked: isNew, achievement: doc };
  }

  /**
   * Lists achievements unlocked by a user.
   */
  async listUserAchievements(userId: string): Promise<UserAchievementDoc[]> {
    return this.achievementsCol.find({ user_id: userId }).sort({ unlocked_at: -1 }).toArray();
  }

  /**
   * Records a reward item redemption.
   */
  async redeemReward(
    userId: string,
    rewardId: string,
    session?: ClientSession
  ): Promise<UserRewardDoc> {
    const doc: UserRewardDoc = {
      _id: `rew_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      user_id: userId,
      reward_id: rewardId,
      redeemed_at: new Date(),
      status: "pending",
    };

    await this.rewardsCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Counts how many times a reward item has been redeemed.
   */
  async countRedemptions(rewardId: string, session?: ClientSession): Promise<number> {
    return this.rewardsCol.countDocuments({ reward_id: rewardId }, { session });
  }

  /**
   * Lists rewards redeemed by a user.
   */
  async listUserRewards(userId: string): Promise<UserRewardDoc[]> {
    return this.rewardsCol.find({ user_id: userId }).sort({ redeemed_at: -1 }).toArray();
  }
}

/**
 * Wallets Repository (MongoDB)
 *
 * Implements atomic, race-condition-free wallet operations for organization balances.
 * Supports both multi-document ACID transactions and conditional atomic updates ($inc with preconditions)
 * to ensure mathematical guarantee against overspending and double-spending across any MongoDB topology.
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type { OrgWalletDoc, UserWalletDoc } from "../types";

export class WalletsRepository {
  private collection: Collection<OrgWalletDoc>;
  private userWalletsCol: Collection<UserWalletDoc>;

  constructor(db: Db) {
    this.collection = db.collection<OrgWalletDoc>("org_wallets");
    this.userWalletsCol = db.collection<UserWalletDoc>("user_wallets");
  }

  /**
   * Retrieves an organization wallet by orgId.
   */
  async getWallet(orgId: string, session?: ClientSession): Promise<OrgWalletDoc | null> {
    return this.collection.findOne({ org_id: orgId }, { session });
  }

  /**
   * Creates a new organization wallet.
   */
  async createWallet(
    wallet: {
      org_id: string;
      currency?: string;
      network?: string;
      balance?: number;
      reserved?: number;
    },
    session?: ClientSession
  ): Promise<OrgWalletDoc> {
    const doc: OrgWalletDoc = {
      _id: wallet.org_id,
      org_id: wallet.org_id,
      currency: wallet.currency || "USDC",
      network: wallet.network || "POLYGON",
      balance: wallet.balance ?? 0,
      reserved: wallet.reserved ?? 0,
      updated_at: new Date(),
    };

    await this.collection.updateOne(
      { org_id: wallet.org_id },
      { $setOnInsert: doc },
      { upsert: true, session }
    );

    return doc;
  }

  /**
   * Atomically reserves funds from an organization wallet.
   * Fails if available balance (balance - reserved) is strictly less than required amount.
   */
  async reserveFunds(
    orgId: string,
    amount: number,
    session?: ClientSession
  ): Promise<{ success: boolean; availableBalance?: number; error?: string }> {
    if (amount <= 0) {
      return { success: false, error: "Invalid reservation amount" };
    }

    // Atomic conditional update enforcing available = balance - reserved >= amount
    const res = await this.collection.findOneAndUpdate(
      {
        org_id: orgId,
        $expr: {
          $gte: [{ $subtract: ["$balance", "$reserved"] }, amount],
        },
      },
      {
        $inc: { reserved: amount },
        $set: { updated_at: new Date() },
      },
      { session, returnDocument: "after" }
    );

    if (!res) {
      // Find current wallet to determine specific failure cause
      const current = await this.collection.findOne({ org_id: orgId }, { session });
      if (!current) {
        return { success: false, error: "Organization wallet not found" };
      }
      const available = current.balance - current.reserved;
      return {
        success: false,
        availableBalance: available,
        error: `Insufficient funds. Available: ${available}, Required: ${amount}`,
      };
    }

    const available = res.balance - res.reserved;
    return { success: true, availableBalance: available };
  }

  /**
   * Releases previously reserved funds when a payout fails, times out, or is cancelled.
   */
  async releaseFunds(orgId: string, amount: number, session?: ClientSession): Promise<boolean> {
    if (amount <= 0) return false;

    const res = await this.collection.updateOne(
      {
        org_id: orgId,
        reserved: { $gte: amount },
      },
      {
        $inc: { reserved: -amount },
        $set: { updated_at: new Date() },
      },
      { session }
    );

    return res.matchedCount > 0;
  }

  /**
   * Completes payout deduction after blockchain transfer confirmation.
   * Atomically decrements both total balance and reserved balance.
   */
  async completeDeduction(orgId: string, amount: number, session?: ClientSession): Promise<boolean> {
    if (amount <= 0) return false;

    const res = await this.collection.updateOne(
      {
        org_id: orgId,
        balance: { $gte: amount },
        reserved: { $gte: amount },
      },
      {
        $inc: { balance: -amount, reserved: -amount },
        $set: { updated_at: new Date() },
      },
      { session }
    );

    return res.matchedCount > 0;
  }

  /**
   * Records a top-up credit to the organization wallet balance.
   */
  async recordTopUp(
    orgId: string,
    amount: number,
    metadata: {
      recordedBy: string; // Foreign reference to SQL auth_users.id (string)
      txHash?: string;
      notes?: string;
    },
    session?: ClientSession
  ): Promise<boolean> {
    if (amount <= 0) return false;

    const now = new Date();
    const res = await this.collection.updateOne(
      { org_id: orgId },
      {
        $inc: { balance: amount },
        $set: {
          updated_at: now,
          lastTopUpTx: {
            amount,
            txHash: metadata.txHash,
            recordedBy: metadata.recordedBy,
            recordedAt: now,
            notes: metadata.notes,
          },
        },
      },
      { session, upsert: false }
    );

    return res.matchedCount > 0;
  }

  /**
   * Retrieves a hunter's user wallet by user_id.
   */
  async getUserWallet(userId: string, session?: ClientSession): Promise<UserWalletDoc | null> {
    return this.userWalletsCol.findOne({ user_id: userId }, { session });
  }

  /**
   * Upserts a hunter's wallet address.
   */
  async upsertUserWallet(
    userId: string,
    data: {
      wallet_address: string;
      network?: string;
      username?: string;
    },
    session?: ClientSession
  ): Promise<UserWalletDoc> {
    const now = new Date();
    const updateDoc: any = {
      $set: {
        wallet_address: data.wallet_address,
        network: data.network || "POLYGON",
        updated_at: now,
      },
      $setOnInsert: {
        _id: userId,
        user_id: userId,
        created_at: now,
      },
    };

    if (data.username) {
      updateDoc.$set.username = data.username;
    }

    await this.userWalletsCol.updateOne(
      { user_id: userId },
      updateDoc,
      { upsert: true, session }
    );

    const doc = await this.userWalletsCol.findOne({ user_id: userId }, { session });
    return doc!;
  }
}

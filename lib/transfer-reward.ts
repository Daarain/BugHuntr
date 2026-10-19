/**
 * Transfer Reward Helper (MongoDB Implementation)
 *
 * Transfers bounty rewards from organization wallet to hunter points/earnings,
 * creating an immutable payout record and audit trail with atomic consistency.
 */

import { getMongoClient, getMongoDatabase } from "@/lib/db/mongodb";
import { WalletsRepository } from "@/lib/db/repositories/wallets.repo";
import { PayoutsRepository } from "@/lib/db/repositories/payouts.repo";
import { GamificationRepository } from "@/lib/db/repositories/gamification.repo";

// Server-only database execution guard
if (typeof window !== "undefined") {
  throw new Error("lib/transfer-reward.ts is a server-only module and cannot be executed in the browser.");
}

const DEFAULT_ORG_WALLET_ID = "demo_org_001";

export interface TransferRewardParams {
  adminUsername: string;
  hunterUsername: string;
  hunterUid: string; // Foreign reference to SQL auth_users.id (string)
  huntId: string;
  submissionId: string;
  amount: number;
  orgWalletId?: string;
}

export async function transferRewardFromAdmin({
  adminUsername,
  hunterUsername,
  hunterUid,
  huntId,
  submissionId,
  amount,
  orgWalletId = DEFAULT_ORG_WALLET_ID,
}: TransferRewardParams): Promise<boolean> {
  if (!adminUsername || !hunterUsername || amount <= 0) {
    throw new Error("Invalid transfer request");
  }

  const client = await getMongoClient();
  const db = await getMongoDatabase();

  const walletsRepo = new WalletsRepository(db);
  const payoutsRepo = new PayoutsRepository(db);
  const gamificationRepo = new GamificationRepository(db);

  // Micro-units calculation (1 token/currency = 1,000,000 micro-units)
  const payoutAmountMicro = Math.floor(amount * 1000000);

  // Check org wallet existence
  let orgWallet = await walletsRepo.getWallet(orgWalletId);
  if (!orgWallet && orgWalletId === DEFAULT_ORG_WALLET_ID) {
    orgWallet = await walletsRepo.createWallet({
      org_id: DEFAULT_ORG_WALLET_ID,
      balance: 10000000000,
      reserved: 0,
      currency: "INR",
      network: "INTERNAL",
    });
  }
  if (!orgWallet) {
    throw new Error("Org wallet not found");
  }

  // Attempt execution within a multi-document ACID transaction if replica set supports it
  let session;
  let useTransaction = false;

  try {
    session = client.startSession();
    // Test if transactions are supported by starting one
    session.startTransaction();
    useTransaction = true;
  } catch {
    // Standalone instances don't support sessions/transactions; fallback to atomic conditional updates
    session = undefined;
    useTransaction = false;
  }

  const payoutOrderId = `BH-PAYOUT-${submissionId}-${Date.now()}`;

  try {
    if (useTransaction && session) {
      // 1. Reserve funds atomically under transaction
      const reserveResult = await walletsRepo.reserveFunds(orgWalletId, payoutAmountMicro, session);
      if (!reserveResult.success) {
        throw new Error(reserveResult.error?.includes("Insufficient") ? "Insufficient org wallet balance" : "Org wallet not found");
      }

      // 2. Complete deduction
      await walletsRepo.completeDeduction(orgWalletId, payoutAmountMicro, session);

      // 3. Award hunter points / earnings in gamification collection
      await gamificationRepo.addPoints(
        hunterUid,
        amount,
        {
          username: hunterUsername,
          reason: `Bounty reward for submission ${submissionId}`,
          bugId: submissionId,
        },
        session
      );

      // 4. Create payout record
      await payoutsRepo.createPayout(
        {
          _id: payoutOrderId,
          order_id: payoutOrderId,
          huntId,
          submissionId,
          orgId: orgWalletId,
          hunterUid,
          hunterWallet: "",
          amount: payoutAmountMicro,
          currency: "INR",
          network: "INTERNAL",
          status: "completed",
          createdBy: adminUsername,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        session
      );

      // 5. Append audit log
      await payoutsRepo.logEvent(
        {
          order_id: payoutOrderId,
          eventType: "reward_transferred_from_admin",
          actorUid: adminUsername,
          data: {
            hunterUid,
            hunterUsername,
            amount: payoutAmountMicro,
            submissionId,
            orgWalletId,
          },
        },
        session
      );

      await session.commitTransaction();
    } else {
      // Standalone Fallback: Atomic conditional update pipeline
      const reserveResult = await walletsRepo.reserveFunds(orgWalletId, payoutAmountMicro);
      if (!reserveResult.success) {
        throw new Error(reserveResult.error?.includes("Insufficient") ? "Insufficient org wallet balance" : "Org wallet not found");
      }

      // Complete deduction
      await walletsRepo.completeDeduction(orgWalletId, payoutAmountMicro);

      // Award hunter points / earnings
      await gamificationRepo.addPoints(hunterUid, amount, {
        username: hunterUsername,
        reason: `Bounty reward for submission ${submissionId}`,
        bugId: submissionId,
      });

      // Create payout record
      await payoutsRepo.createPayout({
        _id: payoutOrderId,
        order_id: payoutOrderId,
        huntId,
        submissionId,
        orgId: orgWalletId,
        hunterUid,
        hunterWallet: "",
        amount: payoutAmountMicro,
        currency: "INR",
        network: "INTERNAL",
        status: "completed",
        createdBy: adminUsername,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Log event
      await payoutsRepo.logEvent({
        order_id: payoutOrderId,
        eventType: "reward_transferred_from_admin",
        actorUid: adminUsername,
        data: {
          hunterUid,
          hunterUsername,
          amount: payoutAmountMicro,
          submissionId,
          orgWalletId,
        },
      });
    }

    return true;
  } catch (err) {
    if (useTransaction && session) {
      try {
        await session.abortTransaction();
      } catch {
        // ignore secondary abort errors
      }
    }
    throw err;
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch {
        // ignore
      }
    }
  }
}
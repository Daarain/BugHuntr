/**
 * Create Payout Cloud Function
 *
 * Callable function that creates a new crypto payout for an approved bug submission.
 *
 * Flow:
 * 1. Validate input and authenticate caller
 * 2. Check organization wallet has sufficient funds
 * 3. Reserve funds atomically
 * 4. Create payout record in Firestore
 * 5. Call Cryptomus API to initiate transfer
 * 6. Update payout status based on API response
 *
 * Idempotency: Uses order_id based on submissionId to prevent duplicate payouts
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { initializeCryptomusClient } from "../utils/cryptomus-client";
import {
  validateWalletAddress,
  validateAmount,
  formatAmountForCryptomus,
  generateOrderId,
} from "../utils/validation";
import {
  releaseReservedFunds,
  createPayoutLog,
} from "../utils/firestore";

const db = admin.firestore();

interface CreatePayoutData {
  submissionId: string;
  huntId: string;
  orgId: string;
  hunterUid: string;
  hunterWallet: string;
  amount: number;
  currency?: string;
  network?: string;
}

/**
 * Create a new payout
 *
 * Usage from Next.js:
 * ```typescript
 * const createPayout = httpsCallable(functions, 'createPayout');
 * const result = await createPayout({
 *   submissionId: 'sub_123',
 *   huntId: 'hunt_456',
 *   orgId: 'org_789',
 *   hunterUid: 'user_abc',
 *   hunterWallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
 *   amount: 1000000, // 1 USDC in micro-units
 *   currency: 'USDC',
 *   network: 'POLYGON'
 * });
 * ```
 */
export const createPayout = functions.https.onCall(
  async (data: CreatePayoutData, context) => {
    // ========================================================================
    // AUTHENTICATION & AUTHORIZATION
    // ========================================================================

    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated to create payouts"
      );
    }

    const callerUid = context.auth.uid;

    // Check if caller is admin (company admin or platform admin)
    const userDoc = await db.collection("users").doc(callerUid).get();
    const userData = userDoc.data();

    if (!userData || (userData.userType !== "admin" && userData.role !== "admin" && userData.role !== "platform_admin")) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only administrators can create payouts"
      );
    }

    functions.logger.info("Payout creation initiated", {
      callerUid,
      submissionId: data.submissionId,
      orgId: data.orgId,
      amount: data.amount,
    });

    // ========================================================================
    // INPUT VALIDATION
    // ========================================================================

    if (
      !data.submissionId ||
      !data.huntId ||
      !data.orgId ||
      !data.hunterUid ||
      !data.hunterWallet ||
      !data.amount
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields: submissionId, huntId, orgId, hunterUid, hunterWallet, amount"
      );
    }

    // ========================================================================
    // GET ORGANIZATION WALLET & ENFORCE TENANT ISOLATION
    // ========================================================================

    const walletDoc = await db.collection("org_wallets").doc(data.orgId).get();

    if (!walletDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        `Organization wallet not found for orgId: ${data.orgId}`
      );
    }

    const wallet = walletDoc.data();

    // Verify caller belongs to the organization or owns the wallet
    const isPlatformAdmin = userData.userType === "platform_admin" || userData.role === "platform_admin";
    const isOrgAdmin = userData.orgId === data.orgId || userData.organizationId === data.orgId;
    const isWalletAdmin = Array.isArray(wallet?.adminUids) && wallet.adminUids.includes(callerUid);
    const isWalletOwner = wallet?.ownerUid === callerUid;

    if (!isPlatformAdmin && !isOrgAdmin && !isWalletAdmin && !isWalletOwner) {
      throw new functions.https.HttpsError(
        "permission-denied",
        `Caller ${callerUid} is not authorized to disburse funds for organization ${data.orgId}`
      );
    }

    // ========================================================================
    // VERIFY SUBMISSION EXISTENCE, STATUS & INTEGRITY
    // ========================================================================

    let submissionDoc = await db.collection("bug_submissions").doc(data.submissionId).get();
    if (!submissionDoc.exists) {
      submissionDoc = await db.collection("vulnerabilities").doc(data.submissionId).get();
    }
    if (!submissionDoc.exists) {
      submissionDoc = await db.collection("bugReports").doc(data.submissionId).get();
    }
    if (!submissionDoc.exists) {
      submissionDoc = await db.collection("submissions").doc(data.submissionId).get();
    }

    if (!submissionDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        `Referenced submission not found: ${data.submissionId}`
      );
    }

    const submissionData = submissionDoc.data() || {};

    // Verify submission matches huntId if huntId is recorded on submission
    if (submissionData.huntId && submissionData.huntId !== data.huntId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Submission huntId '${submissionData.huntId}' does not match payout huntId '${data.huntId}'`
      );
    }

    // Verify submission matches orgId if orgId is recorded on submission
    if (submissionData.orgId && submissionData.orgId !== data.orgId) {
      throw new functions.https.HttpsError(
        "permission-denied",
        `Submission orgId '${submissionData.orgId}' does not match payout orgId '${data.orgId}'`
      );
    }

    // Verify recipient matches the reporter/submitter
    const recordedHunterUid = submissionData.hunterUid || submissionData.reporterUid || submissionData.userId;
    if (recordedHunterUid && recordedHunterUid !== data.hunterUid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        `Recipient hunterUid '${data.hunterUid}' does not match submission reporter '${recordedHunterUid}'`
      );
    }

    // Verify submission approval status
    const subStatus = (submissionData.status || "").toLowerCase();
    const approvedStatuses = ["approved", "accepted", "eligible_for_payout", "triaged", "resolved"];
    if (!approvedStatuses.includes(subStatus)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Submission is not approved for payout (current status: ${submissionData.status || "unknown"})`
      );
    }

    // Verify submission has not already been paid
    if (
      submissionData.payoutStatus === "paid" ||
      submissionData.payoutStatus === "completed" ||
      submissionData.paid === true
    ) {
      throw new functions.https.HttpsError(
        "already-exists",
        `Submission ${data.submissionId} has already been marked as paid`
      );
    }

    // Validate amount limit if submission defines an approved reward
    const maxReward = submissionData.rewardAmount || submissionData.bountyAmount || submissionData.approvedReward;
    if (typeof maxReward === "number" && maxReward > 0 && data.amount > maxReward) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Payout amount (${data.amount}) exceeds approved reward amount (${maxReward})`
      );
    }

    // Validate amount
    const amountValidation = validateAmount(
      data.amount,
      data.currency || "USDC"
    );
    if (!amountValidation.isValid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Invalid amount: ${amountValidation.error}`
      );
    }

    const currency = data.currency || wallet?.currency || "USDC";
    const network = data.network || wallet?.network || "POLYGON";

    // Validate wallet address for the network
    const walletValidation = validateWalletAddress(data.hunterWallet, network);
    if (!walletValidation.isValid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Invalid wallet address: ${walletValidation.error}`
      );
    }

    // ========================================================================
    // ATOMIC PRE-PAYMENT COORDINATION TRANSACTION
    // ========================================================================
    // Atomically in a single Firestore transaction:
    // 1. Checks if a payout record (order_id) already exists (idempotency).
    // 2. Checks current submission status (ensuring not already paid or processing).
    // 3. Verifies org_wallets balance and increments 'reserved'.
    // 4. Locks submission status to 'processing' and links payoutOrderId.
    // 5. Creates the payout document with status 'pending_created'.
    //
    // External Cryptomus payment dispatch is deliberately executed OUTSIDE
    // the retryable transaction callback.

    const order_id = generateOrderId(data.submissionId, data.huntId);
    const payoutRef = db.collection("payouts").doc(order_id);
    const walletRef = db.collection("org_wallets").doc(data.orgId);

    let isExistingPayout = false;
    let existingPayoutData: any = null;

    try {
      await db.runTransaction(async (transaction) => {
        // Step 1: Idempotency check on payout doc
        const payoutDocSnap = await transaction.get(payoutRef);
        if (payoutDocSnap.exists) {
          isExistingPayout = true;
          existingPayoutData = payoutDocSnap.data();
          return;
        }

        // Step 2: Check submission document under transaction lock
        const subDocSnap = await transaction.get(submissionDoc.ref);
        if (!subDocSnap.exists) {
          throw new Error("SUBMISSION_NOT_FOUND");
        }
        const currentSub = subDocSnap.data() || {};
        const currentSubStatus = (currentSub.status || "").toLowerCase();
        if (!approvedStatuses.includes(currentSubStatus)) {
          throw new Error(`SUBMISSION_NOT_APPROVED:${currentSub.status}`);
        }
        if (
          currentSub.payoutStatus === "paid" ||
          currentSub.payoutStatus === "completed" ||
          currentSub.payoutStatus === "processing" ||
          currentSub.paid === true
        ) {
          throw new Error("ALREADY_PAID_OR_PROCESSING");
        }

        // Step 3: Check wallet balance under transaction lock
        const walletDocSnap = await transaction.get(walletRef);
        if (!walletDocSnap.exists) {
          throw new Error("WALLET_NOT_FOUND");
        }
        const currentWallet = walletDocSnap.data() || {};
        const balance = currentWallet.balance || 0;
        const reserved = currentWallet.reserved || 0;
        const available = balance - reserved;
        if (available < data.amount) {
          throw new Error(`INSUFFICIENT_FUNDS:${available}`);
        }

        // Step 4: Atomic state mutations
        transaction.update(walletRef, {
          reserved: admin.firestore.FieldValue.increment(data.amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        transaction.update(submissionDoc.ref, {
          payoutStatus: "processing",
          payoutOrderId: order_id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        transaction.set(payoutRef, {
          order_id,
          huntId: data.huntId,
          submissionId: data.submissionId,
          orgId: data.orgId,
          hunterUid: data.hunterUid,
          hunterWallet: data.hunterWallet,
          amount: data.amount,
          currency,
          network,
          status: "pending_created",
          createdBy: callerUid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    } catch (txError: any) {
      if (txError.message === "ALREADY_PAID_OR_PROCESSING") {
        throw new functions.https.HttpsError(
          "already-exists",
          `Submission ${data.submissionId} is already paid or actively processing a payout.`
        );
      }
      if (txError.message?.startsWith("INSUFFICIENT_FUNDS")) {
        const avail = txError.message.split(":")[1];
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Insufficient funds in organization wallet. Available: ${avail}, Required: ${data.amount}`
        );
      }
      if (txError.message === "SUBMISSION_NOT_FOUND") {
        throw new functions.https.HttpsError("not-found", "Referenced submission not found.");
      }
      if (txError.message === "WALLET_NOT_FOUND") {
        throw new functions.https.HttpsError("not-found", "Organization wallet not found.");
      }
      throw new functions.https.HttpsError("internal", `Transaction failed: ${txError.message}`);
    }

    if (isExistingPayout) {
      functions.logger.info("Payout already exists (idempotency)", {
        order_id,
        status: existingPayoutData?.status,
      });
      return {
        success: true,
        order_id,
        status: existingPayoutData?.status,
        cryptomus_payout_id: existingPayoutData?.cryptomus_payout_id,
        message: "Payout already exists for this submission",
        isExisting: true,
      };
    }

    functions.logger.info("Payout atomic reservation completed", { order_id });

    // ========================================================================
    // CALL CRYPTOMUS API
    // ========================================================================

    try {
      const cryptomusClient = initializeCryptomusClient();

      // Get webhook callback URL from config
      const webhookUrl =
        functions.config().cryptomus?.webhook_url ||
        `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/cryptomusWebhook`;

      const cryptomusResponse = await cryptomusClient.createPayout({
        amount: formatAmountForCryptomus(data.amount, currency),
        currency,
        address: data.hunterWallet,
        order_id,
        network,
        url_callback: webhookUrl,
      });

      // ========================================================================
      // UPDATE PAYOUT WITH CRYPTOMUS RESPONSE
      // ========================================================================

      await db
        .collection("payouts")
        .doc(order_id)
        .update({
          status: "processing",
          cryptomus_payout_id: cryptomusResponse.result?.uuid || null,
          cryptomus_response: cryptomusResponse,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      await createPayoutLog({
        eventType: "create",
        order_id,
        actorUid: callerUid,
        data: {
          request: data,
          response: cryptomusResponse,
          newStatus: "processing",
        },
      });

      // Update submission status to prevent race conditions and duplicate payouts
      await submissionDoc.ref.update({
        payoutStatus: "processing",
        payoutOrderId: order_id,
        payoutInitiatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch((err: any) => {
        functions.logger.warn("Failed to update submission payout status", { error: err.message });
      });

      functions.logger.info("Payout created successfully", {
        order_id,
        cryptomus_payout_id: cryptomusResponse.result?.uuid,
      });

      return {
        success: true,
        order_id,
        status: "processing",
        cryptomus_payout_id: cryptomusResponse.result?.uuid,
        message: "Payout initiated successfully",
      };
    } catch (error: any) {
      // ========================================================================
      // ERROR HANDLING - AMBIGUOUS VS DEFINITIVE REJECTION
      // ========================================================================

      functions.logger.error("Cryptomus API error", {
        order_id,
        error: error.message,
        details: error.details,
      });

      // Determine if error is a definitive client rejection (HTTP 4xx except 408 Request Timeout and 429 Rate Limit)
      const rawCode = error.code;
      const numCode = typeof rawCode === "number" ? rawCode : parseInt(String(rawCode), 10);
      const isDefinitiveRejection =
        !isNaN(numCode) &&
        numCode >= 400 &&
        numCode < 500 &&
        numCode !== 408 &&
        numCode !== 429;

      if (isDefinitiveRejection) {
        // Safe to release reserved funds since gateway definitively rejected the order
        functions.logger.info("Definitive gateway rejection; releasing reserved funds", {
          order_id,
          code: error.code,
        });

        await releaseReservedFunds(data.orgId, data.amount);

        await submissionDoc.ref
          .update({
            payoutStatus: "failed",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
          .catch((err) => {
            functions.logger.error("Failed to reset submission payoutStatus after payout error", {
              submissionId: data.submissionId,
              error: err.message,
            });
          });

        await db
          .collection("payouts")
          .doc(order_id)
          .update({
            status: "failed",
            error: {
              code: error.code || "CRYPTOMUS_ERROR",
              message: error.message,
              details: error.details,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

        await createPayoutLog({
          eventType: "create",
          order_id,
          actorUid: callerUid,
          data: {
            request: data,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
            newStatus: "failed",
          },
        });
      } else {
        // Ambiguous error (5xx, timeout, network failure, etc.)
        // DO NOT release reserved funds to avoid double-spend if the gateway processed the payout!
        // The transaction remains in 'pending_external_confirmation' until webhook or reconciliation resolves it.
        functions.logger.warn(
          "Ambiguous gateway response; retaining reserved funds in pending_external_confirmation status",
          {
            order_id,
            error: error.message,
            code: error.code,
          }
        );

        await submissionDoc.ref
          .update({
            payoutStatus: "pending_external_confirmation",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
          .catch((err) => {
            functions.logger.error("Failed to update submission to pending_external_confirmation", {
              submissionId: data.submissionId,
              error: err.message,
            });
          });

        await db
          .collection("payouts")
          .doc(order_id)
          .update({
            status: "pending_external_confirmation",
            error: {
              code: error.code || "AMBIGUOUS_GATEWAY_ERROR",
              message: error.message,
              details: error.details,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

        await createPayoutLog({
          eventType: "create",
          order_id,
          actorUid: callerUid,
          data: {
            request: data,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
            newStatus: "pending_external_confirmation",
          },
        });
      }

      throw new functions.https.HttpsError(
        "internal",
        `Failed to create payout: ${error.message}`,
        error.details
      );
    }
  }
);

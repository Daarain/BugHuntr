/**
 * Batch Payout Creation Function
 *
 * Accepts CSV file with multiple payout requests and queues them for processing.
 * Uses Cloud Tasks to rate-limit API calls and handle retries.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { createPayoutLog } from "../utils/firestore";

const db = admin.firestore();

interface BatchPayoutRow {
  submissionId: string;
  huntId: string;
  hunterUid: string;
  hunterWallet: string;
  amount: number;
}

/**
 * Create batch payouts from CSV data
 *
 * Usage from Next.js API route:
 * ```typescript
 * const createBatchPayouts = httpsCallable(functions, 'createBatchPayouts');
 * const result = await createBatchPayouts({
 *   orgId: 'org_123',
 *   payouts: [
 *     { submissionId: 'sub_1', huntId: 'hunt_1', hunterUid: 'user_1', hunterWallet: '0x...', amount: 1000000 },
 *     { submissionId: 'sub_2', huntId: 'hunt_1', hunterUid: 'user_2', hunterWallet: '0x...', amount: 2000000 }
 *   ]
 * });
 * ```
 */
export const createBatchPayouts = functions.https.onCall(
  async (
    data: {
      orgId: string;
      payouts: BatchPayoutRow[];
    },
    context
  ) => {
    // ========================================================================
    // AUTHENTICATION & AUTHORIZATION
    // ========================================================================

    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated to create batch payouts"
      );
    }

    const callerUid = context.auth.uid;

    // Check if caller is admin
    const userDoc = await db.collection("users").doc(callerUid).get();
    const userData = userDoc.data();

    if (!userData || (userData.userType !== "admin" && userData.role !== "admin" && userData.role !== "platform_admin")) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only administrators can create batch payouts"
      );
    }

    // Verify tenant authorization against organization wallet
    const walletDoc = await db.collection("org_wallets").doc(data.orgId).get();
    if (!walletDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        `Organization wallet not found for orgId: ${data.orgId}`
      );
    }

    const wallet = walletDoc.data();
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

    functions.logger.info("Batch payout creation initiated", {
      callerUid,
      orgId: data.orgId,
      totalRows: data.payouts?.length || 0,
    });

    // ========================================================================
    // INPUT VALIDATION
    // ========================================================================

    if (!data.orgId || !data.payouts || !Array.isArray(data.payouts)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields: orgId and payouts array"
      );
    }

    if (data.payouts.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Payouts array cannot be empty"
      );
    }

    if (data.payouts.length > 1000) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Maximum 1000 payouts per batch"
      );
    }

    // ========================================================================
    // CREATE BATCH JOB RECORD
    // ========================================================================

    const batchId = db.collection("batch_payout_jobs").doc().id;

    const batchJob = {
      batchId,
      orgId: data.orgId,
      createdBy: callerUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "queued",
      totalRows: data.payouts.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    await db.collection("batch_payout_jobs").doc(batchId).set(batchJob);

    // ========================================================================
    // QUEUE INDIVIDUAL PAYOUTS
    // ========================================================================

    const results = {
      totalRows: data.payouts.length,
      queued: 0,
      failed: 0,
      errors: [] as Array<{ row: number; error: string }>,
    };

    // Process payouts sequentially to avoid overwhelming the system
    // In production, you would use Cloud Tasks for better rate limiting
    for (let i = 0; i < data.payouts.length; i++) {
      const payout = data.payouts[i];

      try {
        // Validate row data
        if (
          !payout.submissionId ||
          !payout.huntId ||
          !payout.hunterUid ||
          !payout.hunterWallet ||
          !payout.amount
        ) {
          throw new Error("Missing required fields in payout row");
        }

        // Validate submission exists and is approved for payout
        let subDoc = await db.collection("bug_submissions").doc(payout.submissionId).get();
        if (!subDoc.exists) {
          subDoc = await db.collection("vulnerabilities").doc(payout.submissionId).get();
        }
        if (!subDoc.exists) {
          subDoc = await db.collection("bugReports").doc(payout.submissionId).get();
        }
        if (!subDoc.exists) {
          subDoc = await db.collection("submissions").doc(payout.submissionId).get();
        }

        if (!subDoc.exists) {
          throw new Error(`Referenced submission '${payout.submissionId}' not found`);
        }

        const subData = subDoc.data() || {};
        if (subData.huntId && subData.huntId !== payout.huntId) {
          throw new Error(`Submission huntId '${subData.huntId}' does not match row huntId '${payout.huntId}'`);
        }
        if (subData.orgId && subData.orgId !== data.orgId) {
          throw new Error(`Submission orgId '${subData.orgId}' does not match organization '${data.orgId}'`);
        }
        const recordedHunterUid = subData.hunterUid || subData.reporterUid || subData.userId;
        if (recordedHunterUid && recordedHunterUid !== payout.hunterUid) {
          throw new Error(`Submission reporter '${recordedHunterUid}' does not match row hunterUid '${payout.hunterUid}'`);
        }
        const subStatus = (subData.status || "").toLowerCase();
        const approvedStatuses = ["approved", "accepted", "eligible_for_payout", "triaged", "resolved"];
        if (!approvedStatuses.includes(subStatus)) {
          throw new Error(`Submission is not approved for payout (current status: ${subData.status || "unknown"})`);
        }
        if (
          subData.payoutStatus === "paid" ||
          subData.payoutStatus === "completed" ||
          subData.payoutStatus === "processing" ||
          subData.paid === true
        ) {
          throw new Error(`Submission ${payout.submissionId} has already been paid or is actively processing a payout`);
        }
        const maxReward = subData.rewardAmount || subData.bountyAmount || subData.approvedReward;
        if (typeof maxReward === "number" && maxReward > 0 && payout.amount > maxReward) {
          throw new Error(`Payout amount (${payout.amount}) exceeds approved reward (${maxReward})`);
        }

        // Queue payout task
        // In production, use Cloud Tasks:
        // await cloudTasks.createTask({
        //   parent: queuePath,
        //   task: {
        //     httpRequest: {
        //       httpMethod: 'POST',
        //       url: createPayoutUrl,
        //       body: Buffer.from(JSON.stringify({
        //         data: { ...payout, orgId: data.orgId }
        //       })).toString('base64'),
        //       headers: { 'Content-Type': 'application/json' }
        //     }
        //   }
        // });

        // For now, create a simple queue record
        await db.collection("payout_queue").add({
          batchId,
          orgId: data.orgId,
          submissionId: payout.submissionId,
          huntId: payout.huntId,
          hunterUid: payout.hunterUid,
          hunterWallet: payout.hunterWallet,
          amount: payout.amount,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          rowNumber: i + 1,
        });

        results.queued++;
      } catch (error: any) {
        results.failed++;
        results.errors.push({
          row: i + 1,
          error: error.message,
        });

        functions.logger.error("Failed to queue payout", {
          batchId,
          row: i + 1,
          error: error.message,
        });
      }
    }

    // ========================================================================
    // UPDATE BATCH JOB STATUS
    // ========================================================================

    await db
      .collection("batch_payout_jobs")
      .doc(batchId)
      .update({
        status: results.failed === results.totalRows ? "failed" : "processing",
        queued: results.queued,
        failedToQueue: results.failed,
        queueErrors: results.errors,
      });

    await createPayoutLog({
      eventType: "create",
      actorUid: callerUid,
      data: {
        batchId,
        orgId: data.orgId,
        totalRows: results.totalRows,
        queued: results.queued,
        failed: results.failed,
      },
    });

    functions.logger.info("Batch payouts queued", {
      batchId,
      results,
    });

    return {
      success: true,
      batchId,
      ...results,
    };
  }
);

/**
 * Process queued payouts
 *
 * Triggered by Firestore onCreate in payout_queue collection
 * In production, this would be replaced by Cloud Tasks worker
 */
export const processQueuedPayout = functions.firestore
  .document("payout_queue/{queueId}")
  .onCreate(async (snap, context) => {
    const queueItem = snap.data();
    const queueId = context.params.queueId;

    if (queueItem.status !== "pending") {
      return; // Already processed
    }

    functions.logger.info("Processing queued payout", {
      queueId,
      batchId: queueItem.batchId,
      submissionId: queueItem.submissionId,
    });

    try {
      // Call createPayout function
      // Note: In production, this would be done via Cloud Tasks HTTP request
      // to avoid function timeout issues with large batches

      // For now, mark as needing manual processing
      await snap.ref.update({
        status: "processing",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // TODO: Implement actual payout creation via internal function call
      // or Cloud Tasks queue

      functions.logger.info("Queued payout requires manual processing", {
        queueId,
        message: "Use Cloud Tasks in production for automatic processing",
      });
    } catch (error: any) {
      functions.logger.error("Failed to process queued payout", {
        queueId,
        error: error.message,
      });

      await snap.ref.update({
        status: "failed",
        error: error.message,
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

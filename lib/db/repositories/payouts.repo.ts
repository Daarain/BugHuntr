/**
 * Payouts & Audit Logs Repository (MongoDB)
 *
 * Implements idempotent payout creation, status progression, audit logging,
 * and bulk payout job management.
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type { PayoutDoc, PayoutLogDoc, BatchPayoutJobDoc, MongoPayoutStatus } from "../types";

export class PayoutsRepository {
  private payoutsCol: Collection<PayoutDoc>;
  private logsCol: Collection<PayoutLogDoc>;
  private batchJobsCol: Collection<BatchPayoutJobDoc>;

  constructor(db: Db) {
    this.payoutsCol = db.collection<PayoutDoc>("payouts");
    this.logsCol = db.collection<PayoutLogDoc>("payout_logs");
    this.batchJobsCol = db.collection<BatchPayoutJobDoc>("batch_payout_jobs");
  }

  /**
   * Creates a payout record.
   * Guarded by unique index on order_id to enforce strict idempotency.
   */
  async createPayout(payout: PayoutDoc, session?: ClientSession): Promise<PayoutDoc> {
    const doc: PayoutDoc = {
      ...payout,
      _id: payout.order_id,
      createdAt: payout.createdAt || new Date(),
      updatedAt: payout.updatedAt || new Date(),
    };

    await this.payoutsCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Retrieves a payout by its unique order_id.
   */
  async getByOrderId(orderId: string, session?: ClientSession): Promise<PayoutDoc | null> {
    return this.payoutsCol.findOne({ order_id: orderId }, { session });
  }

  /**
   * Retrieves a payout by associated submissionId.
   */
  async getBySubmissionId(submissionId: string, session?: ClientSession): Promise<PayoutDoc | null> {
    return this.payoutsCol.findOne({ submissionId }, { session });
  }

  /**
   * Updates payout status and associated metadata (tx_hash, cryptomus_response, error).
   */
  async updateStatus(
    orderId: string,
    status: MongoPayoutStatus,
    metadata?: {
      tx_hash?: string;
      cryptomus_payout_id?: string;
      cryptomus_response?: any;
      webhook_payload?: any;
      error?: { code: string; message: string; details?: any };
    },
    session?: ClientSession
  ): Promise<boolean> {
    const update: any = {
      $set: {
        status,
        updatedAt: new Date(),
      },
    };

    if (metadata?.tx_hash) update.$set.tx_hash = metadata.tx_hash;
    if (metadata?.cryptomus_payout_id) update.$set.cryptomus_payout_id = metadata.cryptomus_payout_id;
    if (metadata?.cryptomus_response) update.$set.cryptomus_response = metadata.cryptomus_response;
    if (metadata?.error) update.$set.error = metadata.error;

    if (metadata?.webhook_payload) {
      update.$push = {
        webhook_history: {
          receivedAt: new Date(),
          payload: metadata.webhook_payload,
        },
      };
    }

    const res = await this.payoutsCol.updateOne({ order_id: orderId }, update, { session });
    return res.matchedCount > 0;
  }

  /**
   * Queries payouts for a specific hunter (hunter isolation).
   */
  async listByHunter(hunterUid: string, limit = 50): Promise<PayoutDoc[]> {
    return this.payoutsCol.find({ hunterUid }).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  /**
   * Queries payouts for a specific organization (org isolation).
   */
  async listByOrg(orgId: string, limit = 50): Promise<PayoutDoc[]> {
    return this.payoutsCol.find({ orgId }).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  /**
   * Appends an immutable audit log entry.
   */
  async logEvent(logData: Omit<PayoutLogDoc, "_id" | "createdAt">, session?: ClientSession): Promise<PayoutLogDoc> {
    const doc: PayoutLogDoc = {
      ...logData,
      _id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date(),
    };

    await this.logsCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Retrieves recent audit logs for an order_id.
   */
  async getLogsByOrderId(orderId: string): Promise<PayoutLogDoc[]> {
    return this.logsCol.find({ order_id: orderId }).sort({ createdAt: 1 }).toArray();
  }

  /**
   * Creates a batch payout job record.
   */
  async createBatchJob(job: BatchPayoutJobDoc, session?: ClientSession): Promise<BatchPayoutJobDoc> {
    const doc: BatchPayoutJobDoc = {
      ...job,
      _id: job.batch_id,
      created_at: job.created_at || new Date(),
    };

    await this.batchJobsCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Updates batch payout job progress.
   */
  async updateBatchJob(
    batchId: string,
    update: {
      status?: "pending" | "processing" | "completed" | "failed";
      processed?: number;
      errors?: Array<{ row: number; error: string }>;
    },
    session?: ClientSession
  ): Promise<boolean> {
    const $set: any = {};
    if (update.status) $set.status = update.status;
    if (update.processed !== undefined) $set.processed = update.processed;
    if (update.errors) $set.errors = update.errors;

    const res = await this.batchJobsCol.updateOne({ batch_id: batchId }, { $set }, { session });
    return res.matchedCount > 0;
  }

  /**
   * Retrieves a batch payout job by batchId.
   */
  async getBatchJob(batchId: string, session?: ClientSession): Promise<BatchPayoutJobDoc | null> {
    return this.batchJobsCol.findOne({ batch_id: batchId }, { session });
  }

  /**
   * Lists all payouts with optional limit.
   */
  async listAll(limit = 100): Promise<PayoutDoc[]> {
    return this.payoutsCol.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  }
}

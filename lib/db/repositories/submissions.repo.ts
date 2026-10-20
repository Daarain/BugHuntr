/**
 * Bug Submissions Repository (MongoDB)
 *
 * Implements report management, triage lifecycle, and tenancy isolation
 * (Hunter isolation & Organization isolation).
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type { BugSubmissionDoc } from "../types";

export class SubmissionsRepository {
  private collection: Collection<BugSubmissionDoc>;

  constructor(db: Db) {
    this.collection = db.collection<BugSubmissionDoc>("bug_submissions");
  }

  /**
   * Creates a new bug submission document.
   */
  async createSubmission(submission: BugSubmissionDoc, session?: ClientSession): Promise<BugSubmissionDoc> {
    const doc: BugSubmissionDoc = {
      ...submission,
      payout_status: submission.payout_status || "unpaid",
      created_at: submission.created_at || new Date(),
      updated_at: submission.updated_at || new Date(),
    };

    await this.collection.insertOne(doc, { session });
    return doc;
  }

  /**
   * Retrieves a submission by ID.
   */
  async getById(id: string, session?: ClientSession): Promise<BugSubmissionDoc | null> {
    return this.collection.findOne({ _id: id }, { session });
  }

  /**
   * Hunter Isolation: Hunters may ONLY query their own submissions.
   */
  async listByHunter(
    hunterId: string,
    options?: { status?: string; limit?: number }
  ): Promise<BugSubmissionDoc[]> {
    const filter: any = { hunter_id: hunterId };
    if (options?.status) filter.status = options.status;

    return this.collection
      .find(filter)
      .sort({ created_at: -1 })
      .limit(options?.limit || 50)
      .toArray();
  }

  /**
   * Counts submissions by hunter ID and optional status.
   */
  async countByHunter(hunterId: string, status?: string): Promise<number> {
    const filter: any = { hunter_id: hunterId };
    if (status) filter.status = status;
    return this.collection.countDocuments(filter);
  }

  /**
   * Organization Isolation: Enterprise org members may ONLY query submissions targeting their bounty programs.
   */
  async listByOrg(
    orgId: string,
    options?: { status?: string; limit?: number }
  ): Promise<BugSubmissionDoc[]> {
    const filter: any = { org_id: orgId };
    if (options?.status) filter.status = options.status;

    return this.collection
      .find(filter)
      .sort({ created_at: -1 })
      .limit(options?.limit || 50)
      .toArray();
  }

  /**
   * Updates submission triage status and records review details.
   */
  async updateStatus(
    id: string,
    status: BugSubmissionDoc["status"],
    reviewerId?: string,
    notes?: string,
    session?: ClientSession
  ): Promise<boolean> {
    const update: any = {
      $set: {
        status,
        updated_at: new Date(),
      },
    };
    if (reviewerId) update.$set.reviewed_by = reviewerId;
    if (reviewerId) update.$set.reviewed_at = new Date();
    if (notes) update.$set.admin_notes = notes;

    const res = await this.collection.updateOne({ _id: id }, update, { session });
    return res.matchedCount > 0;
  }

  /**
   * Atomically transitions payout status (e.g. from unpaid -> processing with order_id).
   */
  async updatePayoutStatus(
    id: string,
    payoutStatus: BugSubmissionDoc["payout_status"],
    orderId?: string,
    session?: ClientSession
  ): Promise<boolean> {
    const $set: any = {
      payout_status: payoutStatus,
      updated_at: new Date(),
    };
    if (orderId) $set.payout_order_id = orderId;

    const res = await this.collection.updateOne({ _id: id }, { $set }, { session });
    return res.matchedCount > 0;
  }

  /**
   * Queries all submissions targeting a specific bounty hunt.
   */
  async listByHunt(
    huntId: string,
    options?: { status?: string; limit?: number }
  ): Promise<BugSubmissionDoc[]> {
    const filter: any = { bounty_id: huntId };
    if (options?.status) filter.status = options.status;

    return this.collection
      .find(filter)
      .sort({ created_at: -1 })
      .limit(options?.limit || 100)
      .toArray();
  }

  /**
   * Queries all submissions (administrative and staff triage view).
   */
  async listAll(options?: { status?: string; limit?: number }): Promise<BugSubmissionDoc[]> {
    const filter: any = {};
    if (options?.status) filter.status = options.status;

    return this.collection
      .find(filter)
      .sort({ created_at: -1 })
      .limit(options?.limit || 100)
      .toArray();
  }

  /**
   * Deletes a bug submission.
   */
  async deleteSubmission(id: string, session?: ClientSession): Promise<boolean> {
    const res = await this.collection.deleteOne({ _id: id }, { session });
    return res.deletedCount > 0;
  }

  /**
   * Checks for existing duplicate submissions (pending or approved) with matching title or company.
   */
  async findDuplicate(params: {
    title?: string;
    orgId?: string;
    bountyId?: string;
  }): Promise<BugSubmissionDoc | null> {
    if (!params.title) return null;
    const escaped = params.title.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter: any = {
      title: { $regex: new RegExp(`^${escaped}$`, "i") },
      status: { $in: ["approved", "pending"] },
    };
    if (params.orgId) {
      filter.org_id = { $regex: new RegExp(`^${params.orgId.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") };
    }
    if (params.bountyId) {
      filter.bounty_id = params.bountyId;
    }
    return this.collection.findOne(filter);
  }
}

/**
 * Bug Hunts Repository (MongoDB)
 *
 * Implements bug bounty programs, catalog queries, polymorphic scopes, and reward matrices.
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type { BugHuntDoc } from "../types";

export class HuntsRepository {
  private collection: Collection<BugHuntDoc>;

  constructor(db: Db) {
    this.collection = db.collection<BugHuntDoc>("bug_hunts");
  }

  /**
   * Creates a new bug hunt program.
   */
  async createHunt(hunt: BugHuntDoc, session?: ClientSession): Promise<BugHuntDoc> {
    const doc: BugHuntDoc = {
      ...hunt,
      currentParticipants: hunt.currentParticipants || 0,
      created_at: hunt.created_at || new Date(),
      updated_at: hunt.updated_at || new Date(),
    };

    await this.collection.insertOne(doc, { session });
    return doc;
  }

  /**
   * Retrieves a bug hunt by its ID.
   */
  async getById(id: string, session?: ClientSession): Promise<BugHuntDoc | null> {
    return this.collection.findOne({ _id: id }, { session });
  }

  /**
   * Queries active public bug hunts.
   */
  async listActive(filters?: {
    difficulty?: BugHuntDoc["difficulty"];
    category?: string;
    limit?: number;
  }): Promise<BugHuntDoc[]> {
    const query: any = { status: "active", visibility: "public" };
    if (filters?.difficulty) query.difficulty = filters.difficulty;
    if (filters?.category) query.categories = filters.category;

    return this.collection
      .find(query)
      .sort({ created_at: -1 })
      .limit(filters?.limit || 50)
      .toArray();
  }

  /**
   * Queries all hunts managed by an organization.
   */
  async listByOrg(orgId: string, limit = 50): Promise<BugHuntDoc[]> {
    return this.collection
      .find({ org_id: orgId })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Updates program status (e.g., active, paused, completed).
   */
  async updateStatus(
    id: string,
    status: BugHuntDoc["status"],
    session?: ClientSession
  ): Promise<boolean> {
    const res = await this.collection.updateOne(
      { _id: id },
      { $set: { status, updated_at: new Date() } },
      { session }
    );
    return res.matchedCount > 0;
  }

  /**
   * Queries all hunts (administrative / catalog view).
   */
  async listAll(limit = 100): Promise<BugHuntDoc[]> {
    return this.collection
      .find({})
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Updates arbitrary hunt program fields.
   */
  async updateHunt(
    id: string,
    updates: Partial<BugHuntDoc>,
    session?: ClientSession
  ): Promise<boolean> {
    const { _id, created_at, ...allowedUpdates } = updates as any;
    const res = await this.collection.updateOne(
      { _id: id },
      { $set: { ...allowedUpdates, updated_at: new Date() } },
      { session }
    );
    return res.matchedCount > 0;
  }

  /**
   * Deletes a bug hunt program.
   */
  async deleteHunt(id: string, session?: ClientSession): Promise<boolean> {
    const res = await this.collection.deleteOne({ _id: id }, { session });
    return res.deletedCount > 0;
  }
}

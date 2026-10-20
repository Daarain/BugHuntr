/**
 * Pro Subscriptions & Collaboration Repository (MongoDB)
 *
 * Implements enterprise tier subscriptions, private bug hunt invitations,
 * researcher applications/bids, and signed NDAs.
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type {
  ProSubscriptionDoc,
  ProInvitationDoc,
  ProApplicationDoc,
  ProNdaDoc,
  ProHuntDoc,
} from "../types";

export class ProRepository {
  private subCol: Collection<ProSubscriptionDoc>;
  private invCol: Collection<ProInvitationDoc>;
  private appCol: Collection<ProApplicationDoc>;
  private ndaCol: Collection<ProNdaDoc>;
  private huntCol: Collection<ProHuntDoc>;

  constructor(db: Db) {
    this.subCol = db.collection<ProSubscriptionDoc>("pro_subscriptions");
    this.invCol = db.collection<ProInvitationDoc>("pro_invitations");
    this.appCol = db.collection<ProApplicationDoc>("pro_applications");
    this.ndaCol = db.collection<ProNdaDoc>("pro_ndas");
    this.huntCol = db.collection<ProHuntDoc>("pro_hunts");
  }

  /**
   * Retrieves an enterprise organization's Pro subscription.
   */
  async getSubscription(orgId: string, session?: ClientSession): Promise<ProSubscriptionDoc | null> {
    return this.subCol.findOne({ org_id: orgId }, { session });
  }

  /**
   * Upserts a Pro subscription status.
   */
  async upsertSubscription(
    sub: ProSubscriptionDoc,
    session?: ClientSession
  ): Promise<ProSubscriptionDoc> {
    const doc: ProSubscriptionDoc = {
      ...sub,
      _id: sub.org_id,
      updated_at: new Date(),
    };

    await this.subCol.updateOne(
      { org_id: sub.org_id },
      { $set: doc },
      { upsert: true, session }
    );

    return doc;
  }

  /**
   * Issues an invitation to a private bug hunt.
   */
  async createInvitation(
    inv: ProInvitationDoc,
    session?: ClientSession
  ): Promise<ProInvitationDoc> {
    const doc: ProInvitationDoc = {
      ...inv,
      status: inv.status || "pending",
      created_at: inv.created_at || new Date(),
    };

    await this.invCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Finds an invitation by token.
   */
  async getInvitationByToken(token: string, session?: ClientSession): Promise<ProInvitationDoc | null> {
    return this.invCol.findOne({ token }, { session });
  }

  /**
   * Updates invitation acceptance status.
   */
  async updateInvitationStatus(
    id: string,
    status: ProInvitationDoc["status"],
    hunterId?: string,
    session?: ClientSession
  ): Promise<boolean> {
    const now = new Date();
    const $set: any = { status, responded_at: now };
    if (status === "accepted") {
      $set.accepted_at = now;
    }
    if (hunterId) $set.hunter_id = hunterId;

    const filter: any = { _id: id };
    if (status === "accepted" || status === "declined") {
      filter.status = "pending";
    }

    const res = await this.invCol.updateOne(filter, { $set }, { session });
    return (res.modifiedCount ?? res.matchedCount ?? 0) > 0;
  }

  /**
   * Submits a researcher bid/application for a private hunt.
   */
  async submitApplication(
    app: ProApplicationDoc,
    session?: ClientSession
  ): Promise<ProApplicationDoc> {
    const doc: ProApplicationDoc = {
      ...app,
      _id: `${app.hunt_id}:${app.hunter_id}`,
      status: app.status || "pending",
      created_at: app.created_at || new Date(),
    };

    await this.appCol.updateOne(
      { hunt_id: app.hunt_id, hunter_id: app.hunter_id },
      { $set: doc },
      { upsert: true, session }
    );

    return doc;
  }

  /**
   * Lists researcher applications for a hunt.
   */
  async listApplications(huntId: string): Promise<ProApplicationDoc[]> {
    return this.appCol.find({ hunt_id: huntId }).toArray();
  }

  /**
   * Records a signed Non-Disclosure Agreement (NDA).
   */
  async signNda(nda: ProNdaDoc, session?: ClientSession): Promise<ProNdaDoc> {
    const doc: ProNdaDoc = {
      ...nda,
      _id: `${nda.hunt_id}:${nda.hunter_id}`,
      signed_at: nda.signed_at || new Date(),
    };

    await this.ndaCol.updateOne(
      { hunt_id: nda.hunt_id, hunter_id: nda.hunter_id },
      { $set: doc },
      { upsert: true, session }
    );

    return doc;
  }

  /**
   * Checks if a researcher has signed an NDA for a private hunt.
   */
  async hasSignedNda(huntId: string, hunterId: string, session?: ClientSession): Promise<boolean> {
    const doc = await this.ndaCol.findOne({ hunt_id: huntId, hunter_id: hunterId }, { session });
    return doc !== null;
  }

  /**
   * Retrieves an invitation by its document ID.
   */
  async getInvitationById(id: string, session?: ClientSession): Promise<ProInvitationDoc | null> {
    return this.invCol.findOne({ _id: id }, { session });
  }

  /**
   * Lists invitations matching criteria.
   */
  async listInvitations(filters: {
    huntId?: string;
    hunterId?: string;
    hunterUsername?: string;
    status?: string | string[];
    limit?: number;
  }): Promise<ProInvitationDoc[]> {
    const query: any = {};
    if (filters.huntId) {
      query.hunt_id = filters.huntId;
    }
    if (filters.hunterId || filters.hunterUsername) {
      const orClauses: any[] = [];
      if (filters.hunterId) {
        orClauses.push({ hunter_id: filters.hunterId });
      }
      if (filters.hunterUsername) {
        orClauses.push({ hunter_username: filters.hunterUsername });
      }
      query.$or = orClauses;
    }
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query.status = { $in: filters.status };
      } else if (filters.status.includes(",")) {
        query.status = { $in: filters.status.split(",").map((s) => s.trim()) };
      } else {
        query.status = filters.status;
      }
    }

    return this.invCol
      .find(query)
      .sort({ created_at: -1 })
      .limit(filters.limit || 100)
      .toArray();
  }

  // --- PRO HUNTS CRUD ---

  /**
   * Creates a new Pro Bug Hunt in MongoDB.
   */
  async createHunt(hunt: ProHuntDoc, session?: ClientSession): Promise<ProHuntDoc> {
    const doc: ProHuntDoc = {
      ...hunt,
      currentHunters: hunt.currentHunters || 0,
      created_at: hunt.created_at || new Date(),
      updated_at: hunt.updated_at || new Date(),
    };
    await this.huntCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Lists Pro Bug Hunts with optional filtering.
   */
  async listHunts(filters?: {
    companyId?: string;
    status?: string;
    createdBy?: string;
    limit?: number;
  }): Promise<ProHuntDoc[]> {
    const query: any = {};
    if (filters?.companyId) query.companyId = filters.companyId;
    if (filters?.createdBy) query.createdBy = filters.createdBy;
    if (filters?.status && filters.status !== "all") query.status = filters.status;

    return this.huntCol
      .find(query)
      .sort({ created_at: -1 })
      .limit(filters?.limit || 100)
      .toArray();
  }

  /**
   * Retrieves a Pro Bug Hunt by its ID.
   */
  async getHuntById(id: string, session?: ClientSession): Promise<ProHuntDoc | null> {
    return this.huntCol.findOne({ _id: id }, { session });
  }

  /**
   * Updates an existing Pro Bug Hunt.
   */
  async updateHunt(
    id: string,
    updates: Partial<ProHuntDoc>,
    session?: ClientSession
  ): Promise<boolean> {
    const { _id, created_at, ...allowedUpdates } = updates as any;
    const res = await this.huntCol.updateOne(
      { _id: id },
      { $set: { ...allowedUpdates, updated_at: new Date() } },
      { session }
    );
    return res.matchedCount > 0;
  }

  /**
   * Atomically increments currentHunters count on a hunt when invitation is accepted.
   */
  async incrementHuntHunters(
    id: string,
    count = 1,
    session?: ClientSession
  ): Promise<boolean> {
    const res = await this.huntCol.updateOne(
      { _id: id },
      { $inc: { currentHunters: count }, $set: { updated_at: new Date() } },
      { session }
    );
    return res.matchedCount > 0;
  }

  /**
   * Deletes a Pro Bug Hunt.
   */
  async deleteHunt(id: string, session?: ClientSession): Promise<boolean> {
    const res = await this.huntCol.deleteOne({ _id: id }, { session });
    return res.deletedCount > 0;
  }
}

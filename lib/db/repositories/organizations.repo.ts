/**
 * Organizations & Tenancy Repository (MongoDB)
 *
 * Implements multi-tenant organization profiles and tenant role memberships.
 * Cross-database logical user reference: org_members.user_id -> SQL auth_users.id.
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type { OrganizationDoc, OrgMemberDoc } from "../types";

export class OrganizationsRepository {
  private orgsCol: Collection<OrganizationDoc>;
  private membersCol: Collection<OrgMemberDoc>;

  constructor(db: Db) {
    this.orgsCol = db.collection<OrganizationDoc>("organizations");
    this.membersCol = db.collection<OrgMemberDoc>("org_members");
  }

  /**
   * Creates or registers a new organization.
   */
  async createOrg(org: OrganizationDoc, session?: ClientSession): Promise<OrganizationDoc> {
    const doc: OrganizationDoc = {
      ...org,
      created_at: org.created_at || new Date(),
      updated_at: org.updated_at || new Date(),
    };

    await this.orgsCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Retrieves an organization by ID.
   */
  async getById(id: string, session?: ClientSession): Promise<OrganizationDoc | null> {
    return this.orgsCol.findOne({ _id: id }, { session });
  }

  /**
   * Retrieves an organization by URL slug.
   */
  async getBySlug(slug: string, session?: ClientSession): Promise<OrganizationDoc | null> {
    return this.orgsCol.findOne({ slug }, { session });
  }

  /**
   * Adds or updates a user's membership within an organization.
   */
  async addMember(member: OrgMemberDoc, session?: ClientSession): Promise<OrgMemberDoc> {
    const doc: OrgMemberDoc = {
      ...member,
      _id: member._id || `${member.org_id}:${member.user_id}`,
      joined_at: member.joined_at || new Date(),
    };

    await this.membersCol.updateOne(
      { org_id: member.org_id, user_id: member.user_id },
      { $set: doc },
      { upsert: true, session }
    );

    return doc;
  }

  /**
   * Retrieves a specific member's role within an organization.
   */
  async getMember(orgId: string, userId: string, session?: ClientSession): Promise<OrgMemberDoc | null> {
    return this.membersCol.findOne({ org_id: orgId, user_id: userId }, { session });
  }

  /**
   * Lists all members of an organization.
   */
  async listMembers(orgId: string): Promise<OrgMemberDoc[]> {
    return this.membersCol.find({ org_id: orgId }).toArray();
  }

  /**
   * Lists all organizations where a user holds a membership.
   */
  async listUserOrgs(userId: string): Promise<OrgMemberDoc[]> {
    return this.membersCol.find({ user_id: userId }).toArray();
  }
}

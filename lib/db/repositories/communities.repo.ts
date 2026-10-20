/**
 * Communities & Social Collaboration Repository (MongoDB)
 *
 * Implements high-volume collaborative spaces, community memberships,
 * discussion channels, bug threads, comments, thread live chat,
 * leaderboard reputation tracking, and user notifications.
 *
 * Cross-database logical user reference: user_id -> SQL auth_users.id.
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type {
  CommunityDoc,
  CommunityMembershipDoc,
  CommunityMessageDoc,
  CommunityChannelDoc,
  CommunityThreadDoc,
  CommunityCommentDoc,
  CommunityChatMessageDoc,
  CommunityNotificationDoc,
  CommunityReputationEventDoc,
} from "../types";

export interface CommunityMemberDetailDoc {
  _id: string; // `${community_id}:${user_id}`
  community_id: string;
  user_id: string;
  username: string;
  role: "owner" | "admin" | "moderator" | "member";
  avatar?: string;
  reputation: number;
  solved_count: number;
  helpful_count: number;
  bugs_posted: number;
  skills: string[];
  permissions: string[];
  is_online: boolean;
  joined_at: Date;
  updated_at?: Date;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class CommunitiesRepository {
  private commCol: Collection<CommunityDoc>;
  private membershipsCol: Collection<CommunityMembershipDoc>;
  private memberDetailsCol: Collection<CommunityMemberDetailDoc>;
  private channelsCol: Collection<CommunityChannelDoc>;
  private messagesCol: Collection<CommunityMessageDoc>;
  private threadsCol: Collection<CommunityThreadDoc>;
  private commentsCol: Collection<CommunityCommentDoc>;
  private threadChatCol: Collection<CommunityChatMessageDoc>;
  private notificationsCol: Collection<CommunityNotificationDoc>;
  private repEventsCol: Collection<CommunityReputationEventDoc>;

  constructor(db: Db) {
    this.commCol = db.collection<CommunityDoc>("communities");
    this.membershipsCol = db.collection<CommunityMembershipDoc>("community_memberships");
    this.memberDetailsCol = db.collection<CommunityMemberDetailDoc>("community_members");
    this.channelsCol = db.collection<CommunityChannelDoc>("community_channels");
    this.messagesCol = db.collection<CommunityMessageDoc>("community_messages");
    this.threadsCol = db.collection<CommunityThreadDoc>("community_threads");
    this.commentsCol = db.collection<CommunityCommentDoc>("community_comments");
    this.threadChatCol = db.collection<CommunityChatMessageDoc>("community_thread_chat");
    this.notificationsCol = db.collection<CommunityNotificationDoc>("community_notifications");
    this.repEventsCol = db.collection<CommunityReputationEventDoc>("community_reputation_events");
  }

  // ==========================================================================
  // 1. COMMUNITIES
  // ==========================================================================

  /**
   * Creates a community collaboration space and provisions default channels and owner.
   */
  async createCommunity(community: CommunityDoc, session?: ClientSession): Promise<CommunityDoc> {
    const doc: CommunityDoc = {
      ...community,
      member_count: community.member_count || 1,
      created_at: community.created_at || new Date(),
      updated_at: community.updated_at || new Date(),
    };

    await this.commCol.insertOne(doc, { session });

    // Provision default channels
    await this.ensureDefaultChannels(doc._id, session);

    // Automatically add creator as owner
    await this.addMember(
      {
        _id: `${doc._id}:${doc.creator_id}`,
        community_id: doc._id,
        user_id: doc.creator_id,
        role: "owner",
        joined_at: new Date(),
      },
      {
        username: "Community Owner",
        permissions: ["manage_community", "manage_channels", "manage_members", "moderate_messages"],
        reputation: 25,
      },
      session
    );

    return doc;
  }

  /**
   * Retrieves a community by ID.
   */
  async getById(id: string, session?: ClientSession): Promise<CommunityDoc | null> {
    return this.commCol.findOne({ _id: id }, { session });
  }

  /**
   * Lists public communities.
   */
  async listPublic(limit = 50): Promise<CommunityDoc[]> {
    return this.commCol
      .find({ is_private: false })
      .sort({ member_count: -1, created_at: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Lists all communities (with search filter).
   */
  async listCommunities(options?: { search?: string; limit?: number }): Promise<CommunityDoc[]> {
    const filter: any = {};
    if (options?.search) {
      const rawSearch = options.search.trim().slice(0, 100);
      const safeSearch = escapeRegex(rawSearch);
      if (safeSearch) {
        filter.$or = [
          { name: { $regex: safeSearch, $options: "i" } },
          { description: { $regex: safeSearch, $options: "i" } },
          { tags: { $in: [rawSearch] } },
        ];
      }
    }

    return this.commCol
      .find(filter)
      .sort({ member_count: -1, created_at: -1 })
      .limit(options?.limit || 50)
      .toArray();
  }

  /**
   * Retrieves communities that a specific user has joined.
   */
  async listJoined(userId: string): Promise<CommunityDoc[]> {
    const memberships = await this.membershipsCol.find({ user_id: userId }).toArray();
    const communityIds = memberships.map((m) => m.community_id);
    if (communityIds.length === 0) return [];

    return this.commCol.find({ _id: { $in: communityIds } }).toArray();
  }

  /**
   * Updates community metadata.
   */
  async updateCommunity(
    id: string,
    updates: Partial<CommunityDoc>,
    session?: ClientSession
  ): Promise<boolean> {
    const res = await this.commCol.updateOne(
      { _id: id },
      { $set: { ...updates, updated_at: new Date() } },
      { session }
    );
    return res.matchedCount > 0;
  }

  /**
   * Deletes a community and cascades to channels, messages, threads, comments.
   */
  async deleteCommunity(id: string, session?: ClientSession): Promise<boolean> {
    const res = await this.commCol.deleteOne({ _id: id }, { session });
    if (res.deletedCount === 0) return false;

    await this.channelsCol.deleteMany({ community_id: id }, { session });
    await this.messagesCol.deleteMany({ community_id: id }, { session });
    await this.membershipsCol.deleteMany({ community_id: id }, { session });
    await this.memberDetailsCol.deleteMany({ community_id: id }, { session });
    await this.threadsCol.deleteMany({ community_id: id }, { session });
    await this.commentsCol.deleteMany({ community_id: id }, { session });
    await this.threadChatCol.deleteMany({ community_id: id }, { session });

    return true;
  }

  // ==========================================================================
  // 2. CHANNELS
  // ==========================================================================

  /**
   * Default channels for new or legacy communities.
   */
  buildDefaultChannels(communityId: string): CommunityChannelDoc[] {
    const now = new Date();
    return [
      {
        _id: `${communityId}:general`,
        community_id: communityId,
        channel_id: "general",
        name: "general",
        type: "text",
        description: "General bug solving discussion",
        is_private: false,
        member_ids: [],
        created_at: now,
      },
      {
        _id: `${communityId}:frontend`,
        community_id: communityId,
        channel_id: "frontend",
        name: "frontend",
        type: "text",
        description: "Frontend bugs and fixes",
        is_private: false,
        member_ids: [],
        created_at: now,
      },
      {
        _id: `${communityId}:backend`,
        community_id: communityId,
        channel_id: "backend",
        name: "backend",
        type: "text",
        description: "Backend debugging and architecture",
        is_private: false,
        member_ids: [],
        created_at: now,
      },
      {
        _id: `${communityId}:security`,
        community_id: communityId,
        channel_id: "security",
        name: "security",
        type: "text",
        description: "Security triage and exploit mitigation",
        is_private: false,
        member_ids: [],
        created_at: now,
      },
    ];
  }

  /**
   * Provisions default channels if the community has none yet.
   */
  async ensureDefaultChannels(communityId: string, session?: ClientSession): Promise<CommunityChannelDoc[]> {
    const existing = await this.channelsCol.find({ community_id: communityId }).toArray();
    if (existing.length > 0) return existing;

    const defaults = this.buildDefaultChannels(communityId);
    for (const channel of defaults) {
      await this.channelsCol.updateOne(
        { _id: channel._id },
        { $setOnInsert: channel },
        { upsert: true, session }
      );
    }
    return defaults;
  }

  /**
   * Lists all channels belonging to a community.
   */
  async listChannels(communityId: string): Promise<CommunityChannelDoc[]> {
    const channels = await this.channelsCol.find({ community_id: communityId }).toArray();
    if (channels.length === 0) {
      return this.ensureDefaultChannels(communityId);
    }
    return channels;
  }

  /**
   * Creates a channel in a community.
   */
  async createChannel(
    communityId: string,
    channel: Omit<CommunityChannelDoc, "_id" | "community_id" | "created_at">,
    session?: ClientSession
  ): Promise<CommunityChannelDoc> {
    const channelId = channel.channel_id || channel.name.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-");
    const doc: CommunityChannelDoc = {
      _id: `${communityId}:${channelId}`,
      community_id: communityId,
      channel_id: channelId,
      name: channel.name,
      type: channel.type || "text",
      description: channel.description || "",
      is_private: Boolean(channel.is_private),
      member_ids: channel.member_ids || [],
      created_at: new Date(),
    };

    await this.channelsCol.updateOne(
      { _id: doc._id },
      { $setOnInsert: doc },
      { upsert: true, session }
    );

    return doc;
  }

  // ==========================================================================
  // 3. MEMBERSHIPS & LEADERBOARDS
  // ==========================================================================

  /**
   * Adds or updates a user's membership in a community.
   */
  async addMember(
    member: CommunityMembershipDoc,
    details?: Partial<CommunityMemberDetailDoc>,
    session?: ClientSession
  ): Promise<CommunityMembershipDoc> {
    const doc: CommunityMembershipDoc = {
      ...member,
      _id: member._id || `${member.community_id}:${member.user_id}`,
      joined_at: member.joined_at || new Date(),
    };

    const isNew = !(await this.isMember(member.community_id, member.user_id, session));

    await this.membershipsCol.updateOne(
      { community_id: member.community_id, user_id: member.user_id },
      { $set: doc },
      { upsert: true, session }
    );

    const detailDoc: CommunityMemberDetailDoc = {
      _id: doc._id,
      community_id: member.community_id,
      user_id: member.user_id,
      username: details?.username || "Anonymous",
      role: member.role || "member",
      avatar: details?.avatar,
      reputation: details?.reputation ?? 0,
      solved_count: details?.solved_count ?? 0,
      helpful_count: details?.helpful_count ?? 0,
      bugs_posted: details?.bugs_posted ?? 0,
      skills: details?.skills || [],
      permissions: details?.permissions || ["comment", "create_thread"],
      is_online: true,
      joined_at: doc.joined_at,
    };

    await this.memberDetailsCol.updateOne(
      { community_id: member.community_id, user_id: member.user_id },
      { $set: detailDoc },
      { upsert: true, session }
    );

    if (isNew) {
      await this.commCol.updateOne(
        { _id: member.community_id },
        { $inc: { member_count: 1 }, $set: { updated_at: new Date() } },
        { session }
      );
    }

    return doc;
  }

  /**
   * Removes a user from a community.
   */
  async removeMember(communityId: string, userId: string, session?: ClientSession): Promise<boolean> {
    const res = await this.membershipsCol.deleteOne(
      { community_id: communityId, user_id: userId },
      { session }
    );

    await this.memberDetailsCol.deleteOne(
      { community_id: communityId, user_id: userId },
      { session }
    );

    if (res.deletedCount > 0) {
      await this.commCol.updateOne(
        { _id: communityId },
        { $inc: { member_count: -1 }, $set: { updated_at: new Date() } },
        { session }
      );
      return true;
    }

    return false;
  }

  /**
   * Checks whether a user is an active member of a community.
   */
  async isMember(communityId: string, userId: string, session?: ClientSession): Promise<boolean> {
    const member = await this.membershipsCol.findOne(
      { community_id: communityId, user_id: userId },
      { session }
    );
    return member !== null;
  }

  /**
   * Retrieves member details with role and reputation.
   */
  async getMember(communityId: string, userId: string): Promise<CommunityMemberDetailDoc | null> {
    return this.memberDetailsCol.findOne({ community_id: communityId, user_id: userId });
  }

  /**
   * Lists members of a community.
   */
  async listMembers(communityId: string, limit = 100): Promise<CommunityMemberDetailDoc[]> {
    return this.memberDetailsCol
      .find({ community_id: communityId })
      .sort({ reputation: -1, joined_at: 1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Awards community reputation and updates member statistics.
   */
  async awardReputation(
    communityId: string,
    userId: string,
    username: string,
    points: number,
    reason: string,
    threadId: string,
    statsUpdate?: { helpfulCount?: number; solvedCount?: number; bugsPosted?: number },
    session?: ClientSession
  ): Promise<void> {
    // Ensure member record exists
    await this.memberDetailsCol.updateOne(
      { community_id: communityId, user_id: userId },
      {
        $inc: {
          reputation: points,
          helpful_count: statsUpdate?.helpfulCount ?? 0,
          solved_count: statsUpdate?.solvedCount ?? 0,
          bugs_posted: statsUpdate?.bugsPosted ?? 0,
        },
        $setOnInsert: {
          _id: `${communityId}:${userId}`,
          community_id: communityId,
          user_id: userId,
          username,
          role: "member",
          skills: [],
          permissions: ["comment", "create_thread"],
          is_online: true,
          joined_at: new Date(),
        },
        $set: { updated_at: new Date() },
      },
      { upsert: true, session }
    );

    // Append reputation event log
    await this.repEventsCol.insertOne(
      {
        _id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        community_id: communityId,
        user_id: userId,
        username,
        points,
        reason,
        thread_id: threadId,
        created_at: new Date(),
      },
      { session }
    );
  }

  /**
   * Retrieves the community leaderboard.
   */
  async listLeaderboard(communityId: string, limit = 50): Promise<CommunityMemberDetailDoc[]> {
    return this.memberDetailsCol
      .find({ community_id: communityId })
      .sort({ reputation: -1, solved_count: -1 })
      .limit(limit)
      .toArray();
  }

  // ==========================================================================
  // 4. MESSAGES (CHANNELS & DIRECT COMMUNITY CHAT)
  // ==========================================================================

  /**
   * Dispatches a real-time message to a community channel or direct chat.
   */
  async sendMessage(message: CommunityMessageDoc, session?: ClientSession): Promise<CommunityMessageDoc> {
    const doc: CommunityMessageDoc = {
      ...message,
      created_at: message.created_at || new Date(),
    };

    await this.messagesCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Queries messages in chronological order.
   */
  async listMessages(
    communityId: string,
    channelId?: string,
    options?: { limit?: number; before?: Date }
  ): Promise<CommunityMessageDoc[]> {
    const query: any = { community_id: communityId };
    if (channelId) {
      query.channel_id = channelId;
    }
    if (options?.before) {
      query.created_at = { $lt: options.before };
    }

    const docs = await this.messagesCol
      .find(query)
      .sort({ created_at: 1 })
      .limit(options?.limit || 100)
      .toArray();

    return docs;
  }

  // ==========================================================================
  // 5. BUG THREADS & COLLABORATION
  // ==========================================================================

  /**
   * Creates a new bug thread.
   */
  async createThread(thread: CommunityThreadDoc, session?: ClientSession): Promise<CommunityThreadDoc> {
    const doc: CommunityThreadDoc = {
      ...thread,
      comment_count: thread.comment_count || 0,
      attachment_urls: thread.attachment_urls || [],
      created_at: thread.created_at || new Date(),
      updated_at: thread.updated_at || new Date(),
    };

    await this.threadsCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Retrieves a single thread by ID.
   */
  async getThread(threadId: string, session?: ClientSession): Promise<CommunityThreadDoc | null> {
    return this.threadsCol.findOne({ _id: threadId }, { session });
  }

  /**
   * Lists threads filtered by community, channel, severity, status, search, or tags.
   */
  async listThreads(
    communityId: string,
    channelId?: string,
    filters?: {
      search?: string;
      severity?: string;
      status?: string;
      tags?: string[];
      limit?: number;
    }
  ): Promise<CommunityThreadDoc[]> {
    const query: any = { community_id: communityId };
    if (channelId && channelId !== "all") {
      query.channel_id = channelId;
    }
    if (filters?.severity && filters.severity !== "all") {
      query.severity = filters.severity;
    }
    if (filters?.status && filters.status !== "all") {
      query.status = filters.status;
    }
    if (filters?.tags && filters.tags.length > 0) {
      query.tags = { $all: filters.tags };
    }
    if (filters?.search) {
      const rawSearch = filters.search.trim().slice(0, 100);
      const safeSearch = escapeRegex(rawSearch);
      if (safeSearch) {
        query.$or = [
          { title: { $regex: safeSearch, $options: "i" } },
          { description: { $regex: safeSearch, $options: "i" } },
          { tags: { $in: [rawSearch] } },
        ];
      }
    }

    return this.threadsCol
      .find(query)
      .sort({ updated_at: -1, created_at: -1 })
      .limit(filters?.limit || 100)
      .toArray();
  }

  /**
   * Updates a thread's fields (status, solution, attachments, etc.).
   */
  async updateThread(
    threadId: string,
    updates: Partial<CommunityThreadDoc>,
    session?: ClientSession
  ): Promise<boolean> {
    const res = await this.threadsCol.updateOne(
      { _id: threadId },
      { $set: { ...updates, updated_at: new Date() } },
      { session }
    );
    return res.matchedCount > 0;
  }

  /**
   * Deletes a thread and its child comments and live chat.
   */
  async deleteThread(threadId: string, session?: ClientSession): Promise<boolean> {
    const res = await this.threadsCol.deleteOne({ _id: threadId }, { session });
    if (res.deletedCount === 0) return false;

    await this.commentsCol.deleteMany({ thread_id: threadId }, { session });
    await this.threadChatCol.deleteMany({ thread_id: threadId }, { session });
    return true;
  }

  // ==========================================================================
  // 6. THREAD COMMENTS & SOLUTIONS
  // ==========================================================================

  /**
   * Adds a comment to a thread and increments thread comment_count.
   */
  async addComment(comment: CommunityCommentDoc, session?: ClientSession): Promise<CommunityCommentDoc> {
    const doc: CommunityCommentDoc = {
      ...comment,
      attachment_urls: comment.attachment_urls || [],
      mentions: comment.mentions || [],
      is_solution: Boolean(comment.is_solution),
      created_at: comment.created_at || new Date(),
      updated_at: comment.updated_at || new Date(),
    };

    await this.commentsCol.insertOne(doc, { session });

    await this.threadsCol.updateOne(
      { _id: comment.thread_id },
      { $inc: { comment_count: 1 }, $set: { updated_at: new Date() } },
      { session }
    );

    return doc;
  }

  /**
   * Lists comments for a thread chronologically.
   */
  async listComments(threadId: string): Promise<CommunityCommentDoc[]> {
    return this.commentsCol.find({ thread_id: threadId }).sort({ created_at: 1 }).toArray();
  }

  /**
   * Marks a comment as the verified solution.
   */
  async markCommentAsSolution(
    threadId: string,
    commentId: string,
    authorId: string,
    session?: ClientSession
  ): Promise<boolean> {
    const comment = await this.commentsCol.findOne({ _id: commentId, thread_id: threadId }, { session });
    if (!comment) return false;

    await this.commentsCol.updateOne(
      { _id: commentId },
      { $set: { is_solution: true, updated_at: new Date() } },
      { session }
    );

    await this.threadsCol.updateOne(
      { _id: threadId },
      {
        $set: {
          solution_comment_id: commentId,
          solution_by_user_id: comment.author_id,
          status: "solved",
          updated_at: new Date(),
        },
      },
      { session }
    );

    return true;
  }

  /**
   * Deletes a comment and decrements thread comment_count.
   */
  async deleteComment(commentId: string, session?: ClientSession): Promise<boolean> {
    const comment = await this.commentsCol.findOne({ _id: commentId }, { session });
    if (!comment) return false;

    await this.commentsCol.deleteOne({ _id: commentId }, { session });
    await this.threadsCol.updateOne(
      { _id: comment.thread_id },
      { $inc: { comment_count: -1 }, $set: { updated_at: new Date() } },
      { session }
    );

    return true;
  }

  // ==========================================================================
  // 7. THREAD LIVE CHAT
  // ==========================================================================

  /**
   * Sends a message to the live chat for a thread.
   */
  async sendThreadChatMessage(
    message: CommunityChatMessageDoc,
    session?: ClientSession
  ): Promise<CommunityChatMessageDoc> {
    const doc: CommunityChatMessageDoc = {
      ...message,
      created_at: message.created_at || new Date(),
    };

    await this.threadChatCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Lists live chat messages for a thread.
   */
  async listThreadChat(threadId: string, limit = 250): Promise<CommunityChatMessageDoc[]> {
    return this.threadChatCol
      .find({ thread_id: threadId })
      .sort({ created_at: 1 })
      .limit(limit)
      .toArray();
  }

  // ==========================================================================
  // 8. NOTIFICATIONS
  // ==========================================================================

  /**
   * Creates a notification for a user.
   */
  async createNotification(
    notification: CommunityNotificationDoc,
    session?: ClientSession
  ): Promise<CommunityNotificationDoc> {
    const doc: CommunityNotificationDoc = {
      ...notification,
      read: false,
      created_at: notification.created_at || new Date(),
    };

    await this.notificationsCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Lists notifications for a user.
   */
  async listNotifications(
    userId: string,
    communityId?: string,
    limit = 30
  ): Promise<CommunityNotificationDoc[]> {
    const query: any = { user_id: userId };
    if (communityId) {
      query.community_id = communityId;
    }

    return this.notificationsCol
      .find(query)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Marks a notification as read.
   */
  async markNotificationRead(
    notificationId: string,
    userId: string,
    session?: ClientSession
  ): Promise<boolean> {
    const res = await this.notificationsCol.updateOne(
      { _id: notificationId, user_id: userId },
      { $set: { read: true } },
      { session }
    );
    return res.matchedCount > 0;
  }
}

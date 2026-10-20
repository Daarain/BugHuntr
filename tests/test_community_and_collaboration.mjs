import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CommunitiesRepository } from "../lib/db/repositories/communities.repo";
import { GET as getCommunitiesHandler, POST as postCommunitiesHandler } from "../app/api/communities/route";
import { GET as getCommunityByIdHandler, PATCH as patchCommunityByIdHandler, DELETE as deleteCommunityByIdHandler } from "../app/api/communities/[id]/route";
import { POST as postJoinHandler } from "../app/api/communities/[id]/join/route";
import { POST as postLeaveHandler } from "../app/api/communities/[id]/leave/route";
import { GET as getChannelsHandler, POST as postChannelsHandler } from "../app/api/communities/[id]/channels/route";
import { GET as getMessagesHandler, POST as postMessagesHandler } from "../app/api/communities/[id]/messages/route";
import { GET as getChannelMessagesHandler, POST as postChannelMessagesHandler } from "../app/api/communities/[id]/channels/[channelId]/messages/route";
import { GET as getThreadsHandler, POST as postThreadsHandler } from "../app/api/communities/[id]/threads/route";
import { GET as getThreadByIdHandler, PATCH as patchThreadByIdHandler, DELETE as deleteThreadByIdHandler } from "../app/api/communities/[id]/threads/[threadId]/route";
import { GET as getCommentsHandler, POST as postCommentsHandler } from "../app/api/communities/[id]/threads/[threadId]/comments/route";
import { DELETE as deleteCommentHandler } from "../app/api/communities/[id]/threads/[threadId]/comments/[commentId]/route";
import { POST as postSolutionHandler } from "../app/api/communities/[id]/threads/[threadId]/comments/[commentId]/solution/route";
import { GET as getChatHandler, POST as postChatHandler } from "../app/api/communities/[id]/threads/[threadId]/chat/route";
import { GET as getLeaderboardHandler } from "../app/api/communities/[id]/leaderboard/route";
import { GET as getNotificationsHandler, PATCH as patchNotificationsHandler } from "../app/api/communities/notifications/route";
import { createSessionToken } from "../lib/server-auth";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.SESSION_SECRET = TEST_SECRET;
process.env.INTERNAL_API_SECRET = TEST_SECRET;
process.env.NODE_ENV = "test";

/**
 * In-memory Mock MongoDB database for hermetic testing.
 */
function createMockDb() {
  const store = new Map();

  return {
    collection(name) {
      if (!store.has(name)) {
        store.set(name, new Map());
      }
      const colMap = store.get(name);

      return {
        async findOne(filter) {
          for (const doc of colMap.values()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (v && typeof v === "object" && "$in" in v) {
                if (!v.$in.includes(doc[k])) { match = false; break; }
              } else if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) {
              return JSON.parse(JSON.stringify(doc));
            }
          }
          return null;
        },

        async insertOne(doc) {
          const id = doc._id || doc.id || String(Date.now() + Math.random());
          const stored = { ...doc, _id: id };
          if (colMap.has(id)) {
            const err = new Error("E11000 duplicate key error");
            err.code = 11000;
            throw err;
          }
          colMap.set(id, JSON.parse(JSON.stringify(stored)));
          return { insertedId: id, acknowledged: true };
        },

        async updateOne(filter, update, options) {
          let foundKey = null;
          let doc = null;

          for (const [k, v] of colMap.entries()) {
            let match = true;
            for (const [fk, fv] of Object.entries(filter)) {
              if (v[fk] !== fv) {
                match = false;
                break;
              }
            }
            if (match) {
              foundKey = k;
              doc = { ...v };
              break;
            }
          }

          if (!doc) {
            if (options?.upsert) {
              const newDoc = {
                ...(update.$setOnInsert || {}),
                ...(update.$set || {}),
              };
              const id = newDoc._id || filter._id || String(Date.now());
              newDoc._id = id;
              colMap.set(id, JSON.parse(JSON.stringify(newDoc)));
              return { matchedCount: 0, modifiedCount: 1, upsertedCount: 1, upsertedId: id };
            }
            return { matchedCount: 0, modifiedCount: 0 };
          }

          if (update.$inc) {
            for (const [ik, iv] of Object.entries(update.$inc)) {
              doc[ik] = (doc[ik] ?? 0) + iv;
            }
          }

          if (update.$set) {
            for (const [sk, sv] of Object.entries(update.$set)) {
              doc[sk] = sv;
            }
          }

          colMap.set(foundKey, JSON.parse(JSON.stringify(doc)));
          return { matchedCount: 1, modifiedCount: 1 };
        },

        async deleteOne(filter) {
          for (const [k, v] of colMap.entries()) {
            let match = true;
            for (const [fk, fv] of Object.entries(filter)) {
              if (v[fk] !== fv) {
                match = false;
                break;
              }
            }
            if (match) {
              colMap.delete(k);
              return { deletedCount: 1 };
            }
          }
          return { deletedCount: 0 };
        },

        async deleteMany(filter) {
          let count = 0;
          for (const [k, v] of Array.from(colMap.entries())) {
            let match = true;
            for (const [fk, fv] of Object.entries(filter)) {
              if (v[fk] !== fv) {
                match = false;
                break;
              }
            }
            if (match) {
              colMap.delete(k);
              count++;
            }
          }
          return { deletedCount: count };
        },

        find(filter = {}) {
          let results = Array.from(colMap.values());
          if (Object.keys(filter).length > 0) {
            results = results.filter((doc) => {
              for (const [k, v] of Object.entries(filter)) {
                if (k === "$or" && Array.isArray(v)) {
                  const orMatch = v.some((cond) => {
                    for (const [ck, cv] of Object.entries(cond)) {
                      if (cv && typeof cv === "object" && "$regex" in cv) {
                        const reg = new RegExp(cv.$regex, cv.$options || "");
                        if (reg.test(String(doc[ck] || ""))) return true;
                      } else if (cv && typeof cv === "object" && "$in" in cv) {
                        if (Array.isArray(doc[ck]) && doc[ck].some((item) => cv.$in.includes(item))) return true;
                      } else if (doc[ck] === cv) {
                        return true;
                      }
                    }
                    return false;
                  });
                  if (!orMatch) return false;
                } else if (v && typeof v === "object" && "$in" in v) {
                  if (!v.$in.includes(doc[k])) return false;
                } else if (v && typeof v === "object" && "$all" in v) {
                  if (!Array.isArray(doc[k]) || !v.$all.every((x) => doc[k].includes(x))) return false;
                } else if (v && typeof v === "object" && "$lt" in v) {
                  if (new Date(doc[k]).getTime() >= new Date(v.$lt).getTime()) return false;
                } else if (doc[k] !== v) {
                  return false;
                }
              }
              return true;
            });
          }

          let sortOrder = null;
          let limitCount = null;

          const cursor = {
            sort(sortObj) {
              sortOrder = sortObj;
              return cursor;
            },
            limit(n) {
              limitCount = n;
              return cursor;
            },
            async toArray() {
              let res = [...results];
              if (sortOrder) {
                res.sort((a, b) => {
                  for (const [field, dir] of Object.entries(sortOrder)) {
                    const valA = a[field] instanceof Date ? a[field].getTime() : a[field];
                    const valB = b[field] instanceof Date ? b[field].getTime() : b[field];
                    if (valA !== valB) {
                      return dir === -1 ? (valB > valA ? 1 : -1) : (valA > valB ? 1 : -1);
                    }
                  }
                  return 0;
                });
              }
              if (limitCount) {
                res = res.slice(0, limitCount);
              }
              return JSON.parse(JSON.stringify(res));
            },
          };

          return cursor;
        },
      };
    },
  };
}

// ----------------------------------------------------------------------------
// TEST SUITE 1: CommunitiesRepository Unit Operations
// ----------------------------------------------------------------------------

test("CommunitiesRepository: community lifecycle, channels, membership, threads, comments, and solutions", async () => {
  const mockDb = createMockDb();
  const repo = new CommunitiesRepository(mockDb);

  // 1. Create community
  const comm = await repo.createCommunity({
    _id: "comm_sec_research",
    name: "Security Research Hub",
    description: "Deep dive into vulnerabilities and exploit mitigations",
    creator_id: "usr_alice",
    is_private: false,
    member_count: 1,
    tags: ["zero-day", "reverse-engineering"],
  });

  assert.equal(comm._id, "comm_sec_research");
  assert.equal(comm.creator_id, "usr_alice");

  // Verify default channels are provisioned
  const channels = await repo.listChannels("comm_sec_research");
  assert.equal(channels.length, 4);
  assert.deepEqual(
    channels.map((c) => c.channel_id).sort(),
    ["backend", "frontend", "general", "security"].sort()
  );

  // 2. Add custom channel
  const customChan = await repo.createChannel("comm_sec_research", {
    name: "exploit-dev",
    description: "Exploit development discussions",
    type: "text",
    is_private: false,
    member_ids: [],
  });
  assert.equal(customChan.channel_id, "exploit-dev");

  // 3. Memberships
  assert.equal(await repo.isMember("comm_sec_research", "usr_alice"), true);
  assert.equal(await repo.isMember("comm_sec_research", "usr_bob"), false);

  await repo.addMember(
    {
      _id: "comm_sec_research:usr_bob",
      community_id: "comm_sec_research",
      user_id: "usr_bob",
      role: "member",
      joined_at: new Date(),
    },
    { username: "bob_hunter", skills: ["reverse-engineering", "pwn"] }
  );

  assert.equal(await repo.isMember("comm_sec_research", "usr_bob"), true);
  const bobMember = await repo.getMember("comm_sec_research", "usr_bob");
  assert.equal(bobMember?.username, "bob_hunter");

  // 4. Messages
  const msg1 = await repo.sendMessage({
    _id: "msg_1",
    community_id: "comm_sec_research",
    channel_id: "general",
    user_id: "usr_alice",
    username: "alice_admin",
    content: "Welcome to Security Research Hub!",
    created_at: new Date("2026-10-18T10:00:00Z"),
  });
  assert.equal(msg1.content, "Welcome to Security Research Hub!");

  const msgList = await repo.listMessages("comm_sec_research", "general");
  assert.equal(msgList.length, 1);
  assert.equal(msgList[0]._id, "msg_1");

  // 5. Bug Threads
  const thread = await repo.createThread({
    _id: "th_heap_overflow",
    community_id: "comm_sec_research",
    channel_id: "security",
    title: "Heap buffer overflow in parser",
    description: "Found out-of-bounds write when parsing corrupted chunk headers",
    severity: "critical",
    status: "open",
    tags: ["overflow", "pwn"],
    author_id: "usr_bob",
    author_username: "bob_hunter",
    comment_count: 0,
    attachment_urls: [],
    created_at: new Date("2026-10-18T11:00:00Z"),
    updated_at: new Date("2026-10-18T11:00:00Z"),
  });
  assert.equal(thread._id, "th_heap_overflow");
  assert.equal(thread.severity, "critical");

  // 6. Comments & Solution Acceptance
  const comment = await repo.addComment({
    _id: "cmt_fix_1",
    thread_id: "th_heap_overflow",
    community_id: "comm_sec_research",
    content: "Check bounds before allocating buffer and validate length against max header size.",
    author_id: "usr_alice",
    author_username: "alice_admin",
    parent_id: null,
    mentions: ["bob_hunter"],
    is_solution: false,
    attachment_urls: [],
    created_at: new Date("2026-10-18T11:30:00Z"),
    updated_at: new Date("2026-10-18T11:30:00Z"),
  });
  assert.equal(comment.content.includes("Check bounds"), true);

  const threadAfterComment = await repo.getThread("th_heap_overflow");
  assert.equal(threadAfterComment?.comment_count, 1);

  // Mark comment as verified solution
  const marked = await repo.markCommentAsSolution("th_heap_overflow", "cmt_fix_1", "usr_alice");
  assert.equal(marked, true);

  const threadSolved = await repo.getThread("th_heap_overflow");
  assert.equal(threadSolved?.status, "solved");
  assert.equal(threadSolved?.solution_comment_id, "cmt_fix_1");
  assert.equal(threadSolved?.solution_by_user_id, "usr_alice");

  // 7. Reputation Awards & Leaderboard
  await repo.awardReputation("comm_sec_research", "usr_alice", "alice_admin", 25, "Solution accepted", "th_heap_overflow", { solvedCount: 1 });
  const leaderboard = await repo.listLeaderboard("comm_sec_research");
  assert.equal(leaderboard[0].user_id, "usr_alice");
  assert.ok(leaderboard[0].reputation >= 25);

  // 8. Notifications
  const notif = await repo.createNotification({
    _id: "notif_1",
    user_id: "usr_bob",
    community_id: "comm_sec_research",
    type: "solution_accepted",
    title: "Solution accepted",
    message: "Alice accepted your solution",
    thread_id: "th_heap_overflow",
    read: false,
    created_at: new Date(),
  });
  assert.equal(notif.read, false);

  const notifs = await repo.listNotifications("usr_bob");
  assert.equal(notifs.length, 1);

  const readSuccess = await repo.markNotificationRead("notif_1", "usr_bob");
  assert.equal(readSuccess, true);

  // 9. Leave community
  const left = await repo.removeMember("comm_sec_research", "usr_bob");
  assert.equal(left, true);
  assert.equal(await repo.isMember("comm_sec_research", "usr_bob"), false);
});

// ----------------------------------------------------------------------------
// TEST SUITE 2: API Routes Authentication, Tenancy, and Authorization
// ----------------------------------------------------------------------------

test("API Routes: Community privacy, membership enforcement, and thread permissions", async () => {
  const mockDb = createMockDb();
  globalThis._mongoClientPromise = Promise.resolve({ db: () => mockDb });

  const aliceToken = createSessionToken({
    id: "usr_alice",
    email: "alice@example.com",
    role: "hunter",
    username: "alice",
  });

  const bobToken = createSessionToken({
    id: "usr_bob",
    email: "bob@example.com",
    role: "hunter",
    username: "bob",
  });

  // 1. Create a private community as Alice
  const createReq = new Request("http://localhost/api/communities", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${aliceToken}`,
    },
    body: JSON.stringify({
      name: "Private SecOps Guild",
      description: "Exclusive invite-only group",
      isPrivate: true,
      tags: ["appsec"],
    }),
  });

  const createRes = await postCommunitiesHandler(createReq);
  assert.equal(createRes.status, 201);
  const commData = await createRes.json();
  const commId = commData.community.id;
  assert.equal(commData.community.isPrivate, true);

  // 2. Unauthenticated GET /api/communities/[id] on private community is rejected with 403
  const unauthGetReq = new Request(`http://localhost/api/communities/${commId}`, { method: "GET" });
  const unauthGetRes = await getCommunityByIdHandler(unauthGetReq, {
    params: Promise.resolve({ id: commId }),
  });
  assert.equal(unauthGetRes.status, 403);

  // 3. Bob (non-member) GET /api/communities/[id] is rejected with 403
  const bobGetReq = new Request(`http://localhost/api/communities/${commId}`, {
    method: "GET",
    headers: { Cookie: `bughuntr_session=${bobToken}` },
  });
  const bobGetRes = await getCommunityByIdHandler(bobGetReq, {
    params: Promise.resolve({ id: commId }),
  });
  assert.equal(bobGetRes.status, 403);

  // 4. Bob attempts to post message to private community before joining -> 403
  const bobMsgReq = new Request(`http://localhost/api/communities/${commId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${bobToken}`,
    },
    body: JSON.stringify({ text: "Hello from outside" }),
  });
  const bobMsgRes = await postMessagesHandler(bobMsgReq, {
    params: Promise.resolve({ id: commId }),
  });
  assert.equal(bobMsgRes.status, 403);

  // 4b. Bob attempts direct ID join without invite code -> 403 Forbidden
  const directJoinReq = new Request(`http://localhost/api/communities/${commId}/join`, {
    method: "POST",
    headers: { Cookie: `bughuntr_session=${bobToken}` },
  });
  const directJoinRes = await postJoinHandler(directJoinReq, {
    params: Promise.resolve({ id: commId }),
  });
  assert.equal(directJoinRes.status, 403);

  // 5. Bob joins community with valid invite code
  const joinReq = new Request(`http://localhost/api/communities/${commId}/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${bobToken}`,
    },
    body: JSON.stringify({ inviteCode: commData.community.inviteCode }),
  });
  const joinRes = await postJoinHandler(joinReq, {
    params: Promise.resolve({ id: commId }),
  });
  assert.equal(joinRes.status, 200);

  // 6. Bob creates a thread
  const bobThreadReq = new Request(`http://localhost/api/communities/${commId}/threads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${bobToken}`,
    },
    body: JSON.stringify({
      channelId: "security",
      title: "SSRF vulnerability in PDF exporter",
      description: "Attacker can read metadata service via custom webhook parameter",
      severity: "high",
      tags: ["ssrf", "cloud"],
    }),
  });
  const bobThreadRes = await postThreadsHandler(bobThreadReq, {
    params: Promise.resolve({ id: commId }),
  });
  assert.equal(bobThreadRes.status, 201);
  const threadData = await bobThreadRes.json();
  const threadId = threadData.thread.id;

  // 7. Alice comments on Bob's thread
  const aliceCommentReq = new Request(`http://localhost/api/communities/${commId}/threads/${threadId}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${aliceToken}`,
    },
    body: JSON.stringify({
      content: "Restrict egress IP ranges with an allowlist and reject 169.254.169.254.",
    }),
  });
  const aliceCommentRes = await postCommentsHandler(aliceCommentReq, {
    params: Promise.resolve({ id: commId, threadId }),
  });
  assert.equal(aliceCommentRes.status, 201);
  const commentData = await aliceCommentRes.json();
  const commentId = commentData.comment.id;

  // 8. Alice tries to mark solution on Bob's thread -> Rejection (only author can mark solution)
  // Alice is community owner here, so let's test a third non-author user Charlie
  const charlieToken = createSessionToken({
    id: "usr_charlie",
    email: "charlie@example.com",
    role: "hunter",
    username: "charlie",
  });
  // Charlie joins with invite code
  await postJoinHandler(
    new Request(`http://localhost/api/communities/${commId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `bughuntr_session=${charlieToken}`,
      },
      body: JSON.stringify({ inviteCode: commData.community.inviteCode }),
    }),
    { params: Promise.resolve({ id: commId }) }
  );

  const charlieSolReq = new Request(
    `http://localhost/api/communities/${commId}/threads/${threadId}/comments/${commentId}/solution`,
    {
      method: "POST",
      headers: { Cookie: `bughuntr_session=${charlieToken}` },
    }
  );
  const charlieSolRes = await postSolutionHandler(charlieSolReq, {
    params: Promise.resolve({ id: commId, threadId, commentId }),
  });
  assert.equal(charlieSolRes.status, 403);

  // 9. Bob (author) accepts solution -> Success
  const bobSolReq = new Request(
    `http://localhost/api/communities/${commId}/threads/${threadId}/comments/${commentId}/solution`,
    {
      method: "POST",
      headers: { Cookie: `bughuntr_session=${bobToken}` },
    }
  );
  const bobSolRes = await postSolutionHandler(bobSolReq, {
    params: Promise.resolve({ id: commId, threadId, commentId }),
  });
  assert.equal(bobSolRes.status, 200);

  // 10. Notifications: Alice received a solution accepted notification
  const aliceNotifReq = new Request("http://localhost/api/communities/notifications", {
    method: "GET",
    headers: { Cookie: `bughuntr_session=${aliceToken}` },
  });
  const aliceNotifRes = await getNotificationsHandler(aliceNotifReq);
  assert.equal(aliceNotifRes.status, 200);
  const notifList = await aliceNotifRes.json();
  assert.ok(notifList.notifications.length >= 1);
  assert.equal(notifList.notifications[0].type, "solution_accepted");

  // 11. Alice marks notification as read
  const notifId = notifList.notifications[0].id;
  const readReq = new Request("http://localhost/api/communities/notifications", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bughuntr_session=${aliceToken}`,
    },
    body: JSON.stringify({ notificationId: notifId }),
  });
  const readRes = await patchNotificationsHandler(readReq);
  assert.equal(readRes.status, 200);

  // 12. Charlie tries to delete Bob's thread -> Rejected with 403
  const charlieDelReq = new Request(`http://localhost/api/communities/${commId}/threads/${threadId}`, {
    method: "DELETE",
    headers: { Cookie: `bughuntr_session=${charlieToken}` },
  });
  const charlieDelRes = await deleteThreadByIdHandler(charlieDelReq, {
    params: Promise.resolve({ id: commId, threadId }),
  });
  assert.equal(charlieDelRes.status, 403);
});

// ----------------------------------------------------------------------------
// TEST SUITE 3: Boundary Verification: Migrated Client Files Have Zero Firestore
// ----------------------------------------------------------------------------

test("Boundary verification: migrated Phase 7 client files have zero direct Firestore/Firebase calls", () => {
  const clientFiles = [
    "hooks/use-community.tsx",
    "hooks/use-thread-collaboration.ts",
    "app/community/[id]/page.tsx",
  ];

  const forbiddenTokens = [
    "firebase/firestore",
    "@/firebaseConfig",
    "getFirestore",
    "onSnapshot",
    "collection(",
    "doc(db",
    "getDoc(",
    "getDocs(",
    "setDoc(",
    "addDoc(",
    "updateDoc(",
    "deleteDoc(",
    "serverTimestamp(",
  ];

  for (const relativePath of clientFiles) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    assert.ok(fs.existsSync(fullPath), `File must exist: ${relativePath}`);

    const content = fs.readFileSync(fullPath, "utf-8");

    for (const token of forbiddenTokens) {
      assert.equal(
        content.includes(token),
        false,
        `File ${relativePath} must NOT contain forbidden Firestore token: "${token}"`
      );
    }
  }
});

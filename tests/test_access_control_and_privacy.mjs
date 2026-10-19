import test from "node:test";
import assert from "node:assert/strict";
import { SubmissionsRepository } from "../lib/db/repositories/submissions.repo";
import { CommunitiesRepository } from "../lib/db/repositories/communities.repo";
import {
  GET as getSubmissionsHandler,
  POST as postSubmissionsHandler,
} from "../app/api/bug-submissions/route";
import {
  GET as getSubmissionByIdHandler,
  PATCH as patchSubmissionByIdHandler,
} from "../app/api/bug-submissions/[id]/route";
import {
  GET as getCommunitiesHandler,
  POST as postCommunitiesHandler,
} from "../app/api/communities/route";
import {
  GET as getCommunityByIdHandler,
} from "../app/api/communities/[id]/route";
import {
  GET as getChannelsHandler,
} from "../app/api/communities/[id]/channels/route";
import {
  GET as getMessagesHandler,
} from "../app/api/communities/[id]/messages/route";
import {
  POST as postJoinHandler,
} from "../app/api/communities/[id]/join/route";
import { createSessionToken } from "../lib/server-auth";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.SESSION_SECRET = TEST_SECRET;
process.env.INTERNAL_API_SECRET = TEST_SECRET;
process.env.NODE_ENV = "test";

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
              } else if (v && typeof v === "object" && "$regex" in v) {
                const regex = new RegExp(v.$regex, v.$options || "");
                if (!regex.test(doc[k])) { match = false; break; }
              } else if (doc[k] !== v) {
                match = false;
                break;
              }
            }
            if (match) return JSON.parse(JSON.stringify(doc));
          }
          return null;
        },

        async insertOne(doc) {
          const key = doc._id || doc.id || `doc_${Date.now()}_${Math.random()}`;
          const saved = JSON.parse(JSON.stringify({ ...doc, _id: key }));
          colMap.set(key, saved);
          return { acknowledged: true, insertedId: key };
        },

        find(filter = {}) {
          const docs = [];
          for (const doc of colMap.values()) {
            let match = true;
            if (filter.$or && Array.isArray(filter.$or)) {
              const orMatch = filter.$or.some((subFilter) => {
                for (const [k, v] of Object.entries(subFilter)) {
                  if (v && typeof v === "object" && "$in" in v) {
                    if (Array.isArray(doc[k]) && doc[k].some((item) => v.$in.includes(item))) return true;
                    if (v.$in.includes(doc[k])) return true;
                  } else if (v && typeof v === "object" && "$regex" in v) {
                    const regex = new RegExp(v.$regex, v.$options || "");
                    if (regex.test(doc[k])) return true;
                  } else if (doc[k] === v) {
                    return true;
                  }
                }
                return false;
              });
              if (!orMatch) match = false;
            } else {
              for (const [k, v] of Object.entries(filter)) {
                if (v && typeof v === "object" && "$in" in v) {
                  if (!v.$in.includes(doc[k])) { match = false; break; }
                } else if (v && typeof v === "object" && "$regex" in v) {
                  const regex = new RegExp(v.$regex, v.$options || "");
                  if (!regex.test(doc[k])) { match = false; break; }
                } else if (doc[k] !== v) {
                  match = false;
                  break;
                }
              }
            }
            if (match) docs.push(JSON.parse(JSON.stringify(doc)));
          }

          let limitCount = docs.length;
          return {
            sort() { return this; },
            limit(n) { limitCount = n; return this; },
            async toArray() { return docs.slice(0, limitCount); },
          };
        },

        async updateOne(filter, update, options = {}) {
          let foundKey = null;
          let doc = null;

          for (const [key, d] of colMap.entries()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (d[k] !== v) { match = false; break; }
            }
            if (match) {
              foundKey = key;
              doc = { ...d };
              break;
            }
          }

          if (!doc) {
            if (options?.upsert) {
              const newDoc = {
                ...filter,
                ...(update.$setOnInsert || {}),
                ...(update.$set || {}),
              };
              const id = newDoc._id || filter._id || String(Date.now() + Math.random());
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
            Object.assign(doc, update.$set);
          }

          colMap.set(foundKey, JSON.parse(JSON.stringify(doc)));
          return { matchedCount: 1, modifiedCount: 1 };
        },

        async deleteOne(filter) {
          for (const [key, doc] of colMap.entries()) {
            let match = true;
            for (const [k, v] of Object.entries(filter)) {
              if (doc[k] !== v) { match = false; break; }
            }
            if (match) {
              colMap.delete(key);
              return { deletedCount: 1 };
            }
          }
          return { deletedCount: 0 };
        },
      };
    },
  };
}

function createMockRequest(url, method, body = null, sessionUser = null) {
  const headers = new Headers();
  if (sessionUser) {
    const token = createSessionToken(
      { email: sessionUser.email || `${sessionUser.username || sessionUser.id}@example.com`, ...sessionUser },
      TEST_SECRET,
      3600
    );
    headers.set("cookie", `bughuntr_session=${token}`);
  }
  if (body) {
    headers.set("content-type", "application/json");
  }

  return {
    url,
    method,
    headers,
    async json() {
      return body || {};
    },
  };
}

const mockDb = createMockDb();
globalThis._mongoClientPromise = Promise.resolve({
  db() {
    return mockDb;
  },
});

// ============================================================================
// SUITE 1: Task A - Bug Report Privacy and Redaction
// ============================================================================
test("Task A: Bug report privacy, server-enforced authorization, and sensitive PoC redaction", async () => {
  const adminUser = { id: "usr_admin", email: "admin@bughuntr.io", role: "admin", userType: "admin", username: "admin" };
  const triagerUser = { id: "usr_triager", email: "triager@bughuntr.io", role: "triager", userType: "staff", username: "triager" };
  const aliceHunter = { id: "usr_alice", email: "alice@hacker.io", role: "user", userType: "hunter", username: "alice" };
  const bobHunter = { id: "usr_bob", email: "bob@hacker.io", role: "user", userType: "hunter", username: "bob" };
  const acmeCompany = { id: "usr_acme", email: "sec@acme.corp", role: "company", userType: "company", username: "acme_corp", orgId: "org_acme" };
  const otherCompany = { id: "usr_other", email: "sec@other.corp", role: "company", userType: "company", username: "other_corp", orgId: "org_other" };

  // 1. Alice submits a medium severity bug report targeting org_acme
  const submitReq = createMockRequest("http://localhost:3000/api/bug-submissions", "POST", {
    title: "Stored XSS in user profile biography",
    description: "Bio field does not sanitize HTML inputs properly.",
    stepsToReproduce: "1. Navigate to /profile. 2. Enter <script>alert(1)</script>. 3. Save.",
    proofOfConceptUrl: "https://exploits.example.com/xss_payload.html",
    severity: "medium",
    category: "Cross-Site Scripting",
    company: "org_acme",
  }, aliceHunter);

  const submitRes = await postSubmissionsHandler(submitReq);
  assert.equal(submitRes.status, 201);
  const createdSub = await submitRes.json();
  const subId = createdSub.id;
  assert.equal(createdSub.userId, "usr_alice");

  // 2. Unauthenticated caller attempts to view pending submission -> 401 Unauthorized
  const unauthReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${subId}`, "GET");
  const unauthRes = await getSubmissionByIdHandler(unauthReq, { params: Promise.resolve({ id: subId }) });
  assert.equal(unauthRes.status, 401);

  // 3. Bob (different hunter) attempts to view Alice's pending submission -> 403 Forbidden
  const bobReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${subId}`, "GET", null, bobHunter);
  const bobRes = await getSubmissionByIdHandler(bobReq, { params: Promise.resolve({ id: subId }) });
  assert.equal(bobRes.status, 403);
  const bobData = await bobRes.json();
  assert.match(bobData.error, /Access denied|private until resolved/i);

  // 4. Other Company attempts to view Alice's pending submission for org_acme -> 403 Forbidden
  const otherCompReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${subId}`, "GET", null, otherCompany);
  const otherCompRes = await getSubmissionByIdHandler(otherCompReq, { params: Promise.resolve({ id: subId }) });
  assert.equal(otherCompRes.status, 403);

  // 5. Alice (reporter) views own submission -> 200 OK with full PoC and reproduction steps
  const aliceReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${subId}`, "GET", null, aliceHunter);
  const aliceRes = await getSubmissionByIdHandler(aliceReq, { params: Promise.resolve({ id: subId }) });
  assert.equal(aliceRes.status, 200);
  const aliceData = await aliceRes.json();
  assert.equal(aliceData.proofOfConceptUrl, "https://exploits.example.com/xss_payload.html");
  assert.equal(aliceData.stepsToReproduce, "1. Navigate to /profile. 2. Enter <script>alert(1)</script>. 3. Save.");

  // 6. Acme (sponsoring organization) views submission -> 200 OK with full PoC
  const acmeReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${subId}`, "GET", null, acmeCompany);
  const acmeRes = await getSubmissionByIdHandler(acmeReq, { params: Promise.resolve({ id: subId }) });
  assert.equal(acmeRes.status, 200);
  const acmeData = await acmeRes.json();
  assert.equal(acmeData.proofOfConceptUrl, "https://exploits.example.com/xss_payload.html");

  // 7. Triager updates submission to "resolved"
  const patchReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${subId}`, "PATCH", {
    status: "resolved",
    adminNotes: "Patched in release v2.4.1",
  }, triagerUser);
  const patchRes = await patchSubmissionByIdHandler(patchReq, { params: Promise.resolve({ id: subId }) });
  assert.equal(patchRes.status, 200);

  // 8. Bob (third-party hunter) views the now-resolved medium submission:
  // Public disclosure allowed, but sensitive reproduction steps and PoC MUST be redacted
  const bobResolvedReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${subId}`, "GET", null, bobHunter);
  const bobResolvedRes = await getSubmissionByIdHandler(bobResolvedReq, { params: Promise.resolve({ id: subId }) });
  assert.equal(bobResolvedRes.status, 200);
  const bobResolvedData = await bobResolvedRes.json();
  assert.equal(bobResolvedData.proofOfConceptUrl, "");
  assert.equal(bobResolvedData.proofOfConcept, "");
  assert.equal(bobResolvedData.stepsToReproduce, "[Redacted for public disclosure]");
  assert.equal(bobResolvedData.adminNotes, undefined);
  assert.equal(bobResolvedData.title, "Stored XSS in user profile biography");

  // 9. Critical / High severity reports: Even when resolved, restricted from third-party access
  const critSubReq = createMockRequest("http://localhost:3000/api/bug-submissions", "POST", {
    title: "Remote Code Execution via deserialization",
    description: "Unauthenticated RCE in gateway endpoint.",
    stepsToReproduce: "Send crafted serialized payload.",
    proofOfConceptUrl: "https://exploits.example.com/rce.py",
    severity: "critical",
    category: "Remote Code Execution",
    company: "org_acme",
  }, aliceHunter);
  const critSubRes = await postSubmissionsHandler(critSubReq);
  assert.equal(critSubRes.status, 201);
  const critSub = await critSubRes.json();

  // Mark critical bug as resolved by admin
  const adminPatchReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${critSub.id}`, "PATCH", {
    status: "resolved",
    adminNotes: "Critical RCE hotfixed.",
  }, adminUser);
  assert.equal((await patchSubmissionByIdHandler(adminPatchReq, { params: Promise.resolve({ id: critSub.id }) })).status, 200);

  // Bob attempts to view resolved critical report -> 403 Forbidden
  const bobCritReq = createMockRequest(`http://localhost:3000/api/bug-submissions/${critSub.id}`, "GET", null, bobHunter);
  const bobCritRes = await getSubmissionByIdHandler(bobCritReq, { params: Promise.resolve({ id: critSub.id }) });
  assert.equal(bobCritRes.status, 403);
  assert.match((await bobCritRes.json()).error, /restricted|access denied/i);
});

// ============================================================================
// SUITE 2: Task B - Private Community Access Control and Discovery Protection
// ============================================================================
test("Task B: Private community search isolation, direct ID join bypass prevention, and channel gating", async () => {
  const aliceHunter = { id: "usr_alice", email: "alice@hacker.io", role: "user", userType: "hunter", username: "alice" };
  const bobHunter = { id: "usr_bob", email: "bob@hacker.io", role: "user", userType: "hunter", username: "bob" };
  const adminUser = { id: "usr_admin", email: "admin@bughuntr.io", role: "admin", userType: "admin", username: "admin" };

  // 1. Alice creates a private community
  const createPrivateReq = createMockRequest("http://localhost:3000/api/communities", "POST", {
    name: "Red Team Inner Circle",
    description: "Confidential exploit development working group",
    isPrivate: true,
    tags: ["redteam", "zero-day"],
  }, aliceHunter);
  const createPrivateRes = await postCommunitiesHandler(createPrivateReq);
  assert.equal(createPrivateRes.status, 201);
  const privateCommData = await createPrivateRes.json();
  const privateCommId = privateCommData.community.id;
  const inviteCode = privateCommData.community.inviteCode;
  assert.ok(inviteCode, "Private community must have an invite code");
  assert.equal(inviteCode.length, 32, "Auto-generated invite code must be 32 hex chars (16 random bytes)");
  assert.notEqual(inviteCode, `inv_${privateCommId}`, "Invite code must not be predictable from community ID");

  // 2. Alice creates a public community
  const createPublicReq = createMockRequest("http://localhost:3000/api/communities", "POST", {
    name: "Public WebSec Forum",
    description: "Open discussions on OWASP Top 10",
    isPrivate: false,
    tags: ["websec", "owasp"],
  }, aliceHunter);
  const createPublicRes = await postCommunitiesHandler(createPublicReq);
  assert.equal(createPublicRes.status, 201);
  const publicCommData = await createPublicRes.json();
  const publicCommId = publicCommData.community.id;

  // 3. Search Isolation:
  // Unauthenticated caller searching for "Circle" gets 0 results (private community not leaked)
  const unauthSearchReq = createMockRequest("http://localhost:3000/api/communities?search=Circle", "GET");
  const unauthSearchRes = await getCommunitiesHandler(unauthSearchReq);
  assert.equal(unauthSearchRes.status, 200);
  const unauthSearchResults = await unauthSearchRes.json();
  assert.equal(unauthSearchResults.communities.length, 0);

  // Non-member Bob searching for "Circle" gets 0 results
  const bobSearchReq = createMockRequest("http://localhost:3000/api/communities?search=Circle", "GET", null, bobHunter);
  const bobSearchRes = await getCommunitiesHandler(bobSearchReq);
  assert.equal(bobSearchRes.status, 200);
  const bobSearchResults = await bobSearchRes.json();
  assert.equal(bobSearchResults.communities.length, 0);

  // Bob searching for "Forum" gets 1 result (public community is discoverable)
  const bobPubSearchReq = createMockRequest("http://localhost:3000/api/communities?search=Forum", "GET", null, bobHunter);
  const bobPubSearchRes = await getCommunitiesHandler(bobPubSearchReq);
  assert.equal(bobPubSearchRes.status, 200);
  const bobPubSearchResults = await bobPubSearchRes.json();
  assert.equal(bobPubSearchResults.communities.length, 1);
  assert.equal(bobPubSearchResults.communities[0]._id, publicCommId);

  // Admin searching for "Circle" sees private community
  const adminSearchReq = createMockRequest("http://localhost:3000/api/communities?search=Circle", "GET", null, adminUser);
  const adminSearchResults = await (await getCommunitiesHandler(adminSearchReq)).json();
  assert.equal(adminSearchResults.communities.length, 1);

  // 4. Channel Enumeration Prevention:
  // Unauthenticated caller trying to list channels on private community -> 401 Unauthorized
  const unauthChannelsReq = createMockRequest(`http://localhost:3000/api/communities/${privateCommId}/channels`, "GET");
  const unauthChannelsRes = await getChannelsHandler(unauthChannelsReq, { params: Promise.resolve({ id: privateCommId }) });
  assert.equal(unauthChannelsRes.status, 401);

  // Non-member Bob trying to list channels on private community -> 403 Forbidden
  const bobChannelsReq = createMockRequest(`http://localhost:3000/api/communities/${privateCommId}/channels`, "GET", null, bobHunter);
  const bobChannelsRes = await getChannelsHandler(bobChannelsReq, { params: Promise.resolve({ id: privateCommId }) });
  assert.equal(bobChannelsRes.status, 403);

  // Non-member Bob trying to list messages on private community -> 403 Forbidden
  const bobMessagesReq = createMockRequest(`http://localhost:3000/api/communities/${privateCommId}/messages`, "GET", null, bobHunter);
  const bobMessagesRes = await getMessagesHandler(bobMessagesReq, { params: Promise.resolve({ id: privateCommId }) });
  assert.equal(bobMessagesRes.status, 403);

  // 5. Direct ID Join Bypass Prevention:
  // Bob attempts direct POST /api/communities/[id]/join without invite code -> 403 Forbidden
  const directJoinReq = createMockRequest(`http://localhost:3000/api/communities/${privateCommId}/join`, "POST", {}, bobHunter);
  const directJoinRes = await postJoinHandler(directJoinReq, { params: Promise.resolve({ id: privateCommId }) });
  assert.equal(directJoinRes.status, 403);
  assert.match((await directJoinRes.json()).error, /Cannot join a private community without an invitation/i);

  // 5b. Predictable inv_${id} Bypass Prevention (SEC-5E-01 regression):
  // Bob attempts to join using predictable inv_${communityId} code -> 403 Forbidden
  const predictableJoinReq = createMockRequest(`http://localhost:3000/api/communities/${privateCommId}/join`, "POST", {
    inviteCode: `inv_${privateCommId}`,
  }, bobHunter);
  const predictableJoinRes = await postJoinHandler(predictableJoinReq, { params: Promise.resolve({ id: privateCommId }) });
  assert.equal(predictableJoinRes.status, 403, "Predictable inv_${id} invite code must be rejected");

  // 5c. Custom Invite Code and Bypass Prevention (SEC-5E-01 regression):
  // Alice creates a second private community with an explicit custom invite code
  const customPrivateReq = createMockRequest("http://localhost:3000/api/communities", "POST", {
    name: "RedTeam Custom Enclave",
    description: "Custom secret key gated community",
    isPrivate: true,
    inviteCode: "super_secret_custom_invite_key_999",
  }, aliceHunter);
  const customPrivateRes = await postCommunitiesHandler(customPrivateReq);
  assert.equal(customPrivateRes.status, 201);
  const customCommData = await customPrivateRes.json();
  const customCommId = customCommData.community.id;
  assert.equal(customCommData.community.inviteCode, "super_secret_custom_invite_key_999");

  // Attempting to join with predictable prefix bypass fails
  const customBypassReq = createMockRequest(`http://localhost:3000/api/communities/${customCommId}/join`, "POST", {
    inviteCode: `inv_${customCommId}`,
  }, bobHunter);
  const customBypassRes = await postJoinHandler(customBypassReq, { params: Promise.resolve({ id: customCommId }) });
  assert.equal(customBypassRes.status, 403, "Predictable code must not bypass custom invite codes");

  // Non-members querying GET /api/communities/[id] do not see invite_code
  const detailsReq = createMockRequest(`http://localhost:3000/api/communities/${customCommId}`, "GET", null, adminUser);
  const detailsRes = await getCommunityByIdHandler(detailsReq, { params: Promise.resolve({ id: customCommId }) });
  assert.equal(detailsRes.status, 200);
  const detailsData = await detailsRes.json();
  assert.equal(detailsData.community.inviteCode, undefined, "inviteCode must not be exposed in community details");
  assert.equal(detailsData.community.invite_code, undefined, "invite_code must not be exposed in community details");

  // Valid custom invite code succeeds
  const customValidJoinReq = createMockRequest(`http://localhost:3000/api/communities/${customCommId}/join`, "POST", {
    inviteCode: "super_secret_custom_invite_key_999",
  }, bobHunter);
  const customValidJoinRes = await postJoinHandler(customValidJoinReq, { params: Promise.resolve({ id: customCommId }) });
  assert.equal(customValidJoinRes.status, 200, "Valid custom invite code must succeed");

  // Verify GET /api/communities does not leak invite_code
  const listReq = createMockRequest("http://localhost:3000/api/communities", "GET");
  const listRes = await getCommunitiesHandler(listReq);
  const listData = await listRes.json();
  for (const c of listData.communities) {
    assert.equal(c.invite_code, undefined, "invite_code must never be exposed in community listings");
    assert.equal(c.inviteCode, undefined, "inviteCode must never be exposed in community listings");
  }

  // 6. Authorized Invite Join:
  // Bob joins with valid invite code -> 200 OK
  const inviteJoinReq = createMockRequest(`http://localhost:3000/api/communities/${privateCommId}/join`, "POST", {
    inviteCode,
  }, bobHunter);
  const inviteJoinRes = await postJoinHandler(inviteJoinReq, { params: Promise.resolve({ id: privateCommId }) });
  assert.equal(inviteJoinRes.status, 200);

  // 7. Post-join access:
  // Bob can now list channels of the private community
  const bobJoinedChannelsReq = createMockRequest(`http://localhost:3000/api/communities/${privateCommId}/channels`, "GET", null, bobHunter);
  const bobJoinedChannelsRes = await getChannelsHandler(bobJoinedChannelsReq, { params: Promise.resolve({ id: privateCommId }) });
  assert.equal(bobJoinedChannelsRes.status, 200);
  const joinedChannels = await bobJoinedChannelsRes.json();
  assert.ok(joinedChannels.channels.length > 0);

  // Bob can now see private community in his search results
  const bobJoinedSearchReq = createMockRequest("http://localhost:3000/api/communities?search=Circle", "GET", null, bobHunter);
  const bobJoinedSearchRes = await getCommunitiesHandler(bobJoinedSearchReq);
  assert.equal(bobJoinedSearchRes.status, 200);
  const bobJoinedSearchResults = await bobJoinedSearchRes.json();
  assert.equal(bobJoinedSearchResults.communities.length, 1);
});

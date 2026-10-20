"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-context";
import type {
  BugSeverity,
  BugThread,
  BugThreadStatus,
  CommunityNotification,
  LeaderboardEntry,
  ThreadAttachment,
  ThreadChatMessage,
  ThreadComment,
} from "@/types/community";

export interface ThreadFilters {
  search: string;
  severity: "all" | BugSeverity;
  status: "all" | BugThreadStatus;
  tags: string[];
}

interface CreateThreadInput {
  title: string;
  description: string;
  severity: BugSeverity;
  tags: string[];
}

interface CreateCommentInput {
  threadId: string;
  content: string;
  parentId?: string;
}

const DEFAULT_FILTERS: ThreadFilters = {
  search: "",
  severity: "all",
  status: "all",
  tags: [],
};

const imageExtensionPattern = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i;

const inferAttachmentType = (url: string): string => {
  const match = url.match(imageExtensionPattern);
  if (!match) return "application/octet-stream";
  const ext = match[1].toLowerCase();
  if (ext === "jpg") return "image/jpeg";
  return `image/${ext}`;
};

const getAttachmentNameFromUrl = (url: string, fallback: string): string => {
  try {
    const decodedUrl = decodeURIComponent(url.split("?")[0]);
    const parts = decodedUrl.split("/");
    const name = parts[parts.length - 1];
    return name || fallback;
  } catch {
    return fallback;
  }
};

const normalizeAttachment = (value: any, index: number): ThreadAttachment | null => {
  if (typeof value === "string") {
    const fallbackName = `attachment-${index + 1}`;
    return {
      name: getAttachmentNameFromUrl(value, fallbackName),
      url: value,
      type: inferAttachmentType(value),
      size: 0,
    };
  }

  if (value && typeof value === "object" && typeof value.url === "string") {
    const fallbackName = `attachment-${index + 1}`;
    return {
      name: typeof value.name === "string" && value.name.trim() ? value.name : getAttachmentNameFromUrl(value.url, fallbackName),
      url: value.url,
      type: typeof value.type === "string" && value.type.trim() ? value.type : inferAttachmentType(value.url),
      size: typeof value.size === "number" ? value.size : 0,
    };
  }

  return null;
};

const normalizeAttachments = (value: any): ThreadAttachment[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => normalizeAttachment(entry, index))
    .filter((entry): entry is ThreadAttachment => entry !== null);
};

export function useThreadCollaboration(communityId: string, channelId: string) {
  const { user } = useAuth();
  const [threads, setThreads] = useState<BugThread[]>([]);
  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [chatMessages, setChatMessages] = useState<ThreadChatMessage[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [notifications, setNotifications] = useState<CommunityNotification[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ThreadFilters>(DEFAULT_FILTERS);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchThreads = useCallback(async () => {
    if (!communityId || !channelId) {
      setThreads([]);
      setIsLoadingThreads(false);
      return;
    }

    try {
      const res = await fetch(`/api/communities/${communityId}/threads?channelId=${encodeURIComponent(channelId)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.threads)) {
          const items: BugThread[] = data.threads.map((t: any) => ({
            ...t,
            attachmentUrls: normalizeAttachments(t.attachmentUrls),
          }));
          items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          setThreads(items);
        }
      }
    } catch (err) {
      console.error("Failed to fetch threads:", err);
    } finally {
      setIsLoadingThreads(false);
    }
  }, [communityId, channelId]);

  const fetchCommentsAndChat = useCallback(async (threadId: string) => {
    if (!communityId || !threadId) {
      setComments([]);
      setChatMessages([]);
      return;
    }

    try {
      const [commentsRes, chatRes] = await Promise.all([
        fetch(`/api/communities/${communityId}/threads/${threadId}/comments`),
        fetch(`/api/communities/${communityId}/threads/${threadId}/chat?limit=250`),
      ]);

      if (commentsRes.ok) {
        const commentsData = await commentsRes.json();
        if (Array.isArray(commentsData?.comments)) {
          setComments(
            commentsData.comments.map((c: any) => ({
              ...c,
              attachmentUrls: normalizeAttachments(c.attachmentUrls),
            }))
          );
        }
      }

      if (chatRes.ok) {
        const chatData = await chatRes.json();
        if (Array.isArray(chatData?.messages)) {
          setChatMessages(chatData.messages);
        }
      }
    } catch (err) {
      console.error("Failed to fetch comments and chat:", err);
    }
  }, [communityId]);

  const fetchLeaderboard = useCallback(async () => {
    if (!communityId) {
      setLeaderboard([]);
      return;
    }

    try {
      const res = await fetch(`/api/communities/${communityId}/leaderboard?limit=50`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.leaderboard)) {
          setLeaderboard(data.leaderboard);
        }
      }
    } catch (err) {
      console.error("Failed to fetch leaderboard:", err);
    }
  }, [communityId]);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id || !communityId) {
      setNotifications([]);
      return;
    }

    try {
      const res = await fetch(`/api/communities/notifications?communityId=${encodeURIComponent(communityId)}&limit=30`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.notifications)) {
          setNotifications(data.notifications);
        }
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  }, [communityId, user?.id]);

  useEffect(() => {
    fetchThreads();
    fetchLeaderboard();
  }, [fetchThreads, fetchLeaderboard]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (selectedThreadId) {
      fetchCommentsAndChat(selectedThreadId);
    } else {
      setComments([]);
      setChatMessages([]);
    }
  }, [selectedThreadId, fetchCommentsAndChat]);

  // Polling for live updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchThreads();
      if (selectedThreadId) {
        fetchCommentsAndChat(selectedThreadId);
      }
      if (user?.id) {
        fetchNotifications();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchThreads, fetchCommentsAndChat, fetchNotifications, selectedThreadId, user?.id]);

  useEffect(() => {
    if (selectedThreadId && threads.some((thread) => thread.id === selectedThreadId)) return;
    if (threads.length > 0) {
      setSelectedThreadId(threads[0].id);
      return;
    }
    setSelectedThreadId(null);
  }, [threads, selectedThreadId]);

  const filteredThreads = useMemo(() => {
    const normalizedSearch = filters.search.trim().toLowerCase();

    return threads.filter((thread) => {
      const matchSearch =
        normalizedSearch.length === 0 ||
        thread.title.toLowerCase().includes(normalizedSearch) ||
        thread.description.toLowerCase().includes(normalizedSearch) ||
        thread.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch));

      const matchSeverity = filters.severity === "all" || thread.severity === filters.severity;
      const matchStatus = filters.status === "all" || thread.status === filters.status;
      const matchTags =
        filters.tags.length === 0 || filters.tags.every((activeTag) => thread.tags.includes(activeTag));

      return matchSearch && matchSeverity && matchStatus && matchTags;
    });
  }, [filters, threads]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );

  const uploadAttachments = async (files: File[], pathPrefix: string): Promise<ThreadAttachment[]> => {
    const settledUploads = await Promise.allSettled(
      files.map(async (file) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("folder", pathPrefix);

        const response = await fetch("/api/cloudinary/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({ error: "Cloudinary upload failed" }));
          throw new Error(errorPayload?.error ?? "Cloudinary upload failed");
        }

        const payload = (await response.json()) as { url?: string };
        if (!payload.url) {
          throw new Error("Cloudinary upload did not return a URL");
        }

        return {
          name: file.name,
          url: payload.url,
          type: file.type || "application/octet-stream",
          size: file.size,
        } as ThreadAttachment;
      })
    );

    const uploads: ThreadAttachment[] = [];
    settledUploads.forEach((result, index) => {
      if (result.status === "fulfilled") {
        uploads.push(result.value);
        return;
      }
      console.error(`Attachment upload failed for ${files[index]?.name ?? "unknown-file"}`, result.reason);
    });

    return uploads;
  };

  const createThread = async (input: CreateThreadInput, files: File[] = []) => {
    if (!user?.id || !communityId || !channelId) return;
    if (!input.title.trim() || !input.description.trim()) return;

    setIsSaving(true);
    try {
      let attachmentUrls: ThreadAttachment[] = [];
      if (files.length > 0) {
        attachmentUrls = await uploadAttachments(files, `community-threads/${communityId}`);
      }

      const res = await fetch(`/api/communities/${communityId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          title: input.title.trim(),
          description: input.description.trim(),
          severity: input.severity,
          tags: input.tags,
          attachmentUrls,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.thread) {
          setSelectedThreadId(data.thread.id);
          await fetchThreads();
          await fetchLeaderboard();
        }
      }
    } catch (err) {
      console.error("Failed to create thread:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const addComment = async (input: CreateCommentInput, files: File[] = []) => {
    if (!user?.id || !communityId || !input.content.trim()) return;

    setIsSaving(true);
    try {
      let attachmentUrls: ThreadAttachment[] = [];
      if (files.length > 0) {
        attachmentUrls = await uploadAttachments(
          files,
          `community-comments/${communityId}/${input.threadId}`
        );
      }

      const res = await fetch(`/api/communities/${communityId}/threads/${input.threadId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: input.content.trim(),
          parentId: input.parentId ?? null,
          attachmentUrls,
        }),
      });

      if (res.ok) {
        await fetchCommentsAndChat(input.threadId);
        await fetchThreads();
        await fetchLeaderboard();
      }
    } catch (err) {
      console.error("Failed to add comment:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const markCommentAsSolution = async (threadId: string, commentId: string) => {
    if (!user?.id || !communityId) return;

    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/communities/${communityId}/threads/${threadId}/comments/${commentId}/solution`,
        { method: "POST" }
      );

      if (res.ok) {
        await fetchThreads();
        await fetchCommentsAndChat(threadId);
        await fetchLeaderboard();
      }
    } catch (err) {
      console.error("Failed to mark comment as solution:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const updateThreadStatus = async (threadId: string, status: BugThreadStatus) => {
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (res.ok) {
        await fetchThreads();
      }
    } catch (err) {
      console.error("Failed to update thread status:", err);
    }
  };

  const sendThreadChatMessage = async (threadId: string, content: string) => {
    if (!user?.id || !content.trim()) return;

    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${threadId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (res.ok) {
        await fetchCommentsAndChat(threadId);
      }
    } catch (err) {
      console.error("Failed to send thread chat message:", err);
    }
  };

  const deleteThread = async (threadId: string) => {
    if (!user?.id) return;

    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${threadId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await fetchThreads();
      }
    } catch (err) {
      console.error("Failed to delete thread:", err);
    }
  };

  const deleteThreadAttachment = async (threadId: string, attachmentUrl: string) => {
    if (!user?.id) return;

    const thread = threads.find((item) => item.id === threadId);
    if (!thread || thread.authorId !== user.id) return;

    const nextAttachments = thread.attachmentUrls.filter((file) => file.url !== attachmentUrl);
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentUrls: nextAttachments }),
      });

      if (res.ok) {
        await fetchThreads();
      }
    } catch (err) {
      console.error("Failed to delete thread attachment:", err);
    }
  };

  const deleteCommentAttachment = async (threadId: string, commentId: string, attachmentUrl: string) => {
    if (!user?.id) return;

    const comment = comments.find((item) => item.id === commentId);
    if (!comment || comment.authorId !== user.id) return;

    try {
      // Deleting a comment can be done via DELETE endpoint
      const res = await fetch(`/api/communities/${communityId}/threads/${threadId}/comments/${commentId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await fetchCommentsAndChat(threadId);
      }
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  const markNotificationAsRead = async (notificationId: string) => {
    if (!user?.id) return;

    try {
      const res = await fetch("/api/communities/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });

      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
        );
      }
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    threads.forEach((thread) => {
      thread.tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [threads]);

  const suggestExperts = (tags: string[]): LeaderboardEntry[] => {
    if (tags.length === 0) return leaderboard.slice(0, 5);

    const normalizedTags = tags.map((tag) => tag.toLowerCase());
    return [...leaderboard]
      .map((entry) => {
        const overlap = entry.skills.filter((skill) => normalizedTags.includes(skill.toLowerCase())).length;
        return { entry, overlap };
      })
      .filter((result) => result.overlap > 0)
      .sort((a, b) => {
        if (b.overlap !== a.overlap) return b.overlap - a.overlap;
        return b.entry.reputation - a.entry.reputation;
      })
      .map((result) => result.entry);
  };

  return {
    filters,
    setFilters,
    filteredThreads,
    threads,
    selectedThread,
    selectedThreadId,
    setSelectedThreadId,
    comments,
    chatMessages,
    leaderboard,
    notifications,
    availableTags,
    isLoadingThreads,
    isSaving,
    createThread,
    deleteThread,
    addComment,
    markCommentAsSolution,
    updateThreadStatus,
    sendThreadChatMessage,
    deleteThreadAttachment,
    deleteCommentAttachment,
    markNotificationAsRead,
    suggestExperts,
  };
}

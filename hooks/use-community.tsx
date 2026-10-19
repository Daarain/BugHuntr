"use client";

import type React from "react";
import { useState, useEffect, createContext, useContext, useMemo, useCallback } from "react";
import type { Community, CommunityChannel, CommunityMember, CommunityMessage } from "@/types/community";
import { useAuth } from "@/components/auth/auth-context";

interface CommunityContextType {
  communities: Community[];
  currentCommunity: Community | null;
  communityMembers: CommunityMember[];
  communityMessages: CommunityMessage[];
  joinedCommunities: Community[];
  joinedCommunityIds: string[];
  isLoading: boolean;

  // Actions
  setCurrentCommunity: (community: Community | null) => void;
  joinCommunity: (communityId: string) => Promise<void>;
  leaveCommunity: (communityId: string) => Promise<void>;
  createCommunity: (communityData: Partial<Community>) => Promise<Community>;
  createChannel: (
    communityId: string,
    channelData: Pick<CommunityChannel, "name" | "description" | "type" | "isPrivate">
  ) => Promise<CommunityChannel>;
  updateCommunity: (communityId: string, updates: Partial<Community>) => Promise<void>;
  sendMessage: (channelId: string, content: string) => Promise<void>;
  getChannelMessages: (channelId: string) => CommunityMessage[];
  getUserRole: (communityId: string, userId: string) => string | null;
  getCommunityChannels: (communityId: string) => CommunityChannel[];
}

const CommunityContext = createContext<CommunityContextType | undefined>(undefined);

export function useCommunity() {
  const context = useContext(CommunityContext);
  if (context === undefined) {
    throw new Error("useCommunity must be used within a CommunityProvider");
  }
  return context;
}

export function CommunityProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [currentCommunity, setCurrentCommunity] = useState<Community | null>(null);
  const [communityMembers, setCommunityMembers] = useState<CommunityMember[]>([]);
  const [communityMessages, setCommunityMessages] = useState<CommunityMessage[]>([]);
  const [joinedCommunityIds, setJoinedCommunityIds] = useState<string[]>([]);
  const [channelMap, setChannelMap] = useState<Record<string, CommunityChannel[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  const fetchCommunities = useCallback(async () => {
    try {
      const res = await fetch("/api/communities");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.communities)) {
          setCommunities(data.communities);
        }
      }
    } catch (err) {
      console.error("Failed to fetch communities:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchJoinedCommunities = useCallback(async () => {
    if (!user?.id) {
      setJoinedCommunityIds([]);
      return;
    }

    try {
      const res = await fetch("/api/communities?joined=true");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.communities)) {
          const ids = data.communities.map((c: any) => c.id);
          setJoinedCommunityIds(ids);
        }
      }
    } catch (err) {
      console.error("Failed to fetch joined communities:", err);
    }
  }, [user?.id]);

  const fetchCommunityDetails = useCallback(async (communityId: string) => {
    if (!communityId) return;

    try {
      const res = await fetch(`/api/communities/${communityId}`);
      if (res.ok) {
        const data = await res.json();
        const comm = data?.community;
        if (comm) {
          if (Array.isArray(comm.channels)) {
            setChannelMap((prev) => ({ ...prev, [communityId]: comm.channels }));
          }
          if (Array.isArray(comm.members)) {
            setCommunityMembers(comm.members);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch community details:", err);
    }
  }, []);

  const fetchChannelMessages = useCallback(async (communityId: string, channelId: string) => {
    if (!communityId || !channelId) return;

    try {
      const res = await fetch(`/api/communities/${communityId}/channels/${channelId}/messages?limit=100`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.messages)) {
          setCommunityMessages(data.messages);
        }
      }
    } catch (err) {
      console.error("Failed to fetch channel messages:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchCommunities();
  }, [fetchCommunities]);

  useEffect(() => {
    fetchJoinedCommunities();
  }, [fetchJoinedCommunities]);

  // Load details and members when current community changes
  useEffect(() => {
    if (currentCommunity?.id) {
      fetchCommunityDetails(currentCommunity.id);
    } else {
      setCommunityMembers([]);
    }
  }, [currentCommunity?.id, fetchCommunityDetails]);

  // Polling for updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchCommunities();
      if (user?.id) {
        fetchJoinedCommunities();
      }
      if (currentCommunity?.id) {
        fetchCommunityDetails(currentCommunity.id);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [fetchCommunities, fetchJoinedCommunities, fetchCommunityDetails, user?.id, currentCommunity?.id]);

  const joinedCommunities = useMemo(
    () => communities.filter((community) => joinedCommunityIds.includes(community.id)),
    [communities, joinedCommunityIds]
  );

  useEffect(() => {
    if (currentCommunity && joinedCommunityIds.includes(currentCommunity.id)) return;
    if (joinedCommunities.length > 0) {
      setCurrentCommunity(joinedCommunities[0]);
      return;
    }
    setCurrentCommunity(null);
  }, [joinedCommunities, joinedCommunityIds, currentCommunity]);

  const joinCommunity = async (communityId: string) => {
    if (!user?.id) return;

    const res = await fetch(`/api/communities/${communityId}/join`, {
      method: "POST",
    });

    if (res.ok) {
      setJoinedCommunityIds((prev) => Array.from(new Set([...prev, communityId])));
      await fetchCommunities();
      await fetchCommunityDetails(communityId);
    }
  };

  const leaveCommunity = async (communityId: string) => {
    if (!user?.id) return;

    const res = await fetch(`/api/communities/${communityId}/leave`, {
      method: "POST",
    });

    if (res.ok) {
      setJoinedCommunityIds((prev) => prev.filter((id) => id !== communityId));
      if (currentCommunity?.id === communityId) {
        setCurrentCommunity(null);
      }
      await fetchCommunities();
    }
  };

  const createCommunity = async (communityData: Partial<Community>): Promise<Community> => {
    if (!user?.id) {
      throw new Error("You must be logged in to create a community");
    }

    const res = await fetch("/api/communities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(communityData),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create community" }));
      throw new Error(err.error || "Failed to create community");
    }

    const data = await res.json();
    const created: Community = data.community;

    setJoinedCommunityIds((prev) => Array.from(new Set([...prev, created.id])));
    await fetchCommunities();
    setCurrentCommunity(created);

    return created;
  };

  const createChannel = async (
    communityId: string,
    channelData: Pick<CommunityChannel, "name" | "description" | "type" | "isPrivate">
  ): Promise<CommunityChannel> => {
    const res = await fetch(`/api/communities/${communityId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(channelData),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create channel" }));
      throw new Error(err.error || "Failed to create channel");
    }

    const data = await res.json();
    const channel: CommunityChannel = data.channel;

    setChannelMap((prev) => ({
      ...prev,
      [communityId]: [...(prev[communityId] || []), channel],
    }));

    return channel;
  };

  const updateCommunity = async (communityId: string, updates: Partial<Community>) => {
    const res = await fetch(`/api/communities/${communityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to update community" }));
      throw new Error(err.error || "Failed to update community");
    }

    await fetchCommunities();
    await fetchCommunityDetails(communityId);
  };

  const sendMessage = async (channelId: string, content: string) => {
    if (!user?.id || !currentCommunity?.id || !content.trim()) return;

    const res = await fetch(`/api/communities/${currentCommunity.id}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.message) {
        setCommunityMessages((prev) => [...prev, data.message]);
      }
    }
  };

  const getChannelMessages = (channelId: string) => {
    return communityMessages.filter((msg) => msg.channelId === channelId);
  };

  const getUserRole = (communityId: string, userId: string) => {
    const member = communityMembers.find(
      (m) => m.userId === userId && joinedCommunityIds.includes(communityId)
    );
    return member?.role || null;
  };

  const getCommunityChannels = (communityId: string) => channelMap[communityId] ?? [];

  const value: CommunityContextType = {
    communities,
    currentCommunity,
    communityMembers,
    communityMessages,
    joinedCommunities,
    joinedCommunityIds,
    isLoading,
    setCurrentCommunity,
    joinCommunity,
    leaveCommunity,
    createCommunity,
    createChannel,
    updateCommunity,
    sendMessage,
    getChannelMessages,
    getUserRole,
    getCommunityChannels,
  };

  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>;
}

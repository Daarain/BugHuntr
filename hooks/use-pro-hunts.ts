"use client";

import { useState, useEffect, useCallback } from "react";
import { type ProHunt } from "@/types/pro";
import { mockProHunts } from "@/data/mock-pro-data";

export function useProHunts() {
  const [proHunts, setProHunts] = useState<ProHunt[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProHunts = useCallback(async () => {
    try {
      const res = await fetch("/api/pro/hunts", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const hunts = Array.isArray(data?.hunts) ? data.hunts : Array.isArray(data) ? data : mockProHunts;
        setProHunts(hunts);
      } else {
        setProHunts(mockProHunts);
      }
    } catch (err) {
      console.error("Failed to load pro hunts, falling back to mocks:", err);
      setProHunts(mockProHunts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProHunts();
  }, [fetchProHunts]);

  const createProHunt = async (
    huntData: Omit<
      ProHunt,
      "id" | "createdAt" | "updatedAt" | "currentHunters"
    >,
  ) => {
    try {
      const res = await fetch("/api/pro/hunts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(huntData),
      });

      if (res.ok) {
        const data = await res.json();
        const created = data?.hunt || data;
        setProHunts((prev) => [created, ...prev]);
        return created;
      }
    } catch (err) {
      console.error("Failed to persist pro hunt via API:", err);
    }

    // Fallback in-memory creation if offline / dev unconfigured
    const fallbackHunt: ProHunt = {
      ...huntData,
      id: `prohunt_${Date.now()}`,
      currentHunters: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProHunts((prev) => [fallbackHunt, ...prev]);
    return fallbackHunt;
  };

  const updateProHunt = async (huntId: string, updates: Partial<ProHunt>) => {
    setProHunts((prev) =>
      prev.map((hunt) =>
        hunt.id === huntId
          ? { ...hunt, ...updates, updatedAt: new Date().toISOString() }
          : hunt,
      ),
    );

    try {
      await fetch("/api/pro/hunts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: huntId, ...updates }),
      });
    } catch (err) {
      console.error("Failed to update pro hunt via API:", err);
    }
  };

  const deleteProHunt = async (huntId: string) => {
    setProHunts((prev) => prev.filter((hunt) => hunt.id !== huntId));
  };

  const getProHuntById = (huntId: string) => {
    return proHunts.find((hunt) => hunt.id === huntId);
  };

  const getActiveProHunts = () => {
    return proHunts.filter((hunt) => hunt.status === "active");
  };

  const getCompanyProHunts = (companyId: string) => {
    return proHunts.filter((hunt) => hunt.companyId === companyId);
  };

  return {
    proHunts,
    loading,
    createProHunt,
    updateProHunt,
    deleteProHunt,
    getProHuntById,
    getActiveProHunts,
    getCompanyProHunts,
    refetch: fetchProHunts,
  };
}

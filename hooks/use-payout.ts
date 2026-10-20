/**
 * Custom Hook for Payout Operations
 *
 * Provides client-side functions to interact with authenticated Next.js API routes
 * for payout creation, status tracking, and management.
 * Fully migrated to PostgreSQL (Auth) + MongoDB (Business Data).
 */

"use client";

import { useState, useCallback } from "react";
import type {
  Payout,
  OrgWallet,
  CreatePayoutRequest,
  CreatePayoutResponse,
  BatchPayoutResponse,
} from "@/types/payout";

export function usePayouts() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Create a single payout
   */
  const createPayout = useCallback(
    async (request: CreatePayoutRequest): Promise<CreatePayoutResponse> => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/payouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to create payout");
        }

        return data;
      } catch (err: any) {
        const errorMessage = err.message || "Failed to create payout";
        setError(errorMessage);
        throw new Error(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Get payout by order_id
   */
  const getPayout = useCallback(
    async (order_id: string): Promise<Payout | null> => {
      try {
        const res = await fetch(`/api/payouts/${encodeURIComponent(order_id)}`);
        if (res.status === 404) return null;

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch payout");
        }

        const p = data.payout;
        if (!p) return null;

        return {
          ...p,
          order_id: p.order_id || p._id,
          createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
          updatedAt: p.updatedAt ? new Date(p.updatedAt) : undefined,
        } as Payout;
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    []
  );

  /**
   * Get all payouts for an organization
   */
  const getOrgPayouts = useCallback(
    async (orgId: string): Promise<Payout[]> => {
      try {
        const res = await fetch(`/api/payouts?orgId=${encodeURIComponent(orgId)}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch organization payouts");
        }

        return (data.payouts || []).map((p: any) => ({
          ...p,
          order_id: p.order_id || p._id,
          createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
          updatedAt: p.updatedAt ? new Date(p.updatedAt) : undefined,
        })) as Payout[];
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    []
  );

  /**
   * Get payouts for a hunter
   */
  const getHunterPayouts = useCallback(
    async (hunterUid: string): Promise<Payout[]> => {
      try {
        const res = await fetch(`/api/payouts?hunterUid=${encodeURIComponent(hunterUid)}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch hunter payouts");
        }

        return (data.payouts || []).map((p: any) => ({
          ...p,
          order_id: p.order_id || p._id,
          createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
          updatedAt: p.updatedAt ? new Date(p.updatedAt) : undefined,
        })) as Payout[];
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    []
  );

  /**
   * Subscribe to payout status updates via safe interval polling
   */
  const subscribeToPayout = useCallback(
    (order_id: string, onUpdate: (payout: Payout) => void) => {
      let isMounted = true;

      const fetchStatus = async () => {
        try {
          const res = await fetch(`/api/payouts/${encodeURIComponent(order_id)}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.payout && isMounted) {
            onUpdate({
              ...data.payout,
              order_id: data.payout.order_id || data.payout._id,
              createdAt: data.payout.createdAt ? new Date(data.payout.createdAt) : undefined,
              updatedAt: data.payout.updatedAt ? new Date(data.payout.updatedAt) : undefined,
            } as Payout);
          }
        } catch (err: any) {
          if (isMounted) setError(err.message);
        }
      };

      fetchStatus();
      const interval = setInterval(fetchStatus, 3000);

      return () => {
        isMounted = false;
        clearInterval(interval);
      };
    },
    []
  );

  /**
   * Get organization wallet
   */
  const getOrgWallet = useCallback(
    async (orgId: string): Promise<OrgWallet | null> => {
      try {
        const res = await fetch(`/api/wallet/org?orgId=${encodeURIComponent(orgId)}`);
        if (res.status === 404) return null;

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch organization wallet");
        }

        const w = data.wallet;
        if (!w) return null;

        return {
          ...w,
          orgId: w.orgId || orgId,
          updatedAt: w.updatedAt ? new Date(w.updatedAt) : new Date(),
        } as OrgWallet;
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    []
  );

  /**
   * Subscribe to wallet balance updates via interval polling
   */
  const subscribeToWallet = useCallback(
    (orgId: string, onUpdate: (wallet: OrgWallet) => void) => {
      let isMounted = true;

      const fetchWallet = async () => {
        try {
          const res = await fetch(`/api/wallet/org?orgId=${encodeURIComponent(orgId)}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.wallet && isMounted) {
            onUpdate({
              ...data.wallet,
              orgId: data.wallet.orgId || orgId,
              updatedAt: data.wallet.updatedAt ? new Date(data.wallet.updatedAt) : new Date(),
            } as OrgWallet);
          }
        } catch (err: any) {
          if (isMounted) setError(err.message);
        }
      };

      fetchWallet();
      const interval = setInterval(fetchWallet, 3000);

      return () => {
        isMounted = false;
        clearInterval(interval);
      };
    },
    []
  );

  /**
   * Create batch payouts from CSV data
   */
  const createBatchPayouts = useCallback(
    async (
      orgId: string,
      payouts: Array<{
        submissionId: string;
        huntId: string;
        hunterUid: string;
        hunterWallet: string;
        amount: number;
      }>
    ): Promise<BatchPayoutResponse> => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/payouts/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, payouts }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to create batch payouts");
        }

        return data;
      } catch (err: any) {
        const errorMessage = err.message || "Failed to create batch payouts";
        setError(errorMessage);
        throw new Error(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    loading,
    error,
    createPayout,
    getPayout,
    getOrgPayouts,
    getHunterPayouts,
    subscribeToPayout,
    getOrgWallet,
    subscribeToWallet,
    createBatchPayouts,
  };
}

/**
 * use-auth.ts
 *
 * React hook for session authentication backed by PostgreSQL/server-auth.
 * Provides current user, loading state, and authentication state.
 */

"use client";

import { useState, useEffect } from "react";

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  role?: "admin" | "triager" | "user";
  org?: string;
  customClaims?: {
    role?: "admin" | "triager" | "user";
    org?: string;
  };
}

export interface UseAuthResult {
  user: AuthUser | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook for managing authentication state backed by PostgreSQL session API.
 * Returns current user, loading state, and any errors.
 */
export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchSession() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.authenticated && data?.user && isMounted) {
            const sessionUser = data.user;
            const effectiveRole = sessionUser.role === "admin" ? "admin" : sessionUser.role === "triager" ? "triager" : "user";
            const effectiveOrg = sessionUser.organizationId || sessionUser.orgId || sessionUser.companyName || undefined;

            const authUser: AuthUser = {
              uid: sessionUser.id,
              email: sessionUser.email || null,
              displayName: sessionUser.username || sessionUser.email?.split("@")[0] || null,
              photoURL: null,
              emailVerified: true,
              role: effectiveRole,
              org: effectiveOrg,
              customClaims: {
                role: effectiveRole,
                org: effectiveOrg,
              },
            };

            setUser(authUser);
            setLoading(false);
            return;
          }
        }

        if (isMounted) {
          setUser(null);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error("Session fetch error"));
          setUser(null);
          setLoading(false);
        }
      }
    }

    fetchSession();

    return () => {
      isMounted = false;
    };
  }, []);

  return { user, loading, error };
}

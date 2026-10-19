"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { getDisplayUsername } from "@/lib/extract-username";

interface User {
  id: string;
  username: string;
  email?: string;
  role: "user" | "admin";
  userType: "company" | "hunter";
  companyName?: string;
  companyId?: string;
  companyDomain?: string;
  representativeName?: string;
  twoFactorEnabled?: boolean;
  rank?: "C" | "B" | "A" | "S";
  huntsParticipated?: number;
  certifications?: string[];
  reputation?: number;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  login: (username: string, email?: string, role?: "user" | "admin", userType?: "company" | "hunter", additionalData?: Partial<User>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.authenticated && data?.user && isMounted) {
            setIsAuthenticated(true);
            setUser(data.user);
            setIsLoading(false);
            return;
          }
        }
      } catch (err) {
        console.error("Session verification failed:", err);
      }

      if (isMounted) {
        setIsAuthenticated(false);
        setUser(null);
        setIsLoading(false);
      }
    }

    checkSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = (
    username: string,
    email?: string,
    role: "user" | "admin" = "user",
    userType: "company" | "hunter" = "hunter",
    additionalData?: Partial<User>
  ) => {
    const displayUsername = getDisplayUsername(username, email);
    const userData: User = {
      id: additionalData?.id || displayUsername,
      username: displayUsername,
      email,
      role,
      userType,
      ...additionalData,
    };
    setIsAuthenticated(true);
    setUser(userData);
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (err) {
      console.error("Logout request failed:", err);
    } finally {
      setIsAuthenticated(false);
      setUser(null);
      if (typeof window !== "undefined") {
        localStorage.removeItem("isAuthenticated");
        localStorage.removeItem("currentUser");
      }
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

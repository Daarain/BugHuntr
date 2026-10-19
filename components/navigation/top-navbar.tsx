"use client";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Bell,
  Search,
  Menu,
  User,
  LogOut,
  Settings,
} from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import Link from "next/link";
import { Logo } from "./logo";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/auth/auth-context";
import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useSearch } from "@/components/search/search-context";
import { toast } from "sonner";

export const INVITATIONS_POLL_INTERVAL_MS = 30000;

export interface TopNavbarInvitation {
  id: string;
  huntId: string;
  huntTitle: string;
  companyName: string;
  hunterId?: string;
  hunterUsername?: string;
  email?: string;
  status: "pending" | "accepted" | "declined" | "expired" | string;
  invitedBy?: string;
  invitedAt?: string;
  expiresAt?: string;
}

interface TopNavbarProps {
  onMenuClick: () => void;
}

function TopNavbarComponent({ onMenuClick }: TopNavbarProps) {
  const { isAuthenticated, logout, user } = useAuth();
  const { searchTerm, setSearchTerm, suggestions, setSuggestions } =
    useSearch();
  const pathname = usePathname();
  const isFeedPage = pathname === "/feed";
  const [localSearchTerm, setLocalSearchTerm] = useState<string>(
    searchTerm ?? "",
  );
  const [invitations, setInvitations] = useState<TopNavbarInvitation[]>([]);
  const [isLoadingInvitations, setIsLoadingInvitations] = useState<boolean>(false);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounce search input to reduce re-renders
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      setSearchTerm(localSearchTerm);
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [localSearchTerm, setSearchTerm]);

  const fetchInvitations = useCallback(async (isInitial = false) => {
    if (!isAuthenticated || !user?.id) {
      setInvitations([]);
      setInvitationsError(null);
      setIsLoadingInvitations(false);
      return;
    }

    // Avoid overlapping requests
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    if (isInitial) {
      setIsLoadingInvitations(true);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/pro/invitations?status=pending", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        credentials: "include",
        signal: controller.signal,
      });

      if (!isMountedRef.current) return;

      if (!res.ok) {
        if (res.status === 401) {
          // Unauthenticated or expired session
          setInvitations([]);
          setInvitationsError(null);
          return;
        }
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Failed to fetch invitations: HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!isMountedRef.current) return;

      const rawList = Array.isArray(data?.invitations)
        ? data.invitations
        : Array.isArray(data)
          ? data
          : [];

      const normalized: TopNavbarInvitation[] = rawList.map((item: any) => ({
        ...item,
        id: item.id || item._id,
        huntId: item.huntId || item.hunt_id,
        huntTitle: item.huntTitle || item.hunt_title || "Pro Hunt",
        companyName: item.companyName || item.company_name || "Company",
        status: item.status || "pending",
      }));

      setInvitations(normalized);
      setInvitationsError(null);
    } catch (err: any) {
      if (err.name === "AbortError") {
        return;
      }
      if (!isMountedRef.current) return;
      console.error("Failed to fetch pro invitations:", err);
      setInvitationsError(err.message || "Failed to load invitations");
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current && isInitial) {
        setIsLoadingInvitations(false);
      }
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!isAuthenticated || !user?.id) {
      setInvitations([]);
      setInvitationsError(null);
      setIsLoadingInvitations(false);
      return;
    }

    fetchInvitations(true);

    const intervalId = setInterval(() => {
      fetchInvitations(false);
    }, INVITATIONS_POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isAuthenticated, user?.id, fetchInvitations]);

  const handleInvitationAction = async (
    invitationId: string,
    huntId: string,
    status: "accepted" | "declined",
  ) => {
    if (actionLoadingId) return; // Prevent duplicate actions
    setActionLoadingId(invitationId);

    try {
      const res = await fetch(`/api/pro/invitations/${encodeURIComponent(invitationId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || `Failed to update invitation: HTTP ${res.status}`);
      }

      if (isMountedRef.current) {
        setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
      }

      if (status === "accepted") {
        toast.success("Invitation accepted");
      } else {
        toast.info("Invitation declined");
      }
    } catch (error: any) {
      console.error("Failed to update invitation:", error);
      toast.error(error.message || "Failed to update invitation");
    } finally {
      if (isMountedRef.current) {
        setActionLoadingId(null);
      }
    }
  };

  const handleLogout = () => {
    logout();
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-[var(--border)] backdrop-blur supports-[backdrop-filter]:bg-background/90"
      style={{
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        transition: "background 0.3s, color 0.3s",
      }}
    >
      <div className="flex h-14 md:h-16 items-center justify-between gap-2 px-3 sm:px-4 lg:px-6 xl:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <Logo />
          </div>
        </div>

        {isFeedPage ? (
          <div className="hidden sm:block flex-1 min-w-0 max-w-xs md:max-w-md lg:max-w-lg mx-1 sm:mx-3 lg:mx-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search vulnerabilities..."
                className="w-full pl-10 pr-4 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all text-sm text-foreground placeholder:text-muted-foreground"
                value={localSearchTerm}
                onChange={(e) => setLocalSearchTerm(e.target.value)}
              />
              {localSearchTerm.trim().length > 0 && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 rounded-lg border border-border bg-popover shadow-md overflow-hidden z-50">
                  {suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                      onClick={() => {
                        setLocalSearchTerm(item.title);
                        setSearchTerm(item.title);
                        setSuggestions([]);
                        const target = document.getElementById(
                          `bug-${item.id}`,
                        );
                        if (target) {
                          target.scrollIntoView({
                            behavior: "smooth",
                            block: "end",
                          });
                        }
                      }}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-w-0" />
        )}

        <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
          <div className="flex-shrink-0">
            <ThemeToggle />
          </div>

          {isAuthenticated ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative hidden sm:inline-flex">
                    <Bell className="h-5 w-5" />
                    {invitations.length > 0 && (
                      <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-[var(--high)] rounded-full"></span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                    <span>Invitations</span>
                    {invitations.length > 0 && (
                      <span className="text-xs text-muted-foreground font-normal">
                        ({invitations.length})
                      </span>
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  {isLoadingInvitations && invitations.length === 0 ? (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                      Loading invitations...
                    </div>
                  ) : invitationsError && invitations.length === 0 ? (
                    <div className="px-3 py-3 text-center text-xs text-destructive">
                      {invitationsError}
                    </div>
                  ) : invitations.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No pending invitations
                    </div>
                  ) : (
                    invitations.map((invite) => (
                      <div key={invite.id} className="px-3 py-2 border-b border-border/40 last:border-0">
                        <div className="text-sm font-medium">
                          {invite.huntTitle || "Pro Hunt"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {invite.companyName || "Company"}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            className="h-7"
                            disabled={actionLoadingId === invite.id}
                            onClick={() =>
                              handleInvitationAction(
                                invite.id,
                                invite.huntId,
                                "accepted",
                              )
                            }
                          >
                            {actionLoadingId === invite.id ? "Processing..." : "Accept"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            disabled={actionLoadingId === invite.id}
                            onClick={() =>
                              handleInvitationAction(
                                invite.id,
                                invite.huntId,
                                "declined",
                              )
                            }
                          >
                            {actionLoadingId === invite.id ? "Processing..." : "Decline"}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Avatar className="h-7 w-7 sm:h-8 sm:w-8 cursor-pointer hover:ring-2 hover:ring-primary transition-all">
                    <AvatarImage src="/placeholder.svg?height=28&width=28" />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      JD
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="flex items-center">
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/settings" className="flex items-center">
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-[var(--critical)]"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                <Link href="/login">Login</Link>
              </Button>
              <Button
                size="sm"
                asChild
                className="bg-primary hover:bg-[var(--accent-hover)]"
              >
                <Link href="/signup" className="px-1 sm:px-0">Sign Up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export const TopNavbar = memo(TopNavbarComponent);

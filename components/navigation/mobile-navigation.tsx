"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Home,
  Bug,
  Target,
  Award,
  Users,
  FileText,
  Settings,
  X,
  LogIn,
  UserPlus,
  LogOut,
  Wallet,
  Crown,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-context";
import { Logo } from "./logo";

interface MobileNavigationProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileNavigation({ isOpen, onClose }: MobileNavigationProps) {
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuth();
  const proEnabled = process.env.NEXT_PUBLIC_BUGHUNTR_PRO === "true";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const navItems = isAuthenticated
    ? [
        { id: "dashboard", label: "Dashboard", icon: Home, href: "/dashboard" },
        { id: "bug-feed", label: "Bug Feed", icon: Bug, href: "/feed" },
        { id: "bug-hunts", label: "Bug Hunts", icon: Target, href: "/bug-hunt" },
        ...(proEnabled
          ? [{ id: "pro", label: "BugHuntr Pro", icon: Crown, href: "/pro" }]
          : []),
        ...(user?.role === "admin"
          ? [
              {
                id: "admin-hunts",
                label: "Manage Hunts",
                icon: Target,
                href: "/admin/bug-hunts",
              },
              {
                id: "admin-submissions",
                label: "Review Submissions",
                icon: ClipboardList,
                href: "/admin/submissions",
              },
            ]
          : [
              {
                id: "submit-bug",
                label: "Submit Bug",
                icon: FileText,
                href: "/submit",
              },
              {
                id: "my-submissions",
                label: "My Submissions",
                icon: ClipboardList,
                href: "/my-submissions",
              },
              {
                id: "my-wallet",
                label: "My Wallet",
                icon: Wallet,
                href: "/my-wallet",
              },
            ]),
        {
          id: "communities",
          label: "Communities",
          icon: Users,
          href: "/communities",
        },
        {
          id: "leaderboard",
          label: "Leaderboard",
          icon: Award,
          href: "/leaderboard",
        },
        { id: "docs", label: "Documentation", icon: FileText, href: "/docs" },
        { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
      ]
    : [
        { id: "home", label: "Home", icon: Home, href: "/" },
        { id: "bug-feed", label: "Bug Feed", icon: Bug, href: "/feed" },
        { id: "bug-hunts", label: "Bug Hunts", icon: Target, href: "/bug-hunt" },
        {
          id: "communities",
          label: "Communities",
          icon: Users,
          href: "/communities",
        },
        {
          id: "leaderboard",
          label: "Leaderboard",
          icon: Award,
          href: "/leaderboard",
        },
        { id: "docs", label: "Documentation", icon: FileText, href: "/docs" },
      ];

  const userInitials = (user?.username || user?.email || "U")
    .substring(0, 2)
    .toUpperCase();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden transition-opacity animate-in fade-in"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Mobile Navigation"
        className={cn(
          "fixed top-0 left-0 bottom-0 h-full w-[85vw] max-w-72 bg-card border-r border-border z-50 flex flex-col justify-between shadow-2xl transition-transform duration-300 ease-out lg:hidden",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border/80">
            <Logo />
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close navigation"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <nav className="flex-1 p-3 overflow-y-auto space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] font-semibold border-l-2 border-[var(--accent-primary)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-3 border-t border-border/80 bg-card/50">
          {isAuthenticated && user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/40">
                <Avatar className="h-9 w-9 border border-border">
                  <AvatarImage src="/placeholder-user.jpg" alt={user.username || "User"} />
                  <AvatarFallback className="bg-[var(--accent-primary)] text-white text-xs font-bold">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground">
                    {user.username || "Security Researcher"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate capitalize">
                    {user.role || "Researcher"}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  logout();
                }}
                className="w-full justify-center gap-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link href="/login" onClick={onClose} className="w-full">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs font-medium gap-1.5"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Sign In
                </Button>
              </Link>
              <Link href="/signup" onClick={onClose} className="w-full">
                <Button
                  size="sm"
                  className="w-full text-xs font-medium bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white gap-1.5"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Register
                </Button>
              </Link>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

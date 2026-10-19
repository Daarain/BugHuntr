"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-context";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Shield, Eye, Clock, DollarSign } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface BugCardProps {
  bug: {
    id: string | number;
    title: string;
    severity: "critical" | "high" | "medium" | "low";
    category: string;
    company: string;
    summary: string;
    postedTime: string;
    isLocked: boolean;
    author: string;
    email?: string;
    bounty?: number;
    views?: number;
    status?: string;
  };
  className?: string;
  index?: number;
}

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case "critical":
      return "text-severity-critical bg-severity-critical/10 border-severity-critical";
    case "high":
      return "text-severity-high bg-severity-high/10 border-severity-high";
    case "medium":
      return "text-severity-medium bg-severity-medium/10 border-severity-medium";
    case "low":
      return "text-severity-low bg-severity-low/10 border-severity-low";
    default:
      return "text-muted-foreground bg-muted border-border";
  }
};

const getSeverityGlow = (severity: string) => {
  switch (severity) {
    case "critical":
      return "hover:shadow-md";
    case "high":
      return "hover:shadow-md";
    case "medium":
      return "hover:shadow-md";
    case "low":
      return "hover:shadow-md";
    default:
      return "hover:shadow-md";
  }
};

export function BugCard({ bug, className, index = 0 }: BugCardProps) {
  const { user } = useAuth();
  const isOwner = user?.email && bug.email && user.email === bug.email;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!bug.id) return;
    if (
      !window.confirm(
        "Are you sure you want to delete this bug report? This action cannot be undone."
      )
    )
      return;
    try {
      const res = await fetch(`/api/bug-submissions/${bug.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to delete bug");
      }
      window.location.reload();
    } catch (err) {
      alert("Failed to delete bug. Try again.");
    }
  };
  // Real-time 'time ago' logic
  const [timeAgo, setTimeAgo] = useState("");
  useEffect(() => {
    function updateTimeAgo() {
      if (bug.postedTime) {
        const date = new Date(bug.postedTime);
        if (!isNaN(date.getTime())) {
          setTimeAgo(formatDistanceToNow(date, { addSuffix: true }));
        } else {
          setTimeAgo("Just now");
        }
      } else {
        setTimeAgo("Just now");
      }
    }
    updateTimeAgo();
    const interval = setInterval(updateTimeAgo, 60000); // update every minute
    return () => clearInterval(interval);
  }, [bug.postedTime]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: index * 0.1,
        ease: "easeOut",
      }}
      whileHover={{
        y: -8,
        transition: { duration: 0.2 },
      }}
      className={className}
    >
      <Card
        className={cn(
          "group cursor-pointer transition-all duration-300 border-l-4 border-l-transparent",
          "hover:border-l-cyber-blue",
          getSeverityGlow(bug.severity),
          "transform-gpu"
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-3 flex-1 min-w-0">
              <motion.div
                className="flex items-center gap-2 flex-wrap"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.1 + 0.2 }}
              >
                <Badge
                  className={cn(
                    getSeverityColor(bug.severity),
                    "font-semibold text-xs shrink-0"
                  )}
                >
                  {bug.severity ? (
                    bug.severity.toUpperCase()
                  ) : (
                    <span className="bg-primary text-white px-2 py-0.5 rounded">
                      UNKNOWN
                    </span>
                  )}
                </Badge>
                <Badge
                  variant="outline"
                  className="border-[var(--border-light)] text-xs shrink-0 truncate max-w-24"
                >
                  {bug.category || "Web Application"}
                </Badge>
                {bug.company && (
                  <Badge
                    variant="secondary"
                    className="bg-[var(--accent-soft)] text-primary text-xs shrink-0 truncate max-w-32"
                  >
                    {bug.company}
                  </Badge>
                )}
              </motion.div>
              <CardTitle className="text-base sm:text-lg leading-tight group-hover:text-primary transition-colors duration-200 line-clamp-2">
                {bug.title || (
                  <span className="text-muted-foreground">
                    No title provided
                  </span>
                )}
              </CardTitle>
            </div>
            {bug.isLocked && (
              <motion.div
                className="flex items-center gap-1 text-[var(--high)] bg-[color:color-mix(in_srgb,var(--high)_12%,transparent)] px-2 py-1 rounded-md shrink-0"
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.2 }}
              >
                <Shield className="h-4 w-4" />
                <span className="text-xs sm:text-sm font-medium hidden sm:inline">
                  Premium
                </span>
              </motion.div>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <CardDescription className="text-sm leading-relaxed line-clamp-3 break-words">
            {bug.summary && bug.summary !== "No summary provided." ? (
              bug.summary
            ) : (
              <span className="text-muted-foreground">No summary provided</span>
            )}
          </CardDescription>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-border/50">
            <div className="flex items-center justify-end gap-3 min-w-0 pt-2 border-t border-border/50">
              {/* <button
                  className="px-3 py-1 text-xs bg-primary text-white rounded hover:bg-primary/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.location.href = `/bug/${bug.id}`;
                  }}
                >
                  Open
                </button> */}
              {isOwner && (
                <button
                  className="px-3 py-1 text-xs bg-destructive text-white rounded hover:bg-destructive/80"
                  onClick={handleDelete}
                  title="Delete Bug"
                >
                  Delete
                </button>
              )}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="feather feather-clock"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>{" "}
                {timeAgo}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 text-xs text-muted-foreground flex-wrap">
              {bug.bounty ? (
                <motion.div
                  className="flex items-center gap-1 text-[var(--low)] shrink-0"
                  whileHover={{ scale: 1.1 }}
                  transition={{ duration: 0.2 }}
                >
                  <DollarSign className="h-3 w-3" />
                  <span className="font-semibold">
                    {bug.bounty.toLocaleString()}
                  </span>
                </motion.div>
              ) : (
                <span className="font-semibold text-muted-foreground">00</span>
              )}
              {bug.views ? (
                <div className="flex items-center gap-1 shrink-0">
                  <Eye className="h-3 w-3" />
                  <span>{bug.views}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">00</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

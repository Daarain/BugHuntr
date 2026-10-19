"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";

interface BugStatistics {
  severities: Record<string, number>;
  commonErrors: Array<{ title: string; count: number }>;
  totalBugsReported: number;
}

const getSeverityColor = (severity: string) => {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] text-[var(--critical)] border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)]";
    case "high":
      return "bg-[color:color-mix(in_srgb,var(--high)_12%,transparent)] text-[var(--high)] border-[color:color-mix(in_srgb,var(--high)_25%,transparent)]";
    case "medium":
      return "bg-[color:color-mix(in_srgb,var(--medium)_12%,transparent)] text-[var(--medium)] border-[color:color-mix(in_srgb,var(--medium)_25%,transparent)]";
    case "low":
      return "bg-[var(--accent-soft)] text-primary border-[var(--border-light)]";
    default:
      return "bg-gray-500/10 text-gray-500 border-gray-500/20";
  }
};

export function BugStatistics() {
  const { user } = useAuth();
  const [statistics, setStatistics] = useState<BugStatistics>({
    severities: {},
    commonErrors: [],
    totalBugsReported: 0,
  });
  const [loading, setLoading] = useState(true);

  const normalizeOrg = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const orgKeys = (() => {
    const keys: string[] = [];
    if (user?.companyName) {
      keys.push(normalizeOrg(user.companyName));
    }
    if (user?.email) {
      const domain = user.email.split("@")[1] || "";
      if (domain) {
        keys.push(normalizeOrg(domain));
        const base = domain.split(".")[0];
        if (base) {
          keys.push(normalizeOrg(base));
        }
      }
    }
    return Array.from(new Set(keys.filter(Boolean)));
  })();

  const isOrgScoped =
    Boolean(user?.role === "admin" || user?.userType === "company") &&
    orgKeys.length > 0;

  const matchesOrg = (company: string) => {
    if (!isOrgScoped) return true;
    const normalized = normalizeOrg(company || "");
    if (!normalized) return false;
    return orgKeys.some(
      (key) => normalized === key || normalized.startsWith(`${key} `),
    );
  };

  useEffect(() => {
    const fetchStatistics = async () => {
      try {
        setLoading(true);

        // Fetch submissions via authenticated server endpoint
        const res = await fetch("/api/bug-submissions", { credentials: "include" });
        if (!res.ok) {
          throw new Error("Failed to fetch bug submissions");
        }
        const allSubmissions: any[] = await res.json();

        // Filter submissions by organization if applicable
        const filteredSubmissions = allSubmissions.filter((submission) => {
          const submissionCompany =
            submission.normalizedCompany ||
            submission.company ||
            "";
          return matchesOrg(submissionCompany);
        });

        // Calculate statistics
        const severitiesMap: Record<string, number> = {};
        const errorsMap: Record<string, number> = {};

        filteredSubmissions.forEach((submission) => {
          // Count severities
          if (submission.severity) {
            severitiesMap[submission.severity] =
              (severitiesMap[submission.severity] || 0) + 1;
          }

          // Count error titles (top common bugs)
          if (submission.title) {
            errorsMap[submission.title] =
              (errorsMap[submission.title] || 0) + 1;
          }
        });

        // Sort errors by count and get top 10
        const commonErrorsArray = Object.entries(errorsMap)
          .map(([title, count]) => ({ title, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        setStatistics({
          severities: severitiesMap,
          commonErrors: commonErrorsArray,
          totalBugsReported: filteredSubmissions.length,
        });
      } catch (error) {
        console.error("Failed to fetch bug statistics:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStatistics();
  }, [user?.companyName, user?.email, user?.role, user?.userType]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bug Statistics</CardTitle>
          <CardDescription>
            Most common errors and vulnerability trends
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--border-light)]" />
        </CardContent>
      </Card>
    );
  }

  const total = statistics.totalBugsReported;
  const maxErrorCount = Math.max(
    1,
    ...statistics.commonErrors.map((error) => error.count),
  );

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Bug Statistics
        </CardTitle>
        <CardDescription>
          Most common errors and vulnerability trends
          {isOrgScoped
            ? ` for ${user?.companyName || user?.email?.split("@")[1] || "your organization"}`
            : " across the platform"}
          (Total: {statistics.totalBugsReported} bugs reported)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="severities" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="severities">Severity</TabsTrigger>
            <TabsTrigger value="common-errors">Top Bugs</TabsTrigger>
          </TabsList>

          {/* Severity Tab */}
          <TabsContent value="severities" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {Object.entries(statistics.severities)
                .sort(([, a], [, b]) => b - a)
                .map(([severity, count]) => (
                  <div
                    key={severity}
                    className={`rounded-lg p-4 border ${getSeverityColor(severity)}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm md:text-base font-medium capitalize line-clamp-1">
                          {severity} Severity
                        </p>
                        <p className="text-xl md:text-2xl font-bold">{count}</p>
                      </div>
                      <AlertCircle className="w-8 h-8 opacity-20" />
                    </div>
                    <p className="text-xs opacity-70 mt-2">
                      {total > 0 ? ((count / total) * 100).toFixed(1) : "0.0"}%
                      of all bugs
                    </p>
                  </div>
                ))}
            </div>
          </TabsContent>

          {/* Most Common Bugs Tab */}
          <TabsContent value="common-errors" className="space-y-4">
            <div className="space-y-2">
              {statistics.commonErrors.map((error, index) => (
                <div
                  key={error.title}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-[var(--accent-soft)] border border-[var(--border-light)] flex items-center justify-center text-primary text-xs font-bold">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm line-clamp-1">
                        {error.title}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-2 bg-gray-200 rounded-full w-20 sm:w-24 md:w-32">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{
                          width: `${(error.count / maxErrorCount) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-bold w-8">{error.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

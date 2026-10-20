"use client"

import React, { useState, useMemo, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Shield,
  Search,
  Eye,
  FileText,
  Calendar,
  Award,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { FadeIn } from "@/components/animations/fade-in"
import { SubmissionStatusBadge } from "@/components/bug-submission/submission-status-badge"
import { useBugSubmission } from "@/hooks/use-bug-submission"
import { useAuth } from "@/components/auth/auth-context"
import type { BugSubmission } from "@/types/bug-submission"
import { formatCurrency } from "@/lib/pro-utils"

export default function MySubmissionsPage() {
  const { user } = useAuth();
  const { getSubmissionsByUser } = useBugSubmission();
  const [selectedSubmission, setSelectedSubmission] = useState<BugSubmission | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [userSubmissions, setUserSubmissions] = useState<BugSubmission[]>([]);
  const [isMounted, setIsMounted] = useState(false);

  // Defer rendering until mounted
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Fetch submissions from Firestore on mount and when user changes
  React.useEffect(() => {
    async function updateSubmissions() {
      if (user && user.id) {
        const subs = await getSubmissionsByUser(user.id);
        // Only show submissions that have a huntId (i.e., submitted through a hunt)
        setUserSubmissions(subs.filter((s) => s.huntId && s.huntId !== ""));
      }
    }
    updateSubmissions();
    // Optionally listen for changes if you want real-time updates
    // window.addEventListener("storage", updateSubmissions);
    // return () => {
    //   window.removeEventListener("storage", updateSubmissions);
    // };
  }, [user, getSubmissionsByUser]);

  const filteredSubmissions = useMemo(() => {
    return userSubmissions.filter((submission) => {
      const title = submission.title ?? "";
      const huntTitle = submission.huntTitle ?? "";
      const matchesSearch =
        title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        huntTitle.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "all" || submission.status === statusFilter;
      const matchesSeverity = severityFilter === "all" || submission.severity === severityFilter;

      return matchesSearch && matchesStatus && matchesSeverity;
    });
  }, [userSubmissions, searchTerm, statusFilter, severityFilter]);

  const stats = useMemo(() => {
    return {
      total: userSubmissions.length,
      pending: userSubmissions.filter((s) => s.status === "pending").length,
      underReview: userSubmissions.filter((s) => s.status === "under-review").length,
      approved: userSubmissions.filter((s) => s.status === "approved").length,
      rejected: userSubmissions.filter((s) => s.status === "rejected").length,
      totalPoints: userSubmissions.reduce((sum, s) => sum + (s.pointsAwarded || 0), 0),
    }
  }, [userSubmissions])

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] text-[var(--critical)] border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)]"
      case "high":
        return "bg-[color:color-mix(in_srgb,var(--high)_12%,transparent)] text-[var(--high)] border-[color:color-mix(in_srgb,var(--high)_25%,transparent)]"
      case "medium":
        return "bg-[color:color-mix(in_srgb,var(--medium)_12%,transparent)] text-[var(--medium)] border-[color:color-mix(in_srgb,var(--medium)_25%,transparent)]"
      case "low":
        return "bg-[var(--accent-soft)] text-primary border-[var(--border-light)]"
      default:
        return "bg-gray-500/10 text-gray-500 border-gray-500/20"
    }
  }

  // Don't render heavy content until mounted
  if (!isMounted) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 space-y-6">
        <FadeIn>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                <FileText className="h-8 w-8 text-primary" />
                My Submissions
              </h1>
              <p className="text-muted-foreground mt-1">Track your vulnerability reports and their review status</p>
            </div>
          </div>
        </FadeIn>

        {/* Stats Cards */}
        <FadeIn delay={0.1}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4 w-full">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="text-sm text-muted-foreground">Total</span>
                </div>
                <div className="text-2xl font-bold text-primary mt-1">{stats.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-[var(--medium)]" />
                  <span className="text-sm text-muted-foreground">Pending</span>
                </div>
                <div className="text-2xl font-bold text-[var(--medium)] mt-1">{stats.pending}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-primary" />
                  <span className="text-sm text-muted-foreground">Review</span>
                </div>
                <div className="text-2xl font-bold text-primary mt-1">{stats.underReview}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-[var(--low)]" />
                  <span className="text-sm text-muted-foreground">Approved</span>
                </div>
                <div className="text-2xl font-bold text-[var(--low)] mt-1">{stats.approved}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-[var(--critical)]" />
                  <span className="text-sm text-muted-foreground">Rejected</span>
                </div>
                <div className="text-2xl font-bold text-[var(--critical)] mt-1">{stats.rejected}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-secondary" />
                  <span className="text-sm text-muted-foreground">Rewards</span>
                </div>
                <div className="text-2xl font-bold text-secondary mt-1">
                  {formatCurrency(stats.totalPoints)}
                </div>
              </CardContent>
            </Card>
          </div>
        </FadeIn>

        {/* Filters */}
        <FadeIn delay={0.2}>
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-4 md:flex-row md:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search submissions..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 w-full md:w-auto md:flex-row">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full md:w-40">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="under-review">Under Review</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={severityFilter} onValueChange={setSeverityFilter}>
                    <SelectTrigger className="w-full md:w-40">
                      <SelectValue placeholder="Severity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Severity</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </FadeIn>

        {/* Submissions List */}
        <FadeIn delay={0.3}>
          <div className="space-y-4">
            <AnimatePresence>
              {filteredSubmissions.map((submission, index) => (
                <motion.div
                  key={submission.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="hover:shadow-lg transition-all duration-300 border-border/50 hover:border-[var(--border-light)]">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold text-lg truncate">{submission.title}</h3>
                            <Badge className={getSeverityColor(submission.severity)}>{submission.severity}</Badge>
                            <SubmissionStatusBadge status={submission.status} />
                          </div>

                          <p className="text-muted-foreground text-sm mb-3 line-clamp-2">{submission.description}</p>

                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              <span>{new Date(submission.submittedAt).toLocaleDateString()}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Shield className="h-3 w-3" />
                              <span>{submission.huntTitle}</span>
                            </div>
                            {submission.pointsAwarded && (
                              <div className="flex items-center gap-1">
                                <Award className="h-3 w-3" />
                                <span className="text-secondary font-medium">
                                  {formatCurrency(submission.pointsAwarded)}
                                </span>
                              </div>
                            )}
                          </div>

                          {(submission.reviewedBy || submission.reviewedAt || submission.adminNotes || submission.pointsAwarded) && (
                            <Alert className="mt-3">
                              <AlertTriangle className="h-4 w-4" />
                              <AlertDescription>
                                <strong>Admin Review:</strong><br />
                                {submission.reviewedBy && (<span><strong>Reviewed by:</strong> {submission.reviewedBy}<br /></span>)}
                                {submission.reviewedAt && (<span><strong>Date:</strong> {new Date(submission.reviewedAt).toLocaleString()}<br /></span>)}
                                <strong>Status:</strong> {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}<br />
                                {submission.adminNotes && (<span><strong>Feedback:</strong> {submission.adminNotes}<br /></span>)}
                                {submission.pointsAwarded && (
                                  <span>
                                    <strong>Reward Amount:</strong> {formatCurrency(submission.pointsAwarded)}
                                  </span>
                                )}
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>

                        <div className="flex flex-col gap-2">
                          <Button variant="outline" size="sm" onClick={() => setSelectedSubmission(submission)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>

            {filteredSubmissions.length === 0 && (
              <Card>
                <CardContent className="p-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No submissions found</h3>
                  <p className="text-muted-foreground">
                    {userSubmissions.length === 0
                      ? "You haven't submitted any vulnerability reports yet."
                      : "Try adjusting your filters to see more results."}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </FadeIn>
      </div>

      {/* Submission Details Modal */}
      <Dialog open={!!selectedSubmission} onOpenChange={() => setSelectedSubmission(null)}>
  <DialogContent className="max-w-full md:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Submission Details: {selectedSubmission?.title}
            </DialogTitle>
          </DialogHeader>

          {selectedSubmission && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-2">Submission Information</h4>
                  <div className="space-y-2 text-sm">
                    <div>
                      <strong>Bug Hunt:</strong> {selectedSubmission.huntTitle}
                    </div>
                    <div>
                      <strong>Submitted:</strong> {new Date(selectedSubmission.submittedAt).toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2">
                      <strong>Severity:</strong>
                      <Badge className={getSeverityColor(selectedSubmission.severity)}>
                        {selectedSubmission.severity}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <strong>Status:</strong>
                      <SubmissionStatusBadge status={selectedSubmission.status} />
                    </div>
                    {selectedSubmission.reviewedAt && (
                      <div>
                        <strong>Reviewed:</strong> {new Date(selectedSubmission.reviewedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Attachments</h4>
                  <div className="space-y-1">
                    {(selectedSubmission.attachments ?? []).length > 0 ? (
                      selectedSubmission.attachments.map((file, index) => (
                        <div key={index} className="text-sm bg-muted p-2 rounded">
                          {file}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">No attachments</div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">Description</h4>
                <p className="text-sm bg-muted p-3 rounded">{selectedSubmission.description}</p>
              </div>

              <div>
                <h4 className="font-medium mb-2">Steps to Reproduce</h4>
                <pre className="text-sm bg-muted p-3 rounded whitespace-pre-wrap">
                  {selectedSubmission.stepsToReproduce}
                </pre>
              </div>

              <div>
                <h4 className="font-medium mb-2">Impact Assessment</h4>
                <p className="text-sm bg-muted p-3 rounded">{selectedSubmission.impact}</p>
              </div>

              {selectedSubmission.proofOfConcept && (
                <div>
                  <h4 className="font-medium mb-2">Proof of Concept</h4>
                  <p className="text-sm bg-muted p-3 rounded">{selectedSubmission.proofOfConcept}</p>
                </div>
              )}

              {(selectedSubmission.reviewedBy || selectedSubmission.reviewedAt || selectedSubmission.adminNotes || selectedSubmission.pointsAwarded) && (
                <div className="border-t pt-6">
                  <h4 className="font-medium mb-2">Admin Review</h4>
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      {selectedSubmission.reviewedBy && (<span><strong>Reviewed by:</strong> {selectedSubmission.reviewedBy}<br /></span>)}
                      {selectedSubmission.reviewedAt && (<span><strong>Date:</strong> {new Date(selectedSubmission.reviewedAt).toLocaleString()}<br /></span>)}
                      <strong>Status:</strong> {selectedSubmission.status.charAt(0).toUpperCase() + selectedSubmission.status.slice(1)}<br />
                      {selectedSubmission.adminNotes && (<span><strong>Feedback:</strong> {selectedSubmission.adminNotes}<br /></span>)}
                      {selectedSubmission.pointsAwarded && (
                        <span>
                          <strong>Reward Amount:</strong> {formatCurrency(selectedSubmission.pointsAwarded)}
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

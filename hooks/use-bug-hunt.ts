"use client"

import { useState, useEffect, useRef } from "react"
import { type BugHunt, type BugHuntSubmission, BUG_HUNT_TEMPLATES } from "@/types/bug-hunt"

export function useBugHunt() {
  const [bugHunts, setBugHunts] = useState<BugHunt[]>([])
  const [submissions, setSubmissions] = useState<BugHuntSubmission[]>([])

  // Use a ref to always access the latest bugHunts state in event handlers
  const bugHuntsRef = useRef<BugHunt[]>(bugHunts)
  useEffect(() => {
    bugHuntsRef.current = bugHunts
  }, [bugHunts])

  useEffect(() => {
    if (typeof window !== "undefined") {
      const incrementHandler = async (event: Event) => {
        const customEvent = event as CustomEvent
        const { huntId } = customEvent.detail
        const current = bugHuntsRef.current.find(h => h.id === huntId)?.currentParticipants || 0
        const newCount = current + 1
        setBugHunts(prev => prev.map(hunt =>
          hunt.id === huntId ? { ...hunt, currentParticipants: newCount } : hunt
        ))
        try {
          await fetch(`/api/bug-hunts/${huntId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ currentParticipants: newCount }),
          })
        } catch (e) {
          console.error("Failed to increment participants:", e)
        }
      }

      const decrementHandler = async (event: Event) => {
        const customEvent = event as CustomEvent
        const { huntId } = customEvent.detail
        const current = bugHuntsRef.current.find(h => h.id === huntId)?.currentParticipants || 0
        const newCount = Math.max(current - 1, 0)
        setBugHunts(prev => prev.map(hunt =>
          hunt.id === huntId ? { ...hunt, currentParticipants: newCount } : hunt
        ))
        try {
          await fetch(`/api/bug-hunts/${huntId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ currentParticipants: newCount }),
          })
        } catch (e) {
          console.error("Failed to decrement participants:", e)
        }
      }

      window.addEventListener("incrementParticipants", incrementHandler)
      window.addEventListener("decrementParticipants", decrementHandler)
      return () => {
        window.removeEventListener("incrementParticipants", incrementHandler)
        window.removeEventListener("decrementParticipants", decrementHandler)
      }
    }
  }, [])

  useEffect(() => {
    // Fetch bug hunts from server API (backed by MongoDB)
    const fetchBugHunts = async () => {
      try {
        const res = await fetch("/api/bug-hunts", { credentials: "include" })
        if (res.ok) {
          const hunts: BugHunt[] = await res.json()
          setBugHunts(hunts)
        }
      } catch (err) {
        console.error("Failed to load bug hunts:", err)
      }
    }

    // Fetch submissions from server API (backed by MongoDB)
    const fetchSubmissions = async () => {
      try {
        const res = await fetch("/api/bug-submissions", { credentials: "include" })
        if (res.ok) {
          const subs: BugHuntSubmission[] = await res.json()
          setSubmissions(subs)
        }
      } catch (err) {
        console.error("Failed to load bug submissions:", err)
      }
    }

    fetchBugHunts()
    fetchSubmissions()
  }, [])

  const createBugHunt = async (
    huntData: Omit<BugHunt, "id" | "createdAt" | "updatedAt" | "currentParticipants" | "submissions">
  ) => {
    try {
      const res = await fetch("/api/bug-hunts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(huntData),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to create bug hunt")
      }
      const created: BugHunt = await res.json()
      setBugHunts(prev => [...prev, created])
      return created
    } catch (error) {
      console.error("Error creating bug hunt:", error)
      throw error
    }
  }

  const removeBugHunt = async (huntId: string) => {
    try {
      const res = await fetch(`/api/bug-hunts/${huntId}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to remove bug hunt")
      }
      setBugHunts(prev => prev.filter(hunt => hunt.id !== huntId))
      setSubmissions(prev => prev.filter(sub => sub.huntId !== huntId))
    } catch (error) {
      console.error("Error removing bug hunt:", error)
      throw error
    }
  }

  const updateBugHunt = async (huntId: string, updates: Partial<BugHunt>) => {
    try {
      const res = await fetch(`/api/bug-hunts/${huntId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        const updated: BugHunt = await res.json()
        setBugHunts(prev => prev.map(hunt => hunt.id === huntId ? { ...hunt, ...updated } : hunt))
      }
    } catch (error) {
      console.error("Error updating bug hunt:", error)
    }
  }

  const submitToBugHunt = async (submission: Omit<BugHuntSubmission, "id" | "submittedAt" | "status">) => {
    try {
      const res = await fetch("/api/bug-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(submission),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to submit to bug hunt")
      }
      const created: BugHuntSubmission = await res.json()
      setSubmissions(prev => [...prev, created])

      // Update hunt's current participants count
      const hunt = bugHunts.find(h => h.id === submission.huntId)
      if (hunt) {
        const userAlreadyParticipating = submissions.some(
          s => s.huntId === submission.huntId && s.userId === submission.userId
        )
        if (!userAlreadyParticipating) {
          await updateBugHunt(submission.huntId, {
            currentParticipants: (hunt.currentParticipants || 0) + 1,
          })
        }
      }

      return created
    } catch (error) {
      console.error("Error submitting to bug hunt:", error)
      throw error
    }
  }

  const reviewSubmission = async (
    submissionId: string,
    status: "approved" | "rejected" | "duplicate",
    reviewNotes: string,
    pointsAwarded?: number,
    reviewedBy?: string,
  ) => {
    if (status === "approved" && pointsAwarded && pointsAwarded > 0 && reviewedBy) {
      const sub = submissions.find(s => s.id === submissionId)
      if (sub && sub.username && sub.userId) {
        const res = await fetch("/api/bug-hunt/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            adminUsername: reviewedBy,
            hunterUsername: sub.username,
            hunterUid: sub.userId,
            huntId: sub.huntId,
            submissionId: sub.id,
            amount: pointsAwarded,
            status,
            reviewNotes,
          }),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          console.warn("Server reward transfer warning:", errData?.error)
        }
      }
    }

    try {
      const res = await fetch(`/api/bug-submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          status,
          reviewNotes,
          pointsAwarded,
        }),
      })
      if (res.ok) {
        const updated = await res.json()
        setSubmissions(prev => prev.map(s => s.id === submissionId ? { ...s, ...updated } : s))
      }
    } catch (err) {
      console.error("Failed to update submission status:", err)
    }
  }

  const getActiveBugHunts = () => {
    return bugHunts.filter(hunt => hunt.status === "active")
  }

  const getBugHuntById = (huntId: string) => {
    return bugHunts.find(hunt => hunt.id === huntId)
  }

  const getSubmissionsByHunt = (huntId: string) => {
    return submissions.filter(submission => submission.huntId === huntId)
  }

  const getSubmissionsByUser = (userId: string) => {
    return submissions.filter(submission => submission.userId === userId)
  }

  const getUserBugHunts = (userId: string) => {
    return bugHunts.filter(hunt => hunt.createdBy === userId)
  }

  return {
    bugHunts,
    submissions,
    createBugHunt,
    updateBugHunt,
    removeBugHunt,
    submitToBugHunt,
    reviewSubmission,
    getActiveBugHunts,
    getBugHuntById,
    getSubmissionsByHunt,
    getSubmissionsByUser,
    getUserBugHunts,
    BUG_HUNT_TEMPLATES,
  }
}

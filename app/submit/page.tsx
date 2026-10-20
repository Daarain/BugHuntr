"use client"

import type React from "react"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/components/auth/auth-context"
import { useRanking } from "@/hooks/use-ranking"
import { SEVERITY_POINTS } from "@/types/ranking"
import { useRouter } from "next/navigation"
import { Bug, Trophy, AlertTriangle, Star, Upload } from "lucide-react"
import { FadeIn } from "@/components/animations/fade-in"

const SCREENSHOT_ANALYZER_URL =
  process.env.NEXT_PUBLIC_SCREENSHOT_ANALYZER_URL || "http://localhost:8001"

// Alternative: Use a simple base64 upload for testing
const convertToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = (error) => reject(error)
  })
}

interface BugSubmission {
  title: string
  company: string
  category: string
  severity: "critical" | "high" | "medium" | "low" | ""
  summary: string
  description: string
  pocFile: File | null
}

interface FakeReportResult {
  status: "Likely Genuine" | "Suspicious" | "Likely Fake"
  score: number
  reasons: string[]
}

export default function SubmitBugPage() {
  const { user } = useAuth()
  const { addPoints } = useRanking()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [detectingSeverity, setDetectingSeverity] = useState(false)
  const [uploadingProof, setUploadingProof] = useState(false)
  const [analyzingProof, setAnalyzingProof] = useState(false)
  const [uploadedUrl, setUploadedUrl] = useState<string>("")
  const [fakeReport, setFakeReport] = useState<FakeReportResult | null>(null)

  const [formData, setFormData] = useState<BugSubmission>({
    title: "",
    company: "",
    category: "",
    severity: "",
    summary: "",
    description: "",
    pocFile: null,
  })

  const handleInputChange = (field: keyof BugSubmission, value: string | File | null) => {
    setFormData((prev) => ({ ...prev, [field]: value as any }))
  }

  const normalizeText = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

  const canAnalyzeProof = (proofUrl?: string) => {
    if (!SCREENSHOT_ANALYZER_URL) return false
    if (proofUrl && proofUrl.startsWith("data:")) return false
    if (
      SCREENSHOT_ANALYZER_URL.includes("localhost") &&
      typeof window !== "undefined" &&
      window.location.hostname !== "localhost"
    ) {
      return false
    }
    return true
  }

  const hashText = async (value: string) => {
    const data = new TextEncoder().encode(value)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  const hashFile = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  const isDuplicateApprovedBug = async () => {
    const normalizedTitle = normalizeText(formData.title)
    const normalizedCompany = normalizeText(formData.company)

    if (!normalizedTitle || !normalizedCompany) {
      return false
    }

    try {
      const params = new URLSearchParams({
        checkTitle: formData.title.trim(),
        company: formData.company.trim(),
      })
      const res = await fetch(`/api/bug-submissions?${params.toString()}`, {
        credentials: "include",
      })
      if (res.ok) {
        const data = await res.json()
        return Boolean(data.duplicate)
      }
      return false
    } catch {
      return false
    }
  }

  // Call backend for severity detection
  const detectSeverity = async () => {
    if (!formData.title || !formData.description) {
      alert("Please fill in Title and Technical Description before detecting severity.")
      return
    }
    try {
      setDetectingSeverity(true)
      setFakeReport(null)
      const screenshotUrl = formData.pocFile?.type.startsWith("image/") ? uploadedUrl : null
      const response = await fetch("https://bughuntr.onrender.com/api/analyzeSeverity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          screenshot_url: screenshotUrl,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`)
      }

      const data = await response.json()
      if (data.severity) {
        setFormData((prev) => ({ ...prev, severity: data.severity.toLowerCase() as BugSubmission["severity"] }))
        if (data.fake_report) {
          setFakeReport(data.fake_report as FakeReportResult)
        }
      } else {
        alert("Failed to detect severity. Please try again.")
      }

      if (formData.pocFile || uploadedUrl) {
        await analyzeProof(uploadedUrl)
      }
    } catch (err) {
      console.error("Error detecting severity:", err)
      alert("Error connecting to severity detection service.")
    } finally {
      setDetectingSeverity(false)
    }
  }

  // ☁ Upload Proof of Concept to Cloudinary (with base64 fallback)
  const handleFileUpload = async () => {
    if (!formData.pocFile) {
      alert("Please select an image or video first!")
      return
    }

    console.log("Starting file upload...")
    console.log("File:", formData.pocFile)
    setUploadingProof(true)

    try {
      const analysisOk = await analyzeProof()
      if (!analysisOk) {
        console.warn("Proof analysis failed; continuing with upload.")
      }

      // Route upload through protected server endpoint
      const formDataUpload = new FormData()
      formDataUpload.append("file", formData.pocFile)
      formDataUpload.append("folder", "submissions")

      const response = await fetch("/api/cloudinary/upload", {
        method: "POST",
        credentials: "include",
        body: formDataUpload,
      })

      const data = await response.json().catch(() => null)
      
      if (response.ok && data?.url) {
        setUploadedUrl(data.url)
        alert("✅ Proof uploaded successfully!")
      } else {
        throw new Error(data?.error || "Cloudinary upload failed")
      }
    } catch (err) {
      console.error("Cloudinary upload failed, trying base64 fallback:", err)
      
      try {
        // Fallback to base64 for testing
        const base64 = await convertToBase64(formData.pocFile)
        setUploadedUrl(base64)
        console.log("Base64 upload successful!")
        alert("✅ Proof uploaded successfully! (Using base64 fallback)")
      } catch (base64Error) {
        console.error("Base64 conversion failed:", base64Error)
        alert("❌ Upload failed. Please try again.")
      }
    } finally {
      setUploadingProof(false)
    }
  }

  const analyzeProof = async (proofUrl?: string) => {
    if (!formData.description) {
      alert("Please add a Technical Description before analyzing the proof.")
      return false
    }

    if (!canAnalyzeProof(proofUrl)) {
      console.warn("Proof analysis skipped: analyzer unavailable or invalid proof URL.")
      return true
    }

    const isImage = Boolean(formData.pocFile?.type.startsWith("image/"))
    const isPdf = formData.pocFile?.type === "application/pdf"
    if (!isImage && !isPdf) {
      alert("Proof analysis currently supports images or PDF screenshots only.")
      return
    }

    try {
      setAnalyzingProof(true)
      setFakeReport(null)

      let response: Response
      if (formData.pocFile) {
        const payload = new FormData()
        payload.append("bugDescription", formData.description)
        payload.append("bugId", "")
        payload.append("screenshot", formData.pocFile)

        response = await fetch(`${SCREENSHOT_ANALYZER_URL}/api/analyze-bug-screenshot`, {
          method: "POST",
          body: payload,
        })
      } else if (proofUrl) {
        response = await fetch(`${SCREENSHOT_ANALYZER_URL}/api/analyze-bug-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bugDescription: formData.description,
            bugId: "",
            screenshotUrl: proofUrl,
          }),
        })
      } else {
        alert("Please upload a proof file first.")
        return
      }

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`)
      }

      const data = await response.json()
      if (data.fake_report) {
        setFakeReport(data.fake_report as FakeReportResult)
      }
      return true
    } catch (err) {
      console.error("Error analyzing proof:", err)
      alert("Error connecting to proof analysis service.")
      return false
    } finally {
      setAnalyzingProof(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setIsSubmitting(true)

    try {
      const duplicateFound = await isDuplicateApprovedBug()
      if (duplicateFound) {
        alert("This bug appears to already be reported and approved. Please submit a different issue.")
        return
      }

      const bugPayload = {
        title: formData.title.trim(),
        company: formData.company.trim(),
        category: formData.category || "General",
        severity: formData.severity,
        description: formData.description.trim(),
        summary: formData.summary,
        proofOfConceptUrl: uploadedUrl || "",
        stepsToReproduce: formData.description.trim(),
      }

      console.log("Submitting bug data to API:", bugPayload)

      const response = await fetch("/api/bug-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(bugPayload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        if (response.status === 409) {
          alert(errorData?.error || "This bug appears to already be reported and is pending or approved.")
          return
        }
        throw new Error(errorData?.error || "Failed to submit bug report")
      }

      const createdBug = await response.json()
      console.log("Bug submitted successfully:", createdBug)

      // Add points based on severity
      if (formData.severity) {
        const severity = formData.severity as "critical" | "high" | "medium" | "low"
        const points = SEVERITY_POINTS[severity]

        console.log(`Submitting bug with severity: ${severity}, points: ${points}, user: ${user.username}`)

        // Update local ranking state
        addPoints(user.id, Date.now(), severity, `Bug report: ${formData.title} (${severity} severity)`)

        alert(`Bug submitted successfully! Your submission is now under review. Points will be awarded upon verification.`)
      } else {
        alert("Bug submitted successfully! Your submission is now under review.")
      }

      router.push("/my-submissions")
    } catch (error) {
      console.error("Error submitting bug:", error)
      alert("Error submitting bug report. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-severity-critical/10 text-severity-critical border-severity-critical/20"
      case "high":
        return "bg-severity-high/10 text-severity-high border-severity-high/20"
      case "medium":
        return "bg-severity-medium/10 text-severity-medium border-severity-medium/20"
      case "low":
        return "bg-severity-low/10 text-severity-low border-severity-low/20"
      default:
        return "bg-muted text-muted-foreground border-border"
    }
  }

  const getPointsMultiplier = (severity: string) => {
    const multipliers = { critical: 4, high: 3, medium: 2, low: 1 }
    return multipliers[severity as keyof typeof multipliers] || 1
  }

  const normalizeFakeStatus = (report: FakeReportResult) => {
    if (Number.isFinite(report.score)) {
      if (report.score <= 40) return "Likely Genuine"
      if (report.score <= 65) return "Suspicious"
      return "Likely Fake"
    }
    return report.status
  }

  const getFakeStatusColor = (status: FakeReportResult["status"]) => {
    switch (status) {
      case "Likely Fake":
        return "bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] text-[var(--critical)] border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)]"
      case "Suspicious":
        return "bg-[color:color-mix(in_srgb,var(--medium)_12%,transparent)] text-[var(--medium)] border-[color:color-mix(in_srgb,var(--medium)_25%,transparent)]"
      default:
        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
    }
  }

  const normalizedFakeReport = fakeReport
    ? { ...fakeReport, status: normalizeFakeStatus(fakeReport) }
    : null

  const isSubmitDisabled = isSubmitting
  const inputFieldClassName =
    "h-11 !bg-[#0A1628] !border-[#2D4A6C] !text-slate-100 !placeholder:text-slate-400 caret-cyan-300 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.08)] focus-visible:!border-cyan-300 focus-visible:!ring-2 focus-visible:!ring-cyan-400/30"
  const textareaFieldClassName =
    "!bg-[#0A1628] !border-[#2D4A6C] !text-slate-100 !placeholder:text-slate-400 caret-cyan-300 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.08)] focus-visible:!border-cyan-300 focus-visible:!ring-2 focus-visible:!ring-cyan-400/30"
  const labelClassName = "text-slate-100"

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 max-w-6xl">
        <FadeIn>
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Submit Vulnerability Report</h1>
            <p className="text-muted-foreground">
              Report a security vulnerability and earn points based on severity level. All submissions are reviewed
              privately by our security team.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <FadeIn delay={0.2}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bug className="w-5 h-5 text-primary" />
                    Vulnerability Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="title" className={labelClassName}>Vulnerability Title *</Label>
                        <Input
                          id="title"
                          placeholder="e.g., SQL Injection in Login Form"
                          value={formData.title}
                          onChange={(e) => handleInputChange("title", e.target.value)}
                          className={inputFieldClassName}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="company" className={labelClassName}>Target Organization *</Label>
                        <Input
                          id="company"
                          placeholder="e.g., TechCorp"
                          value={formData.company}
                          onChange={(e) => handleInputChange("company", e.target.value)}
                          className={inputFieldClassName}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="summary" className={labelClassName}>Executive Summary *</Label>
                      <Textarea
                        id="summary"
                        placeholder="Brief overview of the vulnerability and its potential impact..."
                        value={formData.summary}
                        onChange={(e) => handleInputChange("summary", e.target.value)}
                        rows={3}
                        className={textareaFieldClassName}
                        required
                      />
                      {formData.severity && (
                        <div className="flex items-center gap-3 mt-2">
                          <Badge className={getSeverityColor(formData.severity)}>
                            {formData.severity.charAt(0).toUpperCase() + formData.severity.slice(1)}
                          </Badge>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description" className={labelClassName}>Technical Description *</Label>
                      <Textarea
                        id="description"
                        placeholder="Detailed technical analysis..."
                        value={formData.description}
                        onChange={(e) => handleInputChange("description", e.target.value)}
                        rows={6}
                        className={textareaFieldClassName}
                        required
                      />
                    </div>

                    {/* ☁ Proof of Concept Upload */}
                    <div className="space-y-2 pt-4">
                      <Label className={labelClassName}>Proof of Concept (Image/Video) <span className="text-muted-foreground">(Optional)</span></Label>
                      <Input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleInputChange("pocFile", e.target.files?.[0] || null)}
                        className="h-11 !bg-[#0A1628] !border-[#2D4A6C] !text-slate-200 !placeholder:text-slate-400 file:text-slate-200 focus-visible:!border-cyan-300 focus-visible:!ring-2 focus-visible:!ring-cyan-400/30"
                      />

                      <Button
                        type="button"
                        variant="outline"
                        className="mt-2 flex items-center gap-2"
                        onClick={handleFileUpload}
                        disabled={uploadingProof || !formData.pocFile}
                      >
                        <Upload className="w-4 h-4" />
                        {uploadingProof
                          ? "Uploading..."
                          : analyzingProof
                          ? "Analyzing..."
                          : "Upload Proof"}
                      </Button>

                      {uploadedUrl && (
                        <div className="mt-4">
                          <p className="text-sm text-muted-foreground mb-2">Uploaded Proof:</p>
                          {formData.pocFile?.type.startsWith("image/") ? (
                            <img src={uploadedUrl} alt="Proof" className="w-48 rounded-md shadow-md" />
                          ) : formData.pocFile?.type === "application/pdf" ? (
                            <a
                              className="text-primary underline text-sm"
                              href={uploadedUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View uploaded PDF
                            </a>
                          ) : (
                            <video src={uploadedUrl} controls className="w-48 rounded-md shadow-md" />
                          )}
                        </div>
                      )}
                    </div>

                    {!formData.severity ? (
                      <Button
                        type="button"
                        variant="default"
                        className="w-full bg-primary hover:bg-primary/90"
                        disabled={detectingSeverity}
                        onClick={detectSeverity}
                      >
                        {detectingSeverity ? "Detecting..." : "Detect Severity"}
                      </Button>
                    ) : (
                      <Button type="submit" className="w-full" disabled={isSubmitDisabled}>
                        {isSubmitting ? "Submitting Report..." : "Submit Vulnerability Report"}
                      </Button>
                    )}
                    {normalizedFakeReport && (
                      <div className="space-y-2 rounded-md border p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Authenticity (Advisory)</span>
                          <Badge className={getFakeStatusColor(normalizedFakeReport.status)}>{normalizedFakeReport.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          AI authenticity is a helper signal and does not block submission.
                        </p>
                      </div>
                    )}
                  </form>
                </CardContent>
              </Card>
            </FadeIn>
          </div>

          <div className="space-y-6">
            <FadeIn delay={0.3}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-primary" />
                    Points Reward
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Report Authenticity</span>
                    {normalizedFakeReport ? (
                      <Badge className={getFakeStatusColor(normalizedFakeReport.status)}>{normalizedFakeReport.status}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </div>
                  {normalizedFakeReport && (
                    <div className="text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>Fake Score</span>
                        <span className="font-medium text-foreground">{normalizedFakeReport.score}</span>
                      </div>
                      {normalizedFakeReport.reasons.length > 0 && (
                        <ul className="mt-2 list-disc pl-4 space-y-1">
                          {normalizedFakeReport.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Risk Level</span>
                    <Badge className={getSeverityColor(formData.severity)}>{formData.severity}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Base Points</span>
                    <span className="font-bold text-primary">
                      {formData.severity ? SEVERITY_POINTS[formData.severity] : "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Multiplier</span>
                    <span className="font-bold text-[var(--low)]">{getPointsMultiplier(formData.severity)}x</span>
                  </div>
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Total Potential</span>
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 text-[var(--high)]" />
                        <span className="font-bold text-lg text-[var(--high)]">
                          {formData.severity
                            ? SEVERITY_POINTS[formData.severity] * getPointsMultiplier(formData.severity)
                            : "-"}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Final points awarded after review</p>
                  </div>
                </CardContent>
              </Card>
            </FadeIn>
          </div>
        </div>
      </div>
    </div>
  )
}

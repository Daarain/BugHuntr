"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DollarSign } from "lucide-react"
import { useRouter } from "next/navigation"

interface RelatedBugsSidebarProps {
  bugs: Array<{
    id: number
    title: string
    severity: "critical" | "high" | "medium" | "low"
    company: string
    bounty: number
  }>
}

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case "critical":
      return "text-severity-critical bg-severity-critical/10 border-severity-critical"
    case "high":
      return "text-severity-high bg-severity-high/10 border-severity-high"
    case "medium":
      return "text-severity-medium bg-severity-medium/10 border-severity-medium"
    case "low":
      return "text-severity-low bg-severity-low/10 border-severity-low"
    default:
      return "text-muted-foreground bg-muted border-border"
  }
}

export function RelatedBugsSidebar({ bugs }: RelatedBugsSidebarProps) {
  const router = useRouter()

  return (
    <Card className="sticky top-24">
      <CardHeader>
        <CardTitle className="text-lg">Related Vulnerabilities</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {bugs.map((bug) => (
          <div
            key={bug.id}
            onClick={() => router.push(`/bug/${bug.id}`)}
            className="p-3 border border-border rounded-lg hover:bg-accent cursor-pointer transition-colors group"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge className={getSeverityColor(bug.severity)}>
                  {bug.severity.toUpperCase()}
                </Badge>
                <Badge variant="outline">
                  {bug.company}
                </Badge>
              </div>
              <h4 className="text-sm font-medium leading-tight group-hover:text-primary transition-colors">
                {bug.title}
              </h4>
              <div className="flex items-center gap-1 text-xs text-[var(--low)]">
                <DollarSign className="h-3 w-3" />
                <span className="font-semibold">${bug.bounty.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

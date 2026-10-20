"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Trophy, Bug, Target, Star } from "lucide-react"

interface UserStatsProps {
  username?: string
}

interface UserStats {
  points: number
  bugsSubmitted: number
  acceptedBugs: number
  rank: string
}

export function UserStatsCards({ username }: UserStatsProps) {
  const [stats, setStats] = useState<UserStats>({
    points: 0,
    bugsSubmitted: 0,
    acceptedBugs: 0,
    rank: "E"
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!username) {
      setStats({
        points: 0,
        bugsSubmitted: 0,
        acceptedBugs: 0,
        rank: "E",
      })
      setLoading(false)
      return
    }

    setLoading(true)

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/user/stats?username=${encodeURIComponent(username)}`, {
          credentials: "include",
        })
        if (res.ok) {
          const data = await res.json()
          setStats({
            points: data.points ?? 0,
            bugsSubmitted: data.bugsSubmitted ?? 0,
            acceptedBugs: data.acceptedBugs ?? 0,
            rank: data.rank || "E",
          })
        }
      } catch (error) {
        console.error("Error fetching user stats:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()

    // Safe periodic polling instead of client-side Firestore listeners
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [username])

  const getRankColor = (rank: string) => {
    switch (rank) {
      case "S": return "text-[var(--critical)]"
      case "A": return "text-[var(--high)]"
      case "B": return "text-secondary"
      case "C": return "text-primary"
      case "D": return "text-[var(--low)]"
      default: return "text-gray-500"
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle>Loading...</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 animate-pulse rounded"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm md:text-base font-medium">Total Points</CardTitle>
          <Trophy className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-xl md:text-2xl font-bold text-primary">{stats.points}</div>
          <p className="text-xs text-muted-foreground">
            Rank: <span className={getRankColor(stats.rank)}>{stats.rank}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm md:text-base font-medium">Bugs Submitted</CardTitle>
          <Bug className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-xl md:text-2xl font-bold">{stats.bugsSubmitted}</div>
          <p className="text-xs text-muted-foreground">
            Total reports submitted
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm md:text-base font-medium">Accepted Bugs</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-xl md:text-2xl font-bold text-[var(--low)]">{stats.acceptedBugs}</div>
          <p className="text-xs text-muted-foreground">
            Success rate: {stats.bugsSubmitted > 0 ? Math.round((stats.acceptedBugs / stats.bugsSubmitted) * 100) : 0}%
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm md:text-base font-medium">Current Rank</CardTitle>
          <Star className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-xl md:text-2xl font-bold ${getRankColor(stats.rank)}`}>{stats.rank}</div>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {stats.rank === "S" ? "Legendary!" : `Next: ${getNextRankPoints(stats.points)} pts`}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function getNextRankPoints(currentPoints: number): number {
  if (currentPoints < 500) return 500 - currentPoints
  if (currentPoints < 1500) return 1500 - currentPoints
  if (currentPoints < 4000) return 4000 - currentPoints
  if (currentPoints < 8000) return 8000 - currentPoints
  if (currentPoints < 15000) return 15000 - currentPoints
  return 0
}
"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { MapPin, Calendar, Globe, Star, Trophy, DollarSign, FileText } from "lucide-react"
import { motion } from "framer-motion"
import { FadeIn } from "@/components/animations/fade-in"
import { SlideIn } from "@/components/animations/slide-in"
import { RankBadge } from "@/components/ranking/rank-badge"
import { VerificationBadge } from "@/components/ui/verification-badge"
import { useAuth } from "@/components/auth/auth-context"
import type { UserRanking } from "@/types/ranking"
import { useEffect, useState } from "react"

interface ProfileHeaderProps {
  user: {
    username: string
    displayName: string
    bio: string
    avatar: string
    joinDate: string
    location: string
    website: string
    rank: number
    totalEarnings: number
    totalReports: number
    reputation: number
    role?: "user" | "admin"
    companyName?: string
  }
  userRanking?: UserRanking | null
}

export function ProfileHeader({ user, userRanking }: ProfileHeaderProps) {
  const [profilePoints, setProfilePoints] = useState<number | null>(null);
  const [pointsLoading, setPointsLoading] = useState(true);
  const [pointsError, setPointsError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPoints() {
      setPointsLoading(true);
      setPointsError(null);
      try {
        if (user?.username) {
          const res = await fetch(`/api/user/profile?username=${encodeURIComponent(user.username)}`, {
            credentials: "include",
          });
          if (res.ok) {
            const profile = await res.json();
            setProfilePoints((profile as any)?.points ?? null);
          } else {
            setProfilePoints(null);
          }
        } else {
          setProfilePoints(null);
        }
      } catch (err) {
        setPointsError("Failed to load points");
        setProfilePoints(null);
      } finally {
        setPointsLoading(false);
      }
    }
    fetchPoints();
  }, [user?.username]);

  let pointsToShow = 0;
  if (pointsLoading) {
    pointsToShow = 0;
  } else if (profilePoints !== null) {
    pointsToShow = profilePoints;
  } else {
    pointsToShow = userRanking?.totalPoints ?? user.totalReports;
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-8">
        <div className="flex flex-col md:flex-row gap-6">
          <SlideIn direction="left">
            <div className="flex flex-col items-center md:items-start">
              <motion.div whileHover={{ scale: 1.05 }} transition={{ duration: 0.2 }}>
                <Avatar className="h-24 w-24 sm:h-32 sm:w-32 mb-4 ring-4 ring-cyber-blue/20">
                  <AvatarImage src={user.avatar || "/placeholder.svg"} />
                  <AvatarFallback className="text-lg sm:text-2xl bg-[var(--accent-soft)] text-primary">
                    {user.displayName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
              </motion.div>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button variant="outline" className="w-full md:w-auto bg-transparent">
                  Edit Profile
                </Button>
              </motion.div>
            </div>
          </SlideIn>

          <div className="flex-1 space-y-4 min-w-0">
            <FadeIn delay={0.2}>
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                  <h1 className="text-2xl sm:text-3xl font-bold truncate">{user.displayName}</h1>
                  <div className="flex items-center gap-2">
                    {userRanking ? (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.4, type: "spring" }}
                      >
                        <RankBadge rank={userRanking.rank} size="md" showDescription />
                      </motion.div>
                    ) : (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.4, type: "spring" }}
                      >
                        <Badge className="bg-[var(--accent-soft)] text-primary border-[var(--border-light)] shrink-0">
                          Rank #{user.rank}
                        </Badge>
                      </motion.div>
                    )}
                  </div>
                </div>
                <p className="text-base sm:text-lg text-muted-foreground truncate flex items-center gap-2">
                  @{user.username}
                  <VerificationBadge isAdmin={user.role === "admin"} companyName={user.companyName} size="sm" />
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.3}>
              <p className="text-foreground leading-relaxed break-words">{user.bio}</p>
            </FadeIn>

            <FadeIn delay={0.4}>
              <div className="flex flex-wrap gap-3 sm:gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1 min-w-0">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span className="truncate">{user.location}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Calendar className="h-4 w-4" />
                  <span>Joined {user.joinDate}</span>
                </div>
                <div className="flex items-center gap-1 min-w-0">
                  <Globe className="h-4 w-4 shrink-0" />
                  <a href={user.website} className="text-primary hover:underline truncate">
                    {user.website.replace("https://", "")}
                  </a>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Star className="h-4 w-4 fill-[var(--high)] text-[var(--high)]" />
                  <span>{user.reputation}/5.0</span>
                </div>
                {userRanking && userRanking.streak > 0 && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Trophy className="h-4 w-4 text-[var(--high)]" />
                    <span>{userRanking.streak} day streak</span>
                  </div>
                )}
              </div>
            </FadeIn>

            <SlideIn direction="up" delay={0.5}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-border/50">
                <motion.div className="text-center" whileHover={{ scale: 1.05 }} transition={{ duration: 0.2 }}>
                  <div className="flex items-center justify-center gap-1 text-[var(--low)] mb-1">
                    <DollarSign className="h-4 w-4" />
                    <span className="text-xl sm:text-2xl font-bold">
                      ${(userRanking?.totalEarnings || user.totalEarnings).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Total Earnings</p>
                </motion.div>
                <motion.div className="text-center" whileHover={{ scale: 1.05 }} transition={{ duration: 0.2 }}>
                  <div className="flex items-center justify-center gap-1 text-primary mb-1">
                    <FileText className="h-4 w-4" />
                    <span className="text-xl sm:text-2xl font-bold">{userRanking?.bugsFound || user.totalReports}</span>
                  </div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Reports Submitted</p>
                </motion.div>
                <motion.div className="text-center" whileHover={{ scale: 1.05 }} transition={{ duration: 0.2 }}>
                  <div className="flex items-center justify-center gap-1 text-secondary mb-1">
                    <Trophy className="h-4 w-4" />
                    {pointsLoading ? (
                      <span className="text-primary text-lg">Loading...</span>
                    ) : pointsError ? (
                      <span className="text-[var(--critical)] text-sm">{pointsError}</span>
                    ) : (
                      <span className="text-xl sm:text-2xl font-bold">{pointsToShow?.toLocaleString?.() ?? pointsToShow}</span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Total Points</p>
                </motion.div>
              </div>
            </SlideIn>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

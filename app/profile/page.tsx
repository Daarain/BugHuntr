"use client";
import { useState, useEffect } from "react";
import { ProfileHeader } from "@/components/profile/profile-header";
import { ProfileStats } from "@/components/profile/profile-stats";
import { ProfileAchievements } from "@/components/profile/profile-achievements";
import { ProfileActivity } from "@/components/profile/profile-activity";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/auth/auth-context";
import { useRanking } from "@/hooks/use-ranking";
import { RankProgress } from "@/components/ranking/rank-progress";
import { PointsHistory } from "@/components/ranking/points-history";
import { Card, CardContent } from "@/components/ui/card";

interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  email: string;
  bio: string;
  joinDate: string;
  location: string;
  website: string;
  points: number;
  bugsSubmitted: number;
  role?: "user" | "admin";
  companyName?: string;
}

interface Activity {
  id: number;
  type: "report" | "certificate";
  title: string;
  company: string;
  bounty?: number;
  date: string;
  status: string;
}

export default function ProfilePage() {
  const { user } = useAuth();
  const { getUserRanking } = useRanking();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [recentActivity, setRecentActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<any[]>([]);

  // Fetch user profile from Firestore
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user || !user.email) {
        setLoading(false);
        return;
      }

      try {
        // 1. Fetch user profile
        const profileRes = await fetch("/api/user/profile", { credentials: "include" });
        if (profileRes.ok) {
          const userDoc = await profileRes.json();
          const joinDate = userDoc.createdAt
            ? new Date(userDoc.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
              })
            : "January 2024";

          // 2. Fetch stats
          const statsRes = await fetch("/api/user/stats", { credentials: "include" });
          const stats = statsRes.ok ? await statsRes.json() : {};

          const points = stats.points ?? userDoc.points ?? 0;
          const bugsSubmitted = stats.bugsSubmitted ?? 0;

          setUserProfile({
            id: userDoc.id || user.id,
            username: userDoc.username || user.username || "Unknown",
            displayName:
              userDoc.displayName || userDoc.name || user.username || "User",
            avatar: userDoc.avatarUrl || userDoc.avatar || "",
            email: user.email,
            bio: userDoc.bio || "Security researcher and bug hunter",
            joinDate: joinDate,
            location: userDoc.country || "Global",
            website: "",
            points: points,
            bugsSubmitted: bugsSubmitted,
            role: user.role || "user",
            companyName: userDoc.companyName || "",
          });

          // Generate badges based on user stats
          const userBadges = generateBadges(points, bugsSubmitted);
          setBadges(userBadges);
        }

        // 3. Fetch recent bug reports as activity
        const bugsRes = await fetch("/api/bug-submissions", { credentials: "include" });
        if (bugsRes.ok) {
          const subsData = await bugsRes.json();
          const submissions = Array.isArray(subsData.submissions)
            ? subsData.submissions.slice(0, 5)
            : [];
          const activities = submissions.map((data: any, index: number) => ({
            id: index + 1,
            type: "report" as const,
            title: data.title || "Bug Report",
            company: data.org_id || data.company || "Bounty Program",
            bounty: data.reward_amount || data.bounty || 0,
            date: data.created_at ? formatDate(data.created_at) : "Recently",
            status: data.status || "pending",
          }));
          setRecentActivity(activities);
        }
      } catch (error) {
        console.error("Error fetching profile:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [user]);

  // Generate badges based on user achievements
  const generateBadges = (points: number, bugsSubmitted: number) => {
    const allBadges = [
      {
        id: 1,
        name: "First Blood",
        description: "First vulnerability reported",
        icon: "🩸",
        earned: bugsSubmitted >= 1,
      },
      {
        id: 2,
        name: "Critical Hunter",
        description: "Found 5+ critical vulnerabilities",
        icon: "🎯",
        earned: points >= 2500,
      },
      {
        id: 3,
        name: "Web Expert",
        description: "Specialized in web application security",
        icon: "🌐",
        earned: bugsSubmitted >= 5,
      },
      {
        id: 4,
        name: "API Master",
        description: "Expert in API security testing",
        icon: "🔌",
        earned: points >= 5000,
      },
      {
        id: 5,
        name: "Hall of Fame",
        description: "Featured in company hall of fame",
        icon: "🏆",
        earned: points >= 10000,
      },
      {
        id: 6,
        name: "Bug Bounty Legend",
        description: "Earned $50,000+ in bounties",
        icon: "💎",
        earned: points >= 50000,
      },
    ];
    return allBadges;
  };

  // Format Firestore timestamp
  const formatDate = (timestamp: any): string => {
    try {
      if (!timestamp) return "Recently";
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      const diffWeeks = Math.floor(diffMs / 604800000);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60)
        return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
      if (diffHours < 24)
        return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
      if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
      if (diffWeeks < 4)
        return `${diffWeeks} week${diffWeeks > 1 ? "s" : ""} ago`;
      return date.toLocaleDateString();
    } catch {
      return "Recently";
    }
  };

  // Get current user's ranking data
  const userRanking = user ? getUserRanking(user.id) : null;

  // Create display user object
  const displayUser = userProfile
    ? {
        username: userProfile.username,
        displayName: userProfile.displayName,
        bio: userProfile.bio,
        avatar: userProfile.avatar || "",
        joinDate: userProfile.joinDate,
        location: userProfile.location,
        website: userProfile.website,
        rank:
          typeof userRanking?.rank === "string" ? 0 : userRanking?.rank || 0,
        totalEarnings: userProfile.points,
        totalReports: userProfile.bugsSubmitted,
        validReports: userProfile.bugsSubmitted,
        duplicateReports: 0,
        averageBounty:
          userProfile.bugsSubmitted > 0
            ? Math.floor(userProfile.points / userProfile.bugsSubmitted)
            : 0,
        reputation: 4.8,
        role: userProfile.role,
        companyName: userProfile.companyName,
      }
    : null;

  if (loading) {
    return (
      <main className="p-6 pb-20 md:pb-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardContent className="p-8">
              <div className="text-center py-12">
                <p className="text-muted-foreground">Loading profile...</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (!displayUser) {
    return (
      <main className="p-6 pb-20 md:pb-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardContent className="p-8">
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  Please log in to view your profile.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="p-6 pb-20 md:pb-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <ProfileHeader user={displayUser} userRanking={userRanking} />

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="ranking">Ranking</TabsTrigger>
            <TabsTrigger value="achievements">Achievements</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="certificates">Certificates</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <ProfileStats user={displayUser} />
          </TabsContent>

          <TabsContent value="ranking">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                {userRanking ? (
                  <RankProgress user={userRanking} />
                ) : (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">
                      Please log in to view your ranking progress.
                    </p>
                  </div>
                )}
              </div>
              <div>
                {user ? (
                  <PointsHistory userId={user.id} limit={10} />
                ) : (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">
                      Please log in to view your points history.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="achievements">
            <ProfileAchievements badges={badges} />
          </TabsContent>

          <TabsContent value="activity">
            <ProfileActivity
              activities={recentActivity.length > 0 ? recentActivity : []}
            />
          </TabsContent>

          <TabsContent value="certificates">
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                Certificate management coming soon...
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

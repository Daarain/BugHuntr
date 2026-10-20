"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  User,
  Bell,
  Shield,
  Trophy,
  Camera,
  Save,
  Key,
  Smartphone,
  Mail,
  MessageSquare,
  Award,
  Star,
} from "lucide-react"
import { useAuth } from "@/components/auth/auth-context"
import { useRouter } from "next/navigation"

export default function SettingsPage() {
  const { user, isAuthenticated } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const [profile, setProfile] = useState({
    username: "",
    email: "",
    fullName: "",
    bio: "",
  })

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    pushNotifications: true,
    bugUpdates: true,
    communityMessages: false,
    weeklyDigest: true,
  })

  const [points, setPoints] = useState({
    total: 0,
    thisMonth: 0,
    rank: "Beginner",
    nextMilestone: 5000,
  })

  // Fetch user data on mount
  useEffect(() => {
    const fetchUserData = async () => {
      if (!isAuthenticated || !user?.email) {
        router.push("/login")
        return
      }

      try {
        // 1. Fetch user profile
        const profileRes = await fetch("/api/user/profile", { credentials: "include" })
        if (profileRes.ok) {
          const profileData = await profileRes.json()
          setProfile({
            username: profileData.username || user.username || "",
            email: user.email || "",
            fullName: profileData.displayName || profileData.name || "",
            bio: profileData.bio || "",
          })
        }

        // 2. Fetch user points & stats
        const statsRes = await fetch("/api/user/stats", { credentials: "include" })
        if (statsRes.ok) {
          const statsData = await statsRes.json()
          setPoints({
            total: statsData.points || 0,
            thisMonth: statsData.monthlyPoints || 0,
            rank: statsData.rank || "Beginner",
            nextMilestone: (statsData.points || 0) + (statsData.nextRankPoints || 500),
          })
        }

        // 3. Fetch notification preferences
        const settingsRes = await fetch("/api/user/settings", { credentials: "include" })
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json()
          if (settingsData.notifications) {
            setNotifications(settingsData.notifications)
          }
        }
      } catch (error) {
        console.error("Error fetching user data:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchUserData()
  }, [isAuthenticated, user, router])

  // Save profile changes
  const handleSaveProfile = async () => {
    setIsSaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          displayName: profile.fullName,
          bio: profile.bio,
        }),
      })

      if (res.ok) {
        alert("Profile updated successfully!")
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Failed to update profile.")
      }
    } catch (error) {
      console.error("Error saving profile:", error)
      alert("Error saving profile. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  // Save notification preferences
  const handleSaveNotifications = async () => {
    setIsSaving(true)
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          notifications: notifications,
        }),
      })

      if (res.ok) {
        alert("Notification preferences updated!")
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Failed to update notification preferences.")
      }
    } catch (error) {
      console.error("Error saving notifications:", error)
      alert("Error saving preferences. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Please log in to access settings</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage your account preferences and security settings</p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="points" className="flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Points & Rewards
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Profile Information
              </CardTitle>
              <CardDescription>Update your profile details and public information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src="/cybersecurity-professional-avatar.png" />
                    <AvatarFallback className="text-lg">AH</AvatarFallback>
                  </Avatar>
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full p-0 bg-transparent"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{profile.fullName}</h3>
                  <p className="text-muted-foreground">@{profile.username}</p>
                  <Badge variant="secondary" className="mt-1">
                    <Star className="h-3 w-3 mr-1" />
                    Verified Hunter
                  </Badge>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    value={profile.fullName}
                    onChange={(e) => setProfile((prev) => ({ ...prev, fullName: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={profile.username}
                    onChange={(e) => setProfile((prev) => ({ ...prev, username: e.target.value }))}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="bio">Bio</Label>
                  <Input
                    id="bio"
                    value={profile.bio}
                    onChange={(e) => setProfile((prev) => ({ ...prev, bio: e.target.value }))}
                    placeholder="Tell us about your expertise..."
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button 
                  className="flex items-center gap-2"
                  onClick={handleSaveProfile}
                  disabled={isSaving}
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notification Preferences
              </CardTitle>
              <CardDescription>Choose how you want to be notified about platform activities</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <Label htmlFor="emailAlerts" className="text-base font-medium">
                        Email Alerts
                      </Label>
                      <p className="text-sm text-muted-foreground">Receive important updates via email</p>
                    </div>
                  </div>
                  <Switch
                    id="emailAlerts"
                    checked={notifications.emailAlerts}
                    onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, emailAlerts: checked }))}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Smartphone className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <Label htmlFor="pushNotifications" className="text-base font-medium">
                        Push Notifications
                      </Label>
                      <p className="text-sm text-muted-foreground">Get instant notifications on your device</p>
                    </div>
                  </div>
                  <Switch
                    id="pushNotifications"
                    checked={notifications.pushNotifications}
                    onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, pushNotifications: checked }))}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <Label htmlFor="bugUpdates" className="text-base font-medium">
                        Bug Report Updates
                      </Label>
                      <p className="text-sm text-muted-foreground">Notifications about your submitted bugs</p>
                    </div>
                  </div>
                  <Switch
                    id="bugUpdates"
                    checked={notifications.bugUpdates}
                    onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, bugUpdates: checked }))}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <Label htmlFor="communityMessages" className="text-base font-medium">
                        Community Messages
                      </Label>
                      <p className="text-sm text-muted-foreground">Messages from other hunters and discussions</p>
                    </div>
                  </div>
                  <Switch
                    id="communityMessages"
                    checked={notifications.communityMessages}
                    onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, communityMessages: checked }))}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <Label htmlFor="weeklyDigest" className="text-base font-medium">
                        Weekly Digest
                      </Label>
                      <p className="text-sm text-muted-foreground">Summary of platform activity and opportunities</p>
                    </div>
                  </div>
                  <Switch
                    id="weeklyDigest"
                    checked={notifications.weeklyDigest}
                    onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, weeklyDigest: checked }))}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button 
                  className="flex items-center gap-2"
                  onClick={handleSaveNotifications}
                  disabled={isSaving}
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? "Saving..." : "Save Preferences"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security Settings
              </CardTitle>
              <CardDescription>Manage your account security and authentication methods</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Key className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <h4 className="font-medium">Password</h4>
                      <p className="text-sm text-muted-foreground">Last changed 3 months ago</p>
                    </div>
                  </div>
                  <Button variant="outline">Change Password</Button>
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Smartphone className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <h4 className="font-medium">Two-Factor Authentication</h4>
                      <p className="text-sm text-muted-foreground">Add an extra layer of security</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[var(--low)] border-[var(--border-light)]">
                      Enabled
                    </Badge>
                    <Button variant="outline">Manage</Button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <h4 className="font-medium">Login Sessions</h4>
                      <p className="text-sm text-muted-foreground">Manage active sessions across devices</p>
                    </div>
                  </div>
                  <Button variant="outline">View Sessions</Button>
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Key className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <h4 className="font-medium">API Keys</h4>
                      <p className="text-sm text-muted-foreground">Manage your API access tokens</p>
                    </div>
                  </div>
                  <Button variant="outline">Manage Keys</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="points" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Points Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-primary">{points.total.toLocaleString()}</div>
                  <p className="text-muted-foreground">Total Points</p>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">This Month</span>
                  <span className="font-semibold text-[var(--low)]">+{points.thisMonth}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Rank</span>
                  <Badge variant="secondary" className="bg-secondary text-white">
                    <Award className="h-3 w-3 mr-1" />
                    {points.rank}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Next Milestone</span>
                    <span>{points.nextMilestone.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(points.total / points.nextMilestone) * 100}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">XSS Vulnerability Found</p>
                    <p className="text-sm text-muted-foreground">2 days ago</p>
                  </div>
                  <Badge className="bg-[var(--low)] text-black">+500</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">SQL Injection Report</p>
                    <p className="text-sm text-muted-foreground">1 week ago</p>
                  </div>
                  <Badge className="bg-[var(--high)] text-black">+750</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">Community Contribution</p>
                    <p className="text-sm text-muted-foreground">2 weeks ago</p>
                  </div>
                  <Badge className="bg-secondary text-black">+100</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Rewards & Redemption</CardTitle>
              <CardDescription>Use your points to unlock exclusive rewards and recognition</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 border rounded-lg text-center">
                  <Trophy className="h-8 w-8 mx-auto mb-2 text-[var(--high)]" />
                  <h4 className="font-medium">Premium Badge</h4>
                  <p className="text-sm text-muted-foreground mb-3">5,000 points</p>
                  <Button size="sm" variant="outline">
                    Redeem
                  </Button>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <Award className="h-8 w-8 mx-auto mb-2 text-secondary" />
                  <h4 className="font-medium">Hall of Fame Entry</h4>
                  <p className="text-sm text-muted-foreground mb-3">10,000 points</p>
                  <Button size="sm" variant="outline">
                    Redeem
                  </Button>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <Star className="h-8 w-8 mx-auto mb-2 text-[var(--low)]" />
                  <h4 className="font-medium">Elite Status</h4>
                  <p className="text-sm text-muted-foreground mb-3">15,000 points</p>
                  <Button size="sm" disabled>
                    {points.total >= 15000 ? "Available" : "Locked"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

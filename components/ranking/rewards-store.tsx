"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useRanking } from "@/hooks/use-ranking"
import { useAuth } from "@/components/auth/auth-context"
import { Trophy, Star, Crown, Shirt, Ticket, UserCheck, ShoppingCart, Lock, Package } from "lucide-react"
import type { RewardItem } from "@/types/ranking"

const iconMap = {
  trophy: Trophy,
  star: Star,
  crown: Crown,
  shirt: Shirt,
  ticket: Ticket,
  "user-check": UserCheck,
}

export function RewardsStore() {
  const { user } = useAuth()
  const { getUserRanking, getAvailableRewards, redeemReward, REWARD_CATALOG } = useRanking()
  const [redeeming, setRedeeming] = useState<string | null>(null)

  if (!user) return null

  const userRanking = getUserRanking(user.id)
  const availableRewards = getAvailableRewards(user.id)
  const unavailableRewards = REWARD_CATALOG.filter((reward) => !availableRewards.includes(reward))

  const handleRedeem = async (rewardId: string) => {
    setRedeeming(rewardId)

    try {
      const result = await redeemReward(user.id, rewardId)
      if (result.success) {
        alert("Reward redeemed successfully!")
      } else {
        alert(result.message)
      }
    } catch (error) {
      alert("Failed to redeem reward. Please try again.")
    } finally {
      setRedeeming(null)
    }
  }

  const getCategoryColor = (category: RewardItem["category"]) => {
    switch (category) {
      case "badge":
        return "bg-[var(--accent-soft)] text-primary border-[var(--border-light)]"
      case "perk":
        return "bg-secondary/10 text-secondary border-cyber-purple/20"
      case "physical":
        return "bg-[color:color-mix(in_srgb,var(--high)_12%,transparent)] text-[var(--high)] border-[color:color-mix(in_srgb,var(--high)_25%,transparent)]"
      case "access":
        return "bg-[color:color-mix(in_srgb,var(--low)_12%,transparent)] text-[var(--low)] border-[color:color-mix(in_srgb,var(--low)_25%,transparent)]"
      default:
        return "bg-muted text-muted-foreground border-border"
    }
  }

  const RewardCard = ({ reward, available }: { reward: RewardItem; available: boolean }) => {
    const IconComponent = iconMap[reward.icon as keyof typeof iconMap] || Package
    const canAfford = userRanking && userRanking.totalPoints >= reward.pointsCost

    return (
      <Card className={`transition-all duration-200 ${available ? "hover:shadow-lg" : "opacity-60"}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  available ? "bg-[var(--accent-soft)]" : "bg-muted"
                }`}
              >
                {available ? (
                  <IconComponent className="w-5 h-5 text-primary" />
                ) : (
                  <Lock className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div>
                <CardTitle className="text-base">{reward.name}</CardTitle>
                <Badge variant="outline" className={getCategoryColor(reward.category)}>
                  {reward.category}
                </Badge>
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold text-primary">{reward.pointsCost.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">points</div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{reward.description}</p>

          {reward.limitedQuantity && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Package className="w-3 h-3" />
              Limited: {reward.limitedQuantity} available
            </div>
          )}

          {reward.requiredRank && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Crown className="w-3 h-3" />
              Requires {reward.requiredRank} rank
            </div>
          )}

          <Button
            className="w-full"
            disabled={!available || !canAfford || redeeming === reward.id}
            onClick={() => handleRedeem(reward.id)}
            variant={available && canAfford ? "default" : "outline"}
          >
            {redeeming === reward.id ? (
              "Redeeming..."
            ) : !available ? (
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Locked
              </div>
            ) : !canAfford ? (
              "Insufficient Points"
            ) : (
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                Redeem
              </div>
            )}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Rewards Store</h2>
          <p className="text-muted-foreground">Redeem your points for exclusive rewards</p>
        </div>
        {userRanking && (
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">{userRanking.totalPoints.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Available Points</div>
          </div>
        )}
      </div>

      {availableRewards.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Available Rewards</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableRewards.map((reward) => (
              <RewardCard key={reward.id} reward={reward} available={true} />
            ))}
          </div>
        </div>
      )}

      {unavailableRewards.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Locked Rewards</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {unavailableRewards.map((reward) => (
              <RewardCard key={reward.id} reward={reward} available={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

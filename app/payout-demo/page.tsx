"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Wallet,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Zap,
  Send,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

export default function PayoutDemoPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [demoOrgId] = useState("demo_org_001");
  const [demoWallet, setDemoWallet] = useState({
    balance: 10000000000, // 10,000 USDC in micro-units
    reserved: 0,
  });
  const [demoPayouts, setDemoPayouts] = useState<any[]>([]);

  // Demo payout form
  const [payoutAmount, setPayoutAmount] = useState("100");
  const [hunterWallet, setHunterWallet] = useState(
    "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
  );

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    loadDemoData();
  }, [isAuthenticated]);

  const loadDemoData = async () => {
    try {
      const res = await fetch(`/api/wallet/org?orgId=${encodeURIComponent(demoOrgId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.wallet) {
          setDemoWallet({
            balance: data.wallet.balance ?? 10000000000,
            reserved: data.wallet.reserved ?? 0,
          });
        }
      }
    } catch (error) {
      console.error("Error loading demo data:", error);
    }
  };

  const initializeDemoWallet = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/wallet/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: demoOrgId,
          balance: 10000000000,
          currency: "USDC",
          network: "POLYGON",
          action: "initialize",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to initialize wallet");
      }

      setDemoWallet({
        balance: 10000000000,
        reserved: 0,
      });

      toast.success("Demo wallet initialized with 10,000 USDC!");
    } catch (error: any) {
      toast.error("Failed to initialize wallet: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const createDemoPayout = async (
    scenario: "success" | "processing" | "failed"
  ) => {
    setLoading(true);
    try {
      const res = await fetch("/api/payouts/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: payoutAmount,
          hunterWallet,
          scenario,
          orgId: demoOrgId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create demo payout");
      }

      if (data.wallet) {
        setDemoWallet({
          balance: data.wallet.balance,
          reserved: data.wallet.reserved,
        });
      }

      if (data.payout) {
        setDemoPayouts((prev) => [data.payout, ...prev]);
      }

      toast.success(
        scenario === "success"
          ? `✅ Demo payout successful! $${payoutAmount} USDC sent`
          : scenario === "failed"
          ? "❌ Demo payout failed (as expected)"
          : "⏳ Demo payout processing..."
      );
    } catch (error: any) {
      toast.error("Failed to create demo payout: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const formatUSDC = (microUnits: number) => {
    return (microUnits / 1000000).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-5 w-5 text-[var(--low)]" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-[var(--critical)]" />;
      case "processing":
        return <Clock className="h-5 w-5 text-[var(--medium)]" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      completed: "bg-[color:color-mix(in_srgb,var(--low)_12%,transparent)] text-[var(--low)] border-[color:color-mix(in_srgb,var(--low)_25%,transparent)]",
      failed: "bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] text-[var(--critical)] border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)]",
      processing: "bg-[color:color-mix(in_srgb,var(--medium)_12%,transparent)] text-[var(--medium)] border-[color:color-mix(in_srgb,var(--medium)_25%,transparent)]",
      pending_created: "bg-[var(--accent-soft)] text-primary border-[var(--border-light)]",
    };

    return (
      <Badge className={variants[status] || "bg-gray-500/10 text-gray-500"}>
        {status.replace(/_/g, " ").toUpperCase()}
      </Badge>
    );
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold flex items-center gap-3">
              <Zap className="h-10 w-10 text-primary" />
              Crypto Payout Demo
            </h1>
            <p className="text-muted-foreground mt-2">
              Test the automated payout system with simulated transactions
            </p>
          </div>
          <Badge className="bg-[var(--high)] text-black text-lg px-4 py-2">
            DEMO MODE
          </Badge>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This is a demonstration environment. No real cryptocurrency
            transactions will be made. All data shown here is for testing
            purposes only.
          </AlertDescription>
        </Alert>

        {/* Wallet Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-6 w-6 text-primary" />
              Demo Organization Wallet
            </CardTitle>
            <CardDescription>
              Simulated USDC balance on Polygon network
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-muted">
                <p className="text-sm text-muted-foreground">Total Balance</p>
                <p className="text-2xl font-bold text-primary">
                  ${formatUSDC(demoWallet.balance)}
                </p>
                <p className="text-xs text-muted-foreground">USDC</p>
              </div>
              <div className="p-4 rounded-lg bg-muted">
                <p className="text-sm text-muted-foreground">Reserved</p>
                <p className="text-2xl font-bold text-[var(--medium)]">
                  ${formatUSDC(demoWallet.reserved)}
                </p>
                <p className="text-xs text-muted-foreground">USDC</p>
              </div>
              <div className="p-4 rounded-lg bg-muted">
                <p className="text-sm text-muted-foreground">Available</p>
                <p className="text-2xl font-bold text-[var(--low)]">
                  ${formatUSDC(demoWallet.balance - demoWallet.reserved)}
                </p>
                <p className="text-xs text-muted-foreground">USDC</p>
              </div>
            </div>

            {demoWallet.balance === 0 && (
              <Button
                onClick={initializeDemoWallet}
                disabled={loading}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Initialize Demo Wallet (10,000 USDC)
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Demo Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Create Demo Payout</CardTitle>
            <CardDescription>
              Simulate different payout scenarios
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="amount">Amount (USDC)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder="100.00"
                />
              </div>
              <div>
                <Label htmlFor="wallet">Hunter Wallet Address</Label>
                <Input
                  id="wallet"
                  value={hunterWallet}
                  onChange={(e) => setHunterWallet(e.target.value)}
                  placeholder="0x..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Button
                onClick={() => createDemoPayout("success")}
                disabled={loading || demoWallet.balance === 0}
                className="bg-[var(--low)] hover:bg-[color:color-mix(in_srgb,var(--low)_85%,black)] text-black"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Simulate Success
              </Button>
              <Button
                onClick={() => createDemoPayout("processing")}
                disabled={loading || demoWallet.balance === 0}
                className="bg-[var(--medium)] hover:bg-[color:color-mix(in_srgb,var(--medium)_85%,black)]"
              >
                <Clock className="h-4 w-4 mr-2" />
                Simulate Processing
              </Button>
              <Button
                onClick={() => createDemoPayout("failed")}
                disabled={loading || demoWallet.balance === 0}
                variant="destructive"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Simulate Failure
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Payout History */}
        <Card>
          <CardHeader>
            <CardTitle>Demo Payout History</CardTitle>
            <CardDescription>Recently simulated transactions</CardDescription>
          </CardHeader>
          <CardContent>
            {demoPayouts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Send className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p>No demo payouts yet. Create one above!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {demoPayouts.map((payout, index) => (
                  <div
                    key={payout.order_id || index}
                    className="p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(payout.status)}
                        <div>
                          <p className="font-mono text-sm">{payout.order_id}</p>
                          <p className="text-xs text-muted-foreground">
                            {payout.hunterWallet.substring(0, 12)}...
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">
                          ${formatUSDC(payout.amount)}
                        </p>
                        {getStatusBadge(payout.status)}
                      </div>
                    </div>
                    {payout.tx_hash && (
                      <div className="mt-2 pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          TX Hash:{" "}
                          <span className="font-mono">{payout.tx_hash}</span>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">How It Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                1. <strong>Initialize</strong> - Set up demo wallet with virtual
                funds
              </p>
              <p>
                2. <strong>Create Payout</strong> - Enter amount and wallet
                address
              </p>
              <p>
                3. <strong>Simulate</strong> - Choose success, processing, or
                failure
              </p>
              <p>
                4. <strong>Observe</strong> - Watch balance update and
                transaction appear
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Scenario Explanations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                ✅ <strong>Success</strong> - Funds deducted, TX hash generated
              </p>
              <p>
                ⏳ <strong>Processing</strong> - Funds reserved, awaiting
                blockchain
              </p>
              <p>
                ❌ <strong>Failure</strong> - Error occurred, funds stay in
                wallet
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

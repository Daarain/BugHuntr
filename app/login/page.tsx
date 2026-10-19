// Firebase auth has been fixed date:26-11-2025

"use client";

import type React from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  ArrowLeft,
  Building2,
  Mail,
  AlertCircle,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/components/auth/auth-context";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const router = useRouter();
  const { login } = useAuth();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    rememberMe: false,
    companyId: "",
    twoFactorCode: "",
  });

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (validationErrors.length > 0) {
      setValidationErrors([]);
    }
  };

  const validateCompanyEmail = (email: string): boolean => {
    const companyDomains = ["@company.com", "@corp.com", "@enterprise.com"];
    return companyDomains.some((domain) =>
      email.toLowerCase().endsWith(domain)
    );
  };

  const validatePassword = (password: string): string[] => {
    const errors: string[] = [];
    if (password.length < 8)
      errors.push("Password must be at least 8 characters long");
    if (!/[A-Z]/.test(password))
      errors.push("Password must contain at least one uppercase letter");
    if (!/[a-z]/.test(password))
      errors.push("Password must contain at least one lowercase letter");
    if (!/\d/.test(password))
      errors.push("Password must contain at least one number");
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password))
      errors.push("Password must contain at least one special character");
    return errors;
  };

  const validateForm = (): boolean => {
    const errors: string[] = [];
    // Only validate password for admin, not email domain
    if (isAdminLogin) {
      const passwordErrors = validatePassword(formData.password);
      errors.push(...passwordErrors);
    }
    setValidationErrors(errors);
    return errors.length === 0;
  };

  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  const sendTwoFactorCode = async (email: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/2fa/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.challengeToken) {
        setValidationErrors([
          data?.error || "Two-factor authentication provider is unconfigured.",
        ]);
        return false;
      }
      setChallengeToken(data.challengeToken);
      return true;
    } catch {
      setValidationErrors(["Failed to dispatch verification code."]);
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      // Authenticate strictly on the server: password comparison, role resolution, and 2FA
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          twoFactorCode: showTwoFactor ? formData.twoFactorCode : undefined,
          challengeToken: showTwoFactor ? challengeToken : undefined,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (data?.newChallengeToken) {
          setChallengeToken(data.newChallengeToken);
        }
        setValidationErrors([data?.error || "Authentication failed. Please try again."]);
        setIsLoading(false);
        return;
      }

      // If server requires 2FA (enforced on server for all admin accounts regardless of tab)
      if (data?.requires2FA) {
        setChallengeToken(data.challengeToken);
        setShowTwoFactor(true);
        setIsLoading(false);
        return;
      }

      if (data?.success && data?.user) {
        login(
          data.user.username,
          data.user.email,
          data.user.role,
          data.user.userType,
          data.user
        );

        alert("Login successful! Welcome back.");
        setTimeout(() => {
          router.push("/feed");
        }, 500);
      } else {
        setValidationErrors(["Unexpected server response."]);
      }
    } catch (error) {
      console.error("Login error:", error);
      setValidationErrors(["Network error during login. Please try again."]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-10 px-4 bg-background relative">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_srgb,var(--border)_20%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--border)_20%,transparent)_1px,transparent_1px)] bg-[size:64px_64px] opacity-25 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--accent-primary)_8%,transparent),transparent_60%)] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <Card className="bg-secondary bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border border-border shadow-lg rounded-xl p-6 sm:p-8">
          <CardHeader className="p-0 pb-6 space-y-2 text-left">
            <CardTitle className="text-primary text-3xl font-semibold tracking-tight border-l-2 border-[var(--accent-primary)] pl-2">
              Login
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Enter your credentials to continue
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0 space-y-6">
            {validationErrors.length > 0 && (
              <Alert className="border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--critical)_10%,transparent)]">
                <AlertCircle className="h-4 w-4 text-[var(--critical)]" />
                <AlertDescription className="text-[var(--critical)]">
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((error, index) => (
                      <li key={index} className="text-sm">{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {!showTwoFactor && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-tertiary p-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsAdminLogin(false)}
                  className={`h-10 w-full rounded-md font-medium transition-all duration-200 ease-in-out ${
                    !isAdminLogin
                      ? "bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-hover)]"
                      : "bg-tertiary text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Hunter
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsAdminLogin(true)}
                  className={`h-10 w-full rounded-md font-medium transition-all duration-200 ease-in-out ${
                    isAdminLogin
                      ? "bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-hover)]"
                      : "bg-tertiary text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Admin
                </Button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {showTwoFactor ? (
                <div className="space-y-2">
                  <Label htmlFor="twoFactorCode" className="text-sm text-muted-foreground">
                    Verification code
                  </Label>
                  <Input
                    id="twoFactorCode"
                    type="text"
                    placeholder="000000"
                    value={formData.twoFactorCode}
                    onChange={(e) =>
                      handleInputChange("twoFactorCode", e.target.value)
                    }
                    className="bg-tertiary border border-border rounded-lg px-4 py-2 h-11 text-foreground placeholder:text-muted-foreground focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent-primary)_30%,transparent)] transition-all duration-200 ease-in-out"
                    maxLength={6}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Code not received?{" "}
                    <button
                      type="button"
                      onClick={() => sendTwoFactorCode(formData.email)}
                      className="text-[var(--accent-primary)] hover:text-[var(--accent-hover)]"
                    >
                      Resend
                    </button>
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm text-muted-foreground">
                      {isAdminLogin ? "Admin email" : "Email"}
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder={
                          isAdminLogin ? "admin@company.com" : "hunter@example.com"
                        }
                        value={formData.email}
                        onChange={(e) =>
                          handleInputChange("email", e.target.value)
                        }
                        className="bg-tertiary border border-border rounded-lg pl-10 pr-4 py-2 h-11 text-foreground placeholder:text-muted-foreground focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent-primary)_30%,transparent)] transition-all duration-200 ease-in-out"
                        required
                      />
                    </div>
                    {isAdminLogin && (
                      <p className="text-xs text-muted-foreground">
                        Use your registered admin email.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sm text-muted-foreground">
                      Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••••••"
                        value={formData.password}
                        onChange={(e) =>
                          handleInputChange("password", e.target.value)
                        }
                        className="bg-tertiary border border-border rounded-lg pl-10 pr-11 py-2 h-11 text-foreground placeholder:text-muted-foreground focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent-primary)_30%,transparent)] transition-all duration-200 ease-in-out"
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 ease-in-out"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {isAdminLogin && (
                      <p className="text-xs text-muted-foreground">
                        Use at least 8 characters with uppercase, lowercase, number, and symbol.
                      </p>
                    )}
                  </div>

                  {isAdminLogin && (
                    <div className="space-y-2">
                      <Label htmlFor="companyId" className="text-sm text-muted-foreground">
                        Company ID (optional)
                      </Label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="companyId"
                          type="text"
                          placeholder="COMP_001 or REG_123456"
                          value={formData.companyId}
                          onChange={(e) =>
                            handleInputChange("companyId", e.target.value)
                          }
                          className="bg-tertiary border border-border rounded-lg pl-10 pr-4 py-2 h-11 text-foreground placeholder:text-muted-foreground focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent-primary)_30%,transparent)] transition-all duration-200 ease-in-out"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="rememberMe"
                        checked={formData.rememberMe}
                        onCheckedChange={(checked: boolean) =>
                          handleInputChange("rememberMe", checked)
                        }
                        className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                      <Label
                        htmlFor="rememberMe"
                        className="text-sm text-muted-foreground cursor-pointer"
                      >
                        Remember me
                      </Label>
                    </div>
                    <Link
                      href="/forgot-password"
                      className="text-sm text-[var(--accent-primary)] hover:text-[var(--accent-hover)]"
                    >
                      Forgot password?
                    </Link>
                  </div>
                </>
              )}

              <Button
                type="submit"
                className="w-full h-auto rounded-lg py-3 text-sm font-medium text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] shadow-md transition-all duration-200 ease-in-out hover:scale-[1.02] active:scale-95"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    {showTwoFactor
                      ? "Verifying..."
                      : isAdminLogin
                      ? "Authenticating..."
                      : "Logging in..."}
                  </div>
                ) : (
                  <span>{showTwoFactor ? "Verify & Login" : "Login"}</span>
                )}
              </Button>

              {showTwoFactor && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 rounded-lg border border-border bg-tertiary text-foreground hover:bg-muted"
                  onClick={() => setShowTwoFactor(false)}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              )}
            </form>

            {!showTwoFactor && (
              <div className="text-center pt-2">
                <p className="text-sm text-muted-foreground">
                  No account?{" "}
                  <Link
                    href="/signup"
                    className="text-[var(--accent-primary)] hover:text-[var(--accent-hover)] font-medium"
                  >
                    Register
                  </Link>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-5 text-center">
          <Link
            href="/"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

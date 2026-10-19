// Firebase auth has been fixed date:26-11-2025

"use client"

import type React from "react"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Eye,
  EyeOff,
  Shield,
  ArrowLeft,
  Mail,
  CheckCircle,
  User,
  Building,
  GraduationCap,
  Briefcase,
  Bug,
  Terminal,
  ShieldCheck,
  Code2,
  Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth/auth-context"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle } from "lucide-react"

type UserType = "user" | "admin"
type AdminType = "company" | "firm" | "student" | "individual"

export default function SignUpPage() {
  // Username uniqueness check state
  const [isCheckingUsername, setIsCheckingUsername] = useState(false)
  const [usernameChecked, setUsernameChecked] = useState(false)

  // Async check for username uniqueness via server API
  const checkUsernameUnique = async (username: string) => {
    if (!username || username.length < 3) return false;
    setIsCheckingUsername(true);
    try {
      const res = await fetch(`/api/user/profile?username=${encodeURIComponent(username)}`, {
        credentials: "include",
      });
      setIsCheckingUsername(false);
      setUsernameChecked(true);
      // Status 404 indicates the username is not taken and available
      return res.status === 404;
    } catch {
      setIsCheckingUsername(false);
      setUsernameChecked(false);
      return false;
    }
  };
  const router = useRouter()
  const { login } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [userType, setUserType] = useState<UserType | "">("")
  const [adminType, setAdminType] = useState<AdminType | "">("")
  const [supportingDoc, setSupportingDoc] = useState<File | null>(null)

  const [formData, setFormData] = useState({
    // Common fields
    username: "",
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",

    // Company/Firm specific
    companyName: "",
    registrationNumber: "",
    businessPhone: "",
    address: "",

    // Student specific
    instituteName: "",
    studentId: "",
    projectName: "",

    // Individual specific
    projectStartupName: "",
  })

  const handleUserTypeSelect = (type: UserType) => {
    setUserType(type)
    setAdminType("") // Reset admin type when user type changes
    setErrors({}) // Clear any existing errors
  }

  const handleAdminTypeSelect = (type: AdminType) => {
    setAdminType(type)
    setErrors({}) // Clear any existing errors
  }

  const validatePassword = (password: string) => {
    const minLength = password.length >= 8
    const hasUppercase = /[A-Z]/.test(password)
    const hasLowercase = /[a-z]/.test(password)
    const hasNumber = /\d/.test(password)
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password)

    return {
      isValid: minLength && hasUppercase && hasLowercase && hasNumber && hasSpecialChar,
      errors: {
        minLength: !minLength ? "Password must be at least 8 characters long" : "",
        hasUppercase: !hasUppercase ? "Password must contain at least one uppercase letter" : "",
        hasLowercase: !hasLowercase ? "Password must contain at least one lowercase letter" : "",
        hasNumber: !hasNumber ? "Password must contain at least one number" : "",
        hasSpecialChar: !hasSpecialChar ? "Password must contain at least one special character" : "",
      },
    }
  }

  const validateEmailDomain = (email: string, type: UserType, adminType?: AdminType) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!emailRegex.test(email)) {
      return { isValid: false, error: "Please enter a valid email address" }
    }

    if (type === "admin") {
      if (adminType === "company" || adminType === "firm") {
        // Check for business domain (not common free email providers)
        const freeEmailDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com"]
        const domain = email.split("@")[1]?.toLowerCase()
        if (freeEmailDomains.includes(domain)) {
          return { isValid: false, error: "Please use your official company/firm email address" }
        }
      } else if (adminType === "student") {
        // Check for educational domain
        const domain = email.split("@")[1]?.toLowerCase()
        if (!domain?.includes("edu") && !domain?.includes("ac.")) {
          return {
            isValid: false,
            error: "Please use your official student email address (e.g., @edu.in, @university.com)",
          }
        }
      }
    }

    return { isValid: true, error: "" }
  }


  const validateForm = async () => {
    const newErrors: Record<string, string> = {}

    if (!formData.username.trim()) {
      newErrors.username = "Username is required"
    } else if (!/^[a-zA-Z0-9_]{3,20}$/.test(formData.username)) {
      newErrors.username = "Username must be 3-20 characters, letters, numbers, or underscores only"
    } else {
      // Check uniqueness
      const isUnique = await checkUsernameUnique(formData.username.trim());
      if (!isUnique) {
        newErrors.username = "Username already exists"
      }
    }

    if (!formData.name.trim()) {
      newErrors.name = "Full name is required"
    }

    const emailValidation = validateEmailDomain(formData.email, userType as UserType, adminType as AdminType)
    if (!emailValidation.isValid) {
      newErrors.email = emailValidation.error
    }

    const passwordValidation = validatePassword(formData.password)
    if (!passwordValidation.isValid) {
      newErrors.password = Object.values(passwordValidation.errors).filter(Boolean).join(". ")
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match"
    }

    // Type-specific validations
    if (userType === "admin") {
      if (adminType === "company" || adminType === "firm") {
        if (!formData.companyName.trim()) {
          newErrors.companyName = `${adminType === "company" ? "Company" : "Firm"} name is required`
        }
        if (!formData.registrationNumber.trim()) {
          newErrors.registrationNumber = "Registration number is required"
        }
        if (!formData.businessPhone.trim()) {
          newErrors.businessPhone = "Business phone number is required"
        }
        if (!formData.address.trim()) {
          newErrors.address = "Address is required"
        }
      } else if (adminType === "student") {
        if (!formData.instituteName.trim()) {
          newErrors.instituteName = "Institute/College name is required"
        }
        if (!formData.studentId.trim()) {
          newErrors.studentId = "Student ID/Enrollment number is required"
        }
      } else if (adminType === "individual") {
        if (!formData.phone.trim()) {
          newErrors.phone = "Phone number is required"
        }
      }
    }

    return newErrors
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }))
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSupportingDoc(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrors({});

    const newErrors = await validateForm();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: formData.username,
          name: formData.name,
          email: formData.email,
          password: formData.password,
          userType: userType === "admin" ? "company" : userType,
          companyName: formData.companyName,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          general: data?.error || "Registration failed. Please try again.",
        }));
        setIsLoading(false);
        return;
      }

      setEmailSent(true);
      setErrors({});
    } catch (error: any) {
      console.error("Registration error:", error);
      let errorMessage = "An error occurred during signup. Please try again.";

      if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }

      setErrors(prev => ({ ...prev, general: errorMessage }));
    } finally {
      setIsLoading(false);
    }
  }

  // Add username field to the form UI
  const renderUsernameField = () => (
    <div className="space-y-2">
      <Label htmlFor="username" className="text-primary font-medium text-sm flex items-center gap-2">
        <User className="h-4 w-4" />
        Username
      </Label>
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-hover)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
        <Input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          value={formData.username}
          onChange={e => {
            setFormData({ ...formData, username: e.target.value });
            setUsernameChecked(false);
          }}
          onBlur={async (e) => {
            const username = e.target.value.trim();
            if (!username) return;
            if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return;
            setErrors((prev) => ({ ...prev, username: "" }));
            setIsCheckingUsername(true);
            const isUnique = await checkUsernameUnique(username);
            setIsCheckingUsername(false);
            if (!isUnique) {
              setErrors((prev) => ({ ...prev, username: "Username already exists" }));
            }
          }}
          placeholder="choose_username"
          className={`relative bg-secondary/70 border-border text-primary placeholder:text-gray-600 focus:border-primary focus:ring-2 focus:ring-primary/20 h-12 transition-all font-mono font-medium ${errors.username ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
          required
        />
      </div>
      {isCheckingUsername && <div className="text-primary text-xs mt-1 font-medium">// Checking availability...</div>}
      {errors.username && <div className="text-[var(--critical)] text-xs mt-1 font-medium">// Error: {errors.username}</div>}
      {usernameChecked && !errors.username && <div className="text-primary text-xs mt-1 font-medium">// Username available ✓</div>}
    </div>
  )

  const renderUserTypeSelection = () => (
    <div className="space-y-8">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Terminal className="h-5 w-5 text-primary" />
          <h3 className="text-2xl font-black text-white tracking-tight">select_role</h3>
        </div>
        <div className="flex justify-center gap-6 mt-6">
          <button
            type="button"
            className={`group relative w-44 h-36 rounded-lg transition-all duration-300 ${
              userType === "user" 
                ? "bg-card/90 border-2 border-border shadow-lg shadow-primary/15" 
                : "bg-card/80 border-2 border-gray-700/50 hover:border-border"
            }`}
            onClick={() => handleUserTypeSelect("user")}
          >
            <div className={`absolute -inset-0.5 bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-hover)] rounded-lg opacity-0 group-hover:opacity-30 blur transition duration-300 ${userType === "user" ? "opacity-30" : ""}`} />
            <div className="relative h-full flex flex-col items-center justify-center space-y-3 p-4">
              <div className="p-3 rounded-lg bg-[var(--accent-soft)] border border-border">
                <Bug className="h-8 w-8 text-primary" />
              </div>
              <span className="text-lg font-bold text-white">Hunter</span>
              <span className="text-xs text-primary/80 font-medium">Bug Bounty Hunter</span>
            </div>
          </button>
          <button
            type="button"
            className={`group relative w-44 h-36 rounded-lg transition-all duration-300 ${
              userType === "admin" 
                ? "bg-card/90 border-2 border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)] shadow-lg shadow-[color:color-mix(in_srgb,var(--critical)_10%,transparent)]" 
                : "bg-card/80 border-2 border-gray-700/50 hover:border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]"
            }`}
            onClick={() => handleUserTypeSelect("admin")}
          >
            <div className={`absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-0 group-hover:opacity-15 blur transition duration-300 ${userType === "admin" ? "opacity-15" : ""}`} />
            <div className="relative h-full flex flex-col items-center justify-center space-y-3 p-4">
              <div className="p-3 rounded-lg bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] border border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)]">
                <ShieldCheck className="h-8 w-8 text-[var(--critical)]" />
              </div>
              <span className="text-lg font-bold text-white">Admin</span>
              <span className="text-xs text-[var(--critical)]/80 font-medium">Organization</span>
            </div>
          </button>
        </div>
      </div>

      {userType === "admin" && (
        <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
          <div className="text-center">
            <h4 className="text-sm font-bold text-primary mb-3">Admin Type</h4>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className={`group relative h-24 rounded-lg transition-all duration-300 ${
                  adminType === "student" 
                    ? "bg-card/90 border-2 border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)] shadow-lg shadow-[color:color-mix(in_srgb,var(--critical)_10%,transparent)]" 
                    : "bg-card/80 border-2 border-gray-700/50 hover:border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]"
                }`}
                onClick={() => handleAdminTypeSelect("student")}
              >
                <div className={`absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-0 group-hover:opacity-15 blur transition duration-300 ${adminType === "student" ? "opacity-15" : ""}`} />
                <div className="relative h-full flex flex-col items-center justify-center space-y-2">
                  <GraduationCap className="h-6 w-6 text-[var(--critical)]" />
                  <span className="text-xs font-bold text-white">Student</span>
                </div>
              </button>
              <button
                type="button"
                className={`group relative h-24 rounded-lg transition-all duration-300 ${
                  adminType === "company" 
                    ? "bg-card/90 border-2 border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)] shadow-lg shadow-[color:color-mix(in_srgb,var(--critical)_10%,transparent)]" 
                    : "bg-card/80 border-2 border-gray-700/50 hover:border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]"
                }`}
                onClick={() => handleAdminTypeSelect("company")}
              >
                <div className={`absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-0 group-hover:opacity-15 blur transition duration-300 ${adminType === "company" ? "opacity-15" : ""}`} />
                <div className="relative h-full flex flex-col items-center justify-center space-y-2">
                  <Building className="h-6 w-6 text-[var(--critical)]" />
                  <span className="text-xs font-bold text-white">Company</span>
                </div>
              </button>
              <button
                type="button"
                className={`group relative h-24 rounded-lg transition-all duration-300 ${
                  adminType === "firm" 
                    ? "bg-card/90 border-2 border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)] shadow-lg shadow-[color:color-mix(in_srgb,var(--critical)_10%,transparent)]" 
                    : "bg-card/80 border-2 border-gray-700/50 hover:border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]"
                }`}
                onClick={() => handleAdminTypeSelect("firm")}
              >
                <div className={`absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-0 group-hover:opacity-15 blur transition duration-300 ${adminType === "firm" ? "opacity-15" : ""}`} />
                <div className="relative h-full flex flex-col items-center justify-center space-y-2">
                  <Building className="h-6 w-6 text-[var(--critical)]" />
                  <span className="text-xs font-bold text-white">Firm</span>
                </div>
              </button>
              <button
                type="button"
                className={`group relative h-24 rounded-lg transition-all duration-300 ${
                  adminType === "individual" 
                    ? "bg-card/90 border-2 border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)] shadow-lg shadow-[color:color-mix(in_srgb,var(--critical)_10%,transparent)]" 
                    : "bg-card/80 border-2 border-gray-700/50 hover:border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]"
                }`}
                onClick={() => handleAdminTypeSelect("individual")}
              >
                <div className={`absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-0 group-hover:opacity-15 blur transition duration-300 ${adminType === "individual" ? "opacity-15" : ""}`} />
                <div className="relative h-full flex flex-col items-center justify-center space-y-2">
                  <Briefcase className="h-6 w-6 text-[var(--critical)]" />
                  <span className="text-xs font-bold text-white">Individual</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const renderFormFields = () => {
    if (!userType || (userType === "admin" && !adminType)) return null

    const labelColor = userType === "admin" ? "text-[var(--critical)]" : "text-primary";

    return (
      <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
        {/* Common fields */}
        <div className="space-y-2">
          <Label htmlFor="name" className={`${labelColor} font-medium text-sm`}>Full Name *</Label>
          <div className="relative group">
            <div className={`absolute -inset-0.5 bg-gradient-to-r ${userType === "admin" ? "from-[var(--critical)] to-[var(--high)]" : "from-[var(--accent-primary)] to-[var(--accent-hover)]"} rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300`} />
            <Input
              id="name"
              type="text"
              placeholder="John Doe"
              value={formData.name}
              onChange={(e) => handleInputChange("name", e.target.value)}
              className={`relative bg-secondary/70 ${userType === "admin" ? "border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] focus:border-[var(--critical)] focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)]" : "border-border text-primary focus:border-primary focus:ring-primary/20"} placeholder:text-gray-600 focus:ring-2 h-12 transition-all font-mono font-medium ${errors.name ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
              required
            />
          </div>
          {errors.name && <p className="text-[var(--critical)] text-xs font-medium">// Error: {errors.name}</p>}
        </div>

        {/* Company/Firm specific fields */}
        {userType === "admin" && (adminType === "company" || adminType === "firm") && (
          <>
            <div className="space-y-2">
              <Label htmlFor="companyName" className="text-[var(--critical)] font-medium text-sm">
                {adminType === "company" ? "company_name" : "firm_name"} *
              </Label>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
                <Input
                  id="companyName"
                  type="text"
                  placeholder={`Enter ${adminType} name`}
                  value={formData.companyName}
                  onChange={(e) => handleInputChange("companyName", e.target.value)}
                  className={`relative bg-secondary/70 border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] placeholder:text-gray-600 focus:border-[var(--critical)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)] h-12 transition-all font-mono font-medium ${errors.companyName ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
                  required
                />
              </div>
              {errors.companyName && <p className="text-[var(--critical)] text-xs font-medium">// Error: {errors.companyName}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="registrationNumber" className="text-[var(--critical)] font-medium text-sm">
                Employee id *
              </Label>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
                <Input
                  id="registrationNumber"
                  type="text"
                  placeholder="Employee ID"
                  value={formData.registrationNumber}
                  onChange={(e) => handleInputChange("registrationNumber", e.target.value)}
                  className={`relative bg-secondary/70 border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] placeholder:text-gray-600 focus:border-[var(--critical)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)] h-12 transition-all font-mono font-medium ${errors.registrationNumber ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
                  required
                />
              </div>
              {errors.registrationNumber && <p className="text-[var(--critical)] text-xs font-mono font-medium">// Error: {errors.registrationNumber}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="businessPhone" className="text-[var(--critical)] font-medium text-sm">
                Business Phone *
              </Label>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
                <Input
                  id="businessPhone"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={formData.businessPhone}
                  onChange={(e) => handleInputChange("businessPhone", e.target.value)}
                  className={`relative bg-secondary/70 border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] placeholder:text-gray-600 focus:border-[var(--critical)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)] h-12 transition-all font-mono font-medium ${errors.businessPhone ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
                  required
                />
              </div>
              {errors.businessPhone && <p className="text-[var(--critical)] text-xs font-medium">// Error: {errors.businessPhone}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="address" className="text-[var(--critical)] font-medium text-sm">
                {adminType === "company" ? "company_address" : "firm_address"} *
              </Label>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
                <Textarea
                  id="address"
                  placeholder="Enter complete address"
                  value={formData.address}
                  onChange={(e) => handleInputChange("address", e.target.value)}
                  className={`relative bg-secondary/70 border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] placeholder:text-gray-600 focus:border-[var(--critical)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)] transition-all font-mono font-medium ${errors.address ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
                  rows={3}
                  required
                />
              </div>
              {errors.address && <p className="text-[var(--critical)] text-xs font-medium">// Error: {errors.address}</p>}
            </div>
          </>
        )}

        {/* Student specific fields */}
        {userType === "admin" && adminType === "student" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="instituteName" className="text-[var(--critical)] font-medium text-sm">
                Institute Name *
              </Label>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
                <Input
                  id="instituteName"
                  type="text"
                  placeholder="University/College name"
                  value={formData.instituteName}
                  onChange={(e) => handleInputChange("instituteName", e.target.value)}
                  className={`relative bg-secondary/70 border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] placeholder:text-gray-600 focus:border-[var(--critical)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)] h-12 transition-all font-mono font-medium ${errors.instituteName ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
                  required
                />
              </div>
              {errors.instituteName && <p className="text-[var(--critical)] text-xs font-medium">// Error: {errors.instituteName}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="studentId" className="text-[var(--critical)] font-medium text-sm">
                Student id *
              </Label>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
                <Input
                  id="studentId"
                  type="text"
                  placeholder="Student ID or enrollment number"
                  value={formData.studentId}
                  onChange={(e) => handleInputChange("studentId", e.target.value)}
                  className={`relative bg-secondary/70 border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] placeholder:text-gray-600 focus:border-[var(--critical)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)] h-12 transition-all font-mono font-medium ${errors.studentId ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
                  required
                />
              </div>
              {errors.studentId && <p className="text-[var(--critical)] text-xs font-medium">// Error: {errors.studentId}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectName" className="text-[var(--critical)] font-medium text-sm">
                project name <span className="text-gray-600">[optional]</span>
              </Label>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
                <Input
                  id="projectName"
                  type="text"
                  placeholder="Project or research name"
                  value={formData.projectName}
                  onChange={(e) => handleInputChange("projectName", e.target.value)}
                  className="relative bg-secondary/70 border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] placeholder:text-gray-600 focus:border-[var(--critical)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)] h-12 transition-all font-mono font-medium"
                />
              </div>
            </div>
          </>
        )}

        {/* Individual specific fields */}
        {userType === "admin" && adminType === "individual" && (
          <div className="space-y-2">
            <Label htmlFor="projectStartupName" className="text-[var(--critical)] font-mono font-medium text-sm">
              project_name <span className="text-gray-600">[optional]</span>
            </Label>
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
              <Input
                id="projectStartupName"
                type="text"
                placeholder="Project or startup name"
                value={formData.projectStartupName}
                onChange={(e) => handleInputChange("projectStartupName", e.target.value)}
                className="relative bg-secondary/70 border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] placeholder:text-gray-600 focus:border-[var(--critical)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)] h-12 transition-all font-mono font-medium"
              />
            </div>
          </div>
        )}

        {/* Email field */}
        <div className="space-y-2">
          <Label htmlFor="email" className={`${labelColor} font-mono font-medium text-sm flex items-center gap-2`}>
            <Mail className="h-4 w-4" />
            {userType === "admin" && (adminType === "company" || adminType === "firm")
              ? "official_email"
              : userType === "admin" && adminType === "student"
                ? "student_email"
                : "email_address"} *
          </Label>
          <div className="relative group">
            <div className={`absolute -inset-0.5 bg-gradient-to-r ${userType === "admin" ? "from-[var(--critical)] to-[var(--high)]" : "from-[var(--accent-primary)] to-[var(--accent-hover)]"} rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300`} />
            <Input
              id="email"
              type="email"
              placeholder={
                userType === "admin" && (adminType === "company" || adminType === "firm")
                  ? "john.doe@company.com"
                  : userType === "admin" && adminType === "student"
                    ? "student@university.edu"
                    : "john.doe@example.com"
              }
              value={formData.email}
              onChange={(e) => handleInputChange("email", e.target.value)}
              className={`relative bg-secondary/70 ${userType === "admin" ? "border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] focus:border-[var(--critical)] focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)]" : "border-border text-primary focus:border-primary focus:ring-primary/20"} placeholder:text-gray-600 focus:ring-2 h-12 transition-all font-mono font-medium ${errors.email ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
              required
            />
          </div>
          {errors.email && <p className="text-[var(--critical)] text-xs font-mono font-medium">// Error: {errors.email}</p>}
        </div>

        {/* Username field (moved below email) */}
        {renderUsernameField()}

        {/* Phone field for user and individual admin */}
        {(userType === "user" || (userType === "admin" && adminType === "individual")) && (
          <div className="space-y-2">
            <Label htmlFor="phone" className={`${labelColor} font-mono font-medium text-sm`}>
              phone_number {userType === "admin" && adminType === "individual" ? "*" : "[optional]"}
            </Label>
            <div className="relative group">
              <div className={`absolute -inset-0.5 bg-gradient-to-r ${userType === "admin" ? "from-[var(--critical)] to-[var(--high)]" : "from-[var(--accent-primary)] to-[var(--accent-hover)]"} rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300`} />
              <Input
                id="phone"
                type="tel"
                placeholder="+1 (555) 123-4567"
                value={formData.phone}
                onChange={(e) => handleInputChange("phone", e.target.value)}
                className={`relative bg-secondary/70 ${userType === "admin" ? "border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] focus:border-[var(--critical)] focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)]" : "border-border text-primary focus:border-primary focus:ring-primary/20"} placeholder:text-gray-600 focus:ring-2 h-12 transition-all font-mono font-medium ${errors.phone ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
                required={userType === "admin" && adminType === "individual"}
              />
            </div>
            {errors.phone && <p className="text-[var(--critical)] text-xs font-mono font-medium">// Error: {errors.phone}</p>}
          </div>
        )}
        

        {/* Password fields */}
        <div className="space-y-2">
          <Label htmlFor="password" className={`${labelColor} font-mono font-medium text-sm flex items-center gap-2`}>
            <Lock className="h-4 w-4" />
            password_hash *
          </Label>
          <div className="relative group">
            <div className={`absolute -inset-0.5 bg-gradient-to-r ${userType === "admin" ? "from-[var(--critical)] to-[var(--high)]" : "from-[var(--accent-primary)] to-[var(--accent-hover)]"} rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300`} />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••••••"
              value={formData.password}
              onChange={(e) => handleInputChange("password", e.target.value)}
              className={`relative bg-secondary/70 ${userType === "admin" ? "border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] focus:border-[var(--critical)] focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)]" : "border-border text-primary focus:border-primary focus:ring-primary/20"} placeholder:text-gray-600 focus:ring-2 pr-12 h-12 transition-all font-mono font-medium ${errors.password ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 hover:bg-gray-900/50 rounded-lg"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? (
                <EyeOff className={`h-5 w-5 ${userType === "admin" ? "text-[var(--critical)]" : "text-primary"}`} />
              ) : (
                <Eye className={`h-5 w-5 ${userType === "admin" ? "text-[var(--critical)]" : "text-primary"}`} />
              )}
            </Button>
          </div>
          {errors.password && <p className="text-[var(--critical)] text-xs font-mono font-medium">// Error: {errors.password}</p>}
          <p className="text-gray-500 text-xs font-mono font-medium">// 8+ chars, A-Z, a-z, 0-9, special chars</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword" className={`${labelColor} font-mono font-medium text-sm flex items-center gap-2`}>
            <Lock className="h-4 w-4" />
            confirm_password *
          </Label>
          <div className="relative group">
            <div className={`absolute -inset-0.5 bg-gradient-to-r ${userType === "admin" ? "from-[var(--critical)] to-[var(--high)]" : "from-[var(--accent-primary)] to-[var(--accent-hover)]"} rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300`} />
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              placeholder="••••••••••••"
              value={formData.confirmPassword}
              onChange={(e) => handleInputChange("confirmPassword", e.target.value)}
              className={`relative bg-secondary/70 ${userType === "admin" ? "border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] focus:border-[var(--critical)] focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)]" : "border-border text-primary focus:border-primary focus:ring-primary/20"} placeholder:text-gray-600 focus:ring-2 pr-12 h-12 transition-all font-mono font-medium ${errors.confirmPassword ? "border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)]" : ""}`}
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 hover:bg-gray-900/50 rounded-lg"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              {showConfirmPassword ? (
                <EyeOff className={`h-5 w-5 ${userType === "admin" ? "text-[var(--critical)]" : "text-primary"}`} />
              ) : (
                <Eye className={`h-5 w-5 ${userType === "admin" ? "text-[var(--critical)]" : "text-primary"}`} />
              )}
            </Button>
          </div>
          {errors.confirmPassword && <p className="text-[var(--critical)] text-xs font-mono font-medium">// Error: {errors.confirmPassword}</p>}
        </div>

        {/* Supporting documents for company/firm */}
        {userType === "admin" && (adminType === "company" || adminType === "firm") && (
          <div className="space-y-2">
            <Label htmlFor="supportingDoc" className="text-[var(--critical)] font-mono font-medium text-sm">
              documents <span className="text-gray-600">[optional]</span>
            </Label>
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--critical)] to-[var(--high)] rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-300" />
              <Input
                id="supportingDoc"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={handleFileChange}
                className="relative bg-secondary/70 border-[color:color-mix(in_srgb,var(--critical)_25%,transparent)] text-[var(--critical)] file:bg-gray-800 file:text-[var(--critical)] file:border-0 file:rounded-md file:px-3 file:py-1 file:font-mono file:font-medium focus:border-[var(--critical)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--critical)_20%,transparent)]"
              />
            </div>
            <p className="text-gray-500 text-xs font-mono font-medium">// Upload GST/Tax ID, certificate, or business docs</p>
          </div>
        )}
      </div>
    )
  }

  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
        {/* Background effects */}
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-black via-gray-950 to-black" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_srgb,var(--border)_35%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--border)_35%,transparent)_1px,transparent_1px)] bg-[size:50px_50px]" />
          <div className="absolute top-20 left-10 w-96 h-96 bg-[var(--accent-soft)] rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-[var(--accent-soft)] rounded-full blur-[120px] animate-pulse" />
        </div>

        <div className="w-full max-w-md relative z-10">
          <Card className="border-border bg-background/90 backdrop-blur-xl shadow-2xl shadow-primary/10">
            {/* Terminal header */}
            <div className="h-8 bg-gradient-to-r from-gray-900 to-black border-b border-border flex items-center px-4 gap-2 rounded-t-lg">
              <div className="w-3 h-3 rounded-full bg-[color:color-mix(in_srgb,var(--critical)_10%,transparent)]0/80" />
              <div className="w-3 h-3 rounded-full bg-[var(--medium)]/80" />
              <div className="w-3 h-3 rounded-full bg-primary/80" />
              <span className="ml-2 text-xs text-primary/60 font-mono">
                system@bughuntr:~$ ./verify_email.sh
              </span>
            </div>

            <CardHeader className="space-y-1 text-center pt-8">
              <div className="flex items-center justify-center mb-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
                  <div className="relative p-4 rounded-full bg-[var(--accent-soft)] border-2 border-border">
                    <CheckCircle className="h-10 w-10 text-primary" />
                  </div>
                </div>
              </div>
              <CardTitle className="text-3xl font-black text-white font-mono">
                registration_<span className="text-primary">success</span>
              </CardTitle>
              <CardDescription className="text-gray-400 font-mono font-medium">
                Verification email sent to:
                <br />
                <span className="text-primary">{formData.email}</span>
                {userType === "admin" && (adminType === "company" || adminType === "firm") && supportingDoc && (
                  <span className="block mt-3 text-gray-400">
                    // Documents will be reviewed within 24-48 hours
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center pb-8">
              <p className="text-gray-400 text-sm font-mono font-medium">
                Check your inbox and click the verification link
              </p>
              <div className="pt-4">
                <Link 
                  href="/login" 
                  className="inline-flex items-center gap-2 text-primary hover:text-primary/85 font-mono font-bold transition-colors"
                >
                  <Terminal className="h-4 w-4" />
                  [return_to_login]
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      {/* Matrix-style cyber background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-black via-gray-950 to-black" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_srgb,var(--border)_35%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--border)_35%,transparent)_1px,transparent_1px)] bg-[size:50px_50px]" />
        
        {/* Glowing corners */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-[var(--accent-soft)] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-[var(--accent-soft)] rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] rounded-full blur-[150px]" />
        
        {/* Floating bugs */}
        {[...Array(10)].map((_, i) => (
          <Bug
            key={i}
            className="absolute text-primary/10 animate-float"
            style={{
              width: Math.random() * 25 + 15 + "px",
              height: Math.random() * 25 + 15 + "px",
              left: Math.random() * 100 + "%",
              top: Math.random() * 100 + "%",
              animationDelay: Math.random() * 10 + "s",
              animationDuration: Math.random() * 15 + 10 + "s",
            }}
          />
        ))}
      </div>

      <style jsx>{`
        @keyframes float {
          0%, 100% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 0.2;
          }
          50% {
            transform: translate(80px, -80px) rotate(180deg);
            opacity: 0.4;
          }
        }
        .animate-float {
          animation: float linear infinite;
        }
      `}</style>

      <div className="w-full max-w-md relative z-10">
        <Card className="border-border bg-background/90 backdrop-blur-xl shadow-2xl shadow-primary/10">
          {/* Terminal window header */}
          <div className="h-8 bg-gradient-to-r from-gray-900 to-black border-b border-border flex items-center px-4 gap-2 rounded-t-lg">
            <div className="w-3 h-3 rounded-full bg-[color:color-mix(in_srgb,var(--critical)_10%,transparent)]0/80" />
            <div className="w-3 h-3 rounded-full bg-[var(--medium)]/80" />
            <div className="w-3 h-3 rounded-full bg-primary/80" />
            <span className="ml-2 text-xs text-primary/60 font-mono">
          
            </span>
          </div>

          <CardHeader className="space-y-1 text-center pt-8">
            <div className="flex items-center justify-center mb-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-hover)] rounded-2xl blur-xl opacity-50 animate-pulse" />
                <div className="relative p-4 rounded-2xl bg-gradient-to-br from-[var(--accent-soft)] to-secondary border-2 border-border backdrop-blur-sm">
                  <Bug className="h-10 w-10 text-primary" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mb-2">
              <Terminal className="h-4 w-4 text-primary" />
              <CardTitle className="text-3xl font-black text-white font-mono">
                 Register<span className="text-primary">New User</span>
              </CardTitle>
            </div>
            <CardDescription className="text-gray-400 font-mono font-medium">
              {userType === "user"
                ? "Initialize hunter profile to start earning"
                : userType === "admin" && adminType === "company"
                  ? "Register company admin credentials"
                  : userType === "admin" && adminType === "firm"
                    ? "Register firm admin credentials"
                    : userType === "admin" && adminType === "student"
                      ? "Register student research profile"
                      : userType === "admin" && adminType === "individual"
                        ? "Register individual project profile"
                        : "Select your role to continue"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            {errors.general && (
              <Alert className="border-[color:color-mix(in_srgb,var(--critical)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--critical)_12%,transparent)] backdrop-blur-sm">
                <AlertCircle className="h-4 w-4 text-[var(--critical)]" />
                <AlertDescription className="text-[var(--critical)] font-mono font-medium">
                  // Error: {errors.general}
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {renderUserTypeSelection()}
              {renderFormFields()}

              {userType && (userType === "user" || (userType === "admin" && adminType)) && (
                <Button 
                  type="submit" 
                  className={`w-full text-black h-12 text-sm font-bold shadow-lg transition-all duration-300 font-mono relative overflow-hidden group ${
                    userType === "admin"
                      ? "bg-[var(--critical)] hover:bg-[color:color-mix(in_srgb,var(--critical)_85%,black)] shadow-[color:color-mix(in_srgb,var(--critical)_10%,transparent)] hover:shadow-[color:color-mix(in_srgb,var(--critical)_20%,transparent)] border border-[color:color-mix(in_srgb,var(--critical)_20%,transparent)]"
                      : "bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-hover)] hover:from-[var(--accent-hover)] hover:to-[var(--accent-primary)] shadow-primary/10 hover:shadow-primary/15 border border-border"
                  }`}
                  disabled={isLoading}
                >
                  <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  <span className="relative flex items-center justify-center gap-2">
                    {isLoading ? (
                      <>
                        <div className="h-5 w-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                        creating_account...
                      </>
                    ) : (
                      <>
                        <Terminal className="h-5 w-5" />
                        create_account
                      </>
                    )}
                  </span>
                </Button>
              )}
            </form>

            <div className="text-center border-t border-gray-800 pt-6">
              <p className="text-gray-500 text-sm font-mono font-medium">
                Already registered?{" "}
                <Link href="/login" className="text-primary hover:text-primary/85 font-bold transition-colors">
                  [login]
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <Link href="/" className="inline-flex items-center text-gray-500 hover:text-primary transition-colors group font-mono font-medium text-sm">
            <ArrowLeft className="h-4 w-4 mr-2 group-hover:-translate-x-1 transition-transform" />
            exit
          </Link>
        </div>
      </div>
    </div>
  )
}

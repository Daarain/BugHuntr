"use client"

import { useState } from "react"
import { CertificateCard } from "@/components/certificates/certificate-card"
import { CertificatePreview } from "@/components/certificates/certificate-preview"

interface CertificateItem {
  id: number;
  title: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  credentialId: string;
  skills: string[];
  verificationUrl: string;
  status: "active" | "expiring" | "expired";
}

const mockCertificates: CertificateItem[] = [
  {
    id: 1,
    title: "Web Application Security Expert",
    issuer: "CyberSec Institute",
    issueDate: "2024-01-15",
    expiryDate: "2025-01-15",
    credentialId: "WSE-2024-001247",
    skills: ["SQL Injection", "XSS", "CSRF", "Authentication Bypass"],
    verificationUrl: "https://verify.cybersec.institute/WSE-2024-001247",
    status: "active",
  },
  {
    id: 2,
    title: "API Security Specialist",
    issuer: "SecureAPI Corp",
    issueDate: "2023-11-20",
    expiryDate: "2024-11-20",
    credentialId: "API-2023-005891",
    skills: ["REST API Security", "GraphQL", "OAuth", "Rate Limiting"],
    verificationUrl: "https://verify.secureapi.corp/API-2023-005891",
    status: "expiring",
  },
  {
    id: 3,
    title: "Mobile Security Researcher",
    issuer: "MobileSec Academy",
    issueDate: "2023-08-10",
    expiryDate: "2023-08-10",
    credentialId: "MSR-2023-003456",
    skills: ["iOS Security", "Android Security", "Mobile App Testing"],
    verificationUrl: "https://verify.mobilesec.academy/MSR-2023-003456",
    status: "expired",
  },
]

export default function CertificatesPage() {
  const [selectedCertificate, setSelectedCertificate] = useState(mockCertificates[0])

  return (
    <main className="p-6 pb-20 md:pb-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 text-primary">
            My Certificates
          </h1>
          <p className="text-muted-foreground">View and download your security certifications</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-4">
            {mockCertificates.map((cert) => (
              <CertificateCard
                key={cert.id}
                certificate={cert}
                isSelected={selectedCertificate.id === cert.id}
                onClick={() => setSelectedCertificate(cert)}
              />
            ))}
          </div>

          <div className="lg:col-span-2">
            <CertificatePreview certificate={selectedCertificate} />
          </div>
        </div>
      </div>
    </main>
  )
}

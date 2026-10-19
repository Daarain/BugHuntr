// BugHuntr Pro Type Definitions

export interface ProSubscription {
  id: string;
  companyId: string;
  companyName: string;
  planType: "basic" | "premium" | "enterprise";
  status: "active" | "expired" | "suspended";
  startDate: string;
  endDate: string;
  maxProHunts: number;
  currentProHunts: number;
  features: string[];
}

export interface ProHunt {
  id: string;
  companyId: string;
  companyName: string;
  missingRequirements?: string[];
  title: string;
  description: string;
  allowedTargetSegments: string[];
  ndaTemplateId: string;
  ndaTemplateText: string;
  requireKYC: boolean;
  requireCerts: boolean;
  allowBids: boolean;
  minRank: "C" | "B" | "A" | "S";
  minHuntsParticipated: number;
  requiredCertifications: string[];
  rewards: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  maxHunters: number;
  currentHunters: number;
  status: "draft" | "active" | "paused" | "completed";
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
  inviteOnly: boolean;
  // Optional id of the user/admin who created this hunt
  createdBy?: string;
}

export interface ProInvitation {
  id: string;
  huntId: string;
  huntTitle: string;
  companyName: string;
  hunterId?: string;
  hunterName?: string;
  hunterUsername?: string;
  email?: string;
  token: string;
  invitedBy: string;
  status: "pending" | "accepted" | "declined" | "expired";
  invitedAt: string;
  expiresAt: string;
  acceptedAt?: string;
}

export interface ProApplication {
  id: string;
  huntId: string;
  huntTitle: string;
  companyName?: string;
  hunterId: string;
  hunterName: string;
  hunterRank: string;
  cover: string;
  bidAmount?: number;
  attachments: string[];
  status: "pending" | "approved" | "rejected" | "more_info_requested";
  submittedAt: string;
  reviewedAt?: string;
  reviewNotes?: string;
}

export interface ProRecommendation {
  hunterId: string;
  hunterName: string;
  hunterUsername?: string;
  score: number;
  rank: string;
  reputation: number;
  huntsParticipated: number;
  successRate: number;
  certifications: string[];
  reasonTags: string[];
  matchPercentage: number;
  isEligible?: boolean;
  missingRequirements?: string[];
}

export interface ProNDA {
  id: string;
  huntId: string;
  hunterId: string;
  hunterName: string;
  ndaText: string;
  signatureHash: string;
  signedAt: string;
  ipAddress: string;
  userAgent: string;
}

export interface ProAccessToken {
  id: string;
  token: string;
  huntId: string;
  hunterId: string;
  hunterName: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  allowedSegments: string[];
}

export interface ProOffer {
  id: string;
  huntId: string;
  huntTitle: string;
  companyId: string;
  companyName: string;
  hunterId: string;
  hunterName: string;
  offerType: "job" | "intern";
  roleTitle: string;
  roleDetails: string;
  salary?: string;
  duration?: string;
  location: string;
  status: "issued" | "accepted" | "declined" | "expired";
  issuedAt: string;
  expiresAt: string;
  acceptedAt?: string;
  declinedAt?: string;
}

export interface ProSubmission {
  id: string;
  huntId: string;
  hunterId: string;
  hunterName: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  attachments: string[];
  aiSeverity?: string;
  triageStatus: "pending" | "triaged" | "verified";
  companyReviewStatus: "pending" | "approved" | "rejected" | "duplicate";
  createdAt: string;
  reviewedAt?: string;
  reviewNotes?: string;
  pointsAwarded?: number;
}

export interface HunterEligibility {
  isEligible: boolean;
  rank: string;
  huntsParticipated: number;
  certifications: string[];
  reasons: string[];
  missingRequirements: string[];
}

export interface ProAuditLog {
  id: string;
  huntId?: string;
  hunterId?: string;
  action: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  detail: string;
}

// NDA Templates
export const NDA_TEMPLATES = [
  {
    id: "standard",
    name: "Standard NDA",
    description: "Basic non-disclosure agreement for bug hunting",
    text: `NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement ("Agreement") is entered into by and between [COMPANY_NAME] ("Company") and the undersigned security researcher ("Researcher").

1. CONFIDENTIAL INFORMATION
The Researcher agrees to keep confidential all information, data, systems, and vulnerabilities discovered during the bug hunting program.

2. OBLIGATIONS
The Researcher shall:
- Not disclose any vulnerabilities publicly before company approval
- Not access or modify data beyond what is necessary for testing
- Report all findings through official channels only
- Delete all confidential information upon program completion

3. TERM
This agreement remains in effect for the duration of the bug hunt and 12 months thereafter.

4. LEGAL REMEDY
Breach of this agreement may result in legal action and permanent ban from the platform.

By signing below, the Researcher acknowledges understanding and agreement to these terms.`,
  },
  {
    id: "enterprise",
    name: "Enterprise NDA",
    description: "Comprehensive NDA for sensitive enterprise systems",
    text: `ENTERPRISE NON-DISCLOSURE AGREEMENT

This Enterprise Non-Disclosure Agreement ("Agreement") is entered into by and between [COMPANY_NAME] ("Company") and the undersigned security researcher ("Researcher").

1. SCOPE OF CONFIDENTIALITY
All information, including but not limited to: system architecture, source code, customer data, business processes, and security vulnerabilities shall be considered strictly confidential.

2. RESTRICTED ACTIONS
The Researcher explicitly agrees to:
- Test only designated systems and segments
- Not attempt privilege escalation beyond approved scope
- Not exfiltrate any data from company systems
- Not use automated scanners without explicit permission
- Not engage in social engineering of company employees

3. DATA HANDLING
- All evidence must be encrypted before transmission
- Screenshots and logs must be stored securely
- All testing artifacts must be destroyed within 30 days of program end

4. INTELLECTUAL PROPERTY
All findings and methodologies developed during testing remain the intellectual property of the Company.

5. LEGAL CONSEQUENCES
Unauthorized disclosure or breach may result in:
- Immediate termination from program
- Legal prosecution under applicable laws
- Financial liability for damages
- Permanent platform ban

6. TERM AND TERMINATION
This agreement is effective immediately upon signature and remains binding for 24 months post-completion.

By signing below, the Researcher acknowledges full understanding and binding agreement to all terms.`,
  },
  {
    id: "fintech",
    name: "FinTech NDA",
    description: "Specialized NDA for financial services and payment systems",
    text: `FINANCIAL SERVICES NON-DISCLOSURE AGREEMENT

This Financial Services NDA ("Agreement") is between [COMPANY_NAME] ("Company") and the security researcher ("Researcher").

1. FINANCIAL DATA CONFIDENTIALITY
Researcher acknowledges that testing involves highly sensitive financial data and payment systems subject to regulatory compliance (PCI-DSS, SOC 2, etc.).

2. STRICT PROHIBITIONS
Researcher shall NOT:
- Access real customer financial data or payment information
- Attempt unauthorized transactions or fund transfers
- Test production payment systems without explicit approval
- Disclose any information about financial controls or security measures

3. REGULATORY COMPLIANCE
Researcher agrees to comply with all applicable financial regulations including but not limited to:
- Payment Card Industry Data Security Standard (PCI-DSS)
- General Data Protection Regulation (GDPR)
- Financial Industry Regulatory Authority (FINRA) guidelines

4. BACKGROUND VERIFICATION
Company reserves the right to conduct background checks and verify researcher identity.

5. MANDATORY REPORTING
Any discovery of actual fraud, data breaches, or regulatory violations must be reported immediately and confidentially to designated company security contact.

6. LIQUIDATED DAMAGES
Breach of this agreement may result in liquidated damages of $100,000 USD in addition to any actual damages incurred.

7. DURATION
This agreement remains in effect perpetually for financial data confidentiality, and 36 months for other provisions.

Researcher signature below constitutes legally binding acceptance of these terms.`,
  },
];

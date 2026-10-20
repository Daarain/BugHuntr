# CVSS System Architecture & Demo Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         🎯 CVSS IMPLEMENTATION                               │
│                    Complete System with Interactive Demo                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│                              📱 FRONTEND LAYER                                 │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐  │
│  │   CVSS DEMO PAGE    │  │  ADMIN DASHBOARDS    │  │  TRIAGE COMPONENTS │  │
│  │  /cvss-demo         │  │  /admin/cve-requests │  │  TriageCvssEditor  │  │
│  ├─────────────────────┤  ├──────────────────────┤  ├────────────────────┤  │
│  │ • Vector Builder    │  │ • CVE Requests       │  │ • Metric Dropdowns │  │
│  │ • Live Calculator   │  │ • Status Tracking    │  │ • Live Scoring     │  │
│  │ • Examples (5)      │  │ • Bulk Actions       │  │ • Audit Trail      │  │
│  │ • Reward Estimator  │  │ • Filtering          │  │ • Approval Buttons │  │
│  │ • Scoring Guide     │  │                      │  │                    │  │
│  └─────────────────────┘  └──────────────────────┘  └────────────────────┘  │
│           │                         │                         │              │
│           └─────────────────────────┼─────────────────────────┘              │
│                                     │                                        │
└─────────────────────────────────────┼────────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              🔗 HOOKS LAYER                                    │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌──────────────────┐   ┌─────────────────────┐   ┌────────────────────┐    │
│  │   use-auth       │   │  use-vulnerability  │   │  use-payout        │    │
│  ├──────────────────┤   ├─────────────────────┤   ├────────────────────┤    │
│  │ • Firebase Auth  │   │ • Vuln Data         │   │ • Reward Calc      │    │
│  │ • Custom Claims  │   │ • CVSS Data         │   │ • Tier Mapping     │    │
│  │ • Role/Org       │   │ • Real-time Updates │   │ • Payout Status    │    │
│  └──────────────────┘   └─────────────────────┘   └────────────────────┘    │
│           │                         │                         │              │
│           └─────────────────────────┼─────────────────────────┘              │
│                                     │                                        │
└─────────────────────────────────────┼────────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                          ⚡ CLOUD FUNCTIONS LAYER                              │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        CVSS ENGINE (cvssEngine.ts)                      │ │
│  ├─────────────────────────────────────────────────────────────────────────┤ │
│  │ • parseVectorString(vector) → CvssVector                               │ │
│  │ • computeBaseScore(vector) → number (0.0-10.0)                         │ │
│  │ • vectorToString(vector) → string                                       │ │
│  │ • suggestVectorFromSubmission(metadata) → CvssVector                   │ │
│  │ • validateVectorString(vector) → boolean                                │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                        │
│                                      ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                  BUGHUNTR SCORING (bughuntrScoring.ts)                  │ │
│  ├─────────────────────────────────────────────────────────────────────────┤ │
│  │ • computeBugHuntrScore(cvss, factors) → score                           │ │
│  │ • getDefaultScoringFactors(assetType) → multipliers                     │ │
│  │ • adjustForExploitability(score, level) → adjusted                      │ │
│  │ • adjustForProofOfConcept(score, hasPoC) → adjusted                     │ │
│  │ • mapScoreToRewardTier(score) → tier                                    │ │
│  │ • computeRewardAmount(score, policy) → $$$                              │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                        │
│                                      ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                       HTTP CALLABLE FUNCTIONS                            │ │
│  ├─────────────────────────────────────────────────────────────────────────┤ │
│  │ • createSuggestedCvss(submissionId)                                     │ │
│  │ • approveCvssVector(vulnId, vector, notes, finalSignOff)                │ │
│  │ • requestCveAssignment(vulnId)                                          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                        │
└──────────────────────────────────────┼────────────────────────────────────────┘
                                       │
                                       ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                          🗄️  FIRESTORE DATABASE                               │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐   │
│  │  vulnerabilities/  │  │   cve_requests/     │  │    payouts/         │   │
│  ├────────────────────┤  ├─────────────────────┤  ├─────────────────────┤   │
│  │ • id               │  │ • id                │  │ • id                │   │
│  │ • submissionId     │  │ • vulnId            │  │ • vulnId            │   │
│  │ • suggestedVector  │  │ • requestedBy       │  │ • amount            │   │
│  │ • currentVector    │  │ • status            │  │ • tier              │   │
│  │ • cvssBase         │  │ • cveId             │  │ • status            │   │
│  │ • bughuntrScore    │  │ • assignedAt        │  │                     │   │
│  │ • status           │  │                     │  │                     │   │
│  │ • assetType        │  │                     │  │                     │   │
│  │ • multiplier       │  │                     │  │                     │   │
│  │                    │  │                     │  │                     │   │
│  │  ↳ audit/ (sub)    │  │                     │  │                     │   │
│  │    • action        │  │                     │  │                     │   │
│  │    • actorUid      │  │                     │  │                     │   │
│  │    • timestamp     │  │                     │  │                     │   │
│  │    • oldVector     │  │                     │  │                     │   │
│  │    • newVector     │  │                     │  │                     │   │
│  └────────────────────┘  └─────────────────────┘  └─────────────────────┘   │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
                              📊 DATA FLOW DIAGRAM
═══════════════════════════════════════════════════════════════════════════════

┌──────────────────────────────────────────────────────────────────────────────┐
│                          COMPLETE WORKFLOW                                    │
└──────────────────────────────────────────────────────────────────────────────┘

  1. BUG SUBMISSION
     │
     ├─► Security Researcher submits vulnerability
     │   • /submit page
     │   • Provides: title, description, type, affected asset
     │
     ▼
  2. AUTO-GENERATION
     │
     ├─► Cloud Function: createSuggestedCvss()
     │   • Reads submission metadata
     │   • Calls suggestVectorFromSubmission()
     │   • Heuristic analysis (SQL Injection → AV:N/AC:L/...)
     │   • Computes CVSS base score
     │   • Applies asset multiplier
     │   • Creates vulnerability document
     │   • Status: 'triage_pending'
     │
     ▼
  3. TRIAGE REVIEW
     │
     ├─► Triager opens /admin/vulnerability/[vulnId]
     │   • Sees suggested vector
     │   • Reviews TriageCvssEditor component
     │   • Can edit any metric via dropdowns
     │   • Sees live score recalculation
     │   • Reviews BugHuntr score breakdown
     │   • Adds approval notes
     │
     ▼
  4. CVSS APPROVAL
     │
     ├─► Cloud Function: approveCvssVector()
     │   • Validates vector string
     │   • Computes final base score
     │   • Applies business multipliers
     │   • Updates vulnerability document
     │   • Creates audit entry (immutable)
     │   • Status: 'cvss_approved'
     │
     ▼
  5. REWARD DECISION
     │
     ├─► System calculates reward tier
     │   • Maps BugHuntr score to tier
     │   • CRITICAL: 9.0+ → $5,000+
     │   • HIGH: 7.0-8.9 → $2,500+
     │   • MEDIUM: 4.0-6.9 → $1,000+
     │   • LOW: 1.0-3.9 → $500+
     │   • Creates payout record
     │   • Status: 'reward_decided'
     │
     ▼
  6. CVE ELIGIBILITY
     │
     ├─► Admin reviews /admin/cve-requests
     │   • Filters: CVSS ≥ 7.0
     │   • Reviews approved vulnerabilities
     │   • Checks CVE criteria
     │   • Decides to request CVE
     │
     ▼
  7. CVE REQUEST
     │
     ├─► Cloud Function: requestCveAssignment()
     │   • Creates CVE request document
     │   • Populates CVE form data
     │   • Status: 'pending'
     │   • (Manual) Submit to CVE Program
     │   • Updates status: 'submitted'
     │
     ▼
  8. CVE ASSIGNMENT
     │
     └─► CVE Program assigns ID
         • CVE-2025-XXXXX
         • Updates cveId in vulnerability
         • Updates cveId in request
         • Status: 'assigned'
         • Public disclosure


═══════════════════════════════════════════════════════════════════════════════
                            🎯 DEMO SYSTEM FLOW
═══════════════════════════════════════════════════════════════════════════════

┌──────────────────────────────────────────────────────────────────────────────┐
│                         INTERACTIVE DEMO USAGE                                │
└──────────────────────────────────────────────────────────────────────────────┘

  USER JOURNEY:

  1. User visits /cvss-demo
     │
     ├─► Lands on Vector Calculator tab
     │   • Sees default vector (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H)
     │   • Sees base score: 9.8 (CRITICAL)
     │   • Sees BugHuntr score: 10.8 (with PoC)
     │   • Sees reward estimate: $5,000+
     │
     ▼
  2. User adjusts metrics
     │
     ├─► Changes Attack Vector: N → L (Network → Local)
     │   • Score drops: 9.8 → 7.8
     │   • Severity changes: CRITICAL → HIGH
     │   • Reward tier: CRITICAL → HIGH
     │   • Estimate: $5,000+ → $2,500+
     │   • Vector updates: CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
     │
     ▼
  3. User explores asset types
     │
     ├─► Selects "Payment System" (2.0x multiplier)
     │   • BugHuntr score: 7.8 × 2.0 = 15.6
     │   • Tier: CRITICAL (due to multiplier)
     │   • Estimate: $10,000+ (org policy)
     │
     ▼
  4. User tries examples
     │
     ├─► Clicks "Example Vulnerabilities" tab
     │   • Sees 5 pre-loaded vulns
     │   • Clicks "SQL Injection in Login Form"
     │   • Vector loads: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H
     │   • Score: 10.0 (CRITICAL)
     │   • Description and details populate
     │
     ▼
  5. User learns methodology
     │
     ├─► Clicks "Scoring Breakdown" tab
     │   • Sees Exploitability metrics
     │   • Sees Impact metrics
     │   • Reads formula explanation
     │   • Understands BugHuntr multipliers
     │
     ▼
  6. User reviews rewards
     │
     └─► Clicks "Reward Mapping" tab
         • Sees tier ranges
         • Reviews CVE eligibility
         • Links to admin dashboards
         • Learns about CVE process


═══════════════════════════════════════════════════════════════════════════════
                          🔧 TECHNICAL ARCHITECTURE
═══════════════════════════════════════════════════════════════════════════════

┌──────────────────────────────────────────────────────────────────────────────┐
│                        COMPONENT RELATIONSHIPS                                │
└──────────────────────────────────────────────────────────────────────────────┘

  cvss-demo/page.tsx
    │
    ├─► Uses: React hooks (useState, useEffect)
    ├─► Uses: shadcn/ui components
    ├─► Uses: lucide-react icons
    ├─► Implements: Client-side CVSS calculation
    │   • parseVectorString() logic (local)
    │   • computeBaseScore() logic (local)
    │   • calculateImpact() (local)
    │   • calculateExploitability() (local)
    │
    └─► NO server dependencies (fully client-side)

  admin/cve-requests/page.tsx
    │
    ├─► Imports: useAuth from @/hooks/use-auth
    ├─► Imports: db from @/firebaseConfig
    ├─► Imports: Firestore functions
    ├─► Fetches: Real-time CVE request data
    │
    └─► Calls: requestCveAssignment() Cloud Function

  admin/vulnerability/[vulnId]/page.tsx
    │
    ├─► Imports: useAuth from @/hooks/use-auth
    ├─► Imports: TriageCvssEditor component
    ├─► Fetches: Vulnerability document from Firestore
    ├─► Fetches: Audit trail subcollection
    │
    └─► Passes props to TriageCvssEditor

  components/triage/TriageCvssEditor.tsx
    │
    ├─► Receives: Props from parent
    ├─► Manages: Local vector state
    ├─► Renders: Metric dropdowns
    ├─► Calculates: Live scores
    │
    └─► Calls: onApprove() callback → approveCvssVector()

  hooks/use-auth.ts
    │
    ├─► Imports: Firebase Auth
    ├─► Imports: auth from @/firebaseConfig
    ├─► Listens: onAuthStateChanged
    ├─► Fetches: Custom claims from ID token
    │
    └─► Returns: { user, loading, error }

  functions/src/cvss/cvssEngine.ts
    │
    ├─► Exports: Pure functions (no side effects)
    ├─► Implements: NIST CVSS v3.1 spec
    ├─► Validates: Vector strings
    ├─► Parses: String to object
    │
    └─► Used by: bughuntrScoring.ts, Cloud Functions

  functions/src/cvss/bughuntrScoring.ts
    │
    ├─► Imports: cvssEngine.ts
    ├─► Implements: Business logic
    ├─► Applies: Multipliers
    ├─► Maps: Scores to tiers
    │
    └─► Used by: Cloud Functions, Components


═══════════════════════════════════════════════════════════════════════════════
                            📈 SCORING EXAMPLES
═══════════════════════════════════════════════════════════════════════════════

Example 1: CRITICAL SQL INJECTION (Payment System)
┌─────────────────────────────────────────────────────────────────────────────┐
│ Vector: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H                        │
│ CVSS Base Score: 10.0 (CRITICAL)                                            │
│ Asset Type: payment_system (2.0x)                                           │
│ PoC Available: Yes (+10%)                                                   │
│ BugHuntr Score: 10.0 × 2.0 × 1.1 = 22.0                                     │
│ Reward Tier: CRITICAL                                                       │
│ Estimated Payout: $10,000+                                                  │
│ CVE Eligible: ✅ YES (score ≥ 7.0)                                          │
└─────────────────────────────────────────────────────────────────────────────┘

Example 2: MEDIUM XSS (Web App)
┌─────────────────────────────────────────────────────────────────────────────┐
│ Vector: CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N                        │
│ CVSS Base Score: 5.4 (MEDIUM)                                               │
│ Asset Type: web_app (1.0x)                                                  │
│ PoC Available: Yes (+10%)                                                   │
│ BugHuntr Score: 5.4 × 1.0 × 1.1 = 5.9                                       │
│ Reward Tier: MEDIUM                                                         │
│ Estimated Payout: $1,000+                                                   │
│ CVE Eligible: ❌ NO (score < 7.0)                                           │
└─────────────────────────────────────────────────────────────────────────────┘

Example 3: HIGH RCE (API, No PoC)
┌─────────────────────────────────────────────────────────────────────────────┐
│ Vector: CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H                        │
│ CVSS Base Score: 8.8 (HIGH)                                                 │
│ Asset Type: api (1.2x)                                                      │
│ PoC Available: No (1.0x)                                                    │
│ BugHuntr Score: 8.8 × 1.2 × 1.0 = 10.6                                      │
│ Reward Tier: CRITICAL                                                       │
│ Estimated Payout: $5,000+                                                   │
│ CVE Eligible: ✅ YES (score ≥ 7.0)                                          │
└─────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
                               📚 FILES CREATED
═══════════════════════════════════════════════════════════════════════════════

DEMO SYSTEM (NEW):
  ✅ app/cvss-demo/page.tsx (900+ LOC)
  ✅ docs/CVSS_DEMO_GUIDE.md (400+ lines)
  ✅ docs/CVSS_QUICK_REFERENCE_CARD.md (350+ lines)
  ✅ CVSS_FILE_INDEX.md (complete index)
  ✅ CVSS_COMPLETE_SUMMARY.md (this file)

HOOKS (NEW):
  ✅ hooks/use-auth.ts (authentication hook)
  ✅ hooks/use-auth.d.ts (type declarations)
  ✅ hooks/index.ts (barrel exports)

NAVIGATION (UPDATED):
  ✅ components/navigation/sidebar.tsx (added CVSS Demo link)

TOTAL NEW/UPDATED: 9 files in this session
TOTAL SYSTEM: 28 files (6,200+ LOC)


═══════════════════════════════════════════════════════════════════════════════
                            ✅ COMPLETION STATUS
═══════════════════════════════════════════════════════════════════════════════

✅ CVSS v3.1 Engine          - COMPLETE
✅ BugHuntr Scoring          - COMPLETE
✅ Cloud Functions           - COMPLETE
✅ Admin Dashboards          - COMPLETE
✅ Triage Components         - COMPLETE
✅ Interactive Demo          - COMPLETE ⭐
✅ Documentation Suite       - COMPLETE ⭐
✅ Unit Tests                - COMPLETE
✅ Integration Tests         - COMPLETE
✅ Security Rules            - COMPLETE
✅ TypeScript Types          - COMPLETE
✅ Responsive Design         - COMPLETE
✅ Navigation Integration    - COMPLETE ⭐

═══════════════════════════════════════════════════════════════════════════════

                    🎉 SYSTEM READY FOR PRODUCTION USE! 🎉

═══════════════════════════════════════════════════════════════════════════════
```

# BugHuntr Pro - Implementation Documentation

## Overview

BugHuntr Pro is a premium, invite-only extension to the BugHuntr platform designed for companies with sensitive applications that require elite security researchers. This implementation provides a complete prototype with frontend components, mock data, and business logic.

## Features Implemented

### ✅ Core Features

1. **Invite-Only Pro Hunts**

   - Companies can create private bug hunts with scope restrictions
   - Invitation system for direct hunter selection
   - Application system for public Pro hunts (optional)

2. **Hunter Eligibility System**

   - Rank-based requirements (C, B, A, S)
   - Minimum hunts participated threshold
   - Certification verification
   - Real-time eligibility checking

3. **AI-Powered Recommendations**

   - Deterministic scoring algorithm based on:
     - Hunter rank (40% weight)
     - Reputation (25% weight)
     - Experience/hunts participated (20% weight)
     - Success rate (10% weight)
     - Certification match (5% weight)
   - Ranked recommendations with reason tags

4. **NDA Management**

   - Multiple NDA templates (Standard, Enterprise, FinTech)
   - Digital signature with hash generation
   - Immutable acceptance records
   - Company-specific NDA customization

5. **Subscription System**

   - Three tiers: Basic, Premium, Enterprise
   - Usage tracking (Pro hunts created vs. limit)
   - Feature-based access control
   - Mock payment integration ready

6. **Talent Pipeline**

   - Job and internship offer system
   - Offer management (issue, accept, decline)
   - Performance-based recruitment
   - Expiration tracking

7. **Access Control**

   - Scoped access tokens (JWT-based mock)
   - Target segment restrictions
   - Time-limited access
   - Token revocation support

8. **🆕 Role-Based Views** _(New in v2.0)_
   - **Dual Role System**: Admin/User + Company/Hunter
   - **4 Role Combinations**: Each with distinct permissions and UI
   - **Permission-Based Access**: Granular control over features
   - **Dynamic Navigation**: Interface adapts to user role
   - **Development Tools**: Role switcher for easy testing
   - 📖 **[Full Documentation](./ROLE_BASED_VIEWS_README.md)**

## Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript
- **Styling**: Tailwind CSS with custom Pro theme
- **State Management**: React Hooks + Custom Hooks
- **UI Components**: Radix UI + shadcn/ui
- **Icons**: Lucide React
- **Notifications**: Sonner (toast)
- **Animations**: Framer Motion

## Project Structure

```
/app
├── .env.local                          # Environment configuration
├── app/
│   └── pro/                           # Pro pages
│       ├── page.tsx                   # Pro dashboard
│       ├── hunts/
│       │   ├── page.tsx              # Browse Pro hunts
│       │   └── create/
│       │       └── page.tsx          # Create Pro hunt wizard
│       ├── applications/
│       │   └── page.tsx              # Application management
│       └── invite/
│           └── page.tsx              # Accept invitation (future)
├── components/
│   └── pro/                          # Pro components
│       ├── index.ts                  # Component exports
│       ├── pro-badge.tsx            # PRO badge indicator
│       ├── pro-hunt-wizard.tsx      # 4-step hunt creation
│       ├── pro-hunt-card.tsx        # Hunt display card
│       ├── pro-recommendations-panel.tsx  # AI recommendations
│       ├── pro-eligibility-card.tsx  # Eligibility status
│       ├── pro-apply-modal.tsx      # Application form
│       ├── pro-nda-modal.tsx        # NDA signature
│       ├── pro-access-card.tsx      # Access token display
│       ├── pro-offers-panel.tsx     # Job/intern offers
│       └── pro-subscription-card.tsx # Subscription info
├── hooks/
│   ├── use-pro-hunts.ts             # Pro hunt operations
│   ├── use-pro-recommendations.ts    # Recommendation generator
│   ├── use-pro-applications.ts      # Application management
│   ├── use-pro-eligibility.ts       # Eligibility checker
│   └── use-pro-subscription.ts      # Subscription management
├── lib/
│   └── pro-utils.ts                 # Utility functions
├── types/
│   └── pro.ts                       # TypeScript definitions
└── data/
    └── mock-pro-data.ts            # Mock data for prototype
```

## Key Components

### 1. ProHuntWizard

4-step wizard for creating Pro hunts:

- Step 1: Basic Information (title, description, segments)
- Step 2: Hunter Requirements (rank, experience, certs)
- Step 3: NDA & Security (template selection)
- Step 4: Rewards & Timeline (bounties, dates)

### 2. ProRecommendationsPanel

Displays AI-generated hunter recommendations:

- Ranked by match score
- Visual score indicators
- Reason tags explaining match
- One-click invitation

### 3. ProHuntCard

Premium hunt display with:

- PRO badge and invite-only indicator
- Reward breakdown
- Eligibility indicators
- Apply/View actions

### 4. ProEligibilityCard

Shows hunter's eligibility status:

- Current stats (rank, hunts, certs)
- Requirements met/missing
- Visual indicators

## Hooks & Business Logic

### useProHunts

Manages Pro hunt CRUD operations:

```typescript
const { proHunts, createProHunt, updateProHunt, deleteProHunt } = useProHunts();
```

### useProRecommendations

Generates hunter recommendations:

```typescript
const { generateRecommendations, loading } = useProRecommendations();
const recommendations = await generateRecommendations(
  huntId,
  minRank,
  minHunts,
  requiredCerts
);
```

### useProEligibility

Checks hunter eligibility:

```typescript
const { checkHunterEligibility } = useProEligibility();
const eligibility = checkHunterEligibility(
  rank,
  huntsParticipated,
  certifications,
  minRank,
  minHunts,
  requiredCerts
);
```

## Utility Functions

### Scoring Algorithm

```typescript
calculateHunterScore(
  rank, // 40% weight
  reputation, // 25% weight
  hunts, // 20% weight
  successRate, // 10% weight
  certs // 5% weight
);
```

### Eligibility Check

```typescript
checkEligibility(
  currentRank,
  currentHunts,
  currentCerts,
  requiredRank,
  requiredHunts,
  requiredCerts
) => HunterEligibility
```

## Environment Configuration

```bash
# .env.local
NEXT_PUBLIC_BUGHUNTR_PRO=true
NEXT_PUBLIC_DOC_VERIFICATION_URL=http://localhost:8000
```

## Feature Flag Control

Pro features are controlled via environment variable:

```typescript
const proEnabled = process.env.NEXT_PUBLIC_BUGHUNTR_PRO === "true";
```

To enable/disable:

1. Update `.env.local`
2. Restart development server
3. Pro link appears/disappears in navigation

## NDA Templates

Three pre-configured templates:

1. **Standard** - Basic non-disclosure for standard hunts
2. **Enterprise** - Comprehensive NDA for enterprise systems
3. **FinTech** - Specialized NDA for financial services (includes PCI-DSS, GDPR compliance)

## Mock Data

All Pro features use mock data during prototype phase:

- **10 Mock Hunters** - Various ranks, experience, certifications
- **3 Pro Hunts** - Different companies, requirements, rewards
- **2 Subscriptions** - Premium & Enterprise plans
- **2 Applications** - Different statuses
- **2 Offers** - Job & Internship

Mock data located in `/data/mock-pro-data.ts`

## Integration Points

### Document Verification (Ready)

Pro integrates with existing `Doc-Verification.py`:

- KYC document upload
- Certification verification
- OCR and validation

### Firebase (Ready for Implementation)

When moving to production:

1. Create Firestore collections as defined in types
2. Replace mock hooks with real Firebase operations
3. Implement Cloud Functions for server-side logic
4. Add Storage rules for encrypted uploads

### Stripe (Ready for Implementation)

Subscription purchase flow stubbed:

```typescript
const { purchaseSubscription } = useProSubscription();
await purchaseSubscription(companyId, companyName, "premium");
```

## User Flows

### Company Flow

1. Purchase Pro subscription
2. Create Pro hunt via wizard
3. Generate hunter recommendations
4. Review and send invitations
5. Review applications (if open)
6. Approve hunters
7. Issue offers based on performance

### Hunter Flow

1. Check Pro eligibility
2. Browse Pro hunts
3. Apply to open hunts OR accept invitation
4. Sign NDA
5. Receive access token
6. Submit vulnerability reports
7. Receive job/intern offers

## Styling & Theme

Pro features use premium visual indicators:

- **Colors**: Amber/Gold (#f59e0b) + Purple (#a855f7)
- **Gradients**: from-amber-500 to-purple-600
- **Badges**: Crown icon + "PRO" text
- **Borders**: Glowing amber borders for Pro cards
- **Backgrounds**: Subtle gradient overlays

## Testing Checklist

- [ ] Pro dashboard loads correctly
- [ ] Navigation shows Pro link when enabled
- [ ] Browse Pro hunts page displays mock hunts
- [ ] Eligibility card shows correct status
- [ ] Apply modal opens and validates input
- [ ] NDA modal displays template correctly
- [ ] Recommendations generate with scores
- [ ] Applications page shows user applications
- [ ] Pro hunt wizard completes all steps
- [ ] Subscription card displays plan details

## Next Steps (Production)

1. **Firebase Setup**

   - Create Firestore collections
   - Set up Storage buckets
   - Implement security rules
   - Deploy Cloud Functions

2. **Authentication**

   - Add custom claims for Pro access
   - Implement role-based access control
   - Add company verification

3. **Payment Integration**

   - Integrate Stripe for subscriptions
   - Implement webhook handlers
   - Add billing management

4. **Real AI Integration** (Optional)

   - Replace deterministic scoring with ML model
   - Integrate OpenAI/Anthropic for advanced matching
   - Add natural language processing for applications

5. **Email System**

   - Set up Firebase Email Extensions
   - Create invitation email templates
   - Add notification system

6. **KYC Enhancement**

   - Full integration with Doc-Verification.py
   - Add certification verification API
   - Implement identity verification flow

7. **Access Control**

   - Implement real JWT token generation
   - Add token validation middleware
   - Set up proxy for scoped access

8. **Audit System**
   - Log all Pro actions to Firestore
   - Create audit dashboard
   - Add compliance reports

## Configuration

### Enabling Pro

```typescript
// .env.local
NEXT_PUBLIC_BUGHUNTR_PRO = true;
```

### Customizing Scoring Weights

Edit `/lib/pro-utils.ts`:

```typescript
// Rank contribution (40%)
score += (RANK_SCORES[rank] || 0) * 0.4;

// Reputation contribution (25%)
score += (reputation / 5) * 25;

// Experience contribution (20%)
score += Math.min(huntsParticipated / 100, 1) * 20;

// Success rate contribution (10%)
score += successRate * 10;

// Certification match (5%)
score += certMatch * 5;
```

### Adding NDA Templates

Edit `/types/pro.ts`:

```typescript
export const NDA_TEMPLATES = [
  {
    id: "custom",
    name: "Custom Template",
    description: "Your custom NDA",
    text: `NDA text here...`,
  },
];
```

## Performance Considerations

- **Code Splitting**: Pro pages are lazy-loaded
- **Mock Data**: Only loads when accessed
- **Memoization**: Complex calculations use useMemo
- **Optimistic Updates**: UI updates before API response

## Security Notes

- All NDA signatures generate cryptographic hashes
- Access tokens are time-limited (24h default)
- Sensitive data should be encrypted client-side before upload
- All Pro operations should be logged for audit

## Support & Maintenance

For issues or questions about BugHuntr Pro:

1. Check this documentation
2. Review mock data in `/data/mock-pro-data.ts`
3. Inspect component props and types
4. Test with different mock hunter profiles

## License

BugHuntr Pro is part of the BugHuntr platform.

---

**Version**: 1.0.0 (Prototype)  
**Last Updated**: January 2025  
**Status**: Ready for Testing & Production Implementation

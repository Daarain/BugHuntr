# CVSS & CVE Workflow - Quick Reference Guide

## 🚀 Get Started in 5 Minutes

### 1. Understand the Data Flow

```
Bug Submission
       ↓
Auto-Suggest CVSS (heuristic analysis)
       ↓
Triager Reviews & Approves CVSS
       ↓
Auto-Decide Reward Tier & Create Payout
       ↓
Optional: Request CVE Assignment
       ↓
Complete!
```

### 2. Key CVSS Metrics (Just Know These)

| Metric                       | What It Means                 | Values                                                      |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------- |
| **AV** (Attack Vector)       | How can attacker reach it?    | Network (worst), Adjacent, Local (best)                     |
| **AC** (Attack Complexity)   | How hard to exploit?          | Low (easy), High (hard)                                     |
| **PR** (Privileges Required) | Need admin?                   | None (easy), Low, High (hard)                               |
| **UI** (User Interaction)    | User click required?          | None (worse), Required                                      |
| **S** (Scope)                | Does it affect other systems? | Changed (worse), Unchanged                                  |
| **C/I/A** (Impact)           | What's affected?              | None, Low, High (on Confidentiality/Integrity/Availability) |

**Example**: RCE vulnerability = `AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H` = **10.0 CRITICAL**

### 3. Reward Tiers

| Score   | Tier        | Multiplier | Example                    |
| ------- | ----------- | ---------- | -------------------------- |
| 9.0+    | 🔴 CRITICAL | 2.0x       | $200 base × 2.0 = **$400** |
| 7.0-8.9 | 🟠 HIGH     | 1.5x       | $200 × 1.5 = **$300**      |
| 4.0-6.9 | 🟡 MEDIUM   | 1.0x       | $200 × 1.0 = **$200**      |
| < 4.0   | ⚪ LOW      | —          | **Auto-Rejected**          |

### 4. Quick Links

**Dashboards**:

- Triage: `/admin/vulnerability/:vulnId` (edit CVSS & approve)
- CVE Requests: `/admin/cve-requests` (track CVE assignments)

**Key Files**:

- CVSS Engine: `functions/src/cvss/cvssEngine.ts` (base score logic)
- Scoring: `functions/src/cvss/bughuntrScoring.ts` (reward tier mapping)
- Editor Component: `components/triage/TriageCvssEditor.tsx` (triager UI)

**Documentation**:

- Full Overview: `docs/CVSS_AND_CVE_README.md`
- Deployment: `docs/DEPLOYMENT_GUIDE.md`
- Data Schema: `docs/CVSS_FIRESTORE_SCHEMA.md`

---

## 🎯 Common Tasks

### For Triagers

**Approving a CVSS Vector**:

1. Go to `/admin/vulnerability/BH-VULN-xxx`
2. Click "CVSS & Triage" tab
3. View suggested vector (auto-generated from submission)
4. Edit metrics if needed (dropdowns)
5. Watch live score update
6. Enter notes (optional)
7. Click "Sign Off" → Confirm

**Requesting CVE**:

1. After CVSS is approved, click "Request CVE Assignment"
2. Add notes (optional)
3. Click "Request CVE"
4. CVE request created (status: requested)

**Tracking CVE Status**:

1. Go to `/admin/cve-requests`
2. Filter by status (Requested, CNA Acknowledged, CVE Assigned, Public)
3. Click "Update" on a request
4. Change status (e.g., CNA Acknowledged → CVE Assigned)
5. If assigning, enter CVE ID (e.g., CVE-2025-12345)
6. Save

### For Developers

**Testing CVSS Calculation Locally**:

```bash
cd functions
pnpm test -- cvssEngine.test.ts  # Run CVSS tests
pnpm test -- bughuntrScoring.test.ts  # Run scoring tests
```

**Checking Vector Format**:

```
Valid:   CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H ✅
Invalid: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H ❌ (missing A)
Invalid: AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H ❌ (missing prefix)
```

**Calling Cloud Functions**:

```typescript
// From Next.js component
const response = await fetch("/api/functions/cvss/approveCvss", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    vulnId: "BH-VULN-xxx",
    cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
    triageNotes: "Confirmed critical vulnerability",
    finalSignOff: true,
  }),
});
```

### For Product Managers

**Configuring Organization Rewards**:

1. Firebase Console → Firestore → Collections → `orgs`
2. Edit `your-org-id` document
3. Update `payoutPolicy`:
   ```json
   {
     "minScoreToPay": 4.0, // Auto-reject below this
     "baseRewardAmount": 200, // USD base reward
     "tierMultipliers": {
       "CRITICAL": 2.0,
       "HIGH": 1.5,
       "MEDIUM": 1.0,
       "LOW": 0.25
     }
   }
   ```
4. Update `assetImportanceMap`:
   ```json
   {
     "payment_system": 2.0, // Higher impact
     "authentication": 1.8,
     "web_app": 1.2,
     "staging": 0.5 // Lower impact
   }
   ```

---

## 🔍 Debugging Tips

### "Vector validation failed"

- Check: All 8 metrics present? (AV, AC, PR, UI, S, C, I, A)
- Check: Valid values? (e.g., `AV` ∈ {L, A, N})
- Check: Correct prefix? (must be `CVSS:3.1/`)

### "Score too low" (auto-rejected)

- Check: `org.payoutPolicy.minScoreToPay` (default: 4.0)
- Check: Asset multiplier in `org.assetImportanceMap`
- Check: BugHuntr score = CVSS × EM × BIM × CF

### "Payout not created"

- Check: Did triager sign off with `finalSignOff=true`?
- Check: Is vulnerability status = `eligible_for_payout`?
- Check: Look in Firestore `payouts` collection

### "CVE status stuck at 'requested'"

- **Expected**: CNA integration is Phase 2
- **For MVP**: Manually update status via dashboard
- **Workaround**: Update directly in Firestore (Firestore Console)

---

## 📊 Key Formulas

### CVSS Base Score

```
Impact = 1 - (1-C) × (1-I) × (1-A)      [if Scope=U]
Impact = Impact × 1.08                   [if Scope=C]

Exploitability = 8.22 × AV × AC × PR × UI

BaseScore = min(Impact × Exploitability, 10.0)
```

### BugHuntr Score

```
Score = CVSS_Base × EM × BIM × CF

Where:
- EM = 1.0 + (0.2 if PoC Code, 0.1 if PoC Screenshot, else 0)
- BIM = assetImportanceMap[assetType]
- CF = 1.0 - (0.3 if vague description, 0.2 if some detail, else 0)

Result = clamp(Score, 0, 10)
```

### Reward Amount

```
RewardAmount = BaseReward × TierMultiplier

Tiers:
- CRITICAL (9.0+): 2.0x
- HIGH (7.0-8.9): 1.5x
- MEDIUM (4.0-6.9): 1.0x
- LOW (<4.0): Rejected
```

---

## 🚨 Important Constraints

### Audit Trail

- ✅ Immutable (append-only)
- ✅ Permanent (never deleted)
- ✅ Compliance-ready
- **Cannot** edit or delete audit entries

### Vulnerability Status States

```
triage_pending
    ↓
  triaged ← (triager approves CVSS)
    ↓
eligible_for_payout ← (reward decision made)
    ↓
  (payout created)

OR

rejected_low_severity ← (score < minScoreToPay)
```

### CVE Request Status States

```
requested
    ↓
cna_acknowledged ← (CNA received)
    ↓
cve_assigned ← (CVE ID issued)
    ↓
public ← (disclosure published)

OR

rejected
```

---

## 📈 Monitoring

### Critical Metrics to Watch

1. **CVSS Suggestion Accuracy**

   - Compare suggested vs. approved vectors
   - Look for patterns in disagreement

2. **Auto-Rejection Rate**

   - Should be < 20% typically
   - High rate = adjust `minScoreToPay` or multipliers

3. **Triager Approval Time**

   - Target: < 24 hours from submission
   - Bottleneck: Often PoC review time

4. **CVE Request Processing**
   - Time from request to assignment
   - Currently manual (CNA Phase 2)

### Where to Check

```bash
# Cloud Function logs
firebase functions:log

# Firestore usage
Google Cloud Console → Firestore → Usage

# Error tracking
Google Cloud Console → Error Reporting
```

---

## 🆘 Need Help?

**Component Issues**:

- Frontend: Check `components/triage/` folder
- Logic: Check `functions/src/` folder
- Data: Check `docs/CVSS_FIRESTORE_SCHEMA.md`

**Deployment Issues**:

- See: `docs/DEPLOYMENT_GUIDE.md` (Troubleshooting section)
- Quick check: `firebase functions:log`
- Detailed: Google Cloud Console → Cloud Functions

**Algorithm Questions**:

- CVSS: Read `docs/CVSS_AND_CVE_README.md`
- Scoring: Check `functions/src/cvss/bughuntrScoring.ts` comments
- Tests: See `functions/src/__tests__/cvss/` for examples

**Firestore Rules**:

- See: `docs/CVSS_FIRESTORE_RULES.md`
- Test: Firebase Emulator → Firestore UI
- Deploy: `firebase deploy --only firestore:rules`

---

## ✅ Pre-Production Checklist

- [ ] All Cloud Functions deployed (`firebase deploy --only functions`)
- [ ] Firestore rules deployed (`firebase deploy --only firestore:rules`)
- [ ] Firestore indexes deployed (`firebase deploy --only firestore:indexes`)
- [ ] Organization payout policies configured (Firebase Console)
- [ ] Custom claims set for all triagers (role: triager, org: xxx)
- [ ] Email notifications configured (optional for MVP)
- [ ] Monitoring dashboard created (Google Cloud Console)
- [ ] Triager training completed
- [ ] Smoke test passed (create submission → triage → approve)
- [ ] Rollback plan documented

---

**Version**: 1.0  
**Last Updated**: December 9, 2025  
**Status**: Production Ready

# 🚀 Quick Start Guide - BugHuntr Crypto Payouts

## For Developers Who Just Want to Get Started

### 1. Install & Setup (5 minutes)

```bash
# Navigate to functions directory
cd functions

# Install dependencies
npm install

# Configure Cryptomus credentials
firebase functions:config:set \
  cryptomus.merchant_id="YOUR_MERCHANT_ID" \
  cryptomus.payout_key="YOUR_API_KEY" \
  cryptomus.use_sandbox="true"
```

### 2. Create Organization Wallet (1 minute)

In Firestore Console or using Firebase Admin SDK:

```javascript
// Create wallet for your organization
db.collection("org_wallets").doc("org_YOUR_ORG_ID").set({
  orgId: "org_YOUR_ORG_ID",
  currency: "USDC",
  network: "POLYGON",
  balance: 0,
  reserved: 0,
  updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
});
```

### 3. Deploy Functions (2 minutes)

```bash
# Build and deploy
npm run build
firebase deploy --only functions
```

### 4. Configure Cryptomus Webhook (1 minute)

1. Go to Cryptomus Dashboard → Settings → Webhooks
2. Add URL: `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/cryptomusWebhook`
3. Enable for: Payout status updates

### 5. Use in Your Code

#### Create a Payout

```typescript
import { usePayouts } from "@/hooks/use-payout";

function ApproveSubmissionButton() {
  const { createPayout } = usePayouts();

  const handleApprove = async () => {
    try {
      const result = await createPayout({
        submissionId: "sub_123",
        huntId: "hunt_456",
        orgId: "org_company1",
        hunterUid: "user_hunter1",
        hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
        amount: 1000000, // 1 USDC = 1,000,000 micro-units
      });

      console.log("Payout created:", result.order_id);
    } catch (error) {
      console.error("Payout failed:", error.message);
    }
  };

  return <button onClick={handleApprove}>Approve & Pay</button>;
}
```

#### Show Payout Status

```tsx
import { PayoutStatus } from "@/components/payout/payout-status";

function SubmissionDetail({ submission }) {
  return (
    <div>
      <h2>Bug Report</h2>
      {/* ...submission details... */}

      {submission.status === "approved" && (
        <PayoutStatus submissionId={submission.id} huntId={submission.huntId} />
      )}
    </div>
  );
}
```

#### Admin Dashboard

```tsx
import { AdminPayoutPanel } from "@/components/payout/admin-payout-panel";

function PayoutsPage() {
  const orgId = useAuth().user.orgId;

  return <AdminPayoutPanel orgId={orgId} />;
}
```

---

## 🎯 Common Tasks

### Test Locally

```bash
cd functions
npm run serve

# In another terminal, test webhook:
curl -X POST http://localhost:5001/PROJECT/us-central1/cryptomusWebhook \
  -H "Content-Type: application/json" \
  -d '{"order_id":"BH-PAYOUT-test","status":"paid","sign":"..."}'
```

### Run Tests

```bash
cd functions
npm test
```

### View Logs

```bash
firebase functions:log
firebase functions:log --only createPayout
```

### Check Wallet Balance

```javascript
const { getOrgWallet } = usePayouts();
const wallet = await getOrgWallet("org_123");

console.log("Balance:", wallet.balance / 1000000, "USDC");
console.log("Reserved:", wallet.reserved / 1000000, "USDC");
console.log("Available:", (wallet.balance - wallet.reserved) / 1000000, "USDC");
```

### Retry Failed Payout

Admin Panel → Payouts Table → Click "Retry" on failed payout

Or programmatically:

```typescript
const { createPayout } = usePayouts();

// Create new payout with retry suffix
await createPayout({
  ...originalPayoutData,
  submissionId: originalPayoutData.submissionId + "-retry",
});
```

---

## 💡 Key Concepts

### Amount Conversion

```typescript
// User enters: 1.50 USDC
// Convert to micro-units:
const amountInMicroUnits = 1.5 * 1_000_000; // = 1,500,000

// In Firestore: amount = 1500000
// Display to user: 1500000 / 1000000 = "1.50 USDC"
```

### Order ID Format

```
BH-PAYOUT-{huntId}-{submissionId}

Examples:
- BH-PAYOUT-hunt_456-sub_123
- BH-PAYOUT-sub_123 (if no huntId)
```

### Payout Status Flow

```
pending_created → processing → completed
                              → failed
                              → cancelled
```

### Balance Tracking

```
Total Balance:     1000 USDC
Reserved:           200 USDC  (for pending payouts)
Available:          800 USDC  (can be used for new payouts)
```

---

## 🔧 Troubleshooting

### "Insufficient Funds" Error

**Fix**: Record a wallet top-up in Admin Panel

### "Wallet Not Found" Error

**Fix**: Create org wallet in Firestore (see step 2 above)

### "Invalid Signature" Error

**Fix**: Check Cryptomus API key configuration:

```bash
firebase functions:config:get cryptomus
```

### Webhook Not Received

**Fix**:

1. Check webhook URL in Cryptomus dashboard
2. Test manually with Postman
3. Check Cloud Functions logs

### Payout Stuck in "Processing"

**Wait**: Blockchain confirmation can take 1-5 minutes
**Check**: View transaction on Polygonscan.com

---

## 📱 Next.js Integration

### Add to Your Pages

```tsx
// app/admin/payouts/page.tsx
import { AdminPayoutPanel } from "@/components/payout/admin-payout-panel";

export default function PayoutsPage() {
  return <AdminPayoutPanel orgId={currentUser.orgId} />;
}
```

```tsx
// app/submissions/[id]/page.tsx
import { PayoutStatus } from "@/components/payout/payout-status";

export default function SubmissionPage({ params }) {
  return (
    <div>
      {/* Submission details */}
      <PayoutStatus submissionId={params.id} huntId={submission.huntId} />
    </div>
  );
}
```

### Add Hook to Your Components

```tsx
import { usePayouts } from "@/hooks/use-payout";

function MyComponent() {
  const { createPayout, getPayout, getOrgPayouts, loading, error } =
    usePayouts();

  // Use the functions...
}
```

---

## 📊 Monitoring Dashboard

### Key Metrics to Track

1. **Payout Success Rate**: completed / total
2. **Average Processing Time**: updatedAt - createdAt
3. **Failed Payouts**: Count where status = 'failed'
4. **Orphaned Webhooks**: Count in payout_webhook_orphan
5. **Balance Accuracy**: balance >= reserved (always)

### Check in Cloud Console

- **Functions**: Firebase Console → Functions
- **Logs**: Cloud Logging → Logs Explorer
- **Firestore**: Firebase Console → Firestore Database
- **Monitoring**: Cloud Monitoring → Dashboards

---

## 🆘 Need Help?

### Documentation

- **Main README**: `/docs/PAYOUT_SYSTEM_README.md`
- **Deployment**: `/docs/DEPLOYMENT_CHECKLIST.md`
- **Summary**: `/CRYPTO_PAYOUT_IMPLEMENTATION_SUMMARY.md`

### Test Collection

- **Postman**: `/postman/BugHuntr-Payout-API.postman_collection.json`

### Support

- Cryptomus: https://cryptomus.com/support
- Firebase: https://firebase.google.com/support

---

**Happy Coding! 🚀**

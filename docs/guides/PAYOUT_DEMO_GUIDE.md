# 🚀 Crypto Payout Demo Guide

## Quick Access

### Admin Demo (Payout Creation)

**URL**: `/payout-demo`  
**Access**: Admin users only (must be logged in with `role: "admin"`)

### Hunter Demo (Wallet & Earnings)

**URL**: `/my-wallet`  
**Access**: Hunter users (must be logged in with `role: "user"`)

## What This Demo Does

This interactive demo allows you to test the entire crypto payout workflow without making real blockchain transactions. It includes both admin and hunter perspectives:

### Admin Side (`/payout-demo`)

1. **Wallet Management** - Virtual USDC balance on Polygon network
2. **Payout Creation** - Generate test payouts with different outcomes
3. **Transaction Tracking** - Monitor payout status in real-time
4. **Balance Updates** - See how payouts affect wallet balance

### Hunter Side (`/my-wallet`)

1. **Wallet Setup** - Save Polygon wallet address for receiving payments
2. **Earnings Dashboard** - View total earnings with privacy toggle
3. **Payment History** - Track completed, pending, and failed payments
4. **Demo Earnings** - Add test earnings to simulate receiving payouts

---

## Admin Demo - Payout Creation

This section covers the admin interface for creating and managing payouts.

### How to Use

1. **Wallet Management** - Virtual USDC balance on Polygon network
2. **Payout Creation** - Generate test payouts with different outcomes
3. **Transaction Tracking** - Monitor payout status in real-time
4. **Balance Updates** - See how payouts affect wallet balance

## How to Use

### Step 1: Login as Admin

1. Navigate to `/login`
2. Login with an admin account (or any account and set `role: "admin"` in localStorage)
3. Go to `/payout-demo` from the sidebar (Wallet icon)

### Step 2: Initialize Demo Wallet

Click **"Initialize Demo Wallet"** to create a test wallet with:

- **10,000 USDC** initial balance
- **USDC** currency (Polygon network)
- **Zero** reserved funds

### Step 3: Create Test Payouts

#### Fill in the form:

- **Amount**: Enter USDC amount (e.g., 100)
- **Hunter Wallet**: Polygon wallet address (default provided)

#### Choose a scenario:

**✅ Simulate Success**

- Creates a completed payout
- Deducts amount from wallet balance
- Generates mock transaction hash
- Status: `COMPLETED`

**⏳ Simulate Processing**

- Creates a processing payout
- Reserves funds (doesn't deduct yet)
- Status: `PROCESSING`

**❌ Simulate Failure**

- Creates a failed payout
- No balance change
- Status: `FAILED`

### Step 4: View Results

The demo shows:

- **Updated Balance** - Real-time balance changes
- **Payout History** - List of all demo transactions
- **Transaction Details** - Order ID, wallet, amount, status, TX hash

## Demo Data Structure

### Wallet Record (Firestore: `org_wallets/{demoOrgId}`)

```javascript
{
  orgId: "demo_org_001",
  orgName: "Demo Organization",
  balance: 10000000000,        // 10,000 USDC (micro-units)
  reserved: 0,
  currency: "USDC",
  network: "POLYGON",
  createdAt: timestamp,
  updatedAt: timestamp,
  totalTopUps: 10000000000,
  totalPayouts: 0
}
```

### Payout Record (Firestore: `payouts/{orderId}`)

```javascript
{
  order_id: "BH-PAYOUT-DEMO-1234567890",
  orgId: "demo_org_001",
  huntId: "demo_hunt_001",
  submissionId: "demo_sub_001",
  hunterUid: "demo_hunter",
  hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  amount: 100000000,           // 100 USDC (micro-units)
  currency: "USDC",
  network: "POLYGON",
  status: "completed",         // or "processing", "failed"
  createdAt: timestamp,
  updatedAt: timestamp,
  createdBy: "admin_user_id",
  tx_hash: "0xdemo123abc",     // Mock transaction hash
  cryptomus_payout_id: "demo_xyz789",
  cryptomus_response: {
    demo: true,
    scenario: "success"
  }
}
```

---

## Hunter Demo - My Wallet

This section covers the hunter interface for viewing earnings and managing wallet settings.

### How to Use

#### Step 1: Login as Hunter

1. Navigate to `/login`
2. Login with a hunter account (or set `role: "user"` in Firestore)
3. Go to `/my-wallet` from the sidebar (Wallet icon)

#### Step 2: Set Up Wallet Address

1. If no wallet address is saved, you'll see a setup form
2. Enter your Polygon wallet address (or use the default demo address)
3. Click **"Save Wallet Address"**
4. Your address will be saved to Firestore (`user_wallets/{uid}`)

#### Step 3: View Your Earnings

The dashboard displays:

- **Total Earnings** - Sum of all completed payments (show/hide toggle)
- **Pending Amount** - Payments being processed
- **Failed Amount** - Payments that failed (with retry option)
- **Wallet Address** - Your saved address with copy button

#### Step 4: Add Demo Earnings

To test the wallet interface:

1. Click **"Add Demo Earning"** button
2. A random payment (20-200 USDC) will be created
3. Payment appears in "Completed" tab
4. Total earnings update automatically

#### Step 5: View Payment History

Three tabs available:

**✅ Completed** (Green badge)

- Successfully processed payments
- Shows TX hash and date
- Includes demo earnings

**⏳ Pending** (Yellow badge)

- Payments being processed
- Shows order ID and creation date
- No TX hash yet

**❌ Failed** (Red badge)

- Failed payment attempts
- Shows error details
- Can retry manually

### Hunter Wallet Features

#### Wallet Address Management

- Save/update Polygon wallet address
- Copy address to clipboard
- Address validation (0x format)
- Required for receiving payments

#### Earnings Display

- Total earnings with show/hide privacy toggle
- Breakdown by status (pending/failed)
- Real-time updates from Firestore
- Formatted in USDC with $ symbol

#### Payment History Table

- Sortable columns (Date, Amount, Status)
- Transaction hash links (for completed)
- Order ID for tracking
- Visual status indicators
- Empty state messages

#### Demo Mode Features

- "Add Demo Earning" button for testing
- Generates random payment amounts
- Creates mock TX hashes
- Updates totals immediately

### Hunter Data Structure

#### User Wallet Record (Firestore: `user_wallets/{hunterUid}`)

```javascript
{
  uid: "hunter_user_id",
  walletAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  network: "POLYGON",
  currency: "USDC",
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### Payout Records (Firestore: `payouts/`)

Hunters see payouts where `hunterUid` matches their user ID:

```javascript
{
  order_id: "BH-PAYOUT-DEMO-1234567890",
  hunterUid: "hunter_user_id",
  hunterWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  amount: 100000000,           // 100 USDC (micro-units)
  currency: "USDC",
  network: "POLYGON",
  status: "completed",         // or "processing", "failed"
  createdAt: timestamp,
  tx_hash: "0xdemo123abc",     // Only for completed
  batchId: "batch_123",        // Optional
}
```

---

## Understanding Micro-Units

**What are micro-units?**

- Crypto amounts are stored in smallest units to avoid decimals
- 1 USDC = 1,000,000 micro-units
- Example: $100 USDC = 100,000,000 micro-units

**Conversion**:

```javascript
// USDC to micro-units
microUnits = amount * 1_000_000;

// Micro-units to USDC
usdc = microUnits / 1_000_000;
```

## Demo vs Production

| Feature             | Demo Mode                   | Production Mode           |
| ------------------- | --------------------------- | ------------------------- |
| **Admin Side**      |
| Wallet Balance      | Virtual (Firestore only)    | Real crypto wallet        |
| Transactions        | Simulated                   | Real blockchain TXs       |
| API Calls           | None                        | Cryptomus API             |
| TX Hashes           | Mock (`0xdemo...`)          | Real blockchain hashes    |
| Costs               | Free                        | Real transaction fees     |
| Reversible          | Yes (delete Firestore docs) | No (blockchain immutable) |
| **Hunter Side**     |
| Earnings            | Demo payments               | Real received payments    |
| Wallet Setup        | Any address accepted        | Verified on-chain         |
| Payment History     | Firestore only              | Blockchain + Firestore    |
| Add Earnings Button | Available                   | Hidden in production      |

## Testing Scenarios

### Admin Scenario 1: Successful Payout

```
1. Initialize wallet (10,000 USDC)
2. Create payout: $100 USDC
3. Click "Simulate Success"
4. Result:
   - Balance: 9,900 USDC
   - Status: COMPLETED
   - TX Hash: 0xdemo...
```

### Scenario 2: Multiple Payouts

```
1. Create 3 success payouts ($100 each)
2. Create 1 processing payout ($50)
3. Create 1 failed payout ($200)
4. Result:
   - Balance: 9,700 USDC (3 × $100 deducted)
   - Reserved: $0 (failures don't reserve)
   - History: 5 transactions
```

### Admin Scenario 3: Balance Exhaustion

```
1. Initialize wallet (10,000 USDC)
2. Create success payout: $5,000
3. Create success payout: $5,000
4. Try to create payout: $100
5. Result:
   - Balance: 0 USDC
   - Buttons disabled (insufficient funds)
```

### Hunter Scenario 1: First Time Setup

```
1. Login as hunter (no wallet saved)
2. See wallet setup form
3. Enter wallet: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
4. Click "Save Wallet Address"
5. Result:
   - Address saved to Firestore
   - Dashboard shows $0.00 earnings
   - Payment history empty
```

### Hunter Scenario 2: Viewing Earnings

```
1. Admin creates payout for hunter ($100)
2. Hunter refreshes /my-wallet
3. Result:
   - Pending: $100.00 (yellow badge)
   - Payment appears in "Pending" tab
```

### Hunter Scenario 3: Demo Earnings

```
1. Hunter clicks "Add Demo Earning"
2. Random amount generated ($50-$200)
3. Result:
   - Total earnings increase
   - Payment in "Completed" tab
   - TX hash visible (0xdemo...)
```

### End-to-End Scenario: Complete Flow

```
1. Admin: Initialize wallet (10,000 USDC)
2. Hunter: Set up wallet address
3. Admin: Create payout ($250) → Simulate Success
4. Hunter: See pending payment
5. Admin: Webhook marks as completed (in production)
6. Hunter: See completed payment with TX hash
7. Result:
   - Admin balance: 9,750 USDC
   - Hunter earnings: $250.00
   - Transaction in both histories
```

## Resetting Demo Data

**Option 1: Clear Individual User Data**

1. Open Firebase Console
2. Navigate to Firestore Database
3. Delete hunter's wallet: `user_wallets/{hunterUid}`
4. Delete hunter's payouts: Filter `payouts` by `hunterUid`

**Option 2: Clear All Demo Data**

1. Open Firebase Console
2. Navigate to Firestore Database
3. Delete documents:
   - `org_wallets/demo_org_001`
   - All `payouts/BH-PAYOUT-DEMO-*`

**Option 2: Re-initialize**

1. Delete wallet via Firestore
2. Refresh page
3. Click "Initialize Demo Wallet" again

## Connecting to Real System

To transition from demo to production:

### Admin Side

1. **Replace demo org ID** with real organization ID
2. **Remove mock data generation** (tx_hash, etc.)
3. **Enable Cloud Functions** (createPayout, webhook handler)
4. **Configure Cryptomus API** keys in Firebase Functions config
5. **Update wallet initialization** to use real balance from Cryptomus
6. **Remove simulation buttons** (Success/Processing/Failure)

### Hunter Side

1. **Hide "Add Demo Earning" button** in production
2. **Add wallet validation** (verify on-chain ownership)
3. **Enable blockchain explorer links** for TX hashes
4. **Add notification system** for new payments
5. **Implement withdrawal functionality** (if needed)

## Troubleshooting

### Admin Issues

**Problem**: "Initialize Demo Wallet" doesn't work

- **Solution**: Check Firebase permissions, ensure Firestore is enabled

**Problem**: Balance doesn't update after payout

- **Solution**: Check browser console for errors, verify Firestore write permissions

**Problem**: Can't access `/payout-demo`

- **Solution**: Ensure you're logged in as admin (`user.role === "admin"`)

**Problem**: Page shows "Loading..." indefinitely

- **Solution**: Check Firebase connection, verify auth context is working

### Hunter Issues

**Problem**: Can't access `/my-wallet`

- **Solution**: Ensure you're logged in and `role: "user"` is set in Firestore

**Problem**: Wallet address won't save

- **Solution**: Check wallet format (must start with 0x), verify Firestore write permissions

**Problem**: Earnings not showing

- **Solution**: Verify `hunterUid` matches your user ID in payouts collection

**Problem**: "Add Demo Earning" doesn't work

- **Solution**: Check console for errors, verify you have a saved wallet address

**Problem**: Payment history not loading

- **Solution**: Check Firestore query permissions, verify hunterUid is correct

**Problem**: Real-time updates not working

- **Solution**: Check Firestore listeners, verify network connection

## Next Steps

After testing the demo:

1. **Review implementation files**:

   - Admin: `app/payout-demo/page.tsx`
   - Hunter: `app/my-wallet/page.tsx`
   - Functions: `functions/src/functions/createPayout.ts`
   - Webhook: `functions/src/functions/cryptomusWebhook.ts`
   - Components: `components/payout/admin-payout-panel.tsx`

2. **Test both perspectives**:

   - Create payouts as admin
   - View earnings as hunter
   - Test all three scenarios (success/processing/failure)
   - Verify real-time updates work

3. **Production setup**:

   - Configure production Cryptomus credentials
   - Test with Cryptomus sandbox API
   - Deploy Cloud Functions to Firebase
   - Test end-to-end with real (sandbox) transactions
   - Remove demo-only features

4. **User experience**:
   - Add email notifications for hunters
   - Implement push notifications for payment updates
   - Add withdrawal/cash-out functionality
   - Create payment receipts/invoices

## Support

For questions or issues:

- Check `docs/PAYOUT_SYSTEM_README.md` for full system documentation
- Review `DEPLOYMENT_CHECKLIST.md` for production deployment
- See `QUICK_START.md` for development setup

---

**Last Updated**: December 9, 2025  
**Demo Version**: 2.0.0  
**Features**: Admin payout creation + Hunter wallet view

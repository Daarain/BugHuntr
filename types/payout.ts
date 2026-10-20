/**
 * TypeScript Type Definitions for BugHuntr Crypto Payout System
 *
 * This file defines all the data models and interfaces used throughout the payout system.
 * These types ensure type safety and provide clear documentation for non-blockchain engineers.
 */

// ============================================================================
// ORGANIZATION WALLET TYPES
// ============================================================================

/**
 * Organization's crypto wallet managed by Cryptomus
 *
 * Terminology:
 * - balance: Total amount of crypto available in the wallet (in smallest token units)
 * - reserved: Amount temporarily locked for pending/processing payouts
 * - available: balance - reserved (calculated, not stored)
 */
export interface OrgWallet {
  /** Firestore document ID - matches organization ID */
  orgId: string;

  /** Cryptocurrency type (e.g., "USDC", "USDT", "BTC") */
  currency: string;

  /** Blockchain network (e.g., "POLYGON", "ETHEREUM", "TRON") */
  network: string;

  /** Total balance in smallest token units (e.g., cents for USDC) */
  balance: number;

  /** Amount reserved for pending/processing payouts */
  reserved: number;

  /** Last update timestamp */
  updatedAt: Date;

  /** Metadata about the last top-up transaction */
  lastTopUpTx?: {
    amount: number;
    txHash?: string;
    recordedBy: string;
    recordedAt: Date;
    notes?: string;
  };
}

// ============================================================================
// PAYOUT TYPES
// ============================================================================

/**
 * Payout status lifecycle:
 * pending_created -> processing -> completed
 *                               -> failed
 *                               -> cancelled
 */
export type PayoutStatus =
  | "pending_created" // Created in Firestore, not yet submitted to Cryptomus
  | "processing" // Submitted to Cryptomus, waiting for blockchain confirmation
  | "completed" // Successfully completed and confirmed on blockchain
  | "failed" // Failed (insufficient funds, invalid address, etc.)
  | "cancelled"; // Manually cancelled by admin

/**
 * Main payout record stored in Firestore
 *
 * order_id format: BH-PAYOUT-{submissionId} or BH-PAYOUT-{huntId}-{submissionId}
 * This ensures idempotency - same submission can't be paid twice
 */
export interface Payout {
  /** Unique order ID (Firestore doc ID) - prevents duplicate payouts */
  order_id: string;

  /** Bug hunt ID */
  huntId: string;

  /** Submission ID that earned this payout */
  submissionId: string;

  /** Organization paying the bounty */
  orgId: string;

  /** Hunter receiving the payout */
  hunterUid: string;

  /** Hunter's crypto wallet address */
  hunterWallet: string;

  /** Payout amount in smallest token units */
  amount: number;

  /** Cryptocurrency type */
  currency: string;

  /** Blockchain network */
  network: string;

  /** Current status */
  status: PayoutStatus;

  /** Cryptomus payout ID (returned after API call) */
  cryptomus_payout_id?: string;

  /** Blockchain transaction hash (from Cryptomus webhook) */
  tx_hash?: string;

  /** Full response from Cryptomus API */
  cryptomus_response?: any;

  /** Array of webhook payloads received */
  webhook_history?: Array<{
    receivedAt: Date;
    payload: any;
  }>;

  /** Error details if status is 'failed' */
  error?: {
    code: string;
    message: string;
    details?: any;
  };

  /** User who initiated the payout */
  createdBy: string;

  /** Optional payout method and destination (for UI backward-compatibility) */
  method?: string;
  destination?: any;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

// ============================================================================
// AUDIT LOG TYPES
// ============================================================================

/**
 * Append-only audit log for all payout operations
 * Used for compliance, debugging, and security audits
 */
export interface PayoutLog {
  /** Auto-generated log ID */
  logId: string;

  /** Type of event being logged */
  eventType: "create" | "update" | "webhook" | "reconcile" | "retry" | "cancel";

  /** Related payout order_id */
  order_id?: string;

  /** User who triggered this event */
  actorUid?: string;

  /** IP address of the actor */
  ip?: string;

  /** User agent string */
  userAgent?: string;

  /** Event-specific data */
  data: {
    /** Previous state (for updates) */
    previousStatus?: PayoutStatus;

    /** New state (for updates) */
    newStatus?: PayoutStatus;

    /** Raw request payload */
    request?: any;

    /** Raw response payload */
    response?: any;

    /** Error details if applicable */
    error?: any;

    /** Additional context */
    metadata?: Record<string, any>;
  };

  /** Timestamp of the event */
  timestamp: Date;
}

/**
 * Storage for webhook payloads that couldn't be matched to existing payouts
 * Useful for debugging integration issues
 */
export interface PayoutWebhookOrphan {
  /** Auto-generated ID */
  id: string;

  /** Raw webhook payload */
  payload: any;

  /** Computed signature for verification */
  receivedSignature?: string;

  /** Whether signature verification passed */
  signatureValid?: boolean;

  /** Reason for orphan status */
  reason: string;

  /** Timestamp received */
  receivedAt: Date;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Input for createPayout Cloud Function
 */
export interface CreatePayoutRequest {
  /** Submission ID earning the payout */
  submissionId: string;

  /** Associated hunt ID */
  huntId: string;

  /** Organization funding the payout */
  orgId: string;

  /** Hunter receiving the payout */
  hunterUid: string;

  /** Hunter's crypto wallet address */
  hunterWallet: string;

  /** Amount to pay (in smallest token units) */
  amount: number;

  /** Currency (defaults to org wallet currency) */
  currency?: string;

  /** Network (defaults to org wallet network) */
  network?: string;
}

/**
 * Response from createPayout Cloud Function
 */
export interface CreatePayoutResponse {
  success: boolean;
  order_id: string;
  status: PayoutStatus;
  cryptomus_payout_id?: string;
  message: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Input for batch payout creation
 */
export interface BatchPayoutRow {
  submissionId: string;
  huntId: string;
  hunterUid: string;
  hunterWallet: string;
  amount: number;
}

/**
 * Response from batch payout operation
 */
export interface BatchPayoutResponse {
  success: boolean;
  totalRows: number;
  queued: number;
  failed: number;
  errors: Array<{
    row: number;
    error: string;
  }>;
}

// ============================================================================
// CRYPTOMUS API TYPES
// ============================================================================

/**
 * Request payload for Cryptomus Payout API
 *
 * TODO: Verify exact field names with official Cryptomus documentation
 * https://doc.cryptomus.com/business/payouts/creating-payout
 */
export interface CryptomusPayoutRequest {
  /** Payout amount (string format required by Cryptomus) */
  amount: string;

  /** Currency code */
  currency: string;

  /** Recipient wallet address */
  address: string;

  /** Unique order identifier (idempotency key) */
  order_id: string;

  /** Blockchain network */
  network: string;

  /** Webhook callback URL */
  url_callback?: string;

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Response from Cryptomus Payout API
 *
 * TODO: Verify exact response structure with official documentation
 */
export interface CryptomusPayoutResponse {
  /** API response state */
  state: number;

  /** Result data */
  result: {
    /** Cryptomus payout UUID */
    uuid: string;

    /** Original order_id */
    order_id: string;

    /** Amount */
    amount: string;

    /** Currency */
    currency: string;

    /** Recipient address */
    address: string;

    /** Network */
    network: string;

    /** Payout status */
    status: string;

    /** Transaction hash (if available) */
    txid?: string;

    /** Additional fields */
    [key: string]: any;
  };
}

/**
 * Cryptomus webhook payload structure
 *
 * TODO: Verify exact webhook payload structure with official documentation
 * https://doc.cryptomus.com/business/payouts/webhook
 */
export interface CryptomusWebhookPayload {
  /** Webhook signature for verification */
  sign?: string;

  /** Order ID */
  order_id: string;

  /** Cryptomus payout UUID */
  uuid: string;

  /** Payout status */
  status: string;

  /** Transaction hash */
  txid?: string;

  /** Amount */
  amount: string;

  /** Currency */
  currency: string;

  /** Network */
  network: string;

  /** Additional webhook data */
  [key: string]: any;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Supported currencies and their configurations
 */
export interface CurrencyConfig {
  code: string;
  name: string;
  decimals: number;
  networks: string[];
  explorerUrls: Record<string, string>;
}

/**
 * Helper type for wallet address validation
 */
export interface WalletValidation {
  isValid: boolean;
  network?: string;
  error?: string;
}

/**
 * Reconciliation result for admin review
 */
export interface ReconciliationResult {
  timestamp: Date;
  totalCryptomusPayouts: number;
  totalFirestorePayouts: number;
  matched: number;
  missingInFirestore: string[];
  missingInCryptomus: string[];
  statusMismatches: Array<{
    order_id: string;
    firestoreStatus: PayoutStatus;
    cryptomusStatus: string;
  }>;
}

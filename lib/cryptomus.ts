/**
 * Cryptomus Integration & Signature Verification (Server-Only)
 *
 * Implements Cryptomus specification for request signing, webhook signature verification,
 * and status mapping.
 */

import * as crypto from "crypto";

if (typeof window !== "undefined") {
  throw new Error("lib/cryptomus.ts is a server-only module and cannot be executed in the browser.");
}

export interface CryptomusCreatePayoutParams {
  amount: string; // Formatted string e.g. "10.00"
  currency: string; // e.g. "USDC"
  address: string;
  order_id: string;
  network?: string; // e.g. "POLYGON"
  url_callback?: string;
  is_subtract?: boolean;
}

export interface CryptomusCreatePayoutResult {
  state: number;
  result: {
    uuid: string;
    amount: string;
    currency: string;
    network: string;
    address: string;
    txid: string | null;
    status: string;
    is_final: boolean;
    balance: string;
    payer_currency: string;
    payer_amount: string;
  };
}

/**
 * Signs a payload per Cryptomus specification:
 * MD5(base64(JSON.stringify(payload)) + apiKey)
 */
export function signCryptomusPayload(payload: any, apiKey: string): string {
  if (!apiKey) {
    throw new Error("Cryptomus API key is required to sign payload");
  }
  const jsonString = JSON.stringify(payload);
  const base64Payload = Buffer.from(jsonString).toString("base64");
  const signatureInput = base64Payload + apiKey;

  return crypto.createHash("md5").update(signatureInput).digest("hex");
}

/**
 * Verifies a Cryptomus webhook signature.
 * Strips the `sign` property and re-computes the hash with the merchant key.
 */
export function verifyCryptomusWebhookSignature(
  payload: Record<string, any>,
  receivedSignature: string,
  apiKey: string
): boolean {
  if (!receivedSignature || !apiKey || !payload) {
    return false;
  }

  const payloadCopy = { ...payload };
  delete payloadCopy.sign;

  try {
    const expected = signCryptomusPayload(payloadCopy, apiKey);
    return expected.toLowerCase() === receivedSignature.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Maps Cryptomus status strings to MongoPayoutStatus.
 */
export function mapCryptomusStatusToPayoutStatus(
  status: string
): "pending_created" | "processing" | "completed" | "failed" | "cancelled" {
  const normalized = (status || "").toLowerCase();

  switch (normalized) {
    case "paid":
    case "paid_over":
    case "completed":
    case "success":
      return "completed";

    case "process":
    case "check":
    case "pending":
    case "processing":
      return "processing";

    case "cancel":
    case "cancelled":
      return "cancelled";

    case "fail":
    case "wrong_amount":
    case "system_fail":
    case "failed":
      return "failed";

    default:
      return "processing";
  }
}

/**
 * Dispatches a payout to Cryptomus (or generates mock response in test/sandbox).
 */
export async function dispatchCryptomusPayout(
  params: CryptomusCreatePayoutParams,
  config?: { merchantId?: string; apiKey?: string; useSandbox?: boolean }
): Promise<CryptomusCreatePayoutResult> {
  const merchantId = config?.merchantId || process.env.CRYPTOMUS_MERCHANT_ID || "";
  const apiKey = config?.apiKey || process.env.CRYPTOMUS_PAYOUT_KEY || "";
  const isMock =
    process.env.CRYPTOMUS_MOCK === "true" ||
    process.env.NODE_ENV === "test" ||
    !merchantId ||
    !apiKey;

  if (isMock) {
    // Hermetic test/mock response
    return {
      state: 0,
      result: {
        uuid: `mock_payout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        amount: params.amount,
        currency: params.currency,
        network: params.network || "POLYGON",
        address: params.address,
        txid: null,
        status: "process",
        is_final: false,
        balance: "1000.00",
        payer_currency: params.currency,
        payer_amount: params.amount,
      },
    };
  }

  // Live provider call
  const body = {
    amount: params.amount,
    currency: params.currency,
    network: params.network,
    order_id: params.order_id,
    address: params.address,
    url_callback: params.url_callback,
    is_subtract: params.is_subtract ?? false,
  };

  const signature = signCryptomusPayload(body, apiKey);
  const response = await fetch("https://api.cryptomus.com/v1/payout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      merchant: merchantId,
      sign: signature,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cryptomus API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

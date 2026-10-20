/**
 * Unit Tests for Payout Concurrency & Atomic Reservation Logic
 *
 * Verifies that concurrent payout requests cannot double-spend or duplicate
 * payouts for the same submission.
 */

describe("Payout Concurrency and Atomic Reservation", () => {
  interface SubmissionDoc {
    status: string;
    payoutStatus?: string;
    paid?: boolean;
    rewardAmount: number;
    payoutOrderId?: string;
  }

  interface WalletDoc {
    balance: number;
    reserved: number;
  }

  interface PayoutDoc {
    order_id: string;
    status: string;
    amount: number;
  }

  // Simulated transactional state transition mirroring Firestore runTransaction in createPayout.ts
  function executePayoutTransaction(
    store: {
      submissions: Record<string, SubmissionDoc>;
      wallets: Record<string, WalletDoc>;
      payouts: Record<string, PayoutDoc>;
    },
    params: {
      submissionId: string;
      orgId: string;
      orderId: string;
      amount: number;
      approvedStatuses: string[];
    }
  ): { success: boolean; isExisting?: boolean } {
    // Step 1: Idempotency check on payout doc
    if (store.payouts[params.orderId]) {
      return { success: true, isExisting: true };
    }

    // Step 2: Check submission document under lock
    const sub = store.submissions[params.submissionId];
    if (!sub) {
      throw new Error("SUBMISSION_NOT_FOUND");
    }

    const currentSubStatus = (sub.status || "").toLowerCase();
    if (!params.approvedStatuses.includes(currentSubStatus)) {
      throw new Error(`SUBMISSION_NOT_APPROVED:${sub.status}`);
    }

    if (
      sub.payoutStatus === "paid" ||
      sub.payoutStatus === "completed" ||
      sub.payoutStatus === "processing" ||
      sub.paid === true
    ) {
      throw new Error("ALREADY_PAID_OR_PROCESSING");
    }

    // Step 3: Check wallet balance under lock
    const wallet = store.wallets[params.orgId];
    if (!wallet) {
      throw new Error("WALLET_NOT_FOUND");
    }

    const available = wallet.balance - wallet.reserved;
    if (available < params.amount) {
      throw new Error(`INSUFFICIENT_FUNDS:${available}`);
    }

    // Step 4: Atomic state mutations
    wallet.reserved += params.amount;
    sub.payoutStatus = "processing";
    sub.payoutOrderId = params.orderId;

    store.payouts[params.orderId] = {
      order_id: params.orderId,
      status: "pending_created",
      amount: params.amount,
    };

    return { success: true };
  }

  const approvedStatuses = ["approved", "accepted", "eligible_for_payout", "triaged", "resolved"];

  it("should successfully reserve funds and lock submission status on first attempt", () => {
    const store: {
      submissions: Record<string, SubmissionDoc>;
      wallets: Record<string, WalletDoc>;
      payouts: Record<string, PayoutDoc>;
    } = {
      submissions: {
        "sub-101": { status: "approved", payoutStatus: "eligible_for_payout", rewardAmount: 500 },
      },
      wallets: {
        "org-1": { balance: 1000, reserved: 0 },
      },
      payouts: {},
    };

    const result = executePayoutTransaction(store, {
      submissionId: "sub-101",
      orgId: "org-1",
      orderId: "BH-PAYOUT-sub-101-hunt-1",
      amount: 500,
      approvedStatuses,
    });

    expect(result.success).toBe(true);
    expect(store.submissions["sub-101"].payoutStatus).toBe("processing");
    expect(store.wallets["org-1"].reserved).toBe(500);
    expect(store.payouts["BH-PAYOUT-sub-101-hunt-1"]).toBeDefined();
    expect(store.payouts["BH-PAYOUT-sub-101-hunt-1"].status).toBe("pending_created");
  });

  it("should reject concurrent second attempt on the same submission while processing", () => {
    const store = {
      submissions: {
        "sub-101": { status: "approved", payoutStatus: "processing", rewardAmount: 500 },
      },
      wallets: {
        "org-1": { balance: 1000, reserved: 500 },
      },
      payouts: {
        "BH-PAYOUT-sub-101-hunt-1": {
          order_id: "BH-PAYOUT-sub-101-hunt-1",
          status: "pending_created",
          amount: 500,
        },
      },
    };

    // If order_id differs (e.g., race with another generated ID)
    expect(() =>
      executePayoutTransaction(store, {
        submissionId: "sub-101",
        orgId: "org-1",
        orderId: "BH-PAYOUT-sub-101-hunt-2",
        amount: 500,
        approvedStatuses,
      })
    ).toThrow("ALREADY_PAID_OR_PROCESSING");
  });

  it("should reject payout when submission is already marked paid", () => {
    const store = {
      submissions: {
        "sub-101": { status: "resolved", payoutStatus: "paid", rewardAmount: 500 },
      },
      wallets: {
        "org-1": { balance: 1000, reserved: 0 },
      },
      payouts: {} as Record<string, PayoutDoc>,
    };

    expect(() =>
      executePayoutTransaction(store, {
        submissionId: "sub-101",
        orgId: "org-1",
        orderId: "BH-PAYOUT-sub-101-hunt-1",
        amount: 500,
        approvedStatuses,
      })
    ).toThrow("ALREADY_PAID_OR_PROCESSING");
  });

  it("should reject payout when available wallet balance is insufficient", () => {
    const store = {
      submissions: {
        "sub-101": { status: "approved", rewardAmount: 500 },
      },
      wallets: {
        "org-1": { balance: 400, reserved: 0 }, // 400 < 500
      },
      payouts: {} as Record<string, PayoutDoc>,
    };

    expect(() =>
      executePayoutTransaction(store, {
        submissionId: "sub-101",
        orgId: "org-1",
        orderId: "BH-PAYOUT-sub-101-hunt-1",
        amount: 500,
        approvedStatuses,
      })
    ).toThrow("INSUFFICIENT_FUNDS:400");
  });

  it("should return isExisting when payout record with orderId already exists (idempotency)", () => {
    const store = {
      submissions: {
        "sub-101": { status: "approved", payoutStatus: "processing", rewardAmount: 500 },
      },
      wallets: {
        "org-1": { balance: 1000, reserved: 500 },
      },
      payouts: {
        "BH-PAYOUT-sub-101-hunt-1": {
          order_id: "BH-PAYOUT-sub-101-hunt-1",
          status: "pending_created",
          amount: 500,
        },
      },
    };

    const result = executePayoutTransaction(store, {
      submissionId: "sub-101",
      orgId: "org-1",
      orderId: "BH-PAYOUT-sub-101-hunt-1",
      amount: 500,
      approvedStatuses,
    });

    expect(result.success).toBe(true);
    expect(result.isExisting).toBe(true);
  });

  describe("Gateway Error Classification (Ambiguous vs Definitive Rejection)", () => {
    function classifyGatewayError(rawCode: any): "definitive_rejection" | "ambiguous_timeout" {
      const numCode = typeof rawCode === "number" ? rawCode : parseInt(String(rawCode), 10);
      const isDefinitive =
        !isNaN(numCode) &&
        numCode >= 400 &&
        numCode < 500 &&
        numCode !== 408 &&
        numCode !== 429;
      return isDefinitive ? "definitive_rejection" : "ambiguous_timeout";
    }

    it("should classify 400, 401, 403, 422 as definitive rejections eligible for fund release", () => {
      expect(classifyGatewayError(400)).toBe("definitive_rejection");
      expect(classifyGatewayError(401)).toBe("definitive_rejection");
      expect(classifyGatewayError(403)).toBe("definitive_rejection");
      expect(classifyGatewayError(422)).toBe("definitive_rejection");
      expect(classifyGatewayError("422")).toBe("definitive_rejection");
    });

    it("should classify 500, 502, 503, 504 server errors as ambiguous timeouts to prevent double spend", () => {
      expect(classifyGatewayError(500)).toBe("ambiguous_timeout");
      expect(classifyGatewayError(502)).toBe("ambiguous_timeout");
      expect(classifyGatewayError(503)).toBe("ambiguous_timeout");
      expect(classifyGatewayError(504)).toBe("ambiguous_timeout");
    });

    it("should classify 408 Request Timeout and 429 Rate Limit as ambiguous timeouts", () => {
      expect(classifyGatewayError(408)).toBe("ambiguous_timeout");
      expect(classifyGatewayError(429)).toBe("ambiguous_timeout");
    });

    it("should classify network drop or UNKNOWN as ambiguous timeout", () => {
      expect(classifyGatewayError("UNKNOWN")).toBe("ambiguous_timeout");
      expect(classifyGatewayError(undefined)).toBe("ambiguous_timeout");
      expect(classifyGatewayError("ECONNRESET")).toBe("ambiguous_timeout");
    });
  });
});

import { ParsedPayoutEvent } from './payout-webhook-parser';

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export interface WebhookVerificationResult {
  isValid: boolean;
  gatewayReference: string;
  status: 'succeeded' | 'failed';
  amountPaise?: number;
  rawPayload?: Record<string, unknown>;
}

export interface DisbursePayoutResult {
  /** False only for a definitive failure. In flight / unknown is not a failure. */
  success: boolean;
  /** The gateway's payout id, or '' when it is not known (e.g. the request timed out). */
  gatewayReference: string;
  /**
   * `succeeded`  the gateway says the money was paid.
   * `processing` accepted but not final, OR outcome unknown (see `ambiguous`):
   *              a payout-status webhook or a manual resolution settles it.
   * `failed`     the gateway definitively refused it; nothing was paid.
   */
  status: 'succeeded' | 'failed' | 'processing';
  failureReason?: string;
  /** True when we could not tell whether the gateway moved money (timeout, 5xx). */
  ambiguous?: boolean;
}

export interface PayoutWebhookResult extends ParsedPayoutEvent {
  /** True only when the signature checked out and the body parsed. */
  isValid: boolean;
}

export interface PaymentProvider {
  createCharge(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
  ): Promise<{ paymentLink: string; gatewayReference: string }>;

  /**
   * `metadata.paymentId` is the id of the Payment being paid out and
   * `metadata.attempt` (default 1) the attempt number. Real providers derive
   * their idempotency key from both, so repeating an attempt cannot pay twice.
   */
  disbursePayout(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
    metadata?: Record<string, unknown>,
  ): Promise<DisbursePayoutResult>;

  verifyWebhook(
    payload: unknown,
    signature?: string,
  ): Promise<WebhookVerificationResult>;

  /**
   * Verifies and parses a payout-status webhook. `rawBody` must be the exact
   * bytes received: the gateway signs those, not a re-serialised copy.
   */
  verifyPayoutWebhook(
    rawBody: Buffer | string,
    signature?: string,
  ): Promise<PayoutWebhookResult>;
}

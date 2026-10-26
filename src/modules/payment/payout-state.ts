/**
 * Payout lifecycle, as recorded on `Payment.status`:
 *
 *   pending ──claim──▶ processing ──▶ succeeded ──▶ reversed
 *                          │  ▲          ▲
 *                          │  │          │ (gateway later says "processed")
 *                          ▼  │          │
 *                        failed ─────────┘──▶ reversed
 *
 * The gateway's status is authoritative, but never moves a payment backwards
 * through its own life: events arrive out of order and more than once.
 * RazorpayX statuses: pending, queued, scheduled, processing, processed,
 * reversed, cancelled, rejected, failed.
 */
export type PayoutStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'reversed';

/** What a gateway status means for us. */
export type GatewayPayoutOutcome =
  | 'in_flight'
  | 'succeeded'
  | 'failed'
  | 'reversed';

export function mapGatewayPayoutStatus(
  gatewayStatus: string,
): GatewayPayoutOutcome | 'unknown' {
  switch (gatewayStatus) {
    case 'pending':
    case 'queued':
    case 'scheduled':
    case 'processing':
    case 'initiated':
      return 'in_flight';
    case 'processed':
      return 'succeeded';
    case 'rejected':
    case 'cancelled':
    case 'failed':
      return 'failed';
    case 'reversed':
      return 'reversed';
    default:
      return 'unknown';
  }
}

export type TransitionReason =
  | 'applied'
  | 'duplicate'
  | 'stale'
  | 'terminal'
  | 'not_dispatched'
  | 'ignored';

export interface Transition {
  next: PayoutStatus | null;
  reason: TransitionReason;
}

/**
 * Decides what a gateway outcome does to a payment currently in `from`.
 * `next: null` means leave the payment alone.
 */
export function resolveWebhookTransition(
  from: string,
  outcome: GatewayPayoutOutcome,
): Transition {
  switch (from) {
    case 'processing':
      if (outcome === 'in_flight') return { next: null, reason: 'duplicate' };
      return { next: outcome, reason: 'applied' };

    case 'succeeded':
      if (outcome === 'reversed') return { next: 'reversed', reason: 'applied' };
      if (outcome === 'succeeded') return { next: null, reason: 'duplicate' };
      // an older "in flight" event arriving late, or a "failed" for a payout
      // the gateway already processed: never walk a settled payout backwards
      return { next: null, reason: 'stale' };

    case 'failed':
      // We can record "failed" on our side before the gateway settles (or by
      // manual resolution); the gateway saying "processed" corrects us.
      if (outcome === 'succeeded') return { next: 'succeeded', reason: 'applied' };
      if (outcome === 'reversed') return { next: 'reversed', reason: 'applied' };
      return {
        next: null,
        reason: outcome === 'failed' ? 'duplicate' : 'stale',
      };

    case 'reversed':
      return { next: null, reason: 'terminal' };

    case 'pending':
      // never sent to the gateway by us, so this event cannot be about it
      return { next: null, reason: 'not_dispatched' };

    default:
      return { next: null, reason: 'ignored' };
  }
}

/**
 * RazorpayX idempotency keys are 4-36 characters of letters, digits, hyphen,
 * underscore and space. Attempt 1 uses the 36-char payment id as is; later
 * attempts use the id without hyphens (32 chars) plus `-r<n>`, so every attempt
 * of every payment gets its own deterministic key within the limit.
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 36;

/**
 * Operational ceiling on dispatches of one payment, so a payout that keeps
 * failing is escalated to a person instead of retried forever. This is a limit
 * we chose, not one the gateway imposes (keys stay within 36 chars well past it).
 */
export const MAX_PAYOUT_ATTEMPTS = 9;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function payoutIdempotencyKey(paymentId: string, attempt: number): string {
  return attempt <= 1
    ? paymentId
    : `${paymentId.replace(/-/g, '')}-r${attempt - 1}`;
}

/** Recovers the payment id from one of our keys / reference_ids, or null if it isn't one of ours. */
export function paymentIdFromReference(reference: unknown): string | null {
  if (typeof reference !== 'string') return null;

  const first = new RegExp(`^(${UUID})$`, 'i').exec(reference);
  if (first) return first[1].toLowerCase();

  const retry = /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})-r\d+$/i.exec(
    reference,
  );
  return retry ? retry.slice(1, 6).join('-').toLowerCase() : null;
}

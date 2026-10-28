import {
  GatewayPayoutOutcome,
  mapGatewayPayoutStatus,
  paymentIdFromReference,
} from './payout-state';

export interface ParsedPayoutEvent {
  event: string;
  payoutId: string;
  referenceId: string | null;
  /** Our payment id, recovered from `notes.paymentId` or an idempotency-key `reference_id`. */
  paymentIdHint: string | null;
  gatewayStatus: string;
  outcome: GatewayPayoutOutcome | 'unknown';
  amountPaise?: number;
  utr?: string | null;
  failureReason?: string | null;
}

interface PayoutEntity {
  id?: unknown;
  status?: unknown;
  amount?: unknown;
  reference_id?: unknown;
  utr?: unknown;
  failure_reason?: unknown;
  notes?: unknown;
  status_details?: { description?: unknown } | null;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/**
 * Parses a RazorpayX payout webhook body (the documented shape:
 * `{ entity: 'event', event: 'payout.processed', payload: { payout: { entity: {...} } } }`).
 * Returns null when the body is not JSON. Events that are not about one
 * payout's status (e.g. `payout.downtime.started`) come back with
 * `outcome: 'unknown'` so the caller can acknowledge and ignore them.
 *
 * The docs' samples show `reference_id` as null, so the payment is located by
 * payout id first, then by `reference_id`, then by `notes.paymentId`, which is
 * echoed back from the request we send.
 */
export function parsePayoutWebhookBody(rawBody: string): ParsedPayoutEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const body = data as { event?: unknown; payload?: { payout?: { entity?: PayoutEntity } } };
  const event = str(body.event) ?? '';
  const entity = body.payload?.payout?.entity;

  if (!event.startsWith('payout.') || !entity || typeof entity !== 'object') {
    return {
      event,
      payoutId: '',
      referenceId: null,
      paymentIdHint: null,
      gatewayStatus: '',
      outcome: 'unknown',
    };
  }

  const notes =
    entity.notes && typeof entity.notes === 'object' && !Array.isArray(entity.notes)
      ? (entity.notes as Record<string, unknown>)
      : {};
  const referenceId = str(entity.reference_id);
  const gatewayStatus = str(entity.status) ?? '';

  return {
    event,
    payoutId: str(entity.id) ?? '',
    referenceId,
    paymentIdHint:
      paymentIdFromReference(notes.paymentId) ?? paymentIdFromReference(referenceId),
    gatewayStatus,
    outcome: mapGatewayPayoutStatus(gatewayStatus),
    amountPaise:
      typeof entity.amount === 'number' && Number.isInteger(entity.amount)
        ? entity.amount
        : undefined,
    utr: str(entity.utr),
    failureReason: str(entity.failure_reason) ?? str(entity.status_details?.description),
  };
}

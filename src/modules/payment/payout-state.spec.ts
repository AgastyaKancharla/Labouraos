import {
  GatewayPayoutOutcome,
  mapGatewayPayoutStatus,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_PAYOUT_ATTEMPTS,
  paymentIdFromReference,
  payoutIdempotencyKey,
  resolveWebhookTransition,
} from './payout-state';

describe('payout state machine (AGENTS.md §9: every transition is tested)', () => {
  describe('mapGatewayPayoutStatus: every documented RazorpayX status', () => {
    it.each([
      ['pending', 'in_flight'],
      ['queued', 'in_flight'],
      ['scheduled', 'in_flight'],
      ['processing', 'in_flight'],
      ['initiated', 'in_flight'],
      ['processed', 'succeeded'],
      ['rejected', 'failed'],
      ['cancelled', 'failed'],
      ['failed', 'failed'],
      ['reversed', 'reversed'],
    ])('%s -> %s', (gateway, expected) => {
      expect(mapGatewayPayoutStatus(gateway)).toBe(expected);
    });

    it('treats an unrecognised status as unknown rather than guessing', () => {
      expect(mapGatewayPayoutStatus('teleported')).toBe('unknown');
      expect(mapGatewayPayoutStatus('')).toBe('unknown');
    });
  });

  describe('resolveWebhookTransition: full table', () => {
    const outcomes: GatewayPayoutOutcome[] = ['in_flight', 'succeeded', 'failed', 'reversed'];
    // [from, outcome, next, reason]
    const table: Array<[string, GatewayPayoutOutcome, string | null, string]> = [
      ['processing', 'in_flight', null, 'duplicate'],
      ['processing', 'succeeded', 'succeeded', 'applied'],
      ['processing', 'failed', 'failed', 'applied'],
      ['processing', 'reversed', 'reversed', 'applied'],

      ['succeeded', 'in_flight', null, 'stale'],
      ['succeeded', 'succeeded', null, 'duplicate'],
      ['succeeded', 'failed', null, 'stale'],
      ['succeeded', 'reversed', 'reversed', 'applied'],

      ['failed', 'in_flight', null, 'stale'],
      ['failed', 'succeeded', 'succeeded', 'applied'],
      ['failed', 'failed', null, 'duplicate'],
      ['failed', 'reversed', 'reversed', 'applied'],

      ['reversed', 'in_flight', null, 'terminal'],
      ['reversed', 'succeeded', null, 'terminal'],
      ['reversed', 'failed', null, 'terminal'],
      ['reversed', 'reversed', null, 'terminal'],

      ['pending', 'in_flight', null, 'not_dispatched'],
      ['pending', 'succeeded', null, 'not_dispatched'],
      ['pending', 'failed', null, 'not_dispatched'],
      ['pending', 'reversed', null, 'not_dispatched'],
    ];

    it.each(table)('%s + %s -> %s (%s)', (from, outcome, next, reason) => {
      expect(resolveWebhookTransition(from, outcome)).toEqual({ next, reason });
    });

    it('covers every (state, outcome) pair for the states a payout can be in', () => {
      for (const from of ['processing', 'succeeded', 'failed', 'reversed', 'pending']) {
        for (const outcome of outcomes) {
          expect(table.some(([f, o]) => f === from && o === outcome)).toBe(true);
        }
      }
    });

    it('leaves payments that are not payouts in flight (completed, refunded) alone', () => {
      for (const from of ['completed', 'refunded', 'whatever']) {
        for (const outcome of outcomes) {
          expect(resolveWebhookTransition(from, outcome).next).toBeNull();
        }
      }
    });

    it('never moves a settled payout backwards, whatever order events arrive in', () => {
      // processed, then a late "initiated", then a late "rejected"
      let state = 'processing';
      for (const outcome of ['succeeded', 'in_flight', 'failed'] as const) {
        const t = resolveWebhookTransition(state, outcome);
        if (t.next) state = t.next;
      }
      expect(state).toBe('succeeded');
    });
  });

  describe('idempotency keys', () => {
    const id = '3f2b8c1e-9a47-4d55-8b0e-1c2d3e4f5a6b';
    const compact = '3f2b8c1e9a474d558b0e1c2d3e4f5a6b';

    it('attempt 1 is the payment id alone; later attempts are distinct and deterministic', () => {
      expect(payoutIdempotencyKey(id, 1)).toBe(id);
      expect(payoutIdempotencyKey(id, 2)).toBe(`${compact}-r1`);
      expect(payoutIdempotencyKey(id, 3)).toBe(`${compact}-r2`);
      expect(payoutIdempotencyKey(id, 2)).toBe(payoutIdempotencyKey(id, 2));
      const keys = new Set(Array.from({ length: MAX_PAYOUT_ATTEMPTS }, (_, i) => payoutIdempotencyKey(id, i + 1)));
      expect(keys.size).toBe(MAX_PAYOUT_ATTEMPTS);
    });

    it('every permitted attempt fits RazorpayX\'s 4-36 character key limit and its allowed characters', () => {
      for (let n = 1; n <= MAX_PAYOUT_ATTEMPTS; n++) {
        const key = payoutIdempotencyKey(id, n);
        expect(key.length).toBeGreaterThanOrEqual(4);
        expect(key.length).toBeLessThanOrEqual(MAX_IDEMPOTENCY_KEY_LENGTH);
        expect(key).toMatch(/^[A-Za-z0-9_ -]+$/);
      }
      // the cap is operational, not a key-length limit: keys stay valid far beyond it
      expect(payoutIdempotencyKey(id, 99).length).toBeLessThanOrEqual(MAX_IDEMPOTENCY_KEY_LENGTH);
    });

    it('two different payments never share a key for any attempt', () => {
      const other = '9a8b7c6d-1111-4222-8333-444455556666';
      for (let n = 1; n <= MAX_PAYOUT_ATTEMPTS; n++) {
        for (let m = 1; m <= MAX_PAYOUT_ATTEMPTS; m++) {
          expect(payoutIdempotencyKey(id, n)).not.toBe(payoutIdempotencyKey(other, m));
        }
      }
    });

    it('recovers the payment id from any of our keys and rejects foreign references', () => {
      for (let n = 1; n <= MAX_PAYOUT_ATTEMPTS; n++) {
        expect(paymentIdFromReference(payoutIdempotencyKey(id, n))).toBe(id);
      }
      expect(paymentIdFromReference(id.toUpperCase())).toBe(id);
      expect(paymentIdFromReference('pout_abc123')).toBeNull();
      expect(paymentIdFromReference(`${id}-x`)).toBeNull();
      expect(paymentIdFromReference(null)).toBeNull();
      expect(paymentIdFromReference(42)).toBeNull();
    });
  });
});

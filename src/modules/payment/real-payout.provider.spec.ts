import * as crypto from 'crypto';
import { RealPaymentProvider } from './real-payment.provider';

const PAYMENT_ID = '3f2b8c1e-9a47-4d55-8b0e-1c2d3e4f5a6b';
const SECRET = 'rzpx_webhook_secret_for_tests';

type Reply = { status?: number; body?: unknown; throws?: Error };

function providerReplying(reply: Reply) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (reply.throws) throw reply.throws;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body ?? {}),
    } as Response;
  }) as unknown as typeof fetch;
  const provider = new RealPaymentProvider({
    keyId: 'k',
    keySecret: 's',
    webhookSecret: 'unused_collection_secret',
    payoutWebhookSecret: SECRET,
    fetchFn,
  });
  return { provider, calls };
}

const disburse = (provider: RealPaymentProvider, extra: Record<string, unknown> = {}) =>
  provider.disbursePayout(20000, 'referral', 'RF-1', { paymentId: PAYMENT_ID, ...extra });

describe('Phase 8: RealPaymentProvider payout dispatch (RazorpayX statuses)', () => {
  describe('gateway status -> our result', () => {
    it('processed is the only final success', async () => {
      const { provider } = providerReplying({ body: { id: 'pout_1', status: 'processed' } });
      expect(await disburse(provider)).toEqual({
        success: true,
        gatewayReference: 'pout_1',
        status: 'succeeded',
      });
    });

    it.each(['processing', 'queued', 'pending', 'scheduled'])(
      '%s is accepted but NOT recorded as succeeded',
      async (status) => {
        const { provider } = providerReplying({ body: { id: 'pout_2', status } });
        const res = await disburse(provider);
        expect(res.status).toBe('processing');
        expect(res.success).toBe(true);
        expect(res.gatewayReference).toBe('pout_2');
        expect(res.ambiguous).toBeUndefined();
      },
    );

    it('an unrecognised status is treated as in flight, never as paid and never as safe to retry', async () => {
      const { provider } = providerReplying({ body: { id: 'pout_3', status: 'teleported' } });
      expect((await disburse(provider)).status).toBe('processing');
    });

    it.each(['rejected', 'cancelled', 'failed', 'reversed'])(
      '%s is a definitive failure',
      async (status) => {
        const { provider } = providerReplying({
          body: { id: 'pout_4', status, failure_reason: 'beneficiary_bank_rejected' },
        });
        const res = await disburse(provider);
        expect(res.status).toBe('failed');
        expect(res.success).toBe(false);
        expect(res.failureReason).toBe('beneficiary_bank_rejected');
      },
    );
  });

  describe('transport failures', () => {
    it('a 4xx means the request was refused: definitive failure, no payout id', async () => {
      const { provider } = providerReplying({ status: 400, body: { error: 'bad fund account' } });
      const res = await disburse(provider);
      expect(res).toMatchObject({ status: 'failed', success: false, gatewayReference: '' });
    });

    it('a 5xx is AMBIGUOUS: the gateway may have created the payout, so it must not read as failed', async () => {
      const { provider } = providerReplying({ status: 502, body: { error: 'bad gateway' } });
      const res = await disburse(provider);
      expect(res).toMatchObject({ status: 'processing', ambiguous: true, gatewayReference: '' });
    });

    it('a network error or timeout is AMBIGUOUS, not failed', async () => {
      const { provider } = providerReplying({ throws: new Error('socket hang up') });
      const res = await disburse(provider);
      expect(res).toMatchObject({ status: 'processing', ambiguous: true, gatewayReference: '' });
      expect(res.failureReason).toContain('socket hang up');
    });
  });

  describe('request: idempotency key per attempt, and the paymentId echoed in notes', () => {
    it('attempt 1 uses the payment id; the same attempt twice sends the identical key', async () => {
      const { provider, calls } = providerReplying({ body: { id: 'pout_5', status: 'processing' } });
      await disburse(provider);
      await disburse(provider);

      for (const c of calls) {
        const headers = c.init?.headers as Record<string, string>;
        const body = JSON.parse(c.init?.body as string);
        expect(headers['X-Payout-Idempotency']).toBe(PAYMENT_ID);
        expect(body.reference_id).toBe(PAYMENT_ID);
        expect(body.notes.paymentId).toBe(PAYMENT_ID);
        expect(body.amount).toBe(20000);
      }
    });

    it('a deliberate retry (attempt 2+) gets a different key, so the gateway makes a new payout', async () => {
      const { provider, calls } = providerReplying({ body: { id: 'pout_6', status: 'processing' } });
      await disburse(provider, { attempt: 1 });
      await disburse(provider, { attempt: 2 });
      await disburse(provider, { attempt: 3 });

      const keys = calls.map((c) => (c.init?.headers as Record<string, string>)['X-Payout-Idempotency']);
      const compact = PAYMENT_ID.replace(/-/g, '');
      expect(keys).toEqual([PAYMENT_ID, `${compact}-r1`, `${compact}-r2`]);
      // RazorpayX: idempotency keys are 4-36 characters
      for (const k of keys) expect(k.length).toBeLessThanOrEqual(36);
      for (const c of calls) {
        expect(JSON.parse(c.init?.body as string).reference_id.length).toBeLessThanOrEqual(36);
      }
    });

    it('refuses an attempt number outside 1..9 (a longer key would not fit the gateway limit)', async () => {
      const { provider, calls } = providerReplying({ body: { id: 'x', status: 'processed' } });
      await expect(disburse(provider, { attempt: 0 })).rejects.toThrow('attempt');
      await expect(disburse(provider, { attempt: 10 })).rejects.toThrow('attempt');
      expect(calls).toHaveLength(0);
    });
  });
});

describe('Phase 8: RealPaymentProvider.verifyPayoutWebhook', () => {
  const sign = (raw: string | Buffer, secret = SECRET) =>
    crypto.createHmac('sha256', secret).update(raw).digest('hex');

  const event = (status: string, extra: Record<string, unknown> = {}, name = `payout.${status}`) => ({
    entity: 'event',
    account_id: 'acc_1',
    event: name,
    contains: ['payout'],
    payload: {
      payout: {
        entity: {
          id: 'pout_w1',
          entity: 'payout',
          amount: 20000,
          currency: 'INR',
          status,
          utr: '523223155921',
          mode: 'UPI',
          reference_id: PAYMENT_ID,
          notes: { paymentId: PAYMENT_ID },
          failure_reason: null,
          status_details: { description: 'Payout processed and credited to the beneficiary account.' },
          ...extra,
        },
      },
    },
    created_at: 1755693679,
  });

  const { provider } = providerReplying({ body: {} });

  it('verifies a genuinely signed processed event and parses the documented shape', async () => {
    const raw = JSON.stringify(event('processed'));
    const res = await provider.verifyPayoutWebhook(raw, sign(raw));

    expect(res).toMatchObject({
      isValid: true,
      event: 'payout.processed',
      payoutId: 'pout_w1',
      referenceId: PAYMENT_ID,
      paymentIdHint: PAYMENT_ID,
      gatewayStatus: 'processed',
      outcome: 'succeeded',
      amountPaise: 20000,
      utr: '523223155921',
    });
  });

  it('verifies against the RAW bytes: a body whose re-serialisation differs still passes', async () => {
    // pretty-printed, with a unicode escape; JSON.stringify(JSON.parse(raw)) is a different string
    const raw = JSON.stringify(event('processed', { notes: { paymentId: PAYMENT_ID, memo: 'café' } }), null, 2);
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);

    expect((await provider.verifyPayoutWebhook(raw, sign(raw))).isValid).toBe(true);
    // ...and a signature computed over the re-serialised copy is NOT accepted for the original bytes
    expect(
      (await provider.verifyPayoutWebhook(raw, sign(JSON.stringify(JSON.parse(raw))))).isValid,
    ).toBe(false);
  });

  it('accepts the body as a Buffer, the form the HTTP layer provides', async () => {
    const raw = Buffer.from(JSON.stringify(event('reversed')), 'utf8');
    const res = await provider.verifyPayoutWebhook(raw, sign(raw));
    expect(res).toMatchObject({ isValid: true, outcome: 'reversed' });
  });

  it('rejects a tampered body, a missing signature, a wrong secret and a non-JSON body', async () => {
    const raw = JSON.stringify(event('processed'));
    const sig = sign(raw);

    expect((await provider.verifyPayoutWebhook(raw.replace('20000', '90000'), sig)).isValid).toBe(false);
    expect((await provider.verifyPayoutWebhook(raw, undefined)).isValid).toBe(false);
    expect((await provider.verifyPayoutWebhook(raw, '')).isValid).toBe(false);
    expect((await provider.verifyPayoutWebhook(raw, sign(raw, 'someone_elses_secret'))).isValid).toBe(false);
    expect((await provider.verifyPayoutWebhook('not json', sign('not json'))).isValid).toBe(false);
    expect((await provider.verifyPayoutWebhook(raw, 'short')).isValid).toBe(false);
  });

  it('uses the RazorpayX webhook secret, not the collection-webhook secret', async () => {
    const raw = JSON.stringify(event('processed'));
    expect((await provider.verifyPayoutWebhook(raw, sign(raw, 'unused_collection_secret'))).isValid).toBe(false);
  });

  it.each([
    ['payout.pending', 'pending', 'in_flight'],
    ['payout.queued', 'queued', 'in_flight'],
    ['payout.initiated', 'processing', 'in_flight'],
    ['payout.processed', 'processed', 'succeeded'],
    ['payout.updated', 'processed', 'succeeded'],
    ['payout.rejected', 'rejected', 'failed'],
    ['payout.failed', 'failed', 'failed'],
    ['payout.reversed', 'reversed', 'reversed'],
  ])('event %s (status %s) maps to %s', async (name, status, outcome) => {
    const raw = JSON.stringify(event(status, {}, name));
    expect(await provider.verifyPayoutWebhook(raw, sign(raw))).toMatchObject({ isValid: true, outcome });
  });

  it('finds our payment through notes when the gateway sends reference_id null (as in its samples)', async () => {
    const raw = JSON.stringify(event('processed', { reference_id: null }));
    expect(await provider.verifyPayoutWebhook(raw, sign(raw))).toMatchObject({
      referenceId: null,
      paymentIdHint: PAYMENT_ID,
    });
  });

  it('recovers the payment id from a retry attempt key', async () => {
    const raw = JSON.stringify(
      event('processed', { reference_id: `${PAYMENT_ID.replace(/-/g, '')}-r2`, notes: {} }),
    );
    expect((await provider.verifyPayoutWebhook(raw, sign(raw))).paymentIdHint).toBe(PAYMENT_ID);
  });

  it('a validly signed event that is not about one payout (downtime) parses to outcome unknown', async () => {
    const raw = JSON.stringify({
      entity: 'event',
      event: 'payout.downtime.started',
      contains: ['payout.downtime'],
      payload: { 'payout.downtime': { entity: { id: 'down_1', status: 'started' } } },
    });
    expect(await provider.verifyPayoutWebhook(raw, sign(raw))).toMatchObject({
      isValid: true,
      outcome: 'unknown',
      payoutId: '',
    });
  });
});

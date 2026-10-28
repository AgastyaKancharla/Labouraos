import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { RealPaymentProvider } from './real-payment.provider';

const SECRET = 'rzpx_webhook_secret_integration';

describe('Phase 8: RazorpayX payout-status webhook (POST /payments/payout-webhook)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let idService: IdService;
  const timestamp = Date.now();
  let ceoStaffId: string;
  let seq = 0;
  const paymentIds: string[] = [];
  const referralIds: string[] = [];

  const sign = (raw: string) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(new RealPaymentProvider({ payoutWebhookSecret: SECRET }))
      .compile();
    // rawBody mirrors main.ts: the signature is over the bytes the gateway sent
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    // audit entries need a staff row to attribute to; don't rely on other suites leaving one behind
    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-PW-${timestamp}`,
        name: 'Audit actor',
        email: `ceo_pw_${timestamp}@laboura.local`,
        passwordHash: 'not-a-real-hash',
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    ceoStaffId = ceo.id;
  });

  afterAll(async () => {
    const payments = await prisma.payment.findMany({
      where: { id: { in: paymentIds } },
      select: { code: true },
    });
    await prisma.auditLog.deleteMany({
      where: { entityCode: { in: payments.map((p) => p.code) } },
    });
    await prisma.payoutWebhookEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: ceoStaffId } });
    await prisma.staff.deleteMany({ where: { id: ceoStaffId } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    await app.close();
  });

  const makePayout = async (
    over: { status?: string; payoutAttempts?: number; gatewayReference?: string; amount?: number } = {},
  ) => {
    seq += 1;
    const referral = await prisma.referral.create({
      data: {
        code: `RF-PW-${timestamp}-${seq}`,
        name: 'Webhook Partner',
        phone: `95${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`,
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });
    referralIds.push(referral.id);
    const payment = await prisma.payment.create({
      data: {
        code: await idService.generateCode('payment'),
        type: 'referral_payout',
        amount: over.amount ?? 20000,
        status: over.status ?? 'processing',
        payoutAttempts: over.payoutAttempts ?? 1,
        gatewayReference: over.gatewayReference ?? `gw_pw_${timestamp}_${seq}`,
        subjectType: 'referral',
        subjectId: referral.id,
        referralId: referral.id,
        city: 'Bengaluru',
      },
    });
    paymentIds.push(payment.id);
    return payment;
  };

  const body = (
    paymentId: string,
    status: string,
    over: { name?: string; payoutId?: string; amount?: number; referenceId?: string | null; notes?: object } = {},
  ) => ({
    entity: 'event',
    account_id: 'acc_test',
    event: over.name ?? `payout.${status === 'processing' ? 'initiated' : status}`,
    contains: ['payout'],
    payload: {
      payout: {
        entity: {
          id: over.payoutId ?? `pout_${paymentId.slice(0, 8)}`,
          entity: 'payout',
          amount: over.amount ?? 20000,
          currency: 'INR',
          status,
          utr: status === 'processed' ? '523223155921' : null,
          reference_id: over.referenceId === undefined ? paymentId : over.referenceId,
          notes: over.notes ?? { paymentId },
          failure_reason: status === 'rejected' ? 'beneficiary_bank_rejected' : null,
        },
      },
    },
    created_at: 1755693679,
  });

  let eventCounter = 0;
  const deliver = (
    payload: object | string,
    opts: { eventId?: string | null; signature?: string | null } = {},
  ) => {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    eventCounter += 1;
    let req = request(app.getHttpServer())
      .post('/payments/payout-webhook')
      .set('Content-Type', 'application/json');
    if (opts.signature !== null) req = req.set('x-razorpay-signature', opts.signature ?? sign(raw));
    if (opts.eventId !== null) {
      req = req.set('x-razorpay-event-id', opts.eventId ?? `evt_${timestamp}_${eventCounter}`);
    }
    return req.send(raw);
  };

  const reload = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });
  const webhookAudits = (code: string) =>
    prisma.auditLog.findMany({ where: { entityCode: code, action: 'payout_status_webhook' } });

  describe('authentication', () => {
    it('rejects a bad signature (400) and changes nothing', async () => {
      const p = await makePayout();
      const res = await deliver(body(p.id, 'processed'), { signature: 'f'.repeat(64) });

      expect(res.status).toBe(400);
      expect((await reload(p.id)).status).toBe('processing');
      expect(await prisma.payoutWebhookEvent.count({ where: { paymentId: p.id } })).toBe(0);
    });

    it('rejects a missing signature (400)', async () => {
      const p = await makePayout();
      expect((await deliver(body(p.id, 'processed'), { signature: null })).status).toBe(400);
      expect((await reload(p.id)).status).toBe('processing');
    });

    it('rejects a body altered after signing', async () => {
      const p = await makePayout();
      const raw = JSON.stringify(body(p.id, 'processed'));
      const res = await deliver(raw.replace('"processed"', '"reversed"'), { signature: sign(raw) });
      expect(res.status).toBe(400);
    });

    it('verifies the raw bytes: a pretty-printed body with a signature over those bytes is accepted', async () => {
      const p = await makePayout();
      const raw = JSON.stringify(body(p.id, 'processed'), null, 4);
      expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);

      const res = await deliver(raw);
      expect(res.status).toBe(200);
      expect((await reload(p.id)).status).toBe('succeeded');
    });

    it('is not behind JWT: no Authorization header is needed, only the signature', async () => {
      const p = await makePayout();
      const res = await deliver(body(p.id, 'processed'));
      expect(res.status).toBe(200);
    });
  });

  describe('applying outcomes', () => {
    it('processed: processing -> succeeded, records the payout id, and writes an audit row', async () => {
      const p = await makePayout();
      const res = await deliver(body(p.id, 'processed', { payoutId: 'pout_applied_1' }));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ received: true, applied: true, status: 'succeeded' });
      const after = await reload(p.id);
      expect(after.status).toBe('succeeded');
      expect(after.gatewayReference).toBe('pout_applied_1');

      const audits = await webhookAudits(p.code);
      expect(audits).toHaveLength(1);
      expect(audits[0].before).toMatchObject({ status: 'processing' });
      expect(audits[0].after).toMatchObject({
        status: 'succeeded',
        source: 'razorpayx_webhook',
        utr: '523223155921',
        correction: false,
      });
    });

    it.each([
      ['rejected', 'failed'],
      ['failed', 'failed'],
      ['cancelled', 'failed'],
      ['reversed', 'reversed'],
    ])('%s: processing -> %s', async (gatewayStatus, expected) => {
      const p = await makePayout();
      const res = await deliver(body(p.id, gatewayStatus));
      expect(res.status).toBe(200);
      expect((await reload(p.id)).status).toBe(expected);
    });

    it('an in-flight event leaves the status alone but records the payout id', async () => {
      const p = await makePayout();
      await deliver(body(p.id, 'queued', { name: 'payout.queued', payoutId: 'pout_inflight_1' }));

      const after = await reload(p.id);
      expect(after.status).toBe('processing');
      expect(after.gatewayReference).toBe('pout_inflight_1');
      expect(await webhookAudits(p.code)).toHaveLength(0);
    });

    it('a later "reversed" overturns an earlier "processed" (documented T+3 failure)', async () => {
      const p = await makePayout();
      await deliver(body(p.id, 'processed'));
      const res = await deliver(body(p.id, 'reversed'));

      expect(res.body).toMatchObject({ applied: true, status: 'reversed' });
      expect((await reload(p.id)).status).toBe('reversed');
      expect(await webhookAudits(p.code)).toHaveLength(2);
    });

    it('the gateway saying "processed" corrects a payout we had recorded as failed', async () => {
      const p = await makePayout({ status: 'failed' });
      const res = await deliver(body(p.id, 'processed'));

      expect(res.body).toMatchObject({ applied: true, status: 'succeeded' });
      const audits = await webhookAudits(p.code);
      expect(audits[0].after).toMatchObject({ correction: true });
    });
  });

  describe('idempotency (AGENTS.md §2 rule 7)', () => {
    it('the same event delivered twice is applied once', async () => {
      const p = await makePayout();
      const eventId = `evt_dup_${timestamp}_a`;
      const payload = body(p.id, 'processed');

      const first = await deliver(payload, { eventId });
      const second = await deliver(payload, { eventId });

      expect(first.body.applied).toBe(true);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ received: true, duplicate: true });
      expect(await webhookAudits(p.code)).toHaveLength(1);
      expect(await prisma.payoutWebhookEvent.count({ where: { eventId } })).toBe(1);
    });

    it('five concurrent deliveries of the same event apply exactly once', async () => {
      const p = await makePayout();
      const eventId = `evt_conc_${timestamp}_b`;
      const payload = body(p.id, 'processed');

      const results = await Promise.all(Array.from({ length: 5 }, () => deliver(payload, { eventId })));

      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.applied === true)).toHaveLength(1);
      expect(results.filter((r) => r.body.duplicate === true)).toHaveLength(4);
      expect(await webhookAudits(p.code)).toHaveLength(1);
      expect((await reload(p.id)).status).toBe('succeeded');
    });

    it('the same outcome under a NEW event id is still a no-op (state machine, not just the event table)', async () => {
      const p = await makePayout();
      await deliver(body(p.id, 'processed'));
      const replay = await deliver(body(p.id, 'processed'));

      expect(replay.body).toMatchObject({ applied: false, reason: 'duplicate', status: 'succeeded' });
      expect(await webhookAudits(p.code)).toHaveLength(1);
    });

    it('with no event-id header, an identical body is still deduplicated', async () => {
      const p = await makePayout();
      const raw = JSON.stringify(body(p.id, 'processed'));
      const a = await deliver(raw, { eventId: null });
      const b = await deliver(raw, { eventId: null });

      expect(a.body.applied).toBe(true);
      expect(b.body.duplicate).toBe(true);
    });
  });

  describe('ordering', () => {
    it('decides from the status as it is when it gets the row lock, not from an earlier read', async () => {
      // Deterministic lost-update check. This test holds the payment row locked in its
      // own transaction, fires a stale "rejected" webhook, and only then commits
      // "succeeded". With the handler's FOR UPDATE it waits, re-reads "succeeded" and
      // ignores the stale event. Without it, it would have decided from its earlier
      // read of "processing" and overwritten the payout as failed.
      const p = await makePayout();
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));

      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "Payment" WHERE "id" = ${p.id} FOR UPDATE`;
          locked();
          await held;
          await tx.payment.update({ where: { id: p.id }, data: { status: 'succeeded' } });
        },
        { timeout: 20000 },
      );
      await lockTaken;

      // supertest is lazy: .then() is what actually sends the request now
      const inFlight = deliver(body(p.id, 'rejected')).then((r) => r);
      await new Promise((r) => setTimeout(r, 400)); // let the handler reach the lock
      release();
      await holder;
      const res = await inFlight;

      expect(res.status).toBe(200);
      expect((await reload(p.id)).status).toBe('succeeded');
      expect(res.body).toMatchObject({ applied: false, reason: 'stale' });
    });

    it('a burst of different events for one payout settles on the gateway outcome', async () => {
      for (let i = 0; i < 4; i++) {
        const p = await makePayout();
        await Promise.all([
          deliver(body(p.id, 'rejected')),
          deliver(body(p.id, 'processed')),
          deliver(body(p.id, 'processing')),
        ]);
        expect((await reload(p.id)).status).toBe('succeeded');
      }
    });

    it('late in-flight and rejected events never walk a processed payout backwards', async () => {
      const p = await makePayout();
      await deliver(body(p.id, 'processed'));
      const late1 = await deliver(body(p.id, 'processing'));
      const late2 = await deliver(body(p.id, 'rejected'));

      expect(late1.body.applied).toBe(false);
      expect(late2.body.applied).toBe(false);
      expect((await reload(p.id)).status).toBe('succeeded');
    });

    it('reversed is terminal: nothing after it changes the payment', async () => {
      const p = await makePayout();
      await deliver(body(p.id, 'reversed'));
      for (const status of ['processed', 'failed', 'processing']) {
        const res = await deliver(body(p.id, status));
        expect(res.body).toMatchObject({ applied: false, reason: 'terminal' });
      }
      expect((await reload(p.id)).status).toBe('reversed');
    });
  });

  describe('finding the payment', () => {
    it('matches by notes.paymentId when we never learned the payout id and reference_id is null', async () => {
      const p = await makePayout({ gatewayReference: `gw_never_got_a_response_${timestamp}` });
      const res = await deliver(body(p.id, 'processed', { referenceId: null, payoutId: 'pout_late_1' }));

      expect(res.body.applied).toBe(true);
      const after = await reload(p.id);
      expect(after.status).toBe('succeeded');
      expect(after.gatewayReference).toBe('pout_late_1');
    });

    it('matches by reference_id (including a retry-attempt key) when notes are empty', async () => {
      const p = await makePayout();
      const res = await deliver(body(p.id, 'processed', { referenceId: `${p.id.replace(/-/g, '')}-r2`, notes: {} }));
      expect(res.body.applied).toBe(true);
    });

    it('matches by the payout id we already stored', async () => {
      const p = await makePayout({ gatewayReference: 'pout_known_1' });
      const res = await deliver(
        body(p.id, 'processed', { payoutId: 'pout_known_1', referenceId: null, notes: {} }),
      );
      expect(res.body.applied).toBe(true);
    });

    it('acknowledges (200) an event for a payout we do not know, changing nothing', async () => {
      const res = await deliver(
        body('00000000-0000-4000-8000-000000000000', 'processed', { payoutId: 'pout_stranger' }),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ received: true, matched: false });
    });

    it('ignores an event for a payment that was never sent as a payout', async () => {
      const p = await makePayout({ status: 'pending', payoutAttempts: 0 });
      const res = await deliver(body(p.id, 'processed'));

      expect(res.body).toMatchObject({ matched: false });
      expect((await reload(p.id)).status).toBe('pending');
    });

    it('refuses to apply an event whose amount differs from the payment', async () => {
      const p = await makePayout({ amount: 20000 });
      const res = await deliver(body(p.id, 'processed', { amount: 99999 }));

      expect(res.body).toMatchObject({ ignored: 'amount_mismatch' });
      expect((await reload(p.id)).status).toBe('processing');
    });

    it('acknowledges non-payout events such as downtime notices', async () => {
      const raw = JSON.stringify({
        entity: 'event',
        event: 'payout.downtime.started',
        contains: ['payout.downtime'],
        payload: { 'payout.downtime': { entity: { id: 'down_1', status: 'started' } } },
      });
      const res = await deliver(raw);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ received: true, ignored: 'not_a_payout_status_event' });
    });
  });

  describe('safety if the app is started without rawBody', () => {
    it('fails closed (400) instead of verifying a re-serialised body', async () => {
      const bare = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PAYMENT_PROVIDER)
        .useValue(new RealPaymentProvider({ payoutWebhookSecret: SECRET }))
        .compile();
      const bareApp = bare.createNestApplication(); // no rawBody
      await bareApp.init();
      try {
        const p = await makePayout();
        const raw = JSON.stringify(body(p.id, 'processed'));
        const res = await request(bareApp.getHttpServer())
          .post('/payments/payout-webhook')
          .set('Content-Type', 'application/json')
          .set('x-razorpay-signature', sign(raw))
          .send(raw);

        expect(res.status).toBe(400);
        expect((await reload(p.id)).status).toBe('processing');
      } finally {
        await bareApp.close();
      }
    });
  });
});

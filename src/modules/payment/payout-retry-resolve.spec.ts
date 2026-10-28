import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';

describe('Phase 8: retrying a failed payout and manually resolving a stuck one', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let idService: IdService;
  let provider: PaymentProvider;
  const timestamp = Date.now();
  const password = 'Password123!';
  let seq = 0;
  const paymentIds: string[] = [];
  const referralIds: string[] = [];
  const staffEmails: string[] = [];
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    provider = app.get<PaymentProvider>(PAYMENT_PROVIDER);

    const passwordHash = await bcrypt.hash(password, 10);
    const roles: Array<[string, string, string?]> = [
      ['ceo', 'ceo'],
      ['manager', 'manager'],
      ['finance', 'finance'],
      ['call_agent', 'call_agent'],
      ['field_agent', 'field_agent', 'Indiranagar'],
      ['team_lead', 'team_lead'],
    ];
    for (const [key, role, area] of roles) {
      const email = `${key}_prr_${timestamp}@laboura.local`;
      staffEmails.push(email);
      await prisma.staff.create({
        data: {
          code: `PRR-${key.toUpperCase()}-${timestamp}`,
          name: `PRR ${key}`,
          email,
          passwordHash,
          role,
          area: area ?? null,
          city: 'Bengaluru',
        },
      });
      const login = await enrolledLogin(app.getHttpServer(), { email, password }).expect(200);
      tokens[key] = login.body.accessToken;
    }
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    const payments = await prisma.payment.findMany({
      where: { id: { in: paymentIds } },
      select: { code: true },
    });
    const staff = await prisma.staff.findMany({
      where: { email: { in: staffEmails } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityCode: { in: payments.map((p) => p.code) } },
          { actorId: { in: staff.map((s) => s.id) } },
        ],
      },
    });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staff.map((s) => s.id) } } });
    await prisma.staff.deleteMany({ where: { email: { in: staffEmails } } });
    await app.close();
  });

  const makePayout = async (over: { status?: string; payoutAttempts?: number; gatewayReference?: string } = {}) => {
    seq += 1;
    const referral = await prisma.referral.create({
      data: {
        code: `RF-RR-${timestamp}-${seq}`,
        name: 'Retry Partner',
        phone: `96${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`,
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
        amount: 20000,
        status: over.status ?? 'failed',
        payoutAttempts: over.payoutAttempts ?? 1,
        gatewayReference: over.gatewayReference ?? `gw_rr_${timestamp}_${seq}`,
        subjectType: 'referral',
        subjectId: referral.id,
        referralId: referral.id,
        city: 'Bengaluru',
      },
    });
    paymentIds.push(payment.id);
    return payment;
  };

  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const retry = (id: string, who = 'ceo') =>
    request(app.getHttpServer()).post(`/payments/${id}/retry-payout`).set(as(who));
  const resolve = (id: string, body: object, who = 'ceo') =>
    request(app.getHttpServer()).post(`/payments/${id}/resolve-payout`).set(as(who)).send(body);
  const reload = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });
  const audits = (code: string, action: string) =>
    prisma.auditLog.findMany({ where: { entityCode: code, action } });

  const providerReturns = (r: Partial<Awaited<ReturnType<PaymentProvider['disbursePayout']>>>) =>
    jest.spyOn(provider, 'disbursePayout').mockResolvedValue({
      success: true,
      gatewayReference: `pout_stub_${Math.random().toString(36).slice(2, 10)}`,
      status: 'succeeded',
      ...r,
    });

  describe('RBAC: only CEO and Manager', () => {
    it.each(['finance', 'call_agent', 'field_agent', 'team_lead'])('%s is denied retry and resolve (403) and nothing changes', async (who) => {
      const failed = await makePayout({ status: 'failed' });
      const stuck = await makePayout({ status: 'processing' });
      const spy = providerReturns({});

      expect((await retry(failed.id, who)).status).toBe(403);
      expect(
        (await resolve(stuck.id, { outcome: 'failed', note: 'checked' }, who)).status,
      ).toBe(403);

      expect(spy).not.toHaveBeenCalled();
      expect((await reload(failed.id)).status).toBe('failed');
      expect((await reload(stuck.id)).status).toBe('processing');
    });

    it('unauthenticated callers get 401', async () => {
      const p = await makePayout();
      const server = app.getHttpServer();
      expect((await request(server).post(`/payments/${p.id}/retry-payout`)).status).toBe(401);
      expect((await request(server).post(`/payments/${p.id}/resolve-payout`).send({})).status).toBe(401);
    });
  });

  describe('retry a failed payout', () => {
    it('CEO retries: new attempt number reaches the provider, payout settles, audit row written', async () => {
      const p = await makePayout({ status: 'failed', payoutAttempts: 1 });
      const spy = providerReturns({ status: 'succeeded', gatewayReference: `pout_retry_ok_${timestamp}` });

      const res = await retry(p.id);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('succeeded');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        p.amount,
        p.subjectType,
        p.subjectId,
        expect.objectContaining({ paymentId: p.id, attempt: 2 }),
      );
      const after = await reload(p.id);
      expect(after.payoutAttempts).toBe(2);
      expect(after.gatewayReference).toBe(`pout_retry_ok_${timestamp}`);

      const rows = await audits(p.code, 'payout_retry');
      expect(rows).toHaveLength(1);
      expect(rows[0].before).toMatchObject({ status: 'failed', payoutAttempts: 1 });
      expect(rows[0].after).toMatchObject({ status: 'succeeded', payoutAttempts: 2 });
    });

    it('Manager may retry, and a reversed payout is retryable too', async () => {
      const p = await makePayout({ status: 'reversed', payoutAttempts: 1 });
      providerReturns({ status: 'processing' });

      const res = await retry(p.id, 'manager');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('processing');
    });

    it.each(['pending', 'succeeded', 'completed'])('refuses to retry a payout that is %s (400)', async (status) => {
      const p = await makePayout({ status, payoutAttempts: status === 'pending' ? 0 : 1 });
      const spy = providerReturns({});

      expect((await retry(p.id)).status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
      expect((await reload(p.id)).status).toBe(status);
    });

    it('refuses to retry a payout stuck in processing: it may already have been paid', async () => {
      const p = await makePayout({ status: 'processing' });
      const spy = providerReturns({});

      const res = await retry(p.id);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/resolve/i);
      expect(spy).not.toHaveBeenCalled();
    });

    it('refuses a payment that was never sent as a payout, even if it says failed', async () => {
      const p = await makePayout({ status: 'failed', payoutAttempts: 0 });
      const spy = providerReturns({});

      expect((await retry(p.id)).status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });

    it('stops at the attempt cap instead of looping forever', async () => {
      const p = await makePayout({ status: 'failed', payoutAttempts: 9 });
      const spy = providerReturns({});

      const res = await retry(p.id);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/escalate/i);
      expect(spy).not.toHaveBeenCalled();
    });

    it('404s for an unknown payment', async () => {
      expect((await retry('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    });

    it('two concurrent retries of one failed payout make exactly one provider call (atomic claim)', async () => {
      const p = await makePayout({ status: 'failed', payoutAttempts: 1 });
      const spy = jest.spyOn(provider, 'disbursePayout').mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { success: true, gatewayReference: `pout_conc_${timestamp}`, status: 'succeeded' as const };
      });

      const results = await Promise.all([retry(p.id), retry(p.id, 'manager'), retry(p.id)]);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(2);
      expect((await reload(p.id)).payoutAttempts).toBe(2);
      expect(await audits(p.code, 'payout_retry')).toHaveLength(1);
    });

    it('an ambiguous retry leaves the payment processing, and it cannot then be retried again', async () => {
      const p = await makePayout({ status: 'failed', payoutAttempts: 1 });
      const spy = providerReturns({ status: 'processing', gatewayReference: '', ambiguous: true });

      const first = await retry(p.id);
      expect(first.body.status).toBe('processing');

      const second = await retry(p.id);
      expect(second.status).toBe(400);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('the dispatch path records what the gateway actually said', () => {
    it('an in-flight response is processing, not succeeded, and keeps the payout id', async () => {
      const p = await makePayout({ status: 'pending', payoutAttempts: 0 });
      providerReturns({ status: 'processing', gatewayReference: `pout_inflight_${timestamp}` });

      const res = await request(app.getHttpServer())
        .post(`/payments/${p.id}/disburse`)
        .set(as('ceo'))
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('processing');
      expect((await reload(p.id)).gatewayReference).toBe(`pout_inflight_${timestamp}`);
    });

    it('an ambiguous response keeps the payment processing and does not overwrite its reference', async () => {
      const p = await makePayout({ status: 'pending', payoutAttempts: 0, gatewayReference: `gw_keep_${timestamp}` });
      providerReturns({ status: 'processing', gatewayReference: '', ambiguous: true });

      await request(app.getHttpServer()).post(`/payments/${p.id}/disburse`).set(as('ceo')).send({});

      const after = await reload(p.id);
      expect(after.status).toBe('processing');
      expect(after.gatewayReference).toBe(`gw_keep_${timestamp}`);
      const rows = await audits(p.code, 'payout_release');
      expect(rows[0].after).toMatchObject({ ambiguous: true, gatewayResult: 'processing' });
    });

    it('a webhook that lands while the provider call is still open is not overwritten by the stale response', async () => {
      const p = await makePayout({ status: 'pending', payoutAttempts: 0 });
      jest.spyOn(provider, 'disbursePayout').mockImplementation(async () => {
        // the gateway's "processed" webhook is applied before our own call returns
        await prisma.payment.update({
          where: { id: p.id },
          data: { status: 'succeeded', gatewayReference: `pout_fast_${timestamp}` },
        });
        return { success: true, gatewayReference: '', status: 'processing' as const, ambiguous: true };
      });

      await request(app.getHttpServer()).post(`/payments/${p.id}/disburse`).set(as('ceo')).send({});

      const after = await reload(p.id);
      expect(after.status).toBe('succeeded');
      expect(after.gatewayReference).toBe(`pout_fast_${timestamp}`);
    });
  });

  it('a stale "succeeded" response never overwrites a "reversed" the webhook already recorded', async () => {
    const p = await makePayout({ status: 'pending', payoutAttempts: 0 });
    jest.spyOn(provider, 'disbursePayout').mockImplementation(async () => {
      // webhooks for processed AND reversed are applied while our request is still open
      await prisma.payment.update({
        where: { id: p.id },
        data: { status: 'reversed', gatewayReference: `pout_rev_${timestamp}` },
      });
      return { success: true, gatewayReference: `pout_stale_${timestamp}`, status: 'succeeded' as const };
    });

    await request(app.getHttpServer()).post(`/payments/${p.id}/disburse`).set(as('ceo')).send({});

    const after = await reload(p.id);
    expect(after.status).toBe('reversed');
    expect(after.gatewayReference).toBe(`pout_rev_${timestamp}`);
  });

  describe('manually resolve a stuck payout', () => {
    it('requires a valid outcome, a note, and (for succeeded) the gateway payout id', async () => {
      const p = await makePayout({ status: 'processing' });

      expect((await resolve(p.id, { outcome: 'maybe', note: 'x' })).status).toBe(400);
      expect((await resolve(p.id, { note: 'x' })).status).toBe(400);
      expect((await resolve(p.id, { outcome: 'failed' })).status).toBe(400);
      expect((await resolve(p.id, { outcome: 'failed', note: '   ' })).status).toBe(400);
      expect((await resolve(p.id, { outcome: 'succeeded', note: 'checked' })).status).toBe(400);
      expect((await reload(p.id)).status).toBe('processing');
    });

    it('resolves as succeeded with the gateway reference and an audit trail naming the actor and note', async () => {
      const p = await makePayout({ status: 'processing' });
      const note = 'RazorpayX dashboard shows processed, UTR 523223155921';

      const res = await resolve(p.id, { outcome: 'succeeded', gatewayReference: `pout_manual_${timestamp}`, note }, 'manager');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('succeeded');
      const after = await reload(p.id);
      expect(after.gatewayReference).toBe(`pout_manual_${timestamp}`);

      const rows = await audits(p.code, 'payout_resolved_manually');
      expect(rows).toHaveLength(1);
      expect(rows[0].before).toMatchObject({ status: 'processing' });
      expect(rows[0].after).toMatchObject({ status: 'succeeded', reconciliationNote: note });
      const manager = await prisma.staff.findUniqueOrThrow({ where: { email: staffEmails[1] } });
      expect(rows[0].actorId).toBe(manager.id);
    });

    it('resolves as failed, after which the payout can be retried', async () => {
      const p = await makePayout({ status: 'processing', payoutAttempts: 1 });
      const spy = providerReturns({ status: 'succeeded' });

      const resolved = await resolve(p.id, { outcome: 'failed', note: 'Gateway has no payout for this reference' });
      expect(resolved.body.status).toBe('failed');

      const retried = await retry(p.id);
      expect(retried.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ attempt: 2 }),
      );
    });

    it.each(['pending', 'failed', 'succeeded', 'reversed'])('refuses to resolve a payout that is %s (400)', async (status) => {
      const p = await makePayout({ status });
      const res = await resolve(p.id, { outcome: 'failed', note: 'checked' });
      expect(res.status).toBe(400);
      expect((await reload(p.id)).status).toBe(status);
    });

    it('404s for an unknown payment', async () => {
      expect((await resolve('00000000-0000-4000-8000-000000000000', { outcome: 'failed', note: 'x' })).status).toBe(404);
    });

    it('refuses a gateway reference already recorded against another payment, leaving the payout processing', async () => {
      const other = await makePayout({ status: 'succeeded', gatewayReference: `pout_taken_${timestamp}` });
      const p = await makePayout({ status: 'processing' });

      const res = await resolve(p.id, { outcome: 'succeeded', gatewayReference: other.gatewayReference, note: 'x' });

      expect(res.status).toBe(400);
      expect((await reload(p.id)).status).toBe('processing');
    });

    it('two concurrent resolutions: exactly one wins and exactly one audit row exists', async () => {
      const p = await makePayout({ status: 'processing' });

      const results = await Promise.all([
        resolve(p.id, { outcome: 'succeeded', gatewayReference: `pout_race_${timestamp}`, note: 'a' }),
        resolve(p.id, { outcome: 'failed', note: 'b' }, 'manager'),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      const winner = results.find((r) => r.status === 200)!;
      expect((await reload(p.id)).status).toBe(winner.body.status);
      expect(await audits(p.code, 'payout_resolved_manually')).toHaveLength(1);
    });
  });
});

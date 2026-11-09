import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 18 Task 3: removed payout routes return 404 and preserve historical payout rows', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let idService: IdService;
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
  }, 60000);

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

  const makePayout = async (over: { status?: string; gatewayReference?: string } = {}) => {
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

  describe('removed payout routes return 404 (AGENTS.md / specs/phase-18.md §Task 3)', () => {
    it.each(['ceo', 'finance', 'manager', 'call_agent', 'field_agent', 'team_lead'])(
      'POST /payments/:id/retry-payout returns 404 for %s',
      async (who) => {
        const p = await makePayout({ status: 'failed' });
        const res = await request(app.getHttpServer())
          .post(`/payments/${p.id}/retry-payout`)
          .set(as(who));
        expect(res.status).toBe(404);
      },
    );

    it.each(['ceo', 'finance', 'manager', 'call_agent', 'field_agent', 'team_lead'])(
      'POST /payments/:id/resolve-payout returns 404 for %s',
      async (who) => {
        const p = await makePayout({ status: 'processing' });
        const res = await request(app.getHttpServer())
          .post(`/payments/${p.id}/resolve-payout`)
          .set(as(who))
          .send({ outcome: 'succeeded', note: 'manual note' });
        expect(res.status).toBe(404);
      },
    );

    it('unauthenticated callers get 404 or 401 on removed routes', async () => {
      const p = await makePayout();
      const retryRes = await request(app.getHttpServer()).post(`/payments/${p.id}/retry-payout`);
      expect([401, 404]).toContain(retryRes.status);
      const resolveRes = await request(app.getHttpServer())
        .post(`/payments/${p.id}/resolve-payout`)
        .send({});
      expect([401, 404]).toContain(resolveRes.status);
    });

    it('old payout rows keep their historical statuses and remain readable', async () => {
      const failed = await makePayout({ status: 'failed' });
      const processing = await makePayout({ status: 'processing' });

      const resFailed = await request(app.getHttpServer())
        .get(`/payments/${failed.id}`)
        .set(as('finance'));
      expect(resFailed.status).toBe(200);
      expect(resFailed.body.status).toBe('failed');

      const resProcessing = await request(app.getHttpServer())
        .get(`/payments/${processing.id}`)
        .set(as('ceo'));
      expect(resProcessing.status).toBe(200);
      expect(resProcessing.body.status).toBe('processing');
    });
  });
});

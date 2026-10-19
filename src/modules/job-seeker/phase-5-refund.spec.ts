import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isWithinRefundGuarantee } from '../../common/money/money';

describe('Phase 5 Task 8: Job seeker 30-day refund approval', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ceoToken: string;
  let managerToken: string;
  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;

  let staffIds: string[] = [];
  const timestamp = Date.now();
  const password = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-P5R-${timestamp}`,
        name: 'CEO User',
        email: `ceo_p5r_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-P5R-${timestamp}`,
        name: 'Manager User',
        email: `mgr_p5r_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-P5R-${timestamp}`,
        name: 'Call Agent User',
        email: `ca_p5r_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-P5R-${timestamp}`,
        name: 'Field Agent User',
        email: `fa_p5r_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });

    const finance = await prisma.staff.create({
      data: {
        code: `FI-P5R-${timestamp}`,
        name: 'Finance User',
        email: `fi_p5r_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    staffIds = [ceo.id, manager.id, callAgent.id, fieldAgent.id, finance.id];

    // Logins
    const getTok = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return res.body.accessToken;
    };

    ceoToken = await getTok(ceo.email);
    managerToken = await getTok(manager.email);
    callAgentToken = await getTok(callAgent.email);
    fieldAgentToken = await getTok(fieldAgent.email);
    financeToken = await getTok(finance.email);
  });

  afterAll(async () => {
    // Teardown
    await prisma.payment.deleteMany({
      where: {
        jobSeeker: {
          code: {
            in: [
              `JS-P5R-PL-${timestamp}`,
              `JS-P5R-ACT-${timestamp}`,
              `JS-P5R-DEACT-${timestamp}`,
            ],
          },
        },
      },
    });
    await prisma.jobSeeker.deleteMany({
      where: {
        code: {
          in: [
            `JS-P5R-PL-${timestamp}`,
            `JS-P5R-ACT-${timestamp}`,
            `JS-P5R-DEACT-${timestamp}`,
          ],
        },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        actorId: { in: staffIds },
      },
    });
    await prisma.staff.deleteMany({
      where: {
        id: { in: staffIds },
      },
    });
    await app.close();
  });

  describe('isWithinRefundGuarantee unit check', () => {
    it('returns false when candidate is placed, even within 30 days', () => {
      const paymentDate = new Date('2026-10-01T00:00:00.000Z');
      const day10 = new Date('2026-10-11T00:00:00.000Z');

      // Placed candidate on day 10
      expect(isWithinRefundGuarantee(paymentDate, day10, 'placed')).toBe(false);
      // Active candidate on day 10
      expect(isWithinRefundGuarantee(paymentDate, day10, 'active')).toBe(true);
      // Deactivated candidate on day 10
      expect(isWithinRefundGuarantee(paymentDate, day10, 'deactivated')).toBe(false);
    });
  });

  describe('POST /job-seekers/:id/refund', () => {
    it('denies non-CEO/non-Manager staff (403)', async () => {
      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5R-ACT-${timestamp}`,
          name: 'Eligible Candidate',
          phone: `93${timestamp.toString().slice(-8)}1`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          paymentReceivedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
        },
      });

      // Call agent denied
      await request(app.getHttpServer())
        .post(`/job-seekers/${candidate.id}/refund`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({})
        .expect(403);

      // Field agent denied
      await request(app.getHttpServer())
        .post(`/job-seekers/${candidate.id}/refund`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({})
        .expect(403);

      // Finance denied (approval stays CEO/Manager only, per §7)
      await request(app.getHttpServer())
        .post(`/job-seekers/${candidate.id}/refund`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({})
        .expect(403);
    });

    it('denies refund to a candidate placed on day 10 when claimed on day 31', async () => {
      const paymentDate = new Date('2026-10-01T00:00:00.000Z');
      const placedCandidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5R-PL-${timestamp}`,
          name: 'Placed Candidate',
          phone: `93${timestamp.toString().slice(-8)}2`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'placed',
          paymentReceivedAt: paymentDate,
        },
      });

      // On day 31 (2026-11-01)
      const day31 = '2026-11-01T12:00:00.000Z';
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${placedCandidate.id}/refund`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ asOf: day31 })
        .expect(400);

      expect(res.body.message).toContain('confirmed placement');
    });

    it('denies refund to a deactivated candidate even after 30 days', async () => {
      const paymentDate = new Date('2026-10-01T00:00:00.000Z');
      const deactCandidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5R-DEACT-${timestamp}`,
          name: 'Deactivated Candidate',
          phone: `93${timestamp.toString().slice(-8)}3`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'deactivated',
          paymentReceivedAt: paymentDate,
        },
      });

      const day31 = '2026-11-01T12:00:00.000Z';
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${deactCandidate.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: day31 })
        .expect(400);

      expect(res.body.message).toContain('deactivated');
    });

    it('allows 30-day refund for active candidate never placed after 30 days, creating Payment and audit log', async () => {
      const candidate = await prisma.jobSeeker.findUnique({
        where: { code: `JS-P5R-ACT-${timestamp}` },
      });
      expect(candidate).toBeDefined();

      // On day 20 (before 30 days elapsed): denied
      const day20 = new Date(candidate!.paymentReceivedAt!.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString();
      await request(app.getHttpServer())
        .post(`/job-seekers/${candidate!.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: day20 })
        .expect(400);

      // On day 31 (after 30 days elapsed): approved by CEO
      const day31 = new Date(candidate!.paymentReceivedAt!.getTime() + 31 * 24 * 60 * 60 * 1000).toISOString();
      const refundRes = await request(app.getHttpServer())
        .post(`/job-seekers/${candidate!.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: day31 })
        .expect(201);

      expect(refundRes.body.type).toBe('refund');
      expect(refundRes.body.amount).toBe(49900); // full ₹499 in paise
      expect(refundRes.body.code).toMatch(/^PAY-\d{5}$/);
      expect(refundRes.body.status).toBe('completed');

      // Payment row exists in DB
      const dbPayment = await prisma.payment.findUnique({
        where: { id: refundRes.body.id },
      });
      expect(dbPayment?.amount).toBe(49900);
      expect(dbPayment?.type).toBe('refund');

      // Audit log entry exists
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityCode: candidate!.code,
          action: 'refund_approved',
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.action).toBe('refund_approved');

      // Repeated refund request rejected (cannot double-refund)
      await request(app.getHttpServer())
        .post(`/job-seekers/${candidate!.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: day31 })
        .expect(400);
    });
  });
});

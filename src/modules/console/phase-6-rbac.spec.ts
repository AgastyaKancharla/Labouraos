import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Business, JobSeeker, Payment, Referral } from '@prisma/client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { seed } from '../../../prisma/seed';

type PaymentRecord = Payment & {
  jobSeeker?: JobSeeker | null;
  business?: Business | null;
  referral?: Referral | null;
};

describe('Phase 6 Task 7: RBAC, Masking, and Consoles Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ceoToken: string;
  let managerToken: string;
  let teamLeadToken: string;
  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;

  const defaultPassword = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Ensure database is seeded with all standard roles and records
    await seed(prisma);

    const loginAs = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: defaultPassword })
        .expect(200);
      return res.body.accessToken;
    };

    ceoToken = await loginAs('ceo@laboura.local');
    managerToken = await loginAs('manager@laboura.local');
    teamLeadToken = await loginAs('lead.koramangala@laboura.local');
    callAgentToken = await loginAs('call.agent@laboura.local');
    fieldAgentToken = await loginAs('field.agent@laboura.local');
    financeToken = await loginAs('finance@laboura.local');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Console Availability and Auth Enforcement', () => {
    it('serves Admin Dashboard at GET /admin with auth modal and role enforcement logic', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Laboura Admin Dashboard');
      expect(res.text).toContain('id="auth-modal"');
      expect(res.text).toContain('id="login-email"');
      expect(res.text).toContain('id="login-password"');
      // Manager token hides pricing tab
      expect(res.text).toContain('id="tab-pricing"');
      expect(res.text).toContain('payload.role === \'ceo\'');
    });

    it('serves Call Agent console at GET /call-agent with auth modal and operations forms', async () => {
      const res = await request(app.getHttpServer())
        .get('/call-agent')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Laboura Call Agent Console');
      expect(res.text).toContain('id="auth-modal"');
      expect(res.text).toContain('Job Seeker Onboarding');
      expect(res.text).toContain('Referral Onboarding');
      expect(res.text).toContain('Business Onboarding');
      expect(res.text).toContain('Candidate Shortlist');
      expect(res.text).toContain('Placement Flow');
    });

    it('serves Field Agent app at GET /field-agent with auth modal and live Priority Dashboard', async () => {
      const res = await request(app.getHttpServer())
        .get('/field-agent')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Laboura Field Agent App');
      expect(res.text).toContain('id="auth-modal"');
      expect(res.text).toContain('accept="image/*" capture="user"');
      expect(res.text).toContain('Priority Dashboard');
      expect(res.text).toContain('/priority/candidates');
      expect(res.text).toContain('/priority/vacancies');
      expect(res.text).toContain('/priority/trades');
    });

    it('POST /auth/login rejects invalid credentials with 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ceo@laboura.local', password: 'wrongpassword' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nonexistent@laboura.local', password: defaultPassword })
        .expect(401);
    });
  });

  describe('RBAC: Pricing & Policy (AGENTS.md §7)', () => {
    it('CEO has sole write access to pricing policy', async () => {
      const res = await request(app.getHttpServer())
        .post('/pricing')
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({
          activationFeePaise: 49900,
          placementFeePercent: 50,
          gstPercent: 18,
          referralPayoutPaise: 20000,
          replacementWindowDays: 60,
          replacementSearchDays: 15,
          jobSeekerGuaranteeDays: 30,
        })
        .expect(201);

      expect(res.body.activationFeePaise).toBe(49900);
      expect(res.body.placementFeePercent).toBe(50);
      expect(res.body.referralPayoutPaise).toBe(20000);
    });

    it('Manager is read-only for pricing (GET allowed, POST forbidden 403)', async () => {
      await request(app.getHttpServer())
        .get('/pricing')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/pricing')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ activationFeePaise: 59900 })
        .expect(403);
    });

    it('Team Lead, Call Agent, Field Agent, and Finance are denied access to pricing (403)', async () => {
      for (const token of [teamLeadToken, callAgentToken, fieldAgentToken, financeToken]) {
        await request(app.getHttpServer())
          .get('/pricing')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);

        await request(app.getHttpServer())
          .post('/pricing')
          .set('Authorization', `Bearer ${token}`)
          .send({ activationFeePaise: 49900 })
          .expect(403);
      }
    });
  });

  describe('RBAC: Payments Ledger and PII Masking (AGENTS.md §7)', () => {
    it('Finance reads payments ledger with PII masked (phone, kyc, contactPhone)', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      for (const p of res.body) {
        if (p.jobSeeker) {
          expect(p.jobSeeker.phone).toBe('********');
          if (p.jobSeeker.kycReference) {
            expect(p.jobSeeker.kycReference).toBe('********');
          }
        }
        if (p.business && p.business.phone) {
          expect(p.business.phone).toBe('********');
        }
        if (p.referral && p.referral.phone) {
          expect(p.referral.phone).toBe('********');
        }
        expect(p.code).toMatch(/^PAY-\d{5}$/);
        expect(typeof p.amount).toBe('number');
      }
    });

    it('CEO and Manager read payments ledger unmasked', async () => {
      const resCeo = await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      const resMgr = await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      const pmtCeo = resCeo.body.find((p: PaymentRecord) => p.jobSeeker?.phone);
      if (pmtCeo) {
        expect(pmtCeo.jobSeeker?.phone).not.toBe('********');
      }

      const pmtMgr = resMgr.body.find((p: PaymentRecord) => p.jobSeeker?.phone);
      if (pmtMgr) {
        expect(pmtMgr.jobSeeker?.phone).not.toBe('********');
      }
    });

    it('Team Lead, Call Agent, and Field Agent are denied access to payments ledger (403)', async () => {
      for (const token of [teamLeadToken, callAgentToken, fieldAgentToken]) {
        await request(app.getHttpServer())
          .get('/payments')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      }
    });
  });

  describe('RBAC: Refund Approvals (AGENTS.md §7)', () => {
    it('Finance, Call Agent, and Field Agent cannot approve candidate refunds (403)', async () => {
      const candidate = await prisma.jobSeeker.findFirst({
        where: { code: 'JS-00001' },
      });
      expect(candidate).toBeDefined();

      for (const token of [financeToken, callAgentToken, fieldAgentToken]) {
        await request(app.getHttpServer())
          .post(`/job-seekers/${candidate!.id}/refund`)
          .set('Authorization', `Bearer ${token}`)
          .send({ reason: 'Attempted refund' })
          .expect(403);
      }
    });

    it('Finance, Call Agent, and Field Agent cannot approve placement refunds (403)', async () => {
      const placement = await prisma.placement.findFirst({
        where: { code: 'PL-00003' },
      });
      expect(placement).toBeDefined();

      for (const token of [financeToken, callAgentToken, fieldAgentToken]) {
        await request(app.getHttpServer())
          .post(`/placements/${placement!.id}/refund`)
          .set('Authorization', `Bearer ${token}`)
          .send({ reason: 'Attempted refund' })
          .expect(403);
      }
    });
  });

  describe('RBAC: Payout Disbursement (AGENTS.md §7)', () => {
    it('Call Agent and Field Agent are denied payout disbursement (403)', async () => {
      const payment = await prisma.payment.findFirst({
        where: { type: 'referral_payout' },
      });
      expect(payment).toBeDefined();

      await request(app.getHttpServer())
        .post(`/payments/${payment!.id}/disburse`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({})
        .expect(403);

      await request(app.getHttpServer())
        .post(`/payments/${payment!.id}/disburse`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({})
        .expect(403);
    });
  });

  describe('Priority Dashboard & Area Scoping', () => {
    it('Field Agent accesses live priority endpoints (/priority/candidates, vacancies, trades)', async () => {
      const candRes = await request(app.getHttpServer())
        .get('/priority/candidates')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .expect(200);

      expect(Array.isArray(candRes.body)).toBe(true);

      const vacRes = await request(app.getHttpServer())
        .get('/priority/vacancies')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .expect(200);

      expect(Array.isArray(vacRes.body)).toBe(true);

      const tradeRes = await request(app.getHttpServer())
        .get('/priority/trades')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .expect(200);

      expect(Array.isArray(tradeRes.body)).toBe(true);
    });
  });
});

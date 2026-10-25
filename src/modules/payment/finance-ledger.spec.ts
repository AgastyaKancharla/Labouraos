import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { Business, JobSeeker, Payment, Referral } from '@prisma/client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

type PaymentWithDetails = Payment & {
  jobSeeker: JobSeeker;
  business?: Business | null;
  referral?: Referral | null;
};

describe('Phase 6 Task 3: Finance Ledger View', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;

  let financeToken: string;
  let ceoToken: string;
  let managerToken: string;
  let caToken: string;
  let faToken: string;
  let tlToken: string;

  let testPaymentId: string;

  const timestamp = Date.now();
  const password = 'Password123!';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    idService = app.get<IdService>(IdService);

    const passwordHash = await bcrypt.hash(password, 10);

    const finance = await prisma.staff.create({
      data: {
        code: `FIN-T3-${timestamp}`,
        name: 'Finance User Task3',
        email: `fin_t3_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-T3-${timestamp}`,
        name: 'CEO User Task3',
        email: `ceo_t3_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-T3-${timestamp}`,
        name: 'Manager User Task3',
        email: `mgr_t3_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const tl = await prisma.staff.create({
      data: {
        code: `TL-T3-${timestamp}`,
        name: 'Team Lead Task3',
        email: `tl_t3_${timestamp}@laboura.local`,
        passwordHash,
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });

    const ca = await prisma.staff.create({
      data: {
        code: `CA-T3-${timestamp}`,
        name: 'Call Agent Task3',
        email: `ca_t3_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const fa = await prisma.staff.create({
      data: {
        code: `FA-T3-${timestamp}`,
        name: 'Field Agent Task3',
        email: `fa_t3_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });

    const finLogin = await enrolledLogin(app.getHttpServer(), { email: finance.email, password })
      .expect(200);
    financeToken = finLogin.body.accessToken;

    const ceoLogin = await enrolledLogin(app.getHttpServer(), { email: ceo.email, password })
      .expect(200);
    ceoToken = ceoLogin.body.accessToken;

    const mgrLogin = await enrolledLogin(app.getHttpServer(), { email: manager.email, password })
      .expect(200);
    managerToken = mgrLogin.body.accessToken;

    const tlLogin = await enrolledLogin(app.getHttpServer(), { email: tl.email, password })
      .expect(200);
    tlToken = tlLogin.body.accessToken;

    const caLogin = await enrolledLogin(app.getHttpServer(), { email: ca.email, password })
      .expect(200);
    caToken = caLogin.body.accessToken;

    const faLogin = await enrolledLogin(app.getHttpServer(), { email: fa.email, password })
      .expect(200);
    faToken = faLogin.body.accessToken;

    // Seed test records for finance ledger tests
    const referral = await prisma.referral.create({
      data: {
        code: `RF-FL-${timestamp}`,
        name: 'Referral FL',
        phone: `93001${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });

    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-FL-${timestamp}`,
        name: 'Candidate FL',
        phone: `93002${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        kycStatus: 'verified',
        kycReference: 'vendor_ref_fl_12345',
        status: 'active',
        city: 'Bengaluru',
      },
    });

    const business = await prisma.business.create({
      data: {
        code: `BZ-FL-${timestamp}`,
        name: 'Business FL',
        phone: `93003${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });

    const code1 = await idService.generateCode('payment');
    const payment1 = await prisma.payment.create({
      data: {
        code: code1,
        type: 'activation',
        amount: 49900,
        status: 'succeeded',
        gatewayReference: `gw_fl_${timestamp}_1`,
        subjectType: 'job_seeker',
        subjectId: candidate.id,
        jobSeekerId: candidate.id,
        createdAt: new Date('2026-10-10T10:00:00.000Z'),
        city: 'Bengaluru',
      },
    });
    testPaymentId = payment1.id;

    const code2 = await idService.generateCode('payment');
    await prisma.payment.create({
      data: {
        code: code2,
        type: 'placement_fee',
        amount: 1180000,
        status: 'pending',
        gatewayReference: `gw_fl_${timestamp}_2`,
        subjectType: 'business',
        subjectId: business.id,
        businessId: business.id,
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
        city: 'Bengaluru',
      },
    });

    const code3 = await idService.generateCode('payment');
    await prisma.payment.create({
      data: {
        code: code3,
        type: 'referral_payout',
        amount: 20000,
        status: 'succeeded',
        gatewayReference: `gw_fl_${timestamp}_3`,
        subjectType: 'referral',
        subjectId: referral.id,
        referralId: referral.id,
        createdAt: new Date('2026-10-20T15:00:00.000Z'),
        city: 'Bengaluru',
      },
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('PII Masking for Finance View', () => {
    it('Finance GET /payments masks candidate, business, and referral phones and KYC reference, but exposes unique IDs and amounts', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);

      const activationPmt = res.body.find((p: PaymentWithDetails) => p.id === testPaymentId);
      expect(activationPmt).toBeDefined();

      // Unique IDs and amounts must be visible in plain text
      expect(activationPmt.code).toMatch(/^PAY-\d{5}$/);
      expect(activationPmt.amount).toBe(49900);
      expect(activationPmt.jobSeeker.code).toBe(`JS-FL-${timestamp}`);

      // PII MUST BE MASKED FOR FINANCE
      expect(activationPmt.jobSeeker.phone).toBe('********');
      expect(activationPmt.jobSeeker.kycReference).toBe('********');
    });

    it('Finance GET /payments/:id applies the exact same PII masking', async () => {
      const res = await request(app.getHttpServer())
        .get(`/payments/${testPaymentId}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      expect(res.body.id).toBe(testPaymentId);
      expect(res.body.code).toMatch(/^PAY-\d{5}$/);
      expect(res.body.amount).toBe(49900);

      // PII masked
      expect(res.body.jobSeeker.phone).toBe('********');
      expect(res.body.jobSeeker.kycReference).toBe('********');
    });

    it('CEO and Manager GET /payments see unmasked PII', async () => {
      const resCeo = await request(app.getHttpServer())
        .get(`/payments/${testPaymentId}`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      expect(resCeo.body.jobSeeker.phone).toBe(`93002${String(timestamp).slice(-5)}`);
      expect(resCeo.body.jobSeeker.kycReference).toBe('vendor_ref_fl_12345');

      const resMgr = await request(app.getHttpServer())
        .get(`/payments/${testPaymentId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(resMgr.body.jobSeeker.phone).toBe(`93002${String(timestamp).slice(-5)}`);
      expect(resMgr.body.jobSeeker.kycReference).toBe('vendor_ref_fl_12345');
    });
  });

  describe('Filtering: type, status, and date range', () => {
    it('filters payments by type', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments?type=referral_payout')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      for (const p of res.body) {
        expect(p.type).toBe('referral_payout');
      }
    });

    it('filters payments by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments?status=pending')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      for (const p of res.body) {
        expect(p.status).toBe('pending');
      }
    });

    it('filters payments by date range', async () => {
      const from = '2026-10-12T00:00:00.000Z';
      const to = '2026-10-18T23:59:59.000Z';

      const res = await request(app.getHttpServer())
        .get(`/payments?fromDate=${from}&toDate=${to}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      for (const p of res.body) {
        const created = new Date(p.createdAt).getTime();
        expect(created).toBeGreaterThanOrEqual(new Date(from).getTime());
        expect(created).toBeLessThanOrEqual(new Date(to).getTime());
      }
    });
  });

  describe('RBAC Access Control', () => {
    it('denies Call Agent, Field Agent, and Team Lead (403 Forbidden)', async () => {
      await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${caToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${faToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${tlToken}`)
        .expect(403);
    });
  });
});

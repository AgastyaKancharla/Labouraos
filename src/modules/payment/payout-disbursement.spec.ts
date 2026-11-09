import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { MockPaymentProvider } from './mock-payment.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 6 Task 2: Payout Disbursement', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  let provider: MockPaymentProvider;

  let financeToken: string;
  let ceoToken: string;
  let managerToken: string;
  let caToken: string;
  let faToken: string;

  const timestamp = Date.now();
  const password = 'Password123!';

  beforeAll(async () => {
    provider = new MockPaymentProvider();

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
        code: `FIN-P6-${timestamp}`,
        name: 'Finance Agent P6',
        email: `fin_p6_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-P6-${timestamp}`,
        name: 'CEO P6 Task2',
        email: `ceo_p6_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-P6-${timestamp}`,
        name: 'Manager P6 Task2',
        email: `mgr_p6_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const ca = await prisma.staff.create({
      data: {
        code: `CA-P6-T2-${timestamp}`,
        name: 'Call Agent P6 Task2',
        email: `ca_p6_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const fa = await prisma.staff.create({
      data: {
        code: `FA-P6-T2-${timestamp}`,
        name: 'Field Agent P6 Task2',
        email: `fa_p6_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
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

    const caLogin = await enrolledLogin(app.getHttpServer(), { email: ca.email, password })
      .expect(200);
    caToken = caLogin.body.accessToken;

    const faLogin = await enrolledLogin(app.getHttpServer(), { email: fa.email, password })
      .expect(200);
    faToken = faLogin.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('MockPaymentProvider disbursePayout unit test', () => {
    it('disburses payout successfully and returns unique gateway reference', async () => {
      const res = await provider.disbursePayout(20000, 'referral', 'ref-123');
      expect(res.success).toBe(true);
      expect(res.status).toBe('succeeded');
      expect(res.gatewayReference).toMatch(/^mock_payout_gw_referral_/);
    });

    it('simulates payout failure when simulateFailure flag is passed', async () => {
      const res = await provider.disbursePayout(20000, 'referral', 'ref-123', {
        simulateFailure: true,
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.failureReason).toBeDefined();
    });
  });

  describe('Removed Payout Disbursement Flow returns 404 (Phase 18 Task 3)', () => {
    it('returns 404 for every role on POST /payments/:id/disburse', async () => {
      const referral = await prisma.referral.create({
        data: {
          code: `RF-D1-${timestamp}`,
          name: 'Payout Partner 1',
          phone: `92001${String(timestamp).slice(-5)}`,
          phoneVerified: true,
          type: 'individual',
          city: 'Bengaluru',
        },
      });

      const paymentCode = await idService.generateCode('payment');
      const payment = await prisma.payment.create({
        data: {
          code: paymentCode,
          type: 'referral_payout',
          amount: 20000,
          status: 'pending',
          subjectType: 'referral',
          subjectId: referral.id,
          referralId: referral.id,
          city: 'Bengaluru',
        },
      });

      // 404 for CEO
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/disburse`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({})
        .expect(404);

      // 404 for Finance
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/disburse`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({})
        .expect(404);

      // 404 for Manager
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/disburse`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({})
        .expect(404);

      // 404 for Call Agent
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/disburse`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({})
        .expect(404);

      // 404 for Field Agent
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/disburse`)
        .set('Authorization', `Bearer ${faToken}`)
        .send({})
        .expect(404);
    });

    it('returns 404 on POST /payments/payout-webhook', async () => {
      await request(app.getHttpServer())
        .post('/payments/payout-webhook')
        .send({ event: 'payout.processed' })
        .expect(404);
    });
  });
});

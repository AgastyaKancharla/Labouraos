import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';
import { PaymentModule } from './payment.module';

describe('Payment Provider and Mock Implementation (Phase 2 Task 4)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let provider: MockPaymentProvider;

  beforeAll(async () => {
    provider = new MockPaymentProvider();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('MockPaymentProvider', () => {
    it('creates a charge and returns a fake payment link and unique gatewayReference', async () => {
      const charge1 = await provider.createCharge(49900, 'job_seeker', 'test-id-1');
      const charge2 = await provider.createCharge(49900, 'job_seeker', 'test-id-2');

      expect(charge1.paymentLink).toBeDefined();
      expect(charge1.paymentLink).toContain(charge1.gatewayReference);
      expect(charge1.gatewayReference).toMatch(/^mock_gw_job_seeker_/);

      expect(charge2.gatewayReference).not.toBe(charge1.gatewayReference);
    });

    it('verifies valid webhook payloads', async () => {
      const payload = {
        gatewayReference: 'mock_gw_123',
        status: 'succeeded',
        amountPaise: 49900,
      };

      const result = await provider.verifyWebhook(payload);
      expect(result.isValid).toBe(true);
      expect(result.gatewayReference).toBe('mock_gw_123');
      expect(result.status).toBe('succeeded');
    });

    it('rejects webhook when signature is invalid', async () => {
      const payload = {
        gatewayReference: 'mock_gw_123',
        status: 'succeeded',
      };

      const result = await provider.verifyWebhook(payload, 'invalid-signature');
      expect(result.isValid).toBe(false);
    });
  });

  describe('Provider Selection via Environment Variable', () => {
    const originalEnv = process.env.PAYMENT_PROVIDER;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PAYMENT_PROVIDER;
      } else {
        process.env.PAYMENT_PROVIDER = originalEnv;
      }
    });

    it('defaults to MockPaymentProvider when PAYMENT_PROVIDER is unset', async () => {
      delete process.env.PAYMENT_PROVIDER;

      const moduleRef = await Test.createTestingModule({
        imports: [PaymentModule],
      }).compile();

      const p = moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER);
      expect(p).toBeInstanceOf(MockPaymentProvider);
    });

    it('selects MockPaymentProvider when PAYMENT_PROVIDER=mock', async () => {
      process.env.PAYMENT_PROVIDER = 'mock';

      const moduleRef = await Test.createTestingModule({
        imports: [PaymentModule],
      }).compile();

      const p = moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER);
      expect(p).toBeInstanceOf(MockPaymentProvider);
    });

    it('throws error when unsupported payment provider is specified', async () => {
      process.env.PAYMENT_PROVIDER = 'stripe_unsupported';

      await expect(
        Test.createTestingModule({
          imports: [PaymentModule],
        }).compile(),
      ).rejects.toThrow('Unsupported payment provider: stripe_unsupported');
    });
  });

  describe('Mock Webhook Simulation Endpoint and Idempotency', () => {
    const timestamp = Date.now();
    let paymentId: string;
    const testGwRef = `test_idempotency_gw_${timestamp}`;

    beforeAll(async () => {
      // Seed a pending payment directly in DB to test webhook handling
      const payment = await prisma.payment.create({
        data: {
          code: `PAY-TEST-${timestamp}`,
          type: 'activation',
          amount: 49900,
          status: 'pending',
          gatewayReference: testGwRef,
          subjectType: 'job_seeker',
          subjectId: `subject-${timestamp}`,
        },
      });
      paymentId = payment.id;
    });

    afterAll(async () => {
      if (paymentId) {
        await prisma.payment.deleteMany({
          where: { gatewayReference: testGwRef },
        });
      }
    });

    it('simulates webhook firing via POST /payments/mock/simulate-webhook', async () => {
      const res = await request(app.getHttpServer())
        .post('/payments/mock/simulate-webhook')
        .send({
          gatewayReference: testGwRef,
          status: 'succeeded',
        });

      expect(res.status).toBe(201);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('succeeded');

      const paymentInDb = await prisma.payment.findUnique({
        where: { id: paymentId },
      });
      expect(paymentInDb?.status).toBe('succeeded');
    });

    it('second webhook with same gatewayReference is a no-op, never a duplicate row', async () => {
      const initialCount = await prisma.payment.count({
        where: { gatewayReference: testGwRef },
      });
      expect(initialCount).toBe(1);

      // Fire identical webhook a second time
      const resSecond = await request(app.getHttpServer())
        .post('/payments/mock/simulate-webhook')
        .send({
          gatewayReference: testGwRef,
          status: 'succeeded',
        });

      expect(resSecond.status).toBe(201);
      expect(resSecond.body.received).toBe(true);
      expect(resSecond.body.alreadyProcessed).toBe(true);

      const finalCount = await prisma.payment.count({
        where: { gatewayReference: testGwRef },
      });
      expect(finalCount).toBe(1);
    });

    it('rejects unknown gateway reference cleanly without crashing', async () => {
      const res = await request(app.getHttpServer())
        .post('/payments/mock/simulate-webhook')
        .send({
          gatewayReference: 'completely_unknown_gw_ref',
          status: 'succeeded',
        });

      expect(res.status).toBe(201);
      expect(res.body.received).toBe(false);
      expect(res.body.error).toContain('not found');
    });
  });
});

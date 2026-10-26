import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { RealPaymentProvider } from './real-payment.provider';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';
import { PaymentModule } from './payment.module';

describe('Phase 7 Task 2: Real Payment Gateway & Payout API Integration', () => {
  const webhookSecret = 'test_webhook_secret_key_12345';
  const keyId = 'rzp_test_sample_key';
  const keySecret = 'sample_secret_key_67890';

  describe('RealPaymentProvider Unit Tests', () => {
    let capturedRequests: Array<{ url: string; options?: RequestInit }>;
    let mockFetch: typeof fetch;

    beforeEach(() => {
      capturedRequests = [];
      mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        capturedRequests.push({ url: urlStr, options: init });

        if (urlStr.includes('/payment_links')) {
          const body = JSON.parse(init?.body as string);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'plink_real_123456',
              short_url: 'https://rzp.io/i/plink_real_123456',
              amount: body.amount,
              reference_id: body.reference_id,
            }),
            text: async () => '{"status":"created"}',
          } as Response;
        }

        if (urlStr.includes('/payouts')) {
          const body = JSON.parse(init?.body as string);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'pout_real_789012',
              status: 'processed',
              amount: body.amount,
              reference_id: body.reference_id,
            }),
            text: async () => '{"status":"processed"}',
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          text: async () => 'Not Found',
        } as Response;
      }) as unknown as typeof fetch;
    });

    it('creates charge with basic auth and returns paymentLink and gatewayReference in integer paise', async () => {
      const provider = new RealPaymentProvider({
        keyId,
        keySecret,
        webhookSecret,
        fetchFn: mockFetch,
      });

      const res = await provider.createCharge(49900, 'job_seeker', 'JS-001');
      expect(res.gatewayReference).toBe('plink_real_123456');
      expect(res.paymentLink).toBe('https://rzp.io/i/plink_real_123456');

      expect(capturedRequests).toHaveLength(1);
      const req = capturedRequests[0];
      const authHeader = req.options?.headers as Record<string, string>;
      const expectedCreds = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      expect(authHeader.Authorization).toBe(`Basic ${expectedCreds}`);

      const body = JSON.parse(req.options?.body as string);
      expect(body.amount).toBe(49900);
      expect(body.currency).toBe('INR');
    });

    it('disburses payout with integer paise and returns succeeded status', async () => {
      const provider = new RealPaymentProvider({
        keyId,
        keySecret,
        webhookSecret,
        fetchFn: mockFetch,
      });

      const paymentId = '3f2b8c1e-9a47-4d55-8b0e-1c2d3e4f5a6b';
      const res = await provider.disbursePayout(20000, 'referral', 'RF-001', {
        paymentId,
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe('succeeded');
      expect(res.gatewayReference).toBe('pout_real_789012');
    });

    it('derives reference_id and the idempotency header from payment.id alone, identically on a retry', async () => {
      const provider = new RealPaymentProvider({
        keyId,
        keySecret,
        webhookSecret,
        fetchFn: mockFetch,
      });
      const paymentId = '3f2b8c1e-9a47-4d55-8b0e-1c2d3e4f5a6b';

      await provider.disbursePayout(20000, 'referral', 'RF-001', { paymentId });
      // a retry later, and with different non-id inputs, must not change the key
      await new Promise((r) => setTimeout(r, 5));
      await provider.disbursePayout(20000, 'referral', 'RF-OTHER', { paymentId });

      const payoutCalls = capturedRequests.filter((r) => r.url.includes('/payouts'));
      expect(payoutCalls).toHaveLength(2);
      for (const call of payoutCalls) {
        expect(JSON.parse(call.options?.body as string).reference_id).toBe(paymentId);
        expect(
          (call.options?.headers as Record<string, string>)['X-Payout-Idempotency'],
        ).toBe(paymentId);
      }
      // RazorpayX idempotency keys are 4-36 characters
      expect(paymentId.length).toBeLessThanOrEqual(36);
    });

    it('refuses to disburse without a paymentId rather than inventing a non-idempotent reference', async () => {
      const provider = new RealPaymentProvider({
        keyId,
        keySecret,
        webhookSecret,
        fetchFn: mockFetch,
      });

      await expect(
        provider.disbursePayout(20000, 'referral', 'RF-001'),
      ).rejects.toThrow('metadata.paymentId');
      await expect(
        provider.disbursePayout(20000, 'referral', 'RF-001', { paymentId: '' }),
      ).rejects.toThrow('metadata.paymentId');
      expect(capturedRequests.filter((r) => r.url.includes('/payouts'))).toHaveLength(0);
    });

    it('verifies HMAC-SHA256 signature on real Razorpay webhook payload and rejects forged signatures', async () => {
      const provider = new RealPaymentProvider({
        keyId,
        keySecret,
        webhookSecret,
      });

      const realPayload = {
        entity: 'event',
        event: 'payment_link.paid',
        payload: {
          payment_link: {
            entity: {
              id: 'plink_real_999888',
              amount: 49900,
              currency: 'INR',
              status: 'paid',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(realPayload);
      const validSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payloadStr)
        .digest('hex');

      // Valid signature, verified over the raw bytes
      const validResult = await provider.verifyWebhook(realPayload, validSignature, payloadStr);
      expect(validResult.isValid).toBe(true);
      expect(validResult.gatewayReference).toBe('plink_real_999888');
      expect(validResult.status).toBe('succeeded');
      expect(validResult.amountPaise).toBe(49900);

      // Forged / invalid signature
      const invalidResult = await provider.verifyWebhook(
        realPayload,
        'forged_invalid_signature_hex_123',
        payloadStr,
      );
      expect(invalidResult.isValid).toBe(false);

      // Missing signature
      const missingResult = await provider.verifyWebhook(realPayload, undefined, payloadStr);
      expect(missingResult.isValid).toBe(false);

      // A parsed object with no raw bytes is never verified: a re-serialised copy is
      // not what the gateway signed, even when it happens to hash the same
      const objectOnly = await provider.verifyWebhook(realPayload, validSignature);
      expect(objectOnly.isValid).toBe(false);
    });
  });

  describe('Real Webhook Idempotency Integration Test (Re-run Phase 2 Task 5 against Real Webhook Shape)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let idService: IdService;
    const timestamp = Date.now();
    const testWebhookSecret = 'test_hmac_secret_phase7_task2';
    let ceoStaffId: string;

    beforeAll(async () => {
      process.env.PAYMENT_PROVIDER = 'real';
      process.env.RAZORPAY_WEBHOOK_SECRET = testWebhookSecret;

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      // rawBody mirrors main.ts: the signature is over the bytes the gateway sent
      app = moduleRef.createNestApplication({ rawBody: true });
      await app.init();

      prisma = app.get<PrismaService>(PrismaService);
      idService = app.get<IdService>(IdService);
      // The activation audit entry needs a staff row to attribute to; don't rely on
      // other suites leaving one behind (a fresh CI database has none)
      const ceo = await prisma.staff.create({
        data: {
          code: `CEO-RWH-${timestamp}`,
          name: 'Audit actor',
          email: `ceo_rwh_${timestamp}@laboura.local`,
          passwordHash: 'not-a-real-hash',
          role: 'ceo',
          city: 'Bengaluru',
        },
      });
      ceoStaffId = ceo.id;
    });

    afterAll(async () => {
      delete process.env.PAYMENT_PROVIDER;
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
      if (app) {
        await prisma.auditLog.deleteMany({ where: { actorId: ceoStaffId } });
        await prisma.staff.deleteMany({ where: { id: ceoStaffId } });
        await app.close();
      }
    });

    it('processes real Razorpay webhook signature, activates candidate, and repeat webhook is an idempotent no-op', async () => {
      // 1. Create a candidate pending payment
      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P7W-${timestamp}`,
          name: 'Real Webhook Seeker',
          phone: `96001${String(timestamp).slice(-5)}`,
          phoneVerified: true,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'pending_payment',
          city: 'Bengaluru',
        },
      });

      // 2. Create pending activation payment row with real gateway reference
      const gatewayReference = `plink_idemp_${timestamp}`;
      const paymentCode = await idService.generateCode('payment');

      const payment = await prisma.payment.create({
        data: {
          code: paymentCode,
          type: 'activation',
          amount: 49900,
          status: 'pending',
          gatewayReference,
          subjectType: 'job_seeker',
          subjectId: candidate.id,
          jobSeekerId: candidate.id,
          city: 'Bengaluru',
        },
      });

      // 3. Real Razorpay webhook payload structure
      const realRazorpayPayload = {
        entity: 'event',
        event: 'payment_link.paid',
        payload: {
          payment_link: {
            entity: {
              id: gatewayReference,
              amount: 49900,
              currency: 'INR',
              status: 'paid',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(realRazorpayPayload);
      const signature = crypto
        .createHmac('sha256', testWebhookSecret)
        .update(payloadStr)
        .digest('hex');

      // 4. First webhook delivery
      const firstRes = await request(app.getHttpServer())
        .post('/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .send(payloadStr);

      expect(firstRes.status).toBe(201);
      expect(firstRes.body.status).toBe('succeeded');
      expect(firstRes.body.paymentId).toBe(payment.id);

      // Verify DB state after first webhook
      const candidateAfterFirst = await prisma.jobSeeker.findUnique({
        where: { id: candidate.id },
      });
      expect(candidateAfterFirst?.status).toBe('active');
      expect(candidateAfterFirst?.paymentReceivedAt).toBeDefined();

      const paymentAfterFirst = await prisma.payment.findUnique({
        where: { id: payment.id },
      });
      expect(paymentAfterFirst?.status).toBe('succeeded');

      // Verify audit log created
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          entityCode: candidate.code,
          action: 'job_seeker.activated',
        },
      });
      expect(auditLogs).toHaveLength(1);

      // 5. Second webhook delivery (repeat delivery - idempotency)
      const secondRes = await request(app.getHttpServer())
        .post('/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .send(payloadStr);

      expect(secondRes.status).toBe(201);
      expect(secondRes.body.received).toBe(true);
      expect(secondRes.body.alreadyProcessed).toBe(true);

      // Verify audit logs NOT duplicated
      const auditLogsAfterSecond = await prisma.auditLog.findMany({
        where: {
          entityCode: candidate.code,
          action: 'job_seeker.activated',
        },
      });
      expect(auditLogsAfterSecond).toHaveLength(1);

      // 6. Webhook with invalid signature is rejected with 400
      await request(app.getHttpServer())
        .post('/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'forged_tampered_signature')
        .send(payloadStr)
        .expect(400);
    });
  });

  describe('PaymentModule integration with PAYMENT_PROVIDER env flag', () => {
    const originalEnv = process.env.PAYMENT_PROVIDER;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PAYMENT_PROVIDER;
      } else {
        process.env.PAYMENT_PROVIDER = originalEnv;
      }
    });

    it('instantiates RealPaymentProvider when PAYMENT_PROVIDER=real or razorpay', async () => {
      process.env.PAYMENT_PROVIDER = 'real';

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [PaymentModule],
      }).compile();

      const provider = moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER);
      expect(provider).toBeInstanceOf(RealPaymentProvider);

      process.env.PAYMENT_PROVIDER = 'razorpay';
      const moduleRefRzp = await Test.createTestingModule({
        imports: [PaymentModule],
      }).compile();
      expect(moduleRefRzp.get<PaymentProvider>(PAYMENT_PROVIDER)).toBeInstanceOf(
        RealPaymentProvider,
      );
    });
  });
});

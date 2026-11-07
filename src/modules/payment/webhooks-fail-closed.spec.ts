import { INestApplication, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import * as request from 'supertest';
import { validateWebhookHmac } from '../../common/webhook/webhook-signature';
import { MockBankFeedProvider } from './mock-bank-feed.provider';
import { MockPaymentProvider } from './mock-payment.provider';
import { RealPaymentProvider } from './real-payment.provider';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { UpiCollectionService } from './upi-collection.service';
import { CallController } from '../call/call.controller';
import { CallService } from '../call/call.service';
import { TelephonyController } from '../telephony/telephony.controller';
import { TelephonyService } from '../telephony/telephony.service';
import { MessageController } from '../message/message.controller';
import { MessagingService } from '../message/messaging.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { BANK_FEED_PROVIDER } from './bank-feed-provider.interface';
import { TELEPHONY_PROVIDER } from '../telephony/telephony.interface';
import { WHATSAPP_PROVIDER } from '../../common/whatsapp/whatsapp.interface';
import { SMS_PROVIDER } from '../message/sms.provider';

describe('Security Fix: Fail-Closed Incoming Webhooks & Secret Enforcement', () => {
  const VALID_SECRET = 'ci_webhook_secret_for_tests_32_characters_minimum';
  const SHORT_SECRET = 'short_secret_under_32_bytes';

  const sign = (raw: string, secret: string) =>
    crypto.createHmac('sha256', secret).update(raw).digest('hex');

  describe('1. validateWebhookHmac unit verification', () => {
    it('refuses when secret is missing or undefined', () => {
      const res = validateWebhookHmac('{}', 'some-sig', undefined);
      expect(res.isValid).toBe(false);
      expect(res.reason).toBe('secret_missing');
    });

    it('refuses when secret is shorter than 32 characters', () => {
      const res = validateWebhookHmac('{}', 'some-sig', SHORT_SECRET);
      expect(res.isValid).toBe(false);
      expect(res.reason).toBe('secret_too_short');
    });

    it('refuses when rawBody is missing or null', () => {
      const res = validateWebhookHmac(undefined, 'some-sig', VALID_SECRET);
      expect(res.isValid).toBe(false);
      expect(res.reason).toBe('raw_body_missing');
    });

    it('refuses when signature is missing, empty, or whitespace', () => {
      const res1 = validateWebhookHmac('{}', undefined, VALID_SECRET);
      expect(res1.isValid).toBe(false);
      expect(res1.reason).toBe('signature_missing');

      const res2 = validateWebhookHmac('{}', '   ', VALID_SECRET);
      expect(res2.isValid).toBe(false);
      expect(res2.reason).toBe('signature_missing');
    });

    it('refuses when signature does not match', () => {
      const res = validateWebhookHmac('{}', 'invalid_signature_hex', VALID_SECRET);
      expect(res.isValid).toBe(false);
      expect(res.reason).toBe('signature_mismatch');
    });

    it('accepts correctly signed rawBody with 32+ char secret', () => {
      const raw = JSON.stringify({ amount: 49900 });
      const validSig = sign(raw, VALID_SECRET);
      const res = validateWebhookHmac(raw, validSig, VALID_SECRET);
      expect(res.isValid).toBe(true);
      expect(res.reason).toBeUndefined();
    });

    it('accepts sha256= prefixed signatures', () => {
      const raw = JSON.stringify({ test: true });
      const validSig = `sha256=${sign(raw, VALID_SECRET)}`;
      const res = validateWebhookHmac(raw, validSig, VALID_SECRET);
      expect(res.isValid).toBe(true);
    });
  });

  describe('2. MockBankFeedProvider fail-closed behaviour', () => {
    afterEach(() => {
      delete process.env.BANK_FEED_WEBHOOK_SECRET;
    });

    it('rejects unsigned bank feed payloads when BANK_FEED_WEBHOOK_SECRET is unset', async () => {
      delete process.env.BANK_FEED_WEBHOOK_SECRET;
      const provider = new MockBankFeedProvider();
      const raw = JSON.stringify({ bankUtr: 'UTR123', amountPaise: 49900 });
      const result = await provider.verifyWebhook(raw);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('secret_missing');
    });

    it('rejects bank feed payloads when BANK_FEED_WEBHOOK_SECRET is shorter than 32 characters', async () => {
      process.env.BANK_FEED_WEBHOOK_SECRET = SHORT_SECRET;
      const provider = new MockBankFeedProvider();
      const raw = JSON.stringify({ bankUtr: 'UTR123', amountPaise: 49900 });
      const sig = sign(raw, SHORT_SECRET);
      const result = await provider.verifyWebhook(raw, sig);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('secret_too_short');
    });

    it('rejects bank feed payloads when signature is missing', async () => {
      process.env.BANK_FEED_WEBHOOK_SECRET = VALID_SECRET;
      const provider = new MockBankFeedProvider();
      const raw = JSON.stringify({ bankUtr: 'UTR123', amountPaise: 49900 });
      const result = await provider.verifyWebhook(raw);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('signature_missing');
    });

    it('rejects bank feed payloads when signature is invalid', async () => {
      process.env.BANK_FEED_WEBHOOK_SECRET = VALID_SECRET;
      const provider = new MockBankFeedProvider();
      const raw = JSON.stringify({ bankUtr: 'UTR123', amountPaise: 49900 });
      const result = await provider.verifyWebhook(raw, 'wrong_sig');
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('signature_mismatch');
    });

    it('accepts validly signed bank feed payloads', async () => {
      process.env.BANK_FEED_WEBHOOK_SECRET = VALID_SECRET;
      const provider = new MockBankFeedProvider();
      const payload = {
        bankUtr: 'UTR12345678',
        amountPaise: 49900,
        remark: 'LABREF001',
        creditedAt: new Date().toISOString(),
      };
      const raw = JSON.stringify(payload);
      const sig = sign(raw, VALID_SECRET);
      const result = await provider.verifyWebhook(raw, sig);
      expect(result.isValid).toBe(true);
      expect(result.event?.bankUtr).toBe('UTR12345678');
      expect(result.event?.amountPaise).toBe(49900);
      expect(result.event?.remark).toBe('LABREF001');
    });
  });

  describe('3. MockPaymentProvider fail-closed behaviour', () => {
    afterEach(() => {
      delete process.env.PAYMENT_WEBHOOK_SECRET;
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
      delete process.env.PAYOUT_WEBHOOK_SECRET;
      delete process.env.RAZORPAYX_WEBHOOK_SECRET;
    });

    it('rejects unsigned card webhook payloads when secret is unset', async () => {
      const provider = new MockPaymentProvider();
      const result = await provider.verifyWebhook({ gatewayReference: 'ref1', status: 'succeeded' });
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('secret_missing');
    });

    it('rejects webhook when secret is shorter than 32 characters', async () => {
      process.env.PAYMENT_WEBHOOK_SECRET = SHORT_SECRET;
      const provider = new MockPaymentProvider();
      const raw = JSON.stringify({ gatewayReference: 'ref1', status: 'succeeded' });
      const sig = sign(raw, SHORT_SECRET);
      const result = await provider.verifyWebhook(JSON.parse(raw), sig, raw);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('secret_too_short');
    });

    it('accepts correctly signed payment webhook', async () => {
      process.env.PAYMENT_WEBHOOK_SECRET = VALID_SECRET;
      const provider = new MockPaymentProvider();
      const payload = { gatewayReference: 'ref_123', status: 'succeeded', amountPaise: 49900 };
      const raw = JSON.stringify(payload);
      const sig = sign(raw, VALID_SECRET);
      const result = await provider.verifyWebhook(payload, sig, raw);
      expect(result.isValid).toBe(true);
      expect(result.gatewayReference).toBe('ref_123');
    });

    it('rejects unsigned payout webhook payloads when payout secret is unset', async () => {
      const provider = new MockPaymentProvider();
      const raw = JSON.stringify({ payoutId: 'pout_1', status: 'processed' });
      const result = await provider.verifyPayoutWebhook(raw);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('secret_missing');
    });

    it('accepts correctly signed payout webhook', async () => {
      process.env.PAYOUT_WEBHOOK_SECRET = VALID_SECRET;
      const provider = new MockPaymentProvider();
      const payload = {
        event: 'payout.processed',
        payload: {
          payout: {
            entity: {
              id: 'pout_123',
              amount: 20000,
              status: 'processed',
            },
          },
        },
      };
      const raw = JSON.stringify(payload);
      const sig = sign(raw, VALID_SECRET);
      const result = await provider.verifyPayoutWebhook(raw, sig);
      expect(result.isValid).toBe(true);
      expect(result.payoutId).toBe('pout_123');
    });
  });

  describe('4. RealPaymentProvider fail-closed behaviour', () => {
    it('refuses webhook when constructed without secret', async () => {
      const provider = new RealPaymentProvider();
      const raw = JSON.stringify({ event: 'payment.captured' });
      const result = await provider.verifyWebhook(JSON.parse(raw), 'sig', raw);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('secret_missing');
    });

    it('refuses webhook when secret is shorter than 32 characters', async () => {
      const provider = new RealPaymentProvider({ webhookSecret: SHORT_SECRET });
      const raw = JSON.stringify({ event: 'payment.captured' });
      const sig = sign(raw, SHORT_SECRET);
      const result = await provider.verifyWebhook(JSON.parse(raw), sig, raw);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('secret_too_short');
    });

    it('refuses webhook when signature is invalid', async () => {
      const provider = new RealPaymentProvider({ webhookSecret: VALID_SECRET });
      const raw = JSON.stringify({ event: 'payment.captured' });
      const result = await provider.verifyWebhook(JSON.parse(raw), 'wrong_sig', raw);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('signature_mismatch');
    });
  });

  describe('5. Production lockdown: POST /payments/mock/simulate-webhook', () => {
    it('returns 404 in production environment', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const controller = new PaymentController(
          { simulateMockWebhook: jest.fn() } as unknown as PaymentService,
          {} as unknown as UpiCollectionService,
        );
        await expect(controller.simulateWebhook({ gatewayReference: 'test' })).rejects.toThrow(
          NotFoundException,
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('service throws NotFoundException if simulateMockWebhook called in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const paymentService = new PaymentService(
          {} as unknown as PrismaService,
          {} as unknown as AuditService,
          {} as unknown as IdService,
          {} as unknown as MockPaymentProvider,
          {} as unknown as MockBankFeedProvider,
          {} as unknown as PricingService,
          {} as never,
          {} as unknown as ReviewFlagService,
        );
        await expect(paymentService.simulateMockWebhook({ gatewayReference: 'test' })).rejects.toThrow(
          NotFoundException,
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('6. Crucial Security Test: Fake bank credit cannot confirm payment or activate job seeker', () => {
    it('rejects unsigned fake credit and leaves payment pending and job seeker pending_payment', async () => {
      process.env.BANK_FEED_WEBHOOK_SECRET = VALID_SECRET;

      let paymentStatus = 'pending';
      let candidateStatus = 'pending_payment';

      const mockPrisma = {
        bankCredit: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'bc-1', amountPaise: 49900 }),
        },
        payment: {
          findFirst: jest.fn().mockImplementation(({ where }) => {
            if (where.upiReference === 'LABREF999') {
              return Promise.resolve({
                id: 'pay-uuid-1',
                code: 'PAY-00001',
                amount: 49900,
                status: paymentStatus,
                upiReference: 'LABREF999',
                jobSeekerId: 'js-uuid-1',
                type: 'activation',
                city: 'Bengaluru',
              });
            }
            return Promise.resolve(null);
          }),
          update: jest.fn().mockImplementation(({ data }) => {
            if (data.status) paymentStatus = data.status;
            return Promise.resolve({});
          }),
        },
        jobSeeker: {
          update: jest.fn().mockImplementation(({ data }) => {
            if (data.status) candidateStatus = data.status;
            return Promise.resolve({});
          }),
        },
      };

      const bankFeedProvider = new MockBankFeedProvider();
      const paymentProvider = new MockPaymentProvider();
      const pricingService = { current: jest.fn().mockResolvedValue({ activationFeePaise: 49900 }) };
      const auditService = { log: jest.fn() };
      const idService = { generateCode: jest.fn() };

      const service = new PaymentService(
        mockPrisma as unknown as PrismaService,
        auditService as unknown as AuditService,
        idService as unknown as IdService,
        paymentProvider,
        bankFeedProvider,
        pricingService as unknown as PricingService,
        {} as never,
        {} as unknown as ReviewFlagService,
      );

      // Attacker sends fake bank credit matching candidate's upiReference and exact amount, but unsigned
      const fakeCreditPayload = {
        bankUtr: 'FAKE_UTR_999999',
        amountPaise: 49900,
        remark: 'LABREF999',
      };
      const rawFakeCredit = JSON.stringify(fakeCreditPayload);

      // Unsigned -> throws UnauthorizedException (401)
      await expect(service.handleBankFeedWebhook(rawFakeCredit, undefined)).rejects.toThrow(
        UnauthorizedException,
      );

      // Wrongly signed -> throws UnauthorizedException (401)
      await expect(
        service.handleBankFeedWebhook(rawFakeCredit, 'fake_attacker_signature'),
      ).rejects.toThrow(UnauthorizedException);

      // Verify payment was NEVER confirmed and job seeker was NEVER activated
      expect(paymentStatus).toBe('pending');
      expect(candidateStatus).toBe('pending_payment');
      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      expect(mockPrisma.jobSeeker.update).not.toHaveBeenCalled();

      delete process.env.BANK_FEED_WEBHOOK_SECRET;
    });
  });

  describe('7. HTTP Controller Gate: All 7 webhook routes fail closed (401)', () => {
    let app: INestApplication;

    const mockPrisma: {
      staff: { findFirst: jest.Mock };
      statusHistory: { create: jest.Mock };
      messageLog: {
        findUnique: jest.Mock;
        update: jest.Mock;
      };
      callbackTask: { findFirst: jest.Mock; create: jest.Mock };
      jobSeeker: { findFirst: jest.Mock; update: jest.Mock };
      payment: {
        findFirst: jest.Mock;
        findUnique: jest.Mock;
        findMany: jest.Mock;
        update: jest.Mock;
        updateMany: jest.Mock;
      };
      bankCredit: { findUnique: jest.Mock; create: jest.Mock };
      $transaction: jest.Mock;
    } = {
      staff: { findFirst: jest.fn() },
      statusHistory: { create: jest.fn() },
      messageLog: {
        findUnique: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'sent', deliveredAt: null, failedAt: null }),
        update: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'delivered' }),
      },
      callbackTask: { findFirst: jest.fn(), create: jest.fn() },
      jobSeeker: { findFirst: jest.fn(), update: jest.fn() },
      payment: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: 'pay-1', status: 'pending', amount: 49900, type: 'activation' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bankCredit: { findUnique: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'bc-1', amountPaise: 49900 }) },
      $transaction: jest.fn(),
    };
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma));

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [
          PaymentController,
          CallController,
          TelephonyController,
          MessageController,
        ],
        providers: [
          {
            provide: PrismaService,
            useValue: mockPrisma,
          },
          {
            provide: AuditService,
            useValue: { log: jest.fn() },
          },
          {
            provide: IdService,
            useValue: { generateCode: jest.fn().mockResolvedValue('ID-001') },
          },
          {
            provide: PricingService,
            useValue: { current: jest.fn().mockResolvedValue({ activationFeePaise: 49900 }) },
          },
          {
            provide: ReviewFlagService,
            useValue: { raise: jest.fn(), resolve: jest.fn() },
          },
          {
            provide: PAYMENT_PROVIDER,
            useClass: MockPaymentProvider,
          },
          {
            provide: BANK_FEED_PROVIDER,
            useClass: MockBankFeedProvider,
          },
          {
            provide: TELEPHONY_PROVIDER,
            useValue: {
              handleInboundCall: jest.fn().mockResolvedValue({ isDuplicate: false, callbackTaskId: 'task-1' }),
              getCapacity: jest.fn().mockResolvedValue({ concurrentChannels: 60 }),
            },
          },
          {
            provide: WHATSAPP_PROVIDER,
            useValue: { send: jest.fn() },
          },
          {
            provide: SMS_PROVIDER,
            useValue: { send: jest.fn() },
          },
          {
            provide: UpiCollectionService,
            useValue: {
              renderPaymentPage: jest.fn(),
              getPaymentPage: jest.fn(),
            },
          },
          {
            provide: PaymentService,
            useFactory: (prisma, audit, id, payProv, bankProv, pricing, review) =>
              new PaymentService(prisma, audit, id, payProv, bankProv, pricing, {} as never, review),
            inject: [
              PrismaService,
              AuditService,
              IdService,
              PAYMENT_PROVIDER,
              BANK_FEED_PROVIDER,
              PricingService,
              ReviewFlagService,
            ],
          },
          {
            provide: TelephonyService,
            useFactory: (provider, prisma) =>
              new TelephonyService(provider, prisma),
            inject: [TELEPHONY_PROVIDER, PrismaService],
          },
          {
            provide: CallService,
            useValue: {
              applyWebhook: (rawBody?: Buffer, signature?: string) => {
                const secret = process.env.TELEPHONY_WEBHOOK_SECRET ?? '';
                const validation = validateWebhookHmac(rawBody, signature, secret);
                if (!validation.isValid) throw new UnauthorizedException(validation.reason);
                return { success: true };
              },
            },
          },
          {
            provide: MessagingService,
            useFactory: (prisma, whatsapp, sms) =>
              new MessagingService(prisma, whatsapp, sms),
            inject: [PrismaService, WHATSAPP_PROVIDER, SMS_PROVIDER],
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication({ rawBody: true });
      await app.init();
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    afterEach(() => {
      delete process.env.BANK_FEED_WEBHOOK_SECRET;
      delete process.env.PAYMENT_WEBHOOK_SECRET;
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
      delete process.env.PAYOUT_WEBHOOK_SECRET;
      delete process.env.RAZORPAYX_WEBHOOK_SECRET;
      delete process.env.TELEPHONY_WEBHOOK_SECRET;
      delete process.env.MESSAGE_WEBHOOK_SECRET;
    });

    const routes: Array<{
      name: string;
      path: string;
      secretEnv: string;
      headerName: string;
      payload: Record<string, unknown>;
    }> = [
      {
        name: 'payments/bank-feed/webhook',
        path: '/payments/bank-feed/webhook',
        secretEnv: 'BANK_FEED_WEBHOOK_SECRET',
        headerName: 'x-bank-feed-signature',
        payload: { bankUtr: 'UTR123', amountPaise: 49900 },
      },
      {
        name: 'payments/webhook',
        path: '/payments/webhook',
        secretEnv: 'PAYMENT_WEBHOOK_SECRET',
        headerName: 'x-razorpay-signature',
        payload: { gatewayReference: 'mock_gw_1', status: 'succeeded' },
      },
      {
        name: 'payments/payout-webhook',
        path: '/payments/payout-webhook',
        secretEnv: 'PAYOUT_WEBHOOK_SECRET',
        headerName: 'x-razorpay-signature',
        payload: {
          event: 'payout.processed',
          payload: { payout: { entity: { id: 'pout_1', amount: 20000, status: 'processed' } } },
        },
      },
      {
        name: 'telephony/webhook/call-status',
        path: '/telephony/webhook/call-status',
        secretEnv: 'TELEPHONY_WEBHOOK_SECRET',
        headerName: 'x-telephony-signature',
        payload: { call_id: 'c1', status: 'completed' },
      },
      {
        name: 'telephony/webhook/missed-call',
        path: '/telephony/webhook/missed-call',
        secretEnv: 'TELEPHONY_WEBHOOK_SECRET',
        headerName: 'x-telephony-signature',
        payload: { call_id: 'c2', caller: '+919999999999' },
      },
      {
        name: 'messages/webhook/whatsapp',
        path: '/messages/webhook/whatsapp',
        secretEnv: 'MESSAGE_WEBHOOK_SECRET',
        headerName: 'x-message-signature',
        payload: { providerMessageId: 'msg1', status: 'delivered' },
      },
      {
        name: 'messages/webhook/sms',
        path: '/messages/webhook/sms',
        secretEnv: 'MESSAGE_WEBHOOK_SECRET',
        headerName: 'x-message-signature',
        payload: { providerMessageId: 'msg2', status: 'delivered' },
      },
    ];

    for (const r of routes) {
      describe(`Webhook route: ${r.name}`, () => {
        it('refuses unsigned request with 401 when secret is unset', async () => {
          delete process.env[r.secretEnv];
          const raw = JSON.stringify(r.payload);
          await request(app.getHttpServer())
            .post(r.path)
            .set('content-type', 'application/json')
            .send(raw)
            .expect(401);
        });

        it('refuses request when secret is < 32 characters with 401', async () => {
          process.env[r.secretEnv] = SHORT_SECRET;
          const raw = JSON.stringify(r.payload);
          const sig = sign(raw, SHORT_SECRET);
          await request(app.getHttpServer())
            .post(r.path)
            .set('content-type', 'application/json')
            .set(r.headerName, sig)
            .send(raw)
            .expect(401);
        });

        it('refuses unsigned request with 401 even when secret is configured', async () => {
          process.env[r.secretEnv] = VALID_SECRET;
          const raw = JSON.stringify(r.payload);
          await request(app.getHttpServer())
            .post(r.path)
            .set('content-type', 'application/json')
            .send(raw)
            .expect(401);
        });

        it('refuses wrongly signed request with 401', async () => {
          process.env[r.secretEnv] = VALID_SECRET;
          const raw = JSON.stringify(r.payload);
          await request(app.getHttpServer())
            .post(r.path)
            .set('content-type', 'application/json')
            .set(r.headerName, 'forged_bad_signature_hex')
            .send(raw)
            .expect(401);
        });

        it('accepts correctly signed request with 32+ char secret', async () => {
          process.env[r.secretEnv] = VALID_SECRET;
          const raw = JSON.stringify(r.payload);
          const validSig = sign(raw, VALID_SECRET);
          const res = await request(app.getHttpServer())
            .post(r.path)
            .set('content-type', 'application/json')
            .set(r.headerName, validSig)
            .send(raw);

          // Must be accepted (200 or 201), never 401
          expect(res.status).not.toBe(401);
          expect([200, 201]).toContain(res.status);
        });
      });
    }
  });
});

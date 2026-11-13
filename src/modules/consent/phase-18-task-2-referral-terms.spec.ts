import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ExecutionContext, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentLinkService } from './consent-link.service';
import { ConsentService } from './consent.service';
import { OtpService } from '../../common/otp/otp.service';
import { MessagingService } from '../message/messaging.service';
import { PricingService } from '../pricing/pricing.service';
import { AuditService } from '../../common/audit/audit.service';
import { PaymentService } from '../payment/payment.service';
import { ReferralController } from '../referral/referral.controller';
import { ReferralService } from '../referral/referral.service';
import { ConsentController } from './consent.controller';
import { ConsentWithdrawalService } from './consent-withdrawal.service';
import { PaymentController } from '../payment/payment.controller';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { IdService } from '../../common/id/id.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { AGREEMENT_DOCUMENT_STORAGE, MemoryAgreementDocumentStorage } from './agreement-document.storage';
import { BusinessVerificationService } from '../business/business-verification.service';
import { PAYMENT_PROVIDER } from '../payment/payment-provider.interface';
import { BANK_FEED_PROVIDER } from '../payment/bank-feed-provider.interface';
import { MockPaymentProvider } from '../payment/mock-payment.provider';
import { MockBankFeedProvider } from '../payment/mock-bank-feed.provider';
import { ConsentClock } from './consent-clock';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { PublicOtpLimiter } from '../../common/public-otp-limiter.service';
import { createHash } from 'node:crypto';

type MockPrismaService = {
  referral: { findUnique: jest.Mock };
  consent: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    updateMany: jest.Mock;
  };
  payment: { findUnique: jest.Mock; update: jest.Mock };
  statusHistory: { create: jest.Mock };
  $transaction: jest.Mock;
};

describe('Phase 18 Task 2: Referral partners sign their terms', () => {
  let app: INestApplication;
  let consentLinkService: ConsentLinkService;
  let otpService: OtpService;
  let messagingService: MessagingService;
  let mockPrisma: MockPrismaService;
  const publicLinks = new Map<string, Record<string, unknown>>();

  const mockStaffUser = {
    sub: 'staff-uuid-1',
    role: 'call_agent',
    phone: '9876543210',
  };

  const referralId = 'ref-uuid-100';
  const partnerPhone = '919876543210';
  const partnerName = 'Ramesh Kumar';

  const originalAppUrl = process.env.PUBLIC_APP_URL;

  beforeAll(() => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
  });

  afterAll(() => {
    if (originalAppUrl) {
      process.env.PUBLIC_APP_URL = originalAppUrl;
    } else {
      delete process.env.PUBLIC_APP_URL;
    }
  });

  beforeEach(async () => {
    publicLinks.clear();
    mockPrisma = {
      referral: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === referralId) {
            return Promise.resolve({
              id: referralId,
              code: 'RF-00100',
              name: partnerName,
              phone: partnerPhone,
              status: 'active',
              city: 'Bengaluru',
            });
          }
          return Promise.resolve(null);
        }),
      },
      consent: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'c-1', ...create })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pay-1', ...data })),
      },
      statusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'sh-1' }),
      },
      $transaction: jest.fn().mockImplementation(async (cb) => {
        if (typeof cb === 'function') {
          return cb(mockPrisma);
        }
        return Promise.all(cb);
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ReferralController, ConsentController, PaymentController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PublicOtpLimiter, useValue: { claimSend: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: PublicLinkStoreService,
          useValue: {
            create: jest.fn().mockImplementation(async (input) => {
              const token = createHash('sha256').update(`terms-link-${publicLinks.size + 1}-${Date.now()}`).digest('hex');
              const id = `public-link-${publicLinks.size + 1}`;
              publicLinks.set(token, {
                id,
                tokenHash: createHash('sha256').update(token).digest('hex'),
                ...input,
                usedAt: null,
                revokedAt: null,
                openedAt: null,
                createdAt: new Date(),
              });
              return { token, id };
            }),
            findByToken: jest.fn().mockImplementation(async (token: string) => {
              const row = publicLinks.get(token);
              if (!row) throw new Error('Public link not found');
              if (row.usedAt) throw new BadRequestException('Public link has already been used');
              if ((row.expiresAt as Date).getTime() <= Date.now()) throw new BadRequestException('Public link has expired');
              row.openedAt = row.openedAt ?? new Date();
              return row;
            }),
            markUsed: jest.fn().mockImplementation(async (token: string) => {
              const row = publicLinks.get(token);
              if (row) row.usedAt = new Date();
            }),
            revokeActive: jest.fn().mockResolvedValue({ count: 0 }),
            hashToken: jest.fn((token: string) => createHash('sha256').update(token).digest('hex')),
          },
        },
        ConsentClock,
        ConsentService,
        ConsentLinkService,
        {
          provide: ConsentWithdrawalService,
          useValue: { withdraw: jest.fn(), eligibility: jest.fn() },
        },
        {
          provide: OtpService,
          useValue: {
            sendOtp: jest.fn().mockResolvedValue({ requestId: 'otp-req-999' }),
            verifyOtp: jest.fn().mockImplementation((reqId: string, code: string) => Promise.resolve(code === '123456')),
            isVerified: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: MessagingService,
          useValue: {
            send: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
          },
        },
        {
          provide: PricingService,
          useValue: {
            current: jest.fn().mockResolvedValue({
              referralPayoutPaise: 20000,
              placementFeePercent: 50,
              gstPercent: 18,
              noBypassMonths: 12,
              noBypassPenaltyPercent: 50,
            }),
          },
        },
        {
          provide: AuditService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: BusinessVerificationService,
          useValue: { advanceToPendingTlCheckIfReady: jest.fn() },
        },
        {
          provide: AGREEMENT_DOCUMENT_STORAGE,
          useClass: MemoryAgreementDocumentStorage,
        },
        {
          provide: IdService,
          useValue: { generateCode: jest.fn().mockResolvedValue('PAY-00001') },
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
          provide: UpiCollectionService,
          useValue: { renderPaymentPage: jest.fn(), getPaymentPage: jest.fn() },
        },
        PaymentService,
        {
          provide: ReferralService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findById: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = mockStaffUser;
          return true;
        },
      })
      .overrideGuard(RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new PiiMaskingInterceptor());
    await app.init();

    consentLinkService = moduleRef.get<ConsentLinkService>(ConsentLinkService);
    otpService = moduleRef.get<OtpService>(OtpService);
    messagingService = moduleRef.get<MessagingService>(MessagingService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('1. Referral Terms Link Generation (POST /referrals/:id/terms-links)', () => {
    it('creates a resumable token and sends SMS with referral terms and partner code', async () => {
      const res = await request(app.getHttpServer())
        .post(`/referrals/${referralId}/terms-links`)
        .send({ language: 'en' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.token.length).toBe(64);
      // Response must NEVER leak the phone number
      expect(res.body.phone).toBeUndefined();
      expect(res.body.partnerPhone).toBeUndefined();

      expect(messagingService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'sms',
          template: 'referral_terms_link',
          subjectType: 'referral',
          subjectId: referralId,
          variables: expect.objectContaining({
            token: res.body.token,
            link: expect.stringContaining(`/app/p/partner/${res.body.token}`),
            referralCode: expect.any(String),
          }),
        }),
      );
    });

    it('rejects unsupported language', async () => {
      const res = await request(app.getHttpServer())
        .post(`/referrals/${referralId}/terms-links`)
        .send({ language: 'fr' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('language must be kn, hi, or en');
    });

    it('throws 404 if referral partner does not exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/referrals/non-existent-ref/terms-links')
        .send({ language: 'en' });

      expect(res.status).toBe(404);
    });
  });

  describe('2. Public Link Retrieval (GET /consent/:token)', () => {
    it('returns terms details including referralPayoutPaise and masked phone', async () => {
      const link = await consentLinkService.createReferralTermsLink(referralId, 'staff-1', 'en');

      const res = await request(app.getHttpServer())
        .get(`/consent/${link.token}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.subjectType).toBe('referral');
      expect(res.body.referralId).toBe(referralId);
      expect(res.body.partnerName).toBe(partnerName);
      expect(res.body.maskedPhone).toBe('******3210');
      expect(res.body.referralPayoutPaise).toBe(20000);
      expect(res.body.termsHtml).toContain('Laboura Referral Partner Terms');
      expect(res.body.termsHtml).toContain('₹200');
    });

    it('returns HTML page when Accept header requests text/html', async () => {
      const link = await consentLinkService.createReferralTermsLink(referralId, 'staff-1', 'en');

      const res = await request(app.getHttpServer())
        .get(`/consent/${link.token}`)
        .set('Accept', 'text/html');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Referral Partner Terms');
      expect(res.text).toContain('******3210');
      expect(res.text).toContain('agreement_terms');
      expect(res.text).toContain('call_recording');
    });
  });

  describe('3. Partner OTP Verification and Consent Submission (POST /consent/submit)', () => {
    it('sends OTP to the registered partner phone only', async () => {
      const link = await consentLinkService.createReferralTermsLink(referralId, 'staff-1', 'en');

      const res = await request(app.getHttpServer())
        .post('/consent/send-otp')
        .send({ token: link.token });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.requestId).toBe('otp-req-999');
      expect(res.body.phone).toBe('******3210');
      expect(otpService.sendOtp).toHaveBeenCalledWith(partnerPhone);
    });

    it('refuses submission with invalid OTP code', async () => {
      const link = await consentLinkService.createReferralTermsLink(referralId, 'staff-1', 'en');

      const res = await request(app.getHttpServer())
        .post('/consent/submit')
        .send({
          token: link.token,
          otpRequestId: 'otp-req-999',
          otpCode: '000000', // wrong OTP
          purposes: ['agreement_terms', 'call_recording'],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Valid owner OTP is required to sign referral terms');
    });

    it('accepts the code the partner verified when opening the link, without a second code (as on the job seeker link)', async () => {
      const link = await consentLinkService.createReferralTermsLink(referralId, 'staff-1', 'en');
      const res = await request(app.getHttpServer())
        .post('/consent/submit')
        .send({ token: link.token, otpRequestId: 'otp-req-999', purposes: ['agreement_terms', 'call_recording'] });
      expect(res.status).toBe(201);
      expect(otpService.isVerified).toHaveBeenCalledWith('otp-req-999', partnerPhone);
      expect(otpService.verifyOtp).not.toHaveBeenCalledWith('otp-req-999', undefined);
    });

    it('refuses without a code when that request is not a verified code for the partner phone', async () => {
      const link = await consentLinkService.createReferralTermsLink(referralId, 'staff-1', 'en');
      (otpService.isVerified as jest.Mock).mockResolvedValueOnce(false);
      const res = await request(app.getHttpServer())
        .post('/consent/submit')
        .send({ token: link.token, otpRequestId: 'otp-req-other', purposes: ['agreement_terms', 'call_recording'] });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Valid owner OTP is required to sign referral terms');
    });

    it('refuses submission if either agreement_terms or call_recording is omitted', async () => {
      const link = await consentLinkService.createReferralTermsLink(referralId, 'staff-1', 'en');

      // Only agreement_terms, omitted call_recording
      const res = await request(app.getHttpServer())
        .post('/consent/submit')
        .send({
          token: link.token,
          otpRequestId: 'otp-req-999',
          otpCode: '123456',
          purposes: ['agreement_terms'],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Agreement terms and call recording consent are both required');
    });

    it('signs both consents and keeps the link resumable for the later registration steps', async () => {
      const link = await consentLinkService.createReferralTermsLink(referralId, 'staff-1', 'en');

      const res = await request(app.getHttpServer())
        .post('/consent/submit')
        .send({
          token: link.token,
          otpRequestId: 'otp-req-999',
          otpCode: '123456',
          purposes: ['agreement_terms', 'call_recording'],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.grantedPurposes).toEqual(['agreement_terms', 'call_recording']);

      // Assert two Consent rows created sharing the same otpRequestId
      expect(mockPrisma.consent.upsert).toHaveBeenCalledTimes(2);

      const calls = mockPrisma.consent.upsert.mock.calls;
      const firstCreate = calls[0][0].create;
      const secondCreate = calls[1][0].create;

      expect(firstCreate.subjectType).toBe('referral');
      expect(firstCreate.subjectId).toBe(referralId);
      expect(firstCreate.purpose).toBe('agreement_terms');
      expect(firstCreate.method).toBe('sms_link');
      expect(firstCreate.otpRequestId).toBe('otp-req-999');

      expect(secondCreate.subjectType).toBe('referral');
      expect(secondCreate.subjectId).toBe(referralId);
      expect(secondCreate.purpose).toBe('call_recording');
      expect(secondCreate.method).toBe('sms_link');
      expect(secondCreate.otpRequestId).toBe('otp-req-999');

      // The registration link remains valid after consent so the partner can resume at selfie, ID, and UPI.
      const repeatRes = await request(app.getHttpServer())
        .post('/consent/submit')
        .send({
          token: link.token,
          otpRequestId: 'otp-req-999',
          otpCode: '123456',
          purposes: ['agreement_terms', 'call_recording'],
        });
      expect(repeatRes.status).toBe(201);
      expect(repeatRes.body.grantedPurposes).toEqual(['agreement_terms', 'call_recording']);
      expect(mockPrisma.consent.upsert).toHaveBeenCalledTimes(4);
    });
  });

  describe('4. Payout release/approval blocked without signed terms', () => {
    it('blocks approving a referral payout when agreement_terms is not signed', async () => {
      const paymentId = 'pay-ref-001';
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: paymentId,
        code: 'PAY-00001',
        type: 'referral_payout',
        amount: 20000,
        status: 'pending',
        subjectType: 'referral',
        subjectId: referralId,
        referralId,
      });

      // No active consent in DB
      mockPrisma.consent.findFirst.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post(`/payments/${paymentId}/approve`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Referral partner has not signed agreement terms');
    });

    it('blocks approving a referral payout when agreement_terms was withdrawn', async () => {
      const paymentId = 'pay-ref-001';
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: paymentId,
        code: 'PAY-00001',
        type: 'referral_payout',
        amount: 20000,
        status: 'pending',
        subjectType: 'referral',
        subjectId: referralId,
        referralId,
      });

      // Withdrawn consent in DB
      mockPrisma.consent.findFirst.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post(`/payments/${paymentId}/approve`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Referral partner has not signed agreement terms');
    });

    it('allows approving referral payout once agreement_terms is active', async () => {
      const paymentId = 'pay-ref-001';
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: paymentId,
        code: 'PAY-00001',
        type: 'referral_payout',
        amount: 20000,
        status: 'pending',
        subjectType: 'referral',
        subjectId: referralId,
        referralId,
      });

      // Active consent in DB
      mockPrisma.consent.findFirst.mockResolvedValue({
        id: 'c-1',
        subjectType: 'referral',
        subjectId: referralId,
        purpose: 'agreement_terms',
        granted: true,
        grantedAt: new Date(),
        withdrawnAt: null,
      });

      const res = await request(app.getHttpServer())
        .post(`/payments/${paymentId}/approve`)
        .send();

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('approved');
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: paymentId },
          data: expect.objectContaining({
            status: 'approved',
            approvedByStaffId: mockStaffUser.sub,
          }),
        }),
      );
    });
  });

  describe('5. Staff cannot sign for a partner', () => {
    it('returns 404 for any nonexistent staff signing endpoint', async () => {
      const res1 = await request(app.getHttpServer())
        .post(`/referrals/${referralId}/terms`)
        .send({ signed: true });
      expect(res1.status).toBe(404);

      const res2 = await request(app.getHttpServer())
        .post(`/referrals/${referralId}/sign-terms`)
        .send({ signed: true });
      expect(res2.status).toBe(404);

      const res3 = await request(app.getHttpServer())
        .post(`/referrals/${referralId}/consent`)
        .send({ purpose: 'agreement_terms' });
      expect(res3.status).toBe(404);
    });
  });
});

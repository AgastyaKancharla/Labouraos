import { BadRequestException, ConflictException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { MessagingService } from '../message/messaging.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { PaymentProvider } from './payment-provider.interface';
import { MockBankFeedProvider } from './mock-bank-feed.provider';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';

type MockPrisma = {
  bankCredit: Record<string, jest.Mock>;
  payment: Record<string, jest.Mock>;
  jobSeeker: Record<string, jest.Mock>;
  placement: Record<string, jest.Mock>;
  reviewFlag: Record<string, jest.Mock>;
  statusHistory: Record<string, jest.Mock>;
  staff: Record<string, jest.Mock>;
  $transaction: jest.Mock;
};

type MockAuditService = {
  log: jest.Mock;
};

type MockReviewFlagService = {
  raise: jest.Mock;
  resolve: jest.Mock;
};

describe('Phase 16 Task 3: Bank Feed & Finance Confirmation', () => {
  const originalSecret = process.env.BANK_FEED_WEBHOOK_SECRET;

  let provider: MockBankFeedProvider;
  let service: PaymentService;
  let prisma: MockPrisma;
  let auditService: MockAuditService;
  let reviewFlagService: MockReviewFlagService;

  beforeEach(() => {
    process.env.BANK_FEED_WEBHOOK_SECRET = 'test_webhook_secret_32_chars_long_123';
    provider = new MockBankFeedProvider();

    const mockPrisma: MockPrisma = {
      bankCredit: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      payment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      jobSeeker: {
        update: jest.fn(),
      },
      placement: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      reviewFlag: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      statusHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
      staff: {
        findFirst: jest.fn().mockResolvedValue({ id: 'staff-sys-1', code: 'CEO-00001' }),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma)),
    };
    prisma = mockPrisma;

    auditService = {
      log: jest.fn().mockResolvedValue({}),
    };
    const idService = {
      generateCode: jest.fn().mockResolvedValue('PAY-00001'),
    } as unknown as IdService;
    const pricingService = {
      current: jest.fn().mockResolvedValue({ referralPayoutPaise: 20000 }),
    } as unknown as PricingService;
    const messagingService = {
      send: jest.fn().mockResolvedValue({ status: 'sent' }),
    } as unknown as MessagingService;
    reviewFlagService = {
      raise: jest.fn().mockResolvedValue({ id: 'flag-1', code: 'RF-0001' }),
      resolve: jest.fn().mockResolvedValue({ id: 'flag-1' }),
    };

    service = new PaymentService(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
      idService,
      {} as PaymentProvider,
      provider,
      pricingService,
      messagingService,
      reviewFlagService as unknown as ReviewFlagService,
    );
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.BANK_FEED_WEBHOOK_SECRET;
    } else {
      process.env.BANK_FEED_WEBHOOK_SECRET = originalSecret;
    }
  });

  const sign = (body: string, secret = 'test_webhook_secret_32_chars_long_123') => {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  };

  describe('BankFeedProvider verification', () => {
    it('accepts valid HMAC signature over raw body and parses event', async () => {
      const payload = JSON.stringify({
        bankUtr: '431201928374',
        amountPaise: 49900,
        receivedAt: '2026-11-09T10:00:00.000Z',
        remark: 'UPI/431201928374/PAY-00042-abcd1234',
        payerName: 'Ramesh Kumar',
        payerVpaMasked: 'ramesh@***',
      });
      const signature = sign(payload);
      const result = await provider.verifyWebhook(payload, signature);

      expect(result.isValid).toBe(true);
      expect(result.event).toBeDefined();
      expect(result.event?.bankUtr).toBe('431201928374');
      expect(result.event?.amountPaise).toBe(49900);
      expect(result.event?.remark).toBe('UPI/431201928374/PAY-00042-abcd1234');
    });

    it('refuses invalid or bad signature', async () => {
      const payload = JSON.stringify({ bankUtr: '431201928374', amountPaise: 49900 });
      const badResult = await provider.verifyWebhook(payload, 'bad_signature');
      expect(badResult.isValid).toBe(false);

      const explicitInvalid = await provider.verifyWebhook(payload, 'invalid-signature');
      expect(explicitInvalid.isValid).toBe(false);
    });

    it('refuses missing signature when secret is configured', async () => {
      const payload = JSON.stringify({ bankUtr: '431201928374', amountPaise: 49900 });
      const result = await provider.verifyWebhook(payload, undefined);
      expect(result.isValid).toBe(false);
    });
  });

  describe('handleBankFeedWebhook', () => {
    it('confirms pending upi_direct payment when reference and amount match exactly, starting 30-day clock at receivedAt', async () => {
      const receivedAt = new Date('2026-11-09T10:15:00.000Z');
      const payload = JSON.stringify({
        bankUtr: '431201928374',
        amountPaise: 49900,
        receivedAt: receivedAt.toISOString(),
        remark: 'UPI/431201928374/PAY-00042-abcd1234',
      });
      const signature = sign(payload);

      prisma.bankCredit.findUnique.mockResolvedValue(null);
      prisma.bankCredit.create.mockResolvedValue({
        id: 'credit-1',
        bankUtr: '431201928374',
        amountPaise: 49900,
        receivedAt,
        status: 'unmatched',
      });

      const payment = {
        id: 'pay-1',
        code: 'PAY-00042',
        status: 'pending',
        method: 'upi_direct',
        upiReference: 'PAY-00042-abcd1234',
        expectedAmountPaise: 49900,
        amount: 49900,
        type: 'activation',
        jobSeekerId: 'js-1',
        jobSeeker: { id: 'js-1', code: 'JS-00042', status: 'pending_activation', hitCount: 0 },
      };
      prisma.payment.findMany.mockResolvedValue([payment]);
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.jobSeeker.update.mockResolvedValue({
        id: 'js-1',
        code: 'JS-00042',
        status: 'active',
        paymentReceivedAt: receivedAt,
        hitCount: 0,
        city: 'Bengaluru',
      });
      prisma.bankCredit.update.mockResolvedValue({ id: 'credit-1', status: 'matched', matchedPaymentId: 'pay-1' });

      const response = await service.handleBankFeedWebhook(payload, signature);

      expect(response.received).toBe(true);
      expect(response.status).toBe('succeeded');
      expect(response.paymentId).toBe('pay-1');

      // Assert bank credit marked matched with payment id
      expect(prisma.bankCredit.update).toHaveBeenCalledWith({
        where: { id: 'credit-1' },
        data: { status: 'matched', matchedPaymentId: 'pay-1' },
      });

      // Assert payment marked succeeded with confirmedBy = bank_feed and bankUtr
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-1', status: 'pending' },
          data: expect.objectContaining({
            status: 'succeeded',
            confirmedBy: 'bank_feed',
            bankUtr: '431201928374',
            confirmedAt: receivedAt,
          }),
        }),
      );

      // Assert candidate active and clock started at receivedAt
      expect(prisma.jobSeeker.update).toHaveBeenCalledWith({
        where: { id: 'js-1' },
        data: expect.objectContaining({
          status: 'active',
          paymentReceivedAt: receivedAt,
        }),
      });
    });

    it('is idempotent: same bank notice twice changes nothing', async () => {
      const payload = JSON.stringify({
        bankUtr: '431201928374',
        amountPaise: 49900,
        receivedAt: '2026-11-09T10:15:00.000Z',
        remark: 'UPI/PAY-00042-abcd1234',
      });
      const signature = sign(payload);

      // Already exists
      prisma.bankCredit.findUnique.mockResolvedValue({
        id: 'credit-1',
        bankUtr: '431201928374',
        status: 'matched',
        matchedPaymentId: 'pay-1',
      });

      const response = await service.handleBankFeedWebhook(payload, signature);

      expect(response.received).toBe(true);
      expect(response.alreadyProcessed).toBe(true);
      expect(prisma.bankCredit.create).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('raises payment_mismatch review flag and confirms nothing if amount does not match', async () => {
      const payload = JSON.stringify({
        bankUtr: '431201928399',
        amountPaise: 45000, // wrong amount, expected 49900
        receivedAt: '2026-11-09T10:15:00.000Z',
        remark: 'UPI/PAY-00042-abcd1234',
      });
      const signature = sign(payload);

      prisma.bankCredit.findUnique.mockResolvedValue(null);
      prisma.bankCredit.create.mockResolvedValue({
        id: 'credit-2',
        bankUtr: '431201928399',
        amountPaise: 45000,
        status: 'unmatched',
      });

      const payment = {
        id: 'pay-1',
        status: 'pending',
        method: 'upi_direct',
        upiReference: 'PAY-00042-abcd1234',
        expectedAmountPaise: 49900,
        amount: 49900,
      };
      prisma.payment.findMany.mockResolvedValue([payment]);

      const response = await service.handleBankFeedWebhook(payload, signature);

      expect(response.received).toBe(true);
      expect(response.status).toBe('unmatched');
      expect(response.reason).toBe('amount_mismatch');

      // Did not confirm payment
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();

      // Raised payment_mismatch ReviewFlag
      expect(reviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'payment_mismatch',
          subjectType: 'payment',
          subjectId: 'pay-1',
          details: expect.objectContaining({
            reason: 'amount_mismatch',
            expectedAmountPaise: 49900,
            receivedAmountPaise: 45000,
          }),
        }),
      );
    });

    it('raises payment_mismatch review flag and stays unmatched if reference is unknown', async () => {
      const payload = JSON.stringify({
        bankUtr: '431201928400',
        amountPaise: 49900,
        receivedAt: '2026-11-09T10:15:00.000Z',
        remark: 'UPI/UNKNOWN-REF-12345',
      });
      const signature = sign(payload);

      prisma.bankCredit.findUnique.mockResolvedValue(null);
      prisma.bankCredit.create.mockResolvedValue({
        id: 'credit-3',
        bankUtr: '431201928400',
        amountPaise: 49900,
        status: 'unmatched',
      });

      prisma.payment.findMany.mockResolvedValue([]);

      const response = await service.handleBankFeedWebhook(payload, signature);

      expect(response.received).toBe(true);
      expect(response.status).toBe('unmatched');
      expect(response.reason).toBe('unknown_reference');

      expect(reviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'payment_mismatch',
          subjectType: 'bank_credit',
          subjectId: 'credit-3',
          details: expect.objectContaining({
            reason: 'unknown_reference',
          }),
        }),
      );
    });

    it('raises payment_mismatch review flag and stays unmatched if remark has no reference', async () => {
      const payload = JSON.stringify({
        bankUtr: '431201928401',
        amountPaise: 49900,
        receivedAt: '2026-11-09T10:15:00.000Z',
        remark: '',
      });
      const signature = sign(payload);

      prisma.bankCredit.findUnique.mockResolvedValue(null);
      prisma.bankCredit.create.mockResolvedValue({
        id: 'credit-4',
        bankUtr: '431201928401',
        amountPaise: 49900,
        status: 'unmatched',
      });

      const response = await service.handleBankFeedWebhook(payload, signature);

      expect(response.received).toBe(true);
      expect(response.status).toBe('unmatched');
      expect(response.reason).toBe('no_reference');

      expect(reviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'payment_mismatch',
          subjectType: 'bank_credit',
          subjectId: 'credit-4',
          details: expect.objectContaining({
            reason: 'no_reference',
          }),
        }),
      );
    });
  });

  describe('Finance manual operations', () => {
    it('Finance records a manual bank credit and audits it', async () => {
      prisma.bankCredit.findUnique.mockResolvedValue(null);
      prisma.bankCredit.create.mockResolvedValue({
        id: 'credit-man-1',
        bankUtr: '998877665544',
        amountPaise: 944000,
        receivedAt: new Date('2026-11-09T11:00:00Z'),
        source: 'finance_manual',
        status: 'unmatched',
      });

      const result = await service.recordManualBankCredit(
        {
          bankUtr: '998877665544',
          amountPaise: 944000,
          receivedAt: '2026-11-09T11:00:00Z',
          payerName: 'XYZ Enterprise',
          remark: 'Placement fee',
        },
        'fin-staff-1',
      );

      expect(result.id).toBe('credit-man-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'fin-staff-1',
          action: 'bank_credit.recorded',
          entityType: 'BankCredit',
          entityCode: '998877665544',
        }),
      );
    });

    it('rejects recording duplicate UTR', async () => {
      prisma.bankCredit.findUnique.mockResolvedValue({ id: 'existing-1', bankUtr: '998877665544' });

      await expect(
        service.recordManualBankCredit(
          {
            bankUtr: '998877665544',
            amountPaise: 944000,
            receivedAt: '2026-11-09T11:00:00Z',
          },
          'fin-staff-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('Finance confirms payment with bank credit when amounts match exactly', async () => {
      const receivedAt = new Date('2026-11-09T11:30:00Z');
      const payment = {
        id: 'pay-plac-1',
        code: 'PAY-00099',
        status: 'pending',
        amount: 944000,
        expectedAmountPaise: 944000,
        type: 'placement_fee',
        placementId: 'pl-1',
        placement: { id: 'pl-1', code: 'PL-00001', status: 'awaiting_payment', jobSeekerId: 'js-1' },
      };
      const credit = {
        id: 'credit-man-1',
        bankUtr: '998877665544',
        amountPaise: 944000,
        receivedAt,
        status: 'unmatched',
      };

      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.bankCredit.findUnique.mockResolvedValue(credit);
      prisma.payment.findFirst.mockResolvedValue(null); // No other payment has this UTR
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.placement.findUnique.mockResolvedValue({
        id: 'pl-1',
        code: 'PL-00001',
        status: 'awaiting_payment',
        jobSeekerId: 'js-1',
        jobSeeker: { id: 'js-1', status: 'active' },
      });
      prisma.placement.updateMany.mockResolvedValue({ count: 1 });
      prisma.jobSeeker.update.mockResolvedValue({ id: 'js-1', status: 'placed' });
      prisma.bankCredit.update.mockResolvedValue({ ...credit, status: 'matched', matchedPaymentId: payment.id });

      const res = await service.confirmPaymentWithBankCredit(payment.id, credit.id, 'fin-staff-1');

      expect(res.success).toBe(true);
      expect(res.paymentId).toBe(payment.id);
      expect(prisma.bankCredit.update).toHaveBeenCalledWith({
        where: { id: credit.id },
        data: { status: 'matched', matchedPaymentId: payment.id },
      });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'succeeded',
            confirmedBy: 'finance_manual',
            confirmedByStaffId: 'fin-staff-1',
            bankUtr: '998877665544',
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'fin-staff-1',
          action: 'payment.confirmed_manual',
        }),
      );
    });

    it('Finance CANNOT confirm when amounts are unequal', async () => {
      const payment = {
        id: 'pay-plac-1',
        status: 'pending',
        amount: 944000,
        expectedAmountPaise: 944000,
      };
      const credit = {
        id: 'credit-man-2',
        bankUtr: '998877665545',
        amountPaise: 900000, // unequal!
        status: 'unmatched',
      };

      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.bankCredit.findUnique.mockResolvedValue(credit);

      await expect(
        service.confirmPaymentWithBankCredit(payment.id, credit.id, 'fin-staff-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses matching if UTR is already matched to another payment', async () => {
      const payment = {
        id: 'pay-plac-1',
        status: 'pending',
        amount: 944000,
        expectedAmountPaise: 944000,
      };
      const credit = {
        id: 'credit-man-1',
        bankUtr: '998877665544',
        amountPaise: 944000,
        status: 'unmatched',
      };

      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.bankCredit.findUnique.mockResolvedValue(credit);
      // Another payment already has this UTR
      prisma.payment.findFirst.mockResolvedValue({ id: 'other-payment-id', bankUtr: credit.bankUtr });

      await expect(
        service.confirmPaymentWithBankCredit(payment.id, credit.id, 'fin-staff-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('Finance can ignore an unmatched bank credit with a required reason', async () => {
      const credit = {
        id: 'credit-man-9',
        bankUtr: '112233445566',
        amountPaise: 100000,
        status: 'unmatched',
      };
      prisma.bankCredit.findUnique.mockResolvedValue(credit);
      prisma.bankCredit.update.mockResolvedValue({
        ...credit,
        status: 'ignored',
        ignoredReason: 'Personal transfer unrelated to Laboura',
      });

      const updated = await service.ignoreBankCredit(
        credit.id,
        'Personal transfer unrelated to Laboura',
        'fin-staff-1',
      );

      expect(updated.status).toBe('ignored');
      expect(prisma.bankCredit.update).toHaveBeenCalledWith({
        where: { id: credit.id },
        data: {
          status: 'ignored',
          ignoredReason: 'Personal transfer unrelated to Laboura',
        },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'fin-staff-1',
          action: 'bank_credit.ignored',
          entityCode: '112233445566',
        }),
      );
    });

    it('a matched bank credit cannot be ignored (never editable after matched)', async () => {
      const credit = {
        id: 'credit-matched',
        bankUtr: '112233445577',
        status: 'matched',
      };
      prisma.bankCredit.findUnique.mockResolvedValue(credit);

      await expect(
        service.ignoreBankCredit(credit.id, 'Tried to ignore', 'fin-staff-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('RBAC on Finance routes', () => {
    it('refuses manager, team lead, call agent, and field agent on finance routes', async () => {
      const reflector = new Reflector();
      const guard = new RbacGuard(reflector, prisma as unknown as PrismaService);

      const rolesForbidden = ['manager', 'team_lead', 'call_agent', 'field_agent'] as const;
      const targetHandlers = [
        PaymentController.prototype.recordBankCredit,
        PaymentController.prototype.confirmPayment,
        PaymentController.prototype.ignoreBankCredit,
        PaymentController.prototype.listBankCredits,
      ];

      for (const role of rolesForbidden) {
        for (const handler of targetHandlers) {
          const context = {
            getHandler: () => handler,
            getClass: () => PaymentController,
            switchToHttp: () => ({
              getRequest: () => ({
                method: handler === PaymentController.prototype.listBankCredits ? 'GET' : 'POST',
                user: { sub: 'staff-1', role },
              }),
            }),
          } as unknown as ExecutionContext;

          await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
        }
      }
    });

    it('allows ceo and finance on finance routes', async () => {
      const reflector = new Reflector();
      const guard = new RbacGuard(reflector, prisma as unknown as PrismaService);

      const rolesAllowed = ['ceo', 'finance'] as const;
      const targetHandlers = [
        PaymentController.prototype.recordBankCredit,
        PaymentController.prototype.confirmPayment,
        PaymentController.prototype.ignoreBankCredit,
        PaymentController.prototype.listBankCredits,
      ];

      for (const role of rolesAllowed) {
        for (const handler of targetHandlers) {
          const context = {
            getHandler: () => handler,
            getClass: () => PaymentController,
            switchToHttp: () => ({
              getRequest: () => ({
                method: handler === PaymentController.prototype.listBankCredits ? 'GET' : 'POST',
                user: { sub: 'staff-1', role },
              }),
            }),
          } as unknown as ExecutionContext;

          const allowed = await guard.canActivate(context);
          expect(allowed).toBe(true);
        }
      }
    });
  });
});

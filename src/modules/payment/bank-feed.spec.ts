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
  payoutAccount: Record<string, jest.Mock>;
  bankDayClose: Record<string, jest.Mock>;
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
  refreshBell: jest.Mock;
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
        findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, status: 'ignored' })),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn(),
      },
      payoutAccount: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bankDayClose: { findUnique: jest.fn().mockResolvedValue(null) },
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      refreshBell: jest.fn().mockResolvedValue(undefined),
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
      // claimed only while still unmatched
      expect(prisma.bankCredit.updateMany).toHaveBeenCalledWith({
        where: { id: 'credit-1', status: 'unmatched' },
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

    it('C1: money for a cancelled replacement\'s salary difference is released and flagged for a refund, never swallowed', async () => {
      const receivedAt = new Date('2026-11-20T10:15:00.000Z');
      const payload = JSON.stringify({ bankUtr: '431201928399', amountPaise: 118000, receivedAt: receivedAt.toISOString(), remark: 'UPI/431201928399/PAY-00077-abcd1234' });
      prisma.bankCredit.findUnique.mockResolvedValue(null);
      prisma.bankCredit.create.mockResolvedValue({ id: 'credit-9', bankUtr: '431201928399', amountPaise: 118000, receivedAt, status: 'unmatched' });
      const closed = {
        id: 'pay-up', code: 'PAY-00077', status: 'failed', method: 'upi_direct', upiReference: 'PAY-00077-abcd1234', expectedAmountPaise: 118000, amount: 118000,
        type: 'replacement_upgrade', placementId: 'pl-up', jobSeekerId: null, jobSeeker: null, placement: { code: 'PL-00050' },
      };
      prisma.payment.findMany.mockResolvedValue([closed]);
      prisma.payment.findUnique.mockResolvedValue(closed);
      prisma.bankCredit.updateMany.mockResolvedValue({ count: 1 });
      const response = await service.handleBankFeedWebhook(payload, sign(payload));
      expect(response).toMatchObject({ status: 'unmatched', reason: 'request_closed', bankCreditId: 'credit-9', paymentId: 'pay-up' });
      // The credit goes back to unmatched.
      expect(prisma.bankCredit.updateMany).toHaveBeenCalledWith({ where: { id: 'credit-9', status: 'matched', matchedPaymentId: 'pay-up' }, data: { status: 'unmatched', matchedPaymentId: null } });
      expect(reviewFlagService.raise).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'payment_mismatch', subjectId: 'pay-up',
        details: expect.objectContaining({ reason: 'paid_after_request_closed', placementCode: 'PL-00050', bankCreditId: 'credit-9', bankUtr: '431201928399' }),
      }));
      expect(prisma.payment.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'succeeded' }) }));
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

      prisma.payment.findMany.mockResolvedValue([]);
      const result = await service.recordManualBankCredit(
        {
          bankUtr: '998877665544',
          amountPaise: 944000,
          receivedAt: '2026-11-09T11:00:00Z',
          payerName: 'XYZ Enterprise',
          remark: 'Placement fee',
        },
        'fin-staff-1',
        new Date('2026-11-14T06:00:00Z'),
      );

      expect(result.id).toBe('credit-man-1');
      // matched like a bank-feed credit: no payment reference in the note → unmatched with a flag
      expect(result.match).toEqual({ status: 'unmatched', reason: 'unknown_reference', paymentId: null });
      expect(result.closedDay).toBeNull();
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
      // claimed only while still unmatched
      expect(prisma.bankCredit.updateMany).toHaveBeenCalledWith({
        where: { id: credit.id, status: 'unmatched' },
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

      const at = new Date('2026-11-14T06:00:00Z');
      const updated = await service.ignoreBankCredit(
        credit.id,
        'Personal transfer unrelated to Laboura',
        'fin-staff-1',
        at,
      );

      expect(updated.status).toBe('ignored');
      expect(prisma.bankCredit.updateMany).toHaveBeenCalledWith({
        where: { id: credit.id, status: 'unmatched' },
        data: {
          status: 'ignored',
          ignoredReason: 'Personal transfer unrelated to Laboura',
          ignoredAt: at,
          ignoredByStaffId: 'fin-staff-1',
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

    it('setting a credit aside closes its open mismatch flags and takes them off the bells', async () => {
      const credit = { id: 'credit-aside-1', bankUtr: '998877665544', amountPaise: 50000, status: 'unmatched', receivedAt: new Date() };
      prisma.bankCredit.findUnique.mockResolvedValue(credit);
      prisma.bankCredit.update.mockResolvedValue({ ...credit, status: 'ignored' });
      prisma.reviewFlag.findMany.mockResolvedValueOnce([{ id: 'rf-open-1' }]);

      await service.ignoreBankCredit(credit.id, 'Owner paid rent into the wrong account', 'fin-staff-1');

      // flags about the credit, and about a payment that names this credit
      expect(prisma.reviewFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            kind: 'payment_mismatch',
            status: 'open',
            OR: [
              { subjectType: 'bank_credit', subjectId: credit.id },
              { subjectType: 'payment', details: { path: ['bankCreditId'], equals: credit.id } },
            ],
          },
        }),
      );
      expect(prisma.reviewFlag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['rf-open-1'] } },
          data: expect.objectContaining({ status: 'dismissed', resolution: 'Owner paid rent into the wrong account', resolvedByStaffId: 'fin-staff-1' }),
        }),
      );
      expect(reviewFlagService.refreshBell).toHaveBeenCalledWith('rf-open-1');
    });

    it('refuses to set a credit aside without a reason', async () => {
      await expect(service.ignoreBankCredit('credit-x', '   ', 'fin-staff-1')).rejects.toThrow(BadRequestException);
      expect(prisma.bankCredit.update).not.toHaveBeenCalled();
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
      ).rejects.toThrow(ConflictException);
    });

    it('refuses (409) to set aside a returned or already set-aside credit, so a return is never overwritten', async () => {
      for (const status of ['returned', 'ignored']) {
        prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-r', bankUtr: 'R1', status, receivedAt: new Date() });
        await expect(service.ignoreBankCredit('c-r', 'Not ours', 'fin-staff-1')).rejects.toMatchObject({ status: 409 });
      }
      expect(prisma.bankCredit.updateMany).not.toHaveBeenCalled();
    });

    it('loses cleanly (409) when Finance matched or returned it at the same moment', async () => {
      prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-race', bankUtr: 'R2', status: 'unmatched', receivedAt: new Date() });
      prisma.bankCredit.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.ignoreBankCredit('c-race', 'Not ours', 'fin-staff-1')).rejects.toMatchObject({ status: 409 });
      expect(prisma.reviewFlag.updateMany).not.toHaveBeenCalled();
    });

    it('a match loses cleanly (409) against a set-aside at the same moment, and confirms nothing', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({ id: 'p-race', code: 'PAY-9', status: 'pending', amount: 49900, expectedAmountPaise: 49900, type: 'activation' });
      prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-race', bankUtr: 'R3', status: 'unmatched', amountPaise: 49900, receivedAt: new Date() });
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.bankCredit.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.confirmPaymentWithBankCredit('p-race', 'c-race', 'fin-staff-1')).rejects.toMatchObject({ status: 409 });
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('two credits for one payment at once: the second match finds it already paid, releases its credit and answers 409', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({ id: 'p-two', code: 'PAY-2', status: 'pending', amount: 49900, expectedAmountPaise: 49900, type: 'activation' });
      prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-two', bankUtr: 'R5', status: 'unmatched', amountPaise: 49900, receivedAt: new Date(), bookingNote: null });
      prisma.payment.findFirst.mockResolvedValue(null);
      jest.spyOn(service, 'onPaymentSucceeded').mockResolvedValue({ received: true, alreadyProcessed: true, paymentId: 'p-two' } as never);
      await expect(service.confirmPaymentWithBankCredit('p-two', 'c-two', 'fin-staff-1')).rejects.toMatchObject({ status: 409 });
      expect(prisma.bankCredit.updateMany).toHaveBeenLastCalledWith({ where: { id: 'c-two', status: 'matched', matchedPaymentId: 'p-two' }, data: { status: 'unmatched', matchedPaymentId: null, bookingNote: null } });
    });

    it('a credit dated in a closed month but booked in the open month can still be set aside', async () => {
      const locks = { assertOpenOn: jest.fn(async (at: Date) => { if (at < new Date('2026-11-01T00:00:00+05:30')) throw new BadRequestException('October is closed'); }) };
      const svc = new PaymentService(prisma as unknown as PrismaService, auditService as unknown as AuditService, { generateCode: jest.fn() } as unknown as IdService, {} as PaymentProvider, provider, {} as PricingService, {} as MessagingService, reviewFlagService as unknown as ReviewFlagService, undefined, locks as never);
      // receivedAt is where the credit is booked; the bank's own date is in the note
      prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-b', bankUtr: 'UB', status: 'unmatched', receivedAt: new Date('2026-11-02T06:00:00Z'), bookingNote: 'Bank date 2026-10-30: October 2026 is closed; booked in November 2026' });
      await expect(svc.ignoreBankCredit('c-b', 'Not ours', 'fin-staff-1')).resolves.toBeTruthy();
      expect(locks.assertOpenOn).toHaveBeenCalledWith(new Date('2026-11-02T06:00:00Z'), 'its bank credits');
    });

    it('a returned credit is never matched', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({ id: 'p-1', code: 'PAY-1', status: 'pending', amount: 49900, type: 'activation' });
      prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-ret', bankUtr: 'R4', status: 'returned', amountPaise: 49900, receivedAt: new Date() });
      await expect(service.confirmPaymentWithBankCredit('p-1', 'c-ret', 'fin-staff-1')).rejects.toThrow(/only an unmatched credit is matched/);
    });
  });

  describe('CEO undoes a set-aside (owner decision 14 Nov)', () => {
    it('puts a set-aside credit back to unmatched with a reason, atomically, audited', async () => {
      prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-a', bankUtr: 'UA', status: 'ignored', ignoredReason: 'Personal', ignoredAt: new Date(), ignoredByStaffId: 'fin-staff-1', receivedAt: new Date() });
      await service.undoSetAside('c-a', '  It was a placement fee after all ', 'ceo-1');
      expect(prisma.bankCredit.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-a', status: 'ignored' },
        data: { status: 'unmatched', ignoredReason: null, ignoredAt: null, ignoredByStaffId: null },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'ceo-1', action: 'bank_credit.set_aside_undone', entityCode: 'UA', reason: 'It was a placement fee after all', before: expect.objectContaining({ ignoredReason: 'Personal' }) }),
      );
      // back on Finance's bell with a fresh flag (the old ones were closed when it was set aside)
      expect(reviewFlagService.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'payment_mismatch', subjectType: 'bank_credit', subjectId: 'c-a', details: expect.objectContaining({ reason: 'set_aside_undone' }) }));
    });

    it('needs a reason, only a set-aside credit (409), and loses cleanly to a change at the same moment', async () => {
      await expect(service.undoSetAside('c-a', ' ', 'ceo-1')).rejects.toThrow(BadRequestException);
      prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-a', bankUtr: 'UA', status: 'unmatched', receivedAt: new Date() });
      await expect(service.undoSetAside('c-a', 'why', 'ceo-1')).rejects.toMatchObject({ status: 409 });
      prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-a', bankUtr: 'UA', status: 'ignored', receivedAt: new Date() });
      prisma.bankCredit.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.undoSetAside('c-a', 'why', 'ceo-1')).rejects.toMatchObject({ status: 409 });
    });

    it('is refused in a closed month', async () => {
      const locked = new PaymentService(
        prisma as unknown as PrismaService,
        auditService as unknown as AuditService,
        { generateCode: jest.fn() } as unknown as IdService,
        {} as PaymentProvider,
        provider,
        {} as PricingService,
        {} as MessagingService,
        reviewFlagService as unknown as ReviewFlagService,
        undefined,
        { assertOpenOn: jest.fn().mockRejectedValue(new BadRequestException('October 2026 is closed')) } as never,
      );
      prisma.bankCredit.findUnique.mockResolvedValueOnce({ id: 'c-a', bankUtr: 'UA', status: 'ignored', receivedAt: new Date('2026-10-05T06:00:00Z') });
      await expect(locked.undoSetAside('c-a', 'why', 'ceo-1')).rejects.toThrow('closed');
      expect(prisma.bankCredit.updateMany).not.toHaveBeenCalled();
    });

    it('only the CEO may undo; Finance and everyone else are refused', async () => {
      const guard = new RbacGuard(new Reflector(), prisma as unknown as PrismaService);
      const ctx = (role: string) =>
        ({
          getHandler: () => PaymentController.prototype.undoSetAside,
          getClass: () => PaymentController,
          switchToHttp: () => ({ getRequest: () => ({ method: 'POST', user: { sub: 's', role } }) }),
        }) as unknown as ExecutionContext;
      await expect(guard.canActivate(ctx('ceo'))).resolves.toBe(true);
      for (const role of ['finance', 'manager', 'team_lead', 'call_agent', 'field_agent']) {
        await expect(guard.canActivate(ctx(role))).rejects.toThrow(ForbiddenException);
      }
    });
  });

  describe('Finance adds a credit from the statement (PR #137 review, M5)', () => {
    const now = new Date('2026-11-14T06:00:00Z');
    beforeEach(() => {
      prisma.bankCredit.findUnique.mockResolvedValue(null);
      prisma.bankCredit.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c-new', ...data }));
      prisma.payment.findMany.mockResolvedValue([]);
    });

    it('stores the UTR in one spelling (no spaces, upper case), and checks duplicates in that spelling', async () => {
      await service.recordManualBankCredit({ bankUtr: ' 4312 1200 88ab ', amountPaise: 49900, receivedAt: '2026-11-13T09:00:00+05:30' }, 'fin-staff-1', now);
      expect(prisma.bankCredit.findUnique).toHaveBeenCalledWith({ where: { bankUtr: '4312120088AB' } });
      expect(prisma.bankCredit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ bankUtr: '4312120088AB' }) }));
    });

    it('refuses a future date, a date before 2000, and an amount that is not whole paise or too large', async () => {
      const base = { bankUtr: 'U1', amountPaise: 49900, receivedAt: '2026-11-13T09:00:00+05:30' };
      await expect(service.recordManualBankCredit({ ...base, receivedAt: '2026-11-15T09:00:00+05:30' }, 'fin-staff-1', now)).rejects.toThrow(/future/);
      await expect(service.recordManualBankCredit({ ...base, receivedAt: '1999-12-31T09:00:00+05:30' }, 'fin-staff-1', now)).rejects.toThrow(/2000/);
      await expect(service.recordManualBankCredit({ ...base, amountPaise: 499.5 }, 'fin-staff-1', now)).rejects.toThrow(BadRequestException);
      await expect(service.recordManualBankCredit({ ...base, amountPaise: 2_00_00_000_00 }, 'fin-staff-1', now)).rejects.toThrow(BadRequestException);
      await expect(service.recordManualBankCredit({ ...base, amountPaise: -100 }, 'fin-staff-1', now)).rejects.toThrow(BadRequestException);
      expect(prisma.bankCredit.create).not.toHaveBeenCalled();
    });

    it('matches by the payment reference in the note, like the bank feed', async () => {
      const pending = { id: 'pay-ref', code: 'PAY-77', type: 'activation', status: 'pending', method: 'upi_direct', upiReference: 'LB-JS77', amount: 49900, expectedAmountPaise: 49900, jobSeekerId: null };
      prisma.payment.findMany.mockResolvedValue([pending]);
      const onSucceeded = jest.spyOn(service, 'onPaymentSucceeded').mockResolvedValue({ received: true, status: 'succeeded', paymentId: 'pay-ref' } as never);
      const res = await service.recordManualBankCredit({ bankUtr: 'U2', amountPaise: 49900, receivedAt: '2026-11-13T09:00:00+05:30', remark: 'upi lb-js77 ravi' }, 'fin-staff-1', now);
      // the person who typed it in is recorded on the confirmation
      expect(onSucceeded).toHaveBeenCalledWith('pay-ref', expect.objectContaining({ confirmedBy: 'finance_manual', confirmedByStaffId: 'fin-staff-1', bankUtr: 'U2' }));
      expect(prisma.bankCredit.updateMany).toHaveBeenCalledWith({ where: { id: 'c-new', status: 'unmatched' }, data: { status: 'matched', matchedPaymentId: 'pay-ref' } });
      expect(res.match).toEqual({ status: 'succeeded', reason: null, paymentId: 'pay-ref' });
    });

    it('if the payment was confirmed by something else meanwhile, the typed-in credit is released and flagged, never left matched', async () => {
      const pending = { id: 'pay-ref', code: 'PAY-77', type: 'activation', status: 'pending', method: 'upi_direct', upiReference: 'LB-JS77', amount: 49900, expectedAmountPaise: 49900, jobSeekerId: null };
      prisma.payment.findMany.mockResolvedValue([pending]);
      jest.spyOn(service, 'onPaymentSucceeded').mockResolvedValue({ received: true, alreadyProcessed: true, paymentId: 'pay-ref' } as never);
      const res = await service.recordManualBankCredit({ bankUtr: 'U5', amountPaise: 49900, receivedAt: '2026-11-13T09:00:00+05:30', remark: 'LB-JS77' }, 'fin-staff-1', now);
      expect(prisma.bankCredit.updateMany).toHaveBeenLastCalledWith({ where: { id: 'c-new', status: 'matched', matchedPaymentId: 'pay-ref' }, data: { status: 'unmatched', matchedPaymentId: null } });
      expect(reviewFlagService.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'payment_mismatch', subjectId: 'pay-ref', details: expect.objectContaining({ reason: 'already_succeeded', bankCreditId: 'c-new' }) }));
      expect(res.match.status).toBe('unmatched');
    });

    it('says when the credit lands on a bank day already closed', async () => {
      prisma.bankDayClose.findUnique.mockResolvedValueOnce({ day: '2026-11-13' });
      const res = await service.recordManualBankCredit({ bankUtr: 'U3', amountPaise: 100, receivedAt: '2026-11-13T09:00:00+05:30' }, 'fin-staff-1', now);
      expect(res.closedDay).toBe('2026-11-13');
    });
  });

  describe('Finance resolves payment and payout flags', () => {
    /** `others`: the person's other payout flags (status, details). */
    const flagMock = (flag: Record<string, unknown>, others: Array<{ status: string; details: unknown }> = []) => {
      const f = prisma.reviewFlag as Record<string, jest.Mock>;
      f.findUnique = jest.fn().mockResolvedValue(flag);
      f.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      f.findMany = jest.fn().mockResolvedValue(others);
      f.findUniqueOrThrow = jest.fn(async () => ({ ...flag, status: (f.updateMany.mock.calls[0]?.[0] as { data: { status: string } })?.data.status, resolution: 'x' }));
      return f;
    };
    const open = (kind: string, details: Record<string, unknown> = {}) => ({ id: 'rf-9', code: 'RF-00009', kind, status: 'open', resolution: null, subjectType: 'referral', subjectId: 'r14', details });

    it('resolves a payment_mismatch flag with the written resolution, audits it and clears the bell', async () => {
      const flags = flagMock(open('payment_mismatch'));
      const res = await service.resolvePaymentMismatchFlag('rf-9', '  Matched by hand ', 'fin-staff-1');
      expect(res.status).toBe('resolved');
      expect(flags.updateMany).toHaveBeenCalledWith({ where: { id: 'rf-9', status: 'open' }, data: expect.objectContaining({ status: 'resolved', resolution: 'Matched by hand', resolvedByStaffId: 'fin-staff-1' }) });
      expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'fin-staff-1', action: 'review_flag.resolved', entityCode: 'RF-00009' }));
      expect(reviewFlagService.refreshBell).toHaveBeenCalledWith('rf-9');
      expect(prisma.payoutAccount.updateMany).not.toHaveBeenCalled();
    });

    it.each(['payout_shared_account', 'payout_matches_staff', 'payout_name_mismatch'])('a %s flag needs an outcome (genuine or fraud)', async (kind) => {
      flagMock(open(kind));
      await expect(service.resolvePaymentMismatchFlag('rf-9', 'Checked', 'fin-staff-1')).rejects.toThrow(/genuine.*fraud/);
    });

    it('"Checked, genuine": dismisses the flag and releases only the payout account the flag is about (the 48-hour wait still applies)', async () => {
      const flags = flagMock(open('payout_shared_account', { payoutAccountId: 'pa-31' }));
      const res = await service.resolvePaymentMismatchFlag('rf-9', 'Brothers share one account', 'fin-staff-1', 'genuine');
      expect(flags.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'dismissed', details: { payoutAccountId: 'pa-31', outcome: 'genuine' } }) }));
      expect(prisma.payoutAccount.updateMany).toHaveBeenCalledWith({ where: { id: 'pa-31', ownerType: 'referral', ownerId: 'r14', status: 'flagged' }, data: { status: 'pending_validation' } });
      // activeFrom untouched: only the status changes
      expect(Object.keys((prisma.payoutAccount.updateMany.mock.calls[0][0] as { data: object }).data)).toEqual(['status']);
      expect(res.payoutDetailsReleased).toBe(1);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('"Checked, genuine" keeps the details blocked while another payout flag for that person is still open', async () => {
      flagMock(open('payout_shared_account', { payoutAccountId: 'pa-31' }), [{ status: 'open', details: {} }]);
      const res = await service.resolvePaymentMismatchFlag('rf-9', 'This one is fine', 'fin-staff-1', 'genuine');
      expect(prisma.payoutAccount.updateMany).not.toHaveBeenCalled();
      expect(res.payoutDetailsReleased).toBe(0);
    });

    it('a genuine name-mismatch never releases an account another flag confirmed as fraud (review H-new)', async () => {
      // Old open name-mismatch flag; a new account flagged as a staff number was closed as fraud.
      const flags = flagMock(open('payout_name_mismatch', { flaggedByStaffId: 'fin-staff-2', reason: 'name differs' }), [
        { status: 'resolved', details: { payoutAccountId: 'pa-new', outcome: 'fraud' } },
      ]);
      const res = await service.resolvePaymentMismatchFlag('rf-9', 'Name spelt differently, same person', 'fin-staff-1', 'genuine');
      expect(flags.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'dismissed' }) }));
      expect(prisma.payoutAccount.updateMany).not.toHaveBeenCalled();
      expect(res.payoutDetailsReleased).toBe(0);
    });

    it('a name-mismatch flag names no account, so "genuine" releases nothing even with no other flags', async () => {
      flagMock(open('payout_name_mismatch', { flaggedByStaffId: 'fin-staff-2' }));
      const res = await service.resolvePaymentMismatchFlag('rf-9', 'Same person', 'fin-staff-1', 'genuine');
      expect(prisma.payoutAccount.updateMany).not.toHaveBeenCalled();
      expect(res.payoutDetailsReleased).toBe(0);
    });

    it('never releases an account after a fraud finding on the same person, also an older flag closed as "resolved"', async () => {
      flagMock(open('payout_shared_account', { payoutAccountId: 'pa-31' }), [{ status: 'resolved', details: { payoutAccountId: 'pa-31' } }]);
      await service.resolvePaymentMismatchFlag('rf-9', 'Fine', 'fin-staff-1', 'genuine');
      expect(prisma.payoutAccount.updateMany).not.toHaveBeenCalled();
    });

    it('the Finance person whose payment raised a name-mismatch flag cannot close it', async () => {
      flagMock(open('payout_name_mismatch', { flaggedByStaffId: 'fin-staff-1' }));
      await expect(service.resolvePaymentMismatchFlag('rf-9', 'Fine', 'fin-staff-1', 'genuine')).rejects.toThrow(ForbiddenException);
    });

    it('"Fraud confirmed": resolves the flag and the details stay blocked', async () => {
      const flags = flagMock(open('payout_matches_staff', { matchedStaffId: 'ca-3' }));
      await service.resolvePaymentMismatchFlag('rf-9', 'Agent used his own UPI', 'fin-staff-1', 'fraud');
      expect(flags.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'resolved', details: expect.objectContaining({ outcome: 'fraud' }) }) }));
      expect(prisma.payoutAccount.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a flag that is not open (409), and one closed by someone else at the same moment', async () => {
      flagMock({ ...open('payment_mismatch'), status: 'resolved' });
      await expect(service.resolvePaymentMismatchFlag('rf-9', 'again', 'fin-staff-1')).rejects.toMatchObject({ status: 409 });
      const flags = flagMock(open('payment_mismatch'));
      flags.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.resolvePaymentMismatchFlag('rf-9', 'race', 'fin-staff-1')).rejects.toMatchObject({ status: 409 });
    });

    it('the staff member a "matches staff" flag is about never resolves it', async () => {
      flagMock(open('payout_matches_staff', { matchedStaffId: 'fin-staff-1' }));
      await expect(service.resolvePaymentMismatchFlag('rf-9', 'It is fine', 'fin-staff-1', 'genuine')).rejects.toThrow(ForbiddenException);
    });

    it('requires a written resolution', async () => {
      const flags = flagMock(open('payment_mismatch'));
      await expect(service.resolvePaymentMismatchFlag('rf-9', ' ', 'fin-staff-1')).rejects.toThrow(BadRequestException);
      expect(flags.updateMany).not.toHaveBeenCalled();
    });

    it('never resolves a flag that is not about money (bypass, visits, logins stay with their owners)', async () => {
      const flags = flagMock({ ...open('bypass_suspected') });
      await expect(service.resolvePaymentMismatchFlag('rf-9', 'Looks fine', 'fin-staff-1')).rejects.toThrow('not found');
      expect(flags.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('RBAC on Finance routes', () => {
    const contextFor = (handler: (...args: never[]) => unknown, method: string, role: string) =>
      ({
        getHandler: () => handler,
        getClass: () => PaymentController,
        switchToHttp: () => ({ getRequest: () => ({ method, user: { sub: 'staff-1', role } }) }),
      }) as unknown as ExecutionContext;

    it('lets only Finance and the CEO see and resolve payment and payout flags', async () => {
      const guard = new RbacGuard(new Reflector(), prisma as unknown as PrismaService);
      const routes: Array<[(...args: never[]) => unknown, string]> = [
        [PaymentController.prototype.listReviewFlags, 'GET'],
        [PaymentController.prototype.resolveReviewFlag, 'POST'],
      ];
      for (const [handler, method] of routes) {
        for (const role of ['finance', 'ceo']) {
          await expect(guard.canActivate(contextFor(handler, method, role))).resolves.toBe(true);
        }
        for (const role of ['manager', 'team_lead', 'call_agent', 'field_agent']) {
          await expect(guard.canActivate(contextFor(handler, method, role))).rejects.toThrow(ForbiddenException);
        }
      }
    });

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

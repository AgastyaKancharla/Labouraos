import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { MessagingService } from '../message/messaging.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { PaymentProvider } from './payment-provider.interface';
import { MockBankFeedProvider } from './mock-bank-feed.provider';
import { PaymentService } from './payment.service';

/**
 * Money rules (guide: Money rules at a glance, How money is collected, Finance portal):
 * approval limits, TDS-short placement fees, the 48-hour payout wait on server time,
 * and logged reveal of payout details for the CEO and Finance only.
 */
describe('Money rules (payment service)', () => {
  const secret = 'test_webhook_secret_32_chars_long_123';
  const originalSecret = process.env.BANK_FEED_WEBHOOK_SECRET;
  const originalPayoutKey = process.env.PAYOUT_ACCOUNT_KEY;
  const originalAppUrl = process.env.PUBLIC_APP_URL;

  const staff: Record<string, { id: string; role: string }> = {
    'ceo-1': { id: 'ceo-1', role: 'ceo' },
    'fin-1': { id: 'fin-1', role: 'finance' },
    'mgr-1': { id: 'mgr-1', role: 'manager' },
  };

  const policy = {
    referralPayoutPaise: 20000,
    replacementSearchDays: 15,
    financeBusinessRefundLimitPaise: 1500000,
    payoutDetailsCoolingHours: 48,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let auditLog: jest.Mock;
  let raise: jest.Mock;
  let service: PaymentService;

  beforeEach(() => {
    process.env.BANK_FEED_WEBHOOK_SECRET = secret;
    process.env.PAYOUT_ACCOUNT_KEY = 'unit_test_payout_account_key_32_characters_min';
    process.env.PUBLIC_APP_URL = originalAppUrl || 'https://app.laboura.in';
    prisma = {
      bankCredit: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      payment: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pay-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      placement: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      replacementClaim: { findFirst: jest.fn() },
      payoutAccount: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      tdsReceivable: { create: jest.fn() },
      reviewFlag: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      statusHistory: { create: jest.fn().mockResolvedValue({}) },
      staff: {
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(staff[where.id] ?? null)),
        findFirst: jest.fn().mockResolvedValue({ id: 'ceo-1' }),
      },
      jobSeeker: { update: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    auditLog = jest.fn().mockResolvedValue({});
    raise = jest.fn().mockResolvedValue({ id: 'flag-1' });
    service = new PaymentService(
      prisma as unknown as PrismaService,
      { log: auditLog } as unknown as AuditService,
      { generateCode: jest.fn().mockResolvedValue('INV-00001') } as unknown as IdService,
      {} as PaymentProvider,
      new MockBankFeedProvider(),
      { current: jest.fn().mockResolvedValue(policy) } as unknown as PricingService,
      { send: jest.fn().mockResolvedValue({ status: 'sent' }) } as unknown as MessagingService,
      { raise } as unknown as ReviewFlagService,
    );
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.BANK_FEED_WEBHOOK_SECRET;
    else process.env.BANK_FEED_WEBHOOK_SECRET = originalSecret;
    if (originalPayoutKey === undefined) delete process.env.PAYOUT_ACCOUNT_KEY;
    else process.env.PAYOUT_ACCOUNT_KEY = originalPayoutKey;
    if (originalAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = originalAppUrl;
  });

  describe('Business refund approval limit on POST /payments/:id/approve', () => {
    const reportedAt = new Date('2026-10-01T10:00:00.000Z');
    const day16 = new Date('2026-10-17T10:00:00.000Z');

    const setUpBusinessRefund = (amount: number, extra: Record<string, unknown> = {}) => {
      const payment = {
        id: 'pay-ref',
        code: 'PAY-00061',
        type: 'refund',
        status: 'pending',
        amount,
        subjectType: 'placement',
        subjectId: 'pl-1',
        placementId: 'pl-1',
        businessId: 'bz-1',
        jobSeekerId: null,
        ceoApprovalReason: null,
        sentToCeoByStaffId: null,
        outsideRules: false,
        ...extra,
      };
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.placement.findUnique.mockResolvedValue({
        id: 'pl-1',
        code: 'PL-00061',
        status: 'dropped_out',
        rootPlacementId: null,
        placementFee: amount,
        guaranteeEndedReason: null,
        dropoutReportedAt: reportedAt,
        replacementCandidates: [],
        businessId: 'bz-1',
      });
      prisma.replacementClaim.findFirst.mockResolvedValue({
        decision: 'accepted',
        reportedAt,
        decidedAt: new Date('2026-10-03T10:00:00.000Z'),
      });
      // The business already has a payout account, so no link is sent.
      prisma.payoutAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
      return payment;
    };

    it('lets Finance approve an eligible business refund within the ₹15,000 limit', async () => {
      setUpBusinessRefund(944000);
      const updated = await service.approvePayment('pay-ref', 'fin-1', day16);
      expect(updated.status).toBe('approved');
      expect(updated.approvedByStaffId).toBe('fin-1');
      // The guarantee ends with the refund.
      expect(prisma.placement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'guarantee_ended', guaranteeEndedReason: 'refunded' } }),
      );
    });

    it('stops Finance above the limit, records who sent it, and tells Finance it has gone to the CEO', async () => {
      setUpBusinessRefund(1770000);
      const attempt = service.approvePayment('pay-ref', 'fin-1', day16);
      await expect(attempt).rejects.toThrow(ForbiddenException);
      await expect(service.approvePayment('pay-ref', 'fin-1', day16)).rejects.toThrow(/sent to the CEO/);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-ref' },
        data: expect.objectContaining({
          ceoApprovalReason: 'above_finance_limit',
          sentToCeoByStaffId: 'fin-1',
          sentToCeoAt: day16,
        }),
      });
      // Nothing was approved.
      expect(prisma.payment.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }),
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'refund_sent_to_ceo',
          actorId: 'fin-1',
          after: expect.objectContaining({ ceoApprovalReason: 'above_finance_limit', financeLimitPaise: 1500000 }),
        }),
      );
    });

    it('refuses Finance on a refund that is already with the CEO', async () => {
      setUpBusinessRefund(1770000, { ceoApprovalReason: 'above_finance_limit', sentToCeoByStaffId: 'fin-1' });
      await expect(service.approvePayment('pay-ref', 'fin-1', day16)).rejects.toThrow(/with the CEO/);
    });

    it('lets the CEO approve a refund above the limit and records the CEO as approver', async () => {
      setUpBusinessRefund(1770000, { ceoApprovalReason: 'above_finance_limit', sentToCeoByStaffId: 'fin-1' });
      const updated = await service.approvePayment('pay-ref', 'ceo-1', day16);
      expect(updated.status).toBe('approved');
      expect(updated.approvedByStaffId).toBe('ceo-1');
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment_approved',
          after: expect.objectContaining({
            approvedByRole: 'ceo',
            ceoApprovalReason: 'above_finance_limit',
            sentToCeoByStaffId: 'fin-1',
          }),
        }),
      );
    });

    it('lets only the CEO approve a goodwill refund, even when the rules say it is not owed', async () => {
      setUpBusinessRefund(500000, { ceoApprovalReason: 'goodwill', outsideRules: true });
      const day5 = new Date('2026-10-06T10:00:00.000Z');
      await expect(service.approvePayment('pay-ref', 'fin-1', day5)).rejects.toThrow(ForbiddenException);
      const updated = await service.approvePayment('pay-ref', 'ceo-1', day5);
      expect(updated.status).toBe('approved');
      // A goodwill refund leaves the placement as it is.
      expect(prisma.placement.updateMany).not.toHaveBeenCalled();
    });

    it('counts the 15 days from the dropout report, not the claim decision', async () => {
      setUpBusinessRefund(944000);
      // 15 days after the report, 13 after the decision: due.
      const updated = await service.approvePayment('pay-ref', 'fin-1', new Date('2026-10-16T10:00:00.000Z'));
      expect(updated.status).toBe('approved');
    });
  });

  describe('Payments short by TDS', () => {
    const sign = (body: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');
    const placementFeePayment = {
      id: 'pay-fee',
      code: 'PAY-00098',
      city: 'Bengaluru',
      type: 'placement_fee',
      status: 'pending',
      method: 'upi_direct',
      upiReference: 'PL-00098-abcd',
      amount: 885000,
      expectedAmountPaise: 885000,
      placementId: 'pl-98',
      jobSeekerId: null,
    };

    it('flags a short placement fee from the bank feed as possible TDS, not a plain mismatch', async () => {
      const payload = JSON.stringify({
        bankUtr: '431212008800',
        amountPaise: 810000,
        receivedAt: '2026-11-09T04:50:00.000Z',
        remark: 'UPI/PL-00098-abcd',
      });
      prisma.bankCredit.findUnique.mockResolvedValue(null);
      prisma.bankCredit.create.mockResolvedValue({ id: 'credit-98', amountPaise: 810000 });
      prisma.payment.findMany.mockResolvedValue([placementFeePayment]);

      const res = await service.handleBankFeedWebhook(payload, sign(payload));
      expect(res.status).toBe('unmatched');
      expect(res.reason).toBe('short_possible_tds');
      expect(raise).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ reason: 'short_possible_tds', shortByPaise: 75000 }),
        }),
      );
    });

    it('still treats an overpaid placement fee as an amount mismatch', async () => {
      const payload = JSON.stringify({
        bankUtr: '431212008801',
        amountPaise: 900000,
        receivedAt: '2026-11-09T04:50:00.000Z',
        remark: 'UPI/PL-00098-abcd',
      });
      prisma.bankCredit.findUnique.mockResolvedValue(null);
      prisma.bankCredit.create.mockResolvedValue({ id: 'credit-99', amountPaise: 900000 });
      prisma.payment.findMany.mockResolvedValue([placementFeePayment]);

      const res = await service.handleBankFeedWebhook(payload, sign(payload));
      expect(res.reason).toBe('amount_mismatch');
    });

    const setUpConfirm = (creditPaise: number, payment: Record<string, unknown> = placementFeePayment) => {
      prisma.payment.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === payment.id ? { ...payment, jobSeeker: null } : null),
      );
      prisma.bankCredit.findUnique.mockResolvedValue({
        id: 'credit-98',
        bankUtr: '431212008800',
        amountPaise: creditPaise,
        receivedAt: new Date('2026-11-09T04:50:00.000Z'),
        status: 'unmatched',
      });
      prisma.placement.findUnique.mockResolvedValue({
        id: 'pl-98',
        code: 'PL-00098',
        city: 'Bengaluru',
        status: 'awaiting_payment',
        placementFee: 750000,
        invoiceCode: 'INV-00098',
        jobSeekerId: 'js-1',
        businessId: 'bz-1',
        joiningDate: null,
        jobSeeker: { status: 'placed' },
      });
      prisma.tdsReceivable.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'tds-1', ...data }),
      );
    };

    it('refuses a short credit without TDS details, and says how to record TDS', async () => {
      setUpConfirm(810000);
      await expect(service.confirmPaymentWithBankCredit('pay-fee', 'credit-98', 'fin-1')).rejects.toThrow(
        /Amount mismatch.*record the short 75000 paise as TDS deducted/,
      );
    });

    it('confirms the placement and keeps a TDS receivable when Finance records the short amount as TDS', async () => {
      setUpConfirm(810000);
      const now = new Date('2026-11-09T06:00:00.000Z');
      const res = await service.confirmPaymentWithBankCredit(
        'pay-fee',
        'credit-98',
        'fin-1',
        { tdsDeductedPaise: 75000, tdsNote: 'Section to confirm with the CA; business says 10%' },
        now,
      );
      expect(res.success).toBe(true);
      expect(res.tdsDeductedPaise).toBe(75000);
      // The placement fee payment is confirmed, so the placement moves on.
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'succeeded' }) }),
      );
      expect(prisma.placement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pl-98', status: 'awaiting_payment' },
          data: expect.objectContaining({ status: 'confirmed' }),
        }),
      );
      expect(prisma.tdsReceivable.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          placementId: 'pl-98',
          paymentId: 'pay-fee',
          bankCreditId: 'credit-98',
          amountPaise: 75000,
          sectionNote: 'Section to confirm with the CA; business says 10%',
          status: 'certificate_due',
          recordedByStaffId: 'fin-1',
          recordedAt: now,
        }),
      });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payment.tds_deducted_recorded', actorId: 'fin-1' }),
      );
    });

    it('requires the TDS amount to be exactly the short amount (no rate is assumed)', async () => {
      setUpConfirm(810000);
      await expect(
        service.confirmPaymentWithBankCredit('pay-fee', 'credit-98', 'fin-1', { tdsDeductedPaise: 70000, tdsNote: 'x' }),
      ).rejects.toThrow(/exactly the short amount: 75000/);
      expect(prisma.tdsReceivable.create).not.toHaveBeenCalled();
    });

    it('requires a section or note', async () => {
      setUpConfirm(810000);
      await expect(
        service.confirmPaymentWithBankCredit('pay-fee', 'credit-98', 'fin-1', { tdsDeductedPaise: 75000, tdsNote: ' ' }),
      ).rejects.toThrow(/tdsNote is required/);
    });

    it('refuses TDS on a ₹499 registration payment', async () => {
      setUpConfirm(40000, {
        ...placementFeePayment,
        id: 'pay-act',
        type: 'activation',
        amount: 49900,
        expectedAmountPaise: 49900,
        placementId: null,
      });
      await expect(
        service.confirmPaymentWithBankCredit('pay-act', 'credit-98', 'fin-1', { tdsDeductedPaise: 9900, tdsNote: 'x' }),
      ).rejects.toThrow(/only be recorded on a placement fee/);
    });

    it('refuses TDS when the credit is the full amount', async () => {
      setUpConfirm(885000);
      await expect(
        service.confirmPaymentWithBankCredit('pay-fee', 'credit-98', 'fin-1', { tdsDeductedPaise: 1, tdsNote: 'x' }),
      ).rejects.toThrow(/no TDS to record/);
    });
  });

  describe('48-hour wait after payout details change uses the server clock', () => {
    const now = new Date('2026-11-11T10:00:00.000Z');
    const setUpPayout = (activeFrom: Date) => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-ref-po',
        code: 'PAY-00200',
        type: 'referral_payout',
        status: 'approved',
        referralId: 'rf-1',
        subjectType: 'referral',
        subjectId: 'rf-1',
        payoutAccountId: null,
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.payoutAccount.findFirst.mockResolvedValue({
        id: 'acc-new',
        ownerType: 'referral',
        ownerId: 'rf-1',
        ownerNameAtEntry: 'Arun Kumar',
        status: 'pending_validation',
        activeFrom,
        createdAt: new Date(activeFrom.getTime() - 48 * 3600 * 1000),
        changeOtpRequestId: 'otp-1',
      });
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pay-ref-po', status: 'succeeded' });
    };

    it('refuses a payout during the wait even when the caller sends a paidAt after the wait', async () => {
      const activeFrom = new Date(now.getTime() + 2 * 3600 * 1000); // wait ends in 2 hours
      setUpPayout(activeFrom);
      await expect(
        service.recordPayout(
          'pay-ref-po',
          'fin-1',
          { bankUtr: 'UTR-WAIT-1', receiverNameShown: 'Arun Kumar', paidAt: new Date(now.getTime() + 3 * 3600 * 1000) },
          now,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a payout during the wait when no paidAt is sent', async () => {
      setUpPayout(new Date(now.getTime() + 60 * 1000));
      await expect(
        service.recordPayout('pay-ref-po', 'fin-1', { bankUtr: 'UTR-WAIT-2', receiverNameShown: 'Arun Kumar' }, now),
      ).rejects.toThrow(/cooling period \(48-hour wait\)/);
    });

    it('refuses a back-dated paidAt that falls inside the wait', async () => {
      const activeFrom = new Date(now.getTime() - 3600 * 1000); // wait ended an hour ago
      setUpPayout(activeFrom);
      await expect(
        service.recordPayout(
          'pay-ref-po',
          'fin-1',
          { bankUtr: 'UTR-WAIT-3', receiverNameShown: 'Arun Kumar', paidAt: new Date(now.getTime() - 2 * 3600 * 1000) },
          now,
        ),
      ).rejects.toThrow(/inside the 48-hour wait/);
    });

    it('allows the payout once the wait has passed on the server clock', async () => {
      setUpPayout(new Date(now.getTime() - 3600 * 1000));
      const result = await service.recordPayout(
        'pay-ref-po',
        'fin-1',
        { bankUtr: 'UTR-WAIT-4', receiverNameShown: 'Arun Kumar' },
        now,
      );
      expect(result.status).toBe('succeeded');
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ paidAt: now }) }),
      );
    });
  });

  describe('Revealing full payout details', () => {
    it('refuses anyone but the CEO and Finance, before anything is decrypted or logged', async () => {
      await expect(service.revealPayoutDetails('pay-1', 'mgr-1')).rejects.toThrow(ForbiddenException);
      await expect(service.revealPayoutDetails('pay-1', 'unknown')).rejects.toThrow(ForbiddenException);
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });
  });
});

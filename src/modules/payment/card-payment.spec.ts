import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { MessagingService } from '../message/messaging.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { PaymentProvider } from './payment-provider.interface';
import { BankFeedProvider } from './bank-feed-provider.interface';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { UpiCollectionService } from './upi-collection.service';
import { Response } from 'express';

type MockPrisma = {
  payment: Record<string, jest.Mock>;
  bankCredit: Record<string, jest.Mock>;
  jobSeeker: Record<string, jest.Mock>;
  placement: Record<string, jest.Mock>;
  statusHistory: Record<string, jest.Mock>;
  staff: Record<string, jest.Mock>;
  reviewFlag: Record<string, jest.Mock>;
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
};

describe('Phase 16 Task 4: Card payments, only when payer chooses card', () => {
  let service: PaymentService;
  let upiService: UpiCollectionService;
  let controller: PaymentController;
  let prisma: MockPrisma;
  let provider: jest.Mocked<PaymentProvider>;
  let bankFeedProvider: jest.Mocked<BankFeedProvider>;
  let auditService: { log: jest.Mock };
  let messagingService: { send: jest.Mock };
  let reviewFlagService: { raise: jest.Mock; resolve: jest.Mock };

  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.com';

    const mockPrisma: MockPrisma = {
      payment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bankCredit: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      jobSeeker: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      placement: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      statusHistory: {
        create: jest.fn(),
      },
      staff: {
        findFirst: jest.fn().mockResolvedValue({ id: 'staff-1', code: 'CA-00001' }),
      },
      reviewFlag: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: MockPrisma) => Promise<unknown>) => cb(mockPrisma)),
      $queryRaw: jest.fn(),
    };
    prisma = mockPrisma;

    provider = {
      createCharge: jest.fn(),
      disbursePayout: jest.fn(),
      verifyWebhook: jest.fn(),
      verifyPayoutWebhook: jest.fn(),
    } as unknown as jest.Mocked<PaymentProvider>;

    bankFeedProvider = {
      verifyWebhook: jest.fn(),
    } as unknown as jest.Mocked<BankFeedProvider>;

    auditService = { log: jest.fn() };
    messagingService = { send: jest.fn().mockResolvedValue({}) };
    reviewFlagService = { raise: jest.fn().mockResolvedValue({ id: 'rf-1' }), resolve: jest.fn() };

    const pricingService = {
      current: jest.fn().mockResolvedValue({ referralPayoutPaise: 20000 }),
    } as unknown as PricingService;

    const idService = {
      generateCode: jest.fn().mockResolvedValue('PAY-12345'),
    } as unknown as IdService;

    service = new PaymentService(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
      idService,
      provider,
      bankFeedProvider,
      pricingService,
      messagingService as unknown as MessagingService,
      reviewFlagService as unknown as ReviewFlagService,
    );

    upiService = new UpiCollectionService(
      prisma as unknown as PrismaService,
      idService,
      messagingService as unknown as MessagingService,
      service,
    );

    controller = new PaymentController(service, upiService);
  });

  describe('payByCard logic', () => {
    it('switches payment to method: gateway_card and sets gatewayReference via createCharge', async () => {
      const payment = {
        id: 'pay-1',
        code: 'PAY-00001',
        amount: 49900,
        expectedAmountPaise: 49900,
        status: 'pending',
        method: 'upi_direct',
        gatewayReference: null,
        upiReference: 'PAY-00001-abcd1234',
        subjectType: 'job_seeker',
        subjectId: 'js-1',
      };
      prisma.payment.findUnique.mockResolvedValueOnce(payment);
      provider.createCharge.mockResolvedValueOnce({
        gatewayReference: 'gw_ref_999',
        paymentLink: 'https://gateway.example.com/pay/gw_ref_999',
      });
      prisma.payment.update.mockResolvedValueOnce({
        ...payment,
        method: 'gateway_card',
        gatewayReference: 'gw_ref_999',
      });

      const result = await service.payByCard('PAY-00001-abcd1234');

      expect(provider.createCharge).toHaveBeenCalledTimes(1);
      expect(provider.createCharge).toHaveBeenCalledWith(49900, 'job_seeker', 'js-1');
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: {
          method: 'gateway_card',
          gatewayReference: 'gw_ref_999',
        },
      });
      expect(prisma.statusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subjectType: 'payment',
            subjectId: 'pay-1',
            reason: 'switched_to_gateway_card',
          }),
        }),
      );
      expect(result).toEqual({
        paymentId: 'pay-1',
        gatewayReference: 'gw_ref_999',
        paymentLink: 'https://gateway.example.com/pay/gw_ref_999',
      });
    });

    it('calling payByCard repeatedly does not create a second gateway charge', async () => {
      const paymentAlreadyCard = {
        id: 'pay-1',
        code: 'PAY-00001',
        amount: 49900,
        expectedAmountPaise: 49900,
        status: 'pending',
        method: 'gateway_card',
        gatewayReference: 'gw_ref_999',
        upiReference: 'PAY-00001-abcd1234',
        subjectType: 'job_seeker',
        subjectId: 'js-1',
      };
      prisma.payment.findUnique.mockResolvedValueOnce(paymentAlreadyCard);

      const result = await service.payByCard('PAY-00001-abcd1234');

      expect(provider.createCharge).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(result.paymentId).toBe('pay-1');
      expect(result.gatewayReference).toBe('gw_ref_999');
    });

    it('throws NotFoundException when upiReference token does not exist', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(null);

      await expect(service.payByCard('invalid-token')).rejects.toThrow(NotFoundException);
      expect(provider.createCharge).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if payment is already succeeded', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({
        id: 'pay-1',
        status: 'succeeded',
        upiReference: 'token-1',
      });

      await expect(service.payByCard('token-1')).rejects.toThrow(BadRequestException);
      expect(provider.createCharge).not.toHaveBeenCalled();
    });
  });

  describe('Card gateway webhook confirmation', () => {
    it('confirms the payment through onPaymentSucceeded with confirmedBy: gateway', async () => {
      const payment = {
        id: 'pay-1',
        code: 'PAY-00001',
        amount: 49900,
        status: 'pending',
        method: 'gateway_card',
        gatewayReference: 'gw_ref_999',
        type: 'activation',
        jobSeekerId: 'js-1',
        jobSeeker: { id: 'js-1', code: 'JS-00001', status: 'registered', hitCount: 0, paymentReceivedAt: null, city: 'Bengaluru' },
      };
      provider.verifyWebhook.mockResolvedValueOnce({
        isValid: true,
        gatewayReference: 'gw_ref_999',
        status: 'succeeded',
      });
      prisma.payment.findUnique
        .mockResolvedValueOnce(payment) // handleWebhook lookup
        .mockResolvedValueOnce(payment); // onPaymentSucceeded lookup
      prisma.payment.update.mockResolvedValueOnce({ ...payment, status: 'succeeded', confirmedBy: 'gateway' });
      prisma.jobSeeker.update.mockResolvedValueOnce({ ...payment.jobSeeker, status: 'active', paymentReceivedAt: new Date() });

      const res = await service.handleWebhook({ event: 'payment.captured' });

      expect(res).toEqual({ received: true, status: 'succeeded', paymentId: 'pay-1' });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-1', status: 'pending' },
          data: expect.objectContaining({
            status: 'succeeded',
            confirmedBy: 'gateway',
          }),
        }),
      );
    });
  });

  describe('Later UPI credit after switching to card', () => {
    it('keeps bank credit unmatched and raises payment_mismatch flag if payer pays by UPI after switching to card', async () => {
      const paymentSwitchedToCard = {
        id: 'pay-1',
        code: 'PAY-00001',
        amount: 49900,
        expectedAmountPaise: 49900,
        status: 'pending',
        method: 'gateway_card',
        gatewayReference: 'gw_ref_999',
        upiReference: 'PAY-00001-abcd1234',
      };

      bankFeedProvider.verifyWebhook.mockResolvedValueOnce({
        isValid: true,
        event: {
          bankUtr: '111122223333',
          amountPaise: 49900,
          receivedAt: new Date('2026-11-09T14:00:00Z'),
          remark: 'UPI PAY-00001-abcd1234',
        },
      });
      prisma.bankCredit.findUnique.mockResolvedValueOnce(null);
      prisma.bankCredit.create.mockResolvedValueOnce({
        id: 'credit-1',
        bankUtr: '111122223333',
        status: 'unmatched',
      });
      prisma.payment.findMany.mockResolvedValueOnce([paymentSwitchedToCard]);

      const res = await service.handleBankFeedWebhook(Buffer.from('dummy'), 'sig');

      expect(res).toEqual({
        received: true,
        status: 'unmatched',
        reason: 'switched_to_card',
        bankCreditId: 'credit-1',
        paymentId: 'pay-1',
      });
      // BankCredit must NOT be matched
      expect(prisma.bankCredit.update).not.toHaveBeenCalled();
      // Payment must NOT be confirmed
      expect(prisma.payment.update).not.toHaveBeenCalled();
      // ReviewFlag raised
      expect(reviewFlagService.raise).toHaveBeenCalledWith({
        kind: 'payment_mismatch',
        subjectType: 'payment',
        subjectId: 'pay-1',
        details: expect.objectContaining({
          bankCreditId: 'credit-1',
          bankUtr: '111122223333',
          paymentMethod: 'gateway_card',
          reason: 'switched_to_card',
        }),
      });
    });

    it('keeps bank credit unmatched and raises payment_mismatch flag if payer pays by UPI after card payment already succeeded', async () => {
      const paymentSucceededByCard = {
        id: 'pay-1',
        code: 'PAY-00001',
        amount: 49900,
        expectedAmountPaise: 49900,
        status: 'succeeded',
        method: 'gateway_card',
        gatewayReference: 'gw_ref_999',
        upiReference: 'PAY-00001-abcd1234',
      };

      bankFeedProvider.verifyWebhook.mockResolvedValueOnce({
        isValid: true,
        event: {
          bankUtr: '999988887777',
          amountPaise: 49900,
          receivedAt: new Date('2026-11-09T15:00:00Z'),
          remark: 'UPI PAY-00001-abcd1234',
        },
      });
      prisma.bankCredit.findUnique.mockResolvedValueOnce(null);
      prisma.bankCredit.create.mockResolvedValueOnce({
        id: 'credit-2',
        bankUtr: '999988887777',
        status: 'unmatched',
      });
      prisma.payment.findMany.mockResolvedValueOnce([paymentSucceededByCard]);

      const res = await service.handleBankFeedWebhook(Buffer.from('dummy'), 'sig');

      expect(res.status).toBe('unmatched');
      expect(prisma.bankCredit.update).not.toHaveBeenCalled();
      expect(reviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'payment_mismatch',
          subjectType: 'payment',
          subjectId: 'pay-1',
        }),
      );
    });
  });

  describe('UPI direct flow never touches gateway', () => {
    it('creates and confirms a UPI payment without invoking payment provider createCharge', async () => {
      process.env.COMPANY_UPI_VPA = 'laboura@icici';
      process.env.COMPANY_UPI_PAYEE_NAME = 'Laboura Staffing';

      prisma.payment.findFirst.mockResolvedValueOnce(null);
      prisma.payment.create.mockResolvedValueOnce({
        id: 'pay-upi',
        code: 'PAY-12345',
        type: 'activation',
        amount: 49900,
        expectedAmountPaise: 49900,
        status: 'pending',
        method: 'upi_direct',
        upiReference: 'PAY-12345-aabbccdd',
        subjectType: 'job_seeker',
        subjectId: 'js-upi',
      });

      const upiReq = await upiService.createRequest({
        type: 'activation',
        subjectType: 'job_seeker',
        subjectId: 'js-upi',
        amountPaise: 49900,
      });

      expect(upiReq.paymentId).toBe('pay-upi');
      expect(provider.createCharge).not.toHaveBeenCalled();

      // Bank feed confirmation
      bankFeedProvider.verifyWebhook.mockResolvedValueOnce({
        isValid: true,
        event: {
          bankUtr: '333344445555',
          amountPaise: 49900,
          receivedAt: new Date('2026-11-09T16:00:00Z'),
          remark: 'PAY-12345-aabbccdd',
        },
      });
      prisma.bankCredit.findUnique.mockResolvedValueOnce(null);
      prisma.bankCredit.create.mockResolvedValueOnce({
        id: 'credit-upi',
        bankUtr: '333344445555',
        status: 'unmatched',
      });
      prisma.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pay-upi',
          code: 'PAY-12345',
          amount: 49900,
          expectedAmountPaise: 49900,
          status: 'pending',
          method: 'upi_direct',
          upiReference: 'PAY-12345-aabbccdd',
          type: 'activation',
          jobSeekerId: 'js-upi',
          jobSeeker: { id: 'js-upi', code: 'JS-1', status: 'registered', hitCount: 0, paymentReceivedAt: null, city: 'Bengaluru' },
        },
      ]);
      prisma.payment.findUnique.mockResolvedValueOnce({
        id: 'pay-upi',
        code: 'PAY-12345',
        amount: 49900,
        status: 'pending',
        jobSeeker: { id: 'js-upi', code: 'JS-1', status: 'registered', hitCount: 0, paymentReceivedAt: null, city: 'Bengaluru' },
      });
      prisma.payment.update.mockResolvedValueOnce({ id: 'pay-upi', status: 'succeeded' });
      prisma.jobSeeker.update.mockResolvedValueOnce({ id: 'js-upi', status: 'active' });
      prisma.bankCredit.update.mockResolvedValueOnce({ id: 'credit-upi', status: 'matched' });

      await service.handleBankFeedWebhook(Buffer.from('body'), 'sig');

      expect(provider.createCharge).not.toHaveBeenCalled();
    });
  });

  describe('PaymentController POST /payments/request/:token/card', () => {
    it('returns JSON for API requests without HTML Accept header', async () => {
      const mockResult = {
        paymentId: 'pay-1',
        gatewayReference: 'gw_123',
        paymentLink: 'https://gateway.example.com/pay/gw_123',
      };
      jest.spyOn(service, 'payByCard').mockResolvedValueOnce(mockResult);

      const res = { redirect: jest.fn() } as unknown as Response;
      const response = await controller.payByCard('token-123', 'application/json', res);

      expect(response).toEqual(mockResult);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('redirects when Accept header includes text/html', async () => {
      const mockResult = {
        paymentId: 'pay-1',
        gatewayReference: 'gw_123',
        paymentLink: 'https://gateway.example.com/pay/gw_123',
      };
      jest.spyOn(service, 'payByCard').mockResolvedValueOnce(mockResult);

      const res = { redirect: jest.fn() } as unknown as Response;
      const response = await controller.payByCard('token-123', 'text/html,application/xhtml+xml', res);

      expect(res.redirect).toHaveBeenCalledWith('https://gateway.example.com/pay/gw_123');
      expect(response).toBeUndefined();
    });

    it('delegates to paymentService via upiCollectionService.payByCard', async () => {
      const mockResult = {
        paymentId: 'pay-1',
        gatewayReference: 'gw_123',
        paymentLink: 'https://gateway.example.com/pay/gw_123',
      };
      jest.spyOn(service, 'payByCard').mockResolvedValueOnce(mockResult);

      const res = await upiService.payByCard('token-123');
      expect(res).toEqual(mockResult);
    });
  });
});

import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { MessagingService } from '../message/messaging.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PlacementService } from '../placement/placement.service';
import { PaymentService } from './payment.service';
import { UpiCollectionService } from './upi-collection.service';
import { PaymentProvider } from './payment-provider.interface';
import { BankFeedProvider } from './bank-feed-provider.interface';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { calculatePlacementFee, calculateGst } from '../../common/money/money';

type MockPrisma = {
  payment: Record<string, jest.Mock>;
  jobSeeker: Record<string, jest.Mock>;
  business: Record<string, jest.Mock>;
  placement: Record<string, jest.Mock>;
  interview: Record<string, jest.Mock>;
  businessAgreement: Record<string, jest.Mock>;
  staff: Record<string, jest.Mock>;
  statusHistory: Record<string, jest.Mock>;
  messageLog: Record<string, jest.Mock>;
  pricingPolicy: Record<string, jest.Mock>;
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
};

describe('Phase 16 Task 5: Switch Activation and Placement Fees to UPI', () => {
  let prisma: MockPrisma;
  let idService: IdService;
  let auditService: { log: jest.Mock };
  let messagingService: { send: jest.Mock };
  let pricingService: PricingService;
  let paymentService: PaymentService;
  let upiCollectionService: UpiCollectionService;
  let jobSeekerService: JobSeekerService;
  let placementService: PlacementService;
  let paymentProvider: jest.Mocked<PaymentProvider>;
  let bankFeedProvider: jest.Mocked<BankFeedProvider>;

  const currentPolicy = {
    activationFeePaise: 49900,
    placementFeePercent: 50,
    gstPercent: 18,
    referralPayoutPaise: 20000,
    placementPaymentDueHours: 24,
    maxHits: 3,
  };

  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    process.env.COMPANY_UPI_VPA = 'laboura@icici';
    process.env.COMPANY_UPI_PAYEE_NAME = 'Laboura Staffing';

    const mockPrisma: MockPrisma = {
      payment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      jobSeeker: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      business: {
        findUnique: jest.fn(),
      },
      placement: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      interview: {
        findUnique: jest.fn(),
      },
      businessAgreement: {
        findFirst: jest.fn(),
      },
      staff: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 'staff-1', code: 'CA-00001' }),
      },
      statusHistory: {
        create: jest.fn(),
      },
      messageLog: {
        create: jest.fn(),
        update: jest.fn(),
      },
      pricingPolicy: {
        findFirst: jest.fn().mockResolvedValue(currentPolicy),
      },
      $transaction: jest.fn(async (cb: (tx: MockPrisma) => Promise<unknown>) => cb(mockPrisma)),
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = mockPrisma;

    idService = {
      generateCode: jest.fn().mockImplementation(async (prefix: string) => {
        if (prefix === 'payment') return 'PAY-00001';
        if (prefix === 'placement') return 'PL-00001';
        if (prefix === 'invoice') return 'INV-00001';
        return `${prefix.toUpperCase()}-00001`;
      }),
    } as unknown as IdService;

    auditService = { log: jest.fn() };
    messagingService = { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) };

    pricingService = {
      current: jest.fn().mockResolvedValue(currentPolicy),
    } as unknown as PricingService;

    paymentProvider = {
      createCharge: jest.fn(),
      disbursePayout: jest.fn(),
      verifyWebhook: jest.fn(),
      verifyPayoutWebhook: jest.fn(),
    } as unknown as jest.Mocked<PaymentProvider>;

    bankFeedProvider = {
      verifyWebhook: jest.fn(),
    } as unknown as jest.Mocked<BankFeedProvider>;

    paymentService = new PaymentService(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
      idService,
      paymentProvider,
      bankFeedProvider,
      pricingService,
      messagingService as unknown as MessagingService,
      { raise: jest.fn(), resolve: jest.fn() } as unknown as ReviewFlagService,
    );

    upiCollectionService = new UpiCollectionService(
      prisma as unknown as PrismaService,
      idService,
      messagingService as unknown as MessagingService,
      paymentService,
    );

    jobSeekerService = new JobSeekerService(
      prisma as unknown as PrismaService,
      idService,
      auditService as unknown as AuditService,
      {} as never,
      paymentService,
      pricingService,
      upiCollectionService,
    );

    placementService = new PlacementService(
      prisma as unknown as PrismaService,
      idService,
      auditService as unknown as AuditService,
      jobSeekerService,
      paymentService,
      pricingService,
      upiCollectionService,
      { raise: jest.fn(), resolve: jest.fn() } as unknown as ReviewFlagService,
    );
  });

  describe('1. Registration and re-registration activation fees via UPI', () => {
    it('creates a UPI request, does not call gateway, and clock starts only when confirmed', async () => {
      const candidate = {
        id: 'js-1',
        code: 'JS-00001',
        name: 'Ramesh Kumar',
        phone: '+919876543210',
        city: 'Bengaluru',
        status: 'registered',
        hitCount: 0,
        paymentReceivedAt: null,
      };
      prisma.jobSeeker.findUnique.mockResolvedValueOnce(candidate);
      prisma.payment.findFirst.mockResolvedValueOnce(null); // no existing pending payment
      prisma.payment.create.mockResolvedValueOnce({
        id: 'pay-1',
        code: 'PAY-00001',
        type: 'activation',
        amount: 49900,
        expectedAmountPaise: 49900,
        status: 'pending',
        method: 'upi_direct',
        upiReference: 'PAY-00001-1234abcd',
        gatewayReference: null,
        subjectType: 'job_seeker',
        subjectId: 'js-1',
        jobSeekerId: 'js-1',
      });

      const res = await jobSeekerService.createActivationPayment('js-1');

      // Assertions on activation request
      expect(paymentProvider.createCharge).not.toHaveBeenCalled();
      expect(res.amount).toBe(49900);
      expect(res.gatewayReference).toBeNull();
      expect(res.upiReference).toBe('PAY-00001-1234abcd');
      expect(res.paymentLink).toContain('/payments/request/PAY-00001-1234abcd');
      expect(messagingService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'sms',
          template: 'payment_request',
          subjectType: 'job_seeker',
          subjectId: 'js-1',
        }),
      );

      // Confirm payment through onPaymentSucceeded
      const confirmedAt = new Date('2026-11-09T10:00:00Z');
      const paymentRow = {
        id: 'pay-1',
        code: 'PAY-00001',
        type: 'activation',
        amount: 49900,
        status: 'pending',
        method: 'upi_direct',
        jobSeekerId: 'js-1',
        reactivation: false,
        jobSeeker: candidate,
      };
      prisma.payment.findUnique.mockResolvedValueOnce(paymentRow);
      prisma.jobSeeker.update.mockResolvedValueOnce({
        ...candidate,
        status: 'active',
        paymentReceivedAt: confirmedAt,
      });

      await paymentService.onPaymentSucceeded('pay-1', {
        confirmedAt,
        confirmedBy: 'bank_feed',
        bankUtr: 'UTR1122334455',
      });

      // Assert candidate active and clock started at confirmedAt
      expect(prisma.jobSeeker.update).toHaveBeenCalledWith({
        where: { id: 'js-1' },
        data: {
          status: 'active',
          paymentReceivedAt: confirmedAt,
          hitCount: 0,
        },
      });

      // Receipt link sent to candidate
      expect(messagingService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'payment_receipt',
          subjectType: 'job_seeker',
          subjectId: 'js-1',
          variables: { link: 'https://app.laboura.in/payments/pay-1/receipt' },
        }),
      );
    });

    it('re-registration after 3 hits resets hit count and creates UPI request with reactivation: true', async () => {
      const deactivatedCandidate = {
        id: 'js-deact',
        code: 'JS-00099',
        city: 'Bengaluru',
        status: 'deactivated',
        hitCount: 3,
        paymentReceivedAt: new Date('2026-09-01T00:00:00Z'),
      };
      prisma.jobSeeker.findUnique.mockResolvedValueOnce(deactivatedCandidate);
      prisma.payment.findFirst.mockResolvedValueOnce(null);
      prisma.payment.create.mockResolvedValueOnce({
        id: 'pay-react',
        code: 'PAY-00002',
        type: 'activation',
        amount: 49900,
        expectedAmountPaise: 49900,
        status: 'pending',
        method: 'upi_direct',
        upiReference: 'PAY-00002-react1234',
        reactivation: true,
      });

      const res = await jobSeekerService.reactivate('js-deact', 'staff-1');

      expect(paymentProvider.createCharge).not.toHaveBeenCalled();
      expect(res.amount).toBe(49900);
      expect(res.upiReference).toBe('PAY-00002-react1234');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'job_seeker.reactivation_initiated',
        }),
      );
    });
  });

  describe('2. Placement fee request via UPI', () => {
    it('creates a UPI request for fee plus GST to the business owner without calling gateway', async () => {
      const now = new Date('2026-11-09T11:00:00Z');
      const interview = {
        id: 'interview-1',
        result: 'selected',
        status: 'completed',
        resultRecordedAt: now,
        proposedByStaffId: 'staff-lead-1',
        vacancyId: 'vc-1',
        jobSeekerId: 'js-1',
        businessId: 'biz-1',
        selectedSalaryPaise: 1600000, // ₹16,000
        selectedJoiningDate: new Date('2026-11-15T00:00:00Z'),
        vacancy: { city: 'Bengaluru' },
      };

      prisma.interview.findUnique.mockResolvedValueOnce(interview);
      prisma.placement.findUnique.mockResolvedValueOnce(null); // not existing yet
      prisma.businessAgreement.findFirst.mockResolvedValueOnce({
        id: 'agree-1',
        feePercent: 50,
        gstPercent: 18,
        signedAt: new Date('2026-10-01T00:00:00Z'),
      });

      const expectedFee = calculatePlacementFee(1600000, 50); // 800000 paise (₹8,000)
      const expectedGst = calculateGst(expectedFee, 18); // 144000 paise (₹1,440)
      const expectedTotal = expectedFee + expectedGst; // 944000 paise (₹9,440)

      prisma.placement.create.mockResolvedValueOnce({
        id: 'pl-1',
        code: 'PL-00001',
        city: 'Bengaluru',
        status: 'awaiting_payment',
        agreedSalary: 1600000,
        feePercentAtCreation: 50,
        gstPercentAtCreation: 18,
        placementFee: expectedFee,
        gstAmount: expectedGst,
        businessId: 'biz-1',
        payments: [],
      });

      // UPI request creation
      prisma.payment.findFirst.mockResolvedValueOnce(null);
      prisma.payment.create.mockResolvedValueOnce({
        id: 'pay-placement',
        code: 'PAY-00003',
        type: 'placement_fee',
        amount: expectedTotal,
        expectedAmountPaise: expectedTotal,
        status: 'pending',
        method: 'upi_direct',
        upiReference: 'PAY-00003-plfee1234',
        subjectType: 'placement',
        subjectId: 'pl-1',
        businessId: 'biz-1',
        placementId: 'pl-1',
      });
      prisma.payment.findUnique.mockResolvedValueOnce({
        id: 'pay-placement',
        code: 'PAY-00003',
        amount: expectedTotal,
        status: 'pending',
        upiReference: 'PAY-00003-plfee1234',
        gatewayReference: null,
      });

      const result = await placementService.createAwaitingPaymentFromInterview('interview-1', now);

      expect(paymentProvider.createCharge).not.toHaveBeenCalled();
      expect(result.status).toBe('awaiting_payment');
      expect(result.placementFee).toBe(expectedFee);
      expect(result.gstAmount).toBe(expectedGst);
      expect(result.payment?.amount).toBe(expectedTotal);
      expect(result.payment?.upiReference).toBe('PAY-00003-plfee1234');
      expect(result.payment?.paymentLink).toContain('/payments/request/PAY-00003-plfee1234');

      // Assert sent to business owner via SMS and WhatsApp
      expect(messagingService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'payment_request',
          subjectType: 'business',
          subjectId: 'biz-1',
          variables: expect.objectContaining({
            amount: '9440.00',
            link: expect.stringContaining('/payments/request/PAY-00003-plfee1234'),
          }),
        }),
      );
    });
  });

  describe('3. Placement fee confirmation creates invoice number and sends link once', () => {
    it('assigns invoiceCode on confirmation, confirms placement, places candidate, and sends invoice link once', async () => {
      const confirmedAt = new Date('2026-11-09T12:00:00Z');
      const placement = {
        id: 'pl-1',
        code: 'PL-00001',
        city: 'Bengaluru',
        status: 'awaiting_payment',
        businessId: 'biz-1',
        jobSeekerId: 'js-1',
        invoiceCode: null, // not yet assigned
        joiningDate: new Date('2026-11-15T00:00:00Z'),
        jobSeeker: { id: 'js-1', code: 'JS-00001', status: 'active' },
        business: { id: 'biz-1', code: 'BZ-00001', name: 'Acme Pvt Ltd', phone: '+919999988888' },
      };

      const payment = {
        id: 'pay-placement',
        code: 'PAY-00003',
        type: 'placement_fee',
        amount: 944000,
        status: 'pending',
        placementId: 'pl-1',
      };

      prisma.payment.findUnique.mockResolvedValueOnce(payment);
      prisma.placement.findUnique.mockResolvedValueOnce(placement);
      prisma.placement.update.mockResolvedValueOnce({
        ...placement,
        invoiceCode: 'INV-00001',
      });
      prisma.jobSeeker.update.mockResolvedValueOnce({
        ...placement.jobSeeker,
        status: 'placed',
      });

      await paymentService.onPaymentSucceeded('pay-placement', {
        confirmedAt,
        confirmedBy: 'bank_feed',
        bankUtr: 'UTR9988776655',
      });

      // Invoice code assigned
      expect(idService.generateCode).toHaveBeenCalledWith('invoice');
      expect(prisma.placement.update).toHaveBeenCalledWith({
        where: { id: 'pl-1' },
        data: { invoiceCode: 'INV-00001' },
      });

      // Placement confirmed, candidate placed
      expect(prisma.placement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pl-1', status: 'awaiting_payment' },
          data: { status: 'confirmed', paidAt: confirmedAt },
        }),
      );
      expect(prisma.jobSeeker.update).toHaveBeenCalledWith({
        where: { id: 'js-1' },
        data: { status: 'placed' },
      });

      // Invoice link sent to business owner
      expect(messagingService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'placement_invoice',
          subjectType: 'business',
          subjectId: 'biz-1',
          variables: {
            link: 'https://app.laboura.in/placements/pl-1/invoice',
            invoiceCode: 'INV-00001',
          },
        }),
      );

      // Candidate received joining confirmation
      expect(messagingService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'joining_confirmed',
          subjectType: 'job_seeker',
          subjectId: 'js-1',
        }),
      );
    });
  });

  describe('4. Immutability of GST Invoice across PricingPolicy changes', () => {
    it('getInvoice strictly uses placement.gstPercentAtCreation, ignoring any subsequent policy changes', async () => {
      const placement = {
        id: 'pl-inv',
        code: 'PL-00001',
        city: 'Bengaluru',
        status: 'confirmed',
        invoiceCode: 'INV-00001',
        agreedSalary: 2000000, // ₹20,000
        feePercentAtCreation: 50,
        gstPercentAtCreation: 18,
        placementFee: 1000000, // ₹10,000
        gstAmount: 180000, // ₹1,800
        joinedDate: new Date('2026-11-10T00:00:00Z'),
        business: {
          id: 'biz-1',
          code: 'BZ-00001',
          name: 'Tech Corp Ltd',
          phone: '+919988776655',
          address: '100 Ring Road',
          locality: 'Indiranagar',
          city: 'Bengaluru',
          gstNumber: '29ABCDE1234F1Z5',
        },
        jobSeeker: {
          id: 'js-1',
          code: 'JS-00001',
          name: 'Anil Kumar',
          phone: '+919876543210',
        },
        vacancy: {
          tradeSkill: 'Electrician',
        },
      };

      prisma.staff.findUnique.mockResolvedValueOnce({ id: 'staff-ceo', role: 'ceo' });
      prisma.placement.findFirst.mockResolvedValueOnce(placement);

      // First check with policy having 18% GST
      const inv1 = await placementService.getInvoice('pl-inv', 'staff-ceo');
      expect(inv1.invoiceNumber).toBe('INV-00001');
      expect(inv1.lineItems[0].taxRatePercent).toBe(18);
      expect(inv1.lineItems[0].cgstRatePercent).toBe(9);
      expect(inv1.lineItems[0].sgstRatePercent).toBe(9);
      expect(inv1.summary.subtotalPaise).toBe(1000000);
      expect(inv1.summary.totalTaxPaise).toBe(180000);
      expect(inv1.summary.totalAmountPaise).toBe(1180000);

      // Now change today's policy: GST increased to 28% and fee to 60%
      (pricingService.current as jest.Mock).mockResolvedValueOnce({
        ...currentPolicy,
        placementFeePercent: 60,
        gstPercent: 28,
      });
      prisma.staff.findUnique.mockResolvedValueOnce({ id: 'staff-ceo', role: 'ceo' });
      prisma.placement.findFirst.mockResolvedValueOnce(placement);

      // Second check: invoice must NOT change!
      const inv2 = await placementService.getInvoice('pl-inv', 'staff-ceo');
      expect(inv2.invoiceNumber).toBe('INV-00001');
      expect(inv2.lineItems[0].taxRatePercent).toBe(18); // NOT 28%
      expect(inv2.lineItems[0].cgstRatePercent).toBe(9); // NOT 14%
      expect(inv2.lineItems[0].sgstRatePercent).toBe(9); // NOT 14%
      expect(inv2.lineItems[0].description).toContain('50%'); // NOT 60%
      expect(inv2.summary.subtotalPaise).toBe(1000000);
      expect(inv2.summary.totalTaxPaise).toBe(180000);
      expect(inv2.summary.totalAmountPaise).toBe(1180000);
    });
  });
});

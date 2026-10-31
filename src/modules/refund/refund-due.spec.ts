import { NotFoundException } from '@nestjs/common';
import { RefundService } from './refund.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { evaluateJobSeekerRefundEligibility } from '../job-seeker/job-seeker-refund-eligibility';
import { evaluatePlacementRefundEligibility } from '../placement/placement-refund-eligibility';
import { maskPii } from '../../common/rbac/pii-masking.interceptor';

interface MockPrismaForRefund {
  staff: {
    findUnique: jest.Mock<Promise<{ id: string; role: string; city: string } | null>, [{ where: { id: string } }]>;
  };
  jobSeeker: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown?]>;
  };
  jobSeekerHit: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown?]>;
  };
  placement: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown?]>;
  };
  payment: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown?]>;
  };
}

describe('Phase 6.5 Task 9: Refund-Due Listing & Shared Eligibility', () => {
  let refundService: RefundService;
  let mockPrisma: MockPrismaForRefund;

  const serverNow = new Date('2026-06-30T12:00:00.000Z');

  const ceoActor = { id: 'ceo-1', role: 'ceo', city: 'Bengaluru' };
  const managerActor = { id: 'mgr-1', role: 'manager', city: 'Bengaluru' };
  const financeActor = { id: 'fin-1', role: 'finance', city: 'Bengaluru' };
  const callAgentActor = { id: 'ca-1', role: 'call_agent', city: 'Bengaluru' };

  beforeEach(() => {
    mockPrisma = {
      staff: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'ceo-1') return Promise.resolve(ceoActor);
          if (where.id === 'mgr-1') return Promise.resolve(managerActor);
          if (where.id === 'fin-1') return Promise.resolve(financeActor);
          if (where.id === 'ca-1') return Promise.resolve(callAgentActor);
          return Promise.resolve(null);
        }),
      },
      jobSeeker: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      jobSeekerHit: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      placement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    refundService = new RefundService(mockPrisma as unknown as PrismaService);
  });

  describe('1. Shared Job Seeker Refund Eligibility', () => {
    const paymentDate = new Date('2026-05-01T00:00:00.000Z');

    it('candidate at day 29 is absent from listing and rejected by evaluator', () => {
      // Day 29: May 30
      const day29 = new Date('2026-05-30T00:00:00.000Z');
      const evalResult = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: paymentDate,
          status: 'active',
          hasOfferRejectedHit: false,
          hasExistingRefund: false,
        },
        day29,
      );

      expect(evalResult.eligible).toBe(false);
      expect(evalResult.ineligibleReason).toContain('Refund can only be approved after 30 days');
    });

    it('candidate at day 30 exact is absent from listing and rejected by evaluator', () => {
      // Exactly 30 days: May 31 00:00:00
      const day30Exact = new Date(paymentDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      const evalResult = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: paymentDate,
          status: 'active',
          hasOfferRejectedHit: false,
          hasExistingRefund: false,
        },
        day30Exact,
      );

      expect(evalResult.eligible).toBe(false);
      expect(evalResult.ineligibleReason).toContain('Refund can only be approved after 30 days');
    });

    it('candidate at day 31 is present in listing and accepted by evaluator', () => {
      // Day 31: June 1
      const day31 = new Date('2026-06-01T00:00:00.000Z');
      const evalResult = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: paymentDate,
          status: 'active',
          hasOfferRejectedHit: false,
          hasExistingRefund: false,
        },
        day31,
      );

      expect(evalResult.eligible).toBe(true);
      expect(evalResult.amountPaise).toBe(49900);
      expect(evalResult.daysOwed).toBe(1);
      expect(evalResult.daysElapsed).toBe(31);
    });

    it('candidate disappears once a refund has already been issued', () => {
      const day31 = new Date('2026-06-01T00:00:00.000Z');
      const evalResult = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: paymentDate,
          status: 'active',
          hasOfferRejectedHit: false,
          hasExistingRefund: true, // Already refunded
        },
        day31,
      );

      expect(evalResult.eligible).toBe(false);
      expect(evalResult.ineligibleReason).toContain('A refund has already been issued');
    });

    it('candidate who rejected a suitable offer never appears', () => {
      const day31 = new Date('2026-06-01T00:00:00.000Z');
      const evalResult = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: paymentDate,
          status: 'active',
          hasOfferRejectedHit: true, // Offer rejected hit exists
          hasExistingRefund: false,
        },
        day31,
      );

      expect(evalResult.eligible).toBe(false);
      expect(evalResult.ineligibleReason).toContain('rejected a suitable offer');
    });

    it('placed or deactivated candidates never appear', () => {
      const day31 = new Date('2026-06-01T00:00:00.000Z');

      const placedResult = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: paymentDate,
          status: 'placed',
          hasOfferRejectedHit: false,
          hasExistingRefund: false,
        },
        day31,
      );
      expect(placedResult.eligible).toBe(false);
      expect(placedResult.ineligibleReason).toContain('confirmed placement');

      const deactivatedResult = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: paymentDate,
          status: 'deactivated',
          hasOfferRejectedHit: false,
          hasExistingRefund: false,
        },
        day31,
      );
      expect(deactivatedResult.eligible).toBe(false);
      expect(deactivatedResult.ineligibleReason).toContain('deactivated and carries no refund entitlement');
    });
  });

  describe('2. Shared Placement Refund Eligibility', () => {
    const dropoutDate = new Date('2026-06-01T00:00:00.000Z');
    const placementFee = 3500000;

    it('placement at day 14 from dropout is absent and rejected by evaluator', () => {
      // Day 14: June 15
      const day14 = new Date('2026-06-15T00:00:00.000Z');
      const evalResult = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          eligibility: 'employee_left',
          hasAcceptedReplacement: false,
          dropoutReportedAt: dropoutDate,
          clockPaused: false,
          clockPausedAt: null,
          placementFee,
          hasExistingRefund: false,
        },
        day14,
      );

      expect(evalResult.eligible).toBe(false);
      expect(evalResult.ineligibleReason).toContain('Refund is not payable before 15 days have elapsed');
    });

    it('placement at day 15 is present in listing and accepted by evaluator', () => {
      // Day 15: June 16
      const day15 = new Date('2026-06-16T00:00:00.000Z');
      const evalResult = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          eligibility: 'employee_left',
          hasAcceptedReplacement: false,
          dropoutReportedAt: dropoutDate,
          clockPaused: false,
          clockPausedAt: null,
          placementFee,
          hasExistingRefund: false,
        },
        day15,
      );

      expect(evalResult.eligible).toBe(true);
      expect(evalResult.amountPaise).toBe(placementFee);
      expect(evalResult.daysOwed).toBe(0);
      expect(evalResult.daysElapsed).toBe(15);
    });

    it('placement at day 20 carries daysOwed: 5 and full placement fee', () => {
      const day20 = new Date('2026-06-21T00:00:00.000Z');
      const evalResult = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          eligibility: 'employee_left',
          hasAcceptedReplacement: false,
          dropoutReportedAt: dropoutDate,
          clockPaused: false,
          clockPausedAt: null,
          placementFee,
          hasExistingRefund: false,
        },
        day20,
      );

      expect(evalResult.eligible).toBe(true);
      expect(evalResult.amountPaise).toBe(placementFee);
      expect(evalResult.daysOwed).toBe(5);
      expect(evalResult.daysElapsed).toBe(20);
    });

    it('placement with business_breach or accepted replacement never appears', () => {
      const day20 = new Date('2026-06-21T00:00:00.000Z');

      const breachResult = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          eligibility: 'business_breach',
          hasAcceptedReplacement: false,
          dropoutReportedAt: dropoutDate,
          clockPaused: false,
          clockPausedAt: null,
          placementFee,
          hasExistingRefund: false,
        },
        day20,
      );
      expect(breachResult.eligible).toBe(false);
      expect(breachResult.ineligibleReason).toContain('business_breach');

      const replacementAcceptedResult = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          eligibility: 'employee_left',
          hasAcceptedReplacement: true,
          dropoutReportedAt: dropoutDate,
          clockPaused: false,
          clockPausedAt: null,
          placementFee,
          hasExistingRefund: false,
        },
        day20,
      );
      expect(replacementAcceptedResult.eligible).toBe(false);
      expect(replacementAcceptedResult.ineligibleReason).toContain('replacement candidate has been accepted');
    });

    it('placement disappears once refunded', () => {
      const day20 = new Date('2026-06-21T00:00:00.000Z');
      const evalResult = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          eligibility: 'employee_left',
          hasAcceptedReplacement: false,
          dropoutReportedAt: dropoutDate,
          clockPaused: false,
          clockPausedAt: null,
          placementFee,
          hasExistingRefund: true,
        },
        day20,
      );
      expect(evalResult.eligible).toBe(false);
      expect(evalResult.ineligibleReason).toContain('A refund has already been issued');
    });
  });

  describe('3. Set-Based Listing Query & Sorting Longest-Owed First', () => {
    it('returns both kinds in one response, sorted longest-owed first', async () => {
      // Mock data:
      // JS 1: paid 40 days ago (owed for 10 days) -> daysOwed: 10
      // JS 2: paid 32 days ago (owed for 2 days) -> daysOwed: 2
      // PL 1: dropout 35 days ago (owed for 20 days) -> daysOwed: 20
      // PL 2: dropout 16 days ago (owed for 1 day) -> daysOwed: 1

      const js1Payment = new Date(serverNow.getTime() - 40 * 24 * 60 * 60 * 1000);
      const js2Payment = new Date(serverNow.getTime() - 32 * 24 * 60 * 60 * 1000);

      const pl1Dropout = new Date(serverNow.getTime() - 35 * 24 * 60 * 60 * 1000);
      const pl2Dropout = new Date(serverNow.getTime() - 16 * 24 * 60 * 60 * 1000);

      mockPrisma.jobSeeker.findMany.mockResolvedValue([
        {
          id: 'js-1',
          code: 'JS-00001',
          city: 'Bengaluru',
          name: 'Ramesh Kumar',
          phone: '9876543210',
          tradeSkill: 'cook',
          paymentReceivedAt: js1Payment,
          status: 'active',
        },
        {
          id: 'js-2',
          code: 'JS-00002',
          city: 'Bengaluru',
          name: 'Suresh Patel',
          phone: '9876543211',
          tradeSkill: 'driver',
          paymentReceivedAt: js2Payment,
          status: 'active',
        },
      ]);

      mockPrisma.jobSeekerHit.findMany.mockResolvedValue([]); // No rejected hits
      mockPrisma.payment.findMany.mockResolvedValue([]); // No existing refunds

      mockPrisma.placement.findMany.mockResolvedValue([
        {
          id: 'pl-1',
          code: 'PL-00001',
          city: 'Bengaluru',
          status: 'dropped_out',
          eligibility: 'employee_left',
          dropoutReportedAt: pl1Dropout,
          dropoutDateCallerSupplied: true,
          joinedDate: new Date('2026-04-01T00:00:00.000Z'),
          placementFee: 2000000,
          clockPaused: false,
          clockPausedAt: null,
          business: { name: 'Acme Hotels', area: 'Koramangala' },
          jobSeeker: { name: 'Worker One', phone: '9123456780' },
          replacementCandidates: [],
        },
        {
          id: 'pl-2',
          code: 'PL-00002',
          city: 'Bengaluru',
          status: 'dropped_out',
          eligibility: 'employee_left',
          dropoutReportedAt: pl2Dropout,
          dropoutDateCallerSupplied: false,
          joinedDate: new Date('2026-05-01T00:00:00.000Z'),
          placementFee: 3000000,
          clockPaused: false,
          clockPausedAt: null,
          business: { name: 'Beta Logistics', area: 'Indiranagar' },
          jobSeeker: { name: 'Worker Two', phone: '9123456781' },
          replacementCandidates: [],
        },
      ]);

      const rows = await refundService.getRefundsDue('ceo-1', serverNow);

      expect(rows).toHaveLength(4);

      // Verify longest-owed first sorting:
      // 1. PL-00001 (daysOwed: 20)
      // 2. JS-00001 (daysOwed: 10)
      // 3. JS-00002 (daysOwed: 2)
      // 4. PL-00002 (daysOwed: 1)
      expect(rows[0].code).toBe('PL-00001');
      expect(rows[0].type).toBe('placement');
      expect(rows[0].daysOwed).toBe(20);
      expect(rows[0].amount).toBe(2000000);
      expect(rows[0].dropoutDateCallerSupplied).toBe(true);

      expect(rows[1].code).toBe('JS-00001');
      expect(rows[1].type).toBe('job_seeker');
      expect(rows[1].daysOwed).toBe(10);
      expect(rows[1].amount).toBe(49900);

      expect(rows[2].code).toBe('JS-00002');
      expect(rows[2].type).toBe('job_seeker');
      expect(rows[2].daysOwed).toBe(2);
      expect(rows[2].amount).toBe(49900);

      expect(rows[3].code).toBe('PL-00002');
      expect(rows[3].type).toBe('placement');
      expect(rows[3].daysOwed).toBe(1);
      expect(rows[3].amount).toBe(3000000);
      expect(rows[3].dropoutDateCallerSupplied).toBe(false);

      // Proves no N+1: exactly 1 findMany for candidates, 1 for hits, 1 for placements, and 2 for payments
      expect(mockPrisma.jobSeeker.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.jobSeekerHit.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.placement.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payment.findMany).toHaveBeenCalledTimes(2);
    });

    it('excludes candidate with offer_rejected hit via set-based query', async () => {
      const jsPayment = new Date(serverNow.getTime() - 40 * 24 * 60 * 60 * 1000);

      mockPrisma.jobSeeker.findMany.mockResolvedValue([
        {
          id: 'js-1',
          code: 'JS-00001',
          city: 'Bengaluru',
          name: 'Rejecting Candidate',
          phone: '9876543210',
          tradeSkill: 'cook',
          paymentReceivedAt: jsPayment,
          status: 'active',
        },
      ]);

      // Set-based query finds an offer_rejected hit
      mockPrisma.jobSeekerHit.findMany.mockResolvedValue([
        { jobSeekerId: 'js-1' },
      ]);
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.placement.findMany.mockResolvedValue([]);

      const rows = await refundService.getRefundsDue('ceo-1', serverNow);
      expect(rows).toHaveLength(0);
    });

    it('excludes already refunded placement via set-based query', async () => {
      const plDropout = new Date(serverNow.getTime() - 25 * 24 * 60 * 60 * 1000);

      mockPrisma.placement.findMany.mockResolvedValue([
        {
          id: 'pl-1',
          code: 'PL-00001',
          city: 'Bengaluru',
          status: 'dropped_out',
          eligibility: 'employee_left',
          dropoutReportedAt: plDropout,
          dropoutDateCallerSupplied: false,
          joinedDate: new Date('2026-04-01T00:00:00.000Z'),
          placementFee: 2000000,
          clockPaused: false,
          clockPausedAt: null,
          business: { name: 'Acme Hotels', area: 'Koramangala' },
          jobSeeker: { name: 'Worker One', phone: '9123456780' },
          replacementCandidates: [],
        },
      ]);

      mockPrisma.payment.findMany.mockResolvedValue([
        { placementId: 'pl-1' }, // Already refunded
      ]);
      mockPrisma.jobSeeker.findMany.mockResolvedValue([]);

      const rows = await refundService.getRefundsDue('ceo-1', serverNow);
      expect(rows).toHaveLength(0);
    });
  });

  describe('4. Finance PII Masking Interceptor', () => {
    it('masks candidate and contact phone numbers for finance role', () => {
      const rawRows = [
        {
          type: 'job_seeker',
          code: 'JS-00001',
          amount: 49900,
          daysOwed: 5,
          phone: '9876543210',
          jobSeeker: {
            code: 'JS-00001',
            phone: '9876543210',
          },
        },
        {
          type: 'placement',
          code: 'PL-00001',
          amount: 2500000,
          daysOwed: 10,
          candidatePhone: '9123456789',
          placement: {
            code: 'PL-00001',
            candidatePhone: '9123456789',
          },
        },
      ];

      const masked = maskPii(rawRows);

      expect(masked[0].phone).toBe('********');
      expect(masked[0].jobSeeker?.phone).toBe('********');
      expect(masked[0].amount).toBe(49900);
      expect(masked[0].code).toBe('JS-00001');

      expect(masked[1].candidatePhone).toBe('********');
      expect(masked[1].placement?.candidatePhone).toBe('********');
      expect(masked[1].amount).toBe(2500000);
      expect(masked[1].code).toBe('PL-00001');
    });
  });

  describe('5. Access Control & Validation', () => {
    it('throws NotFoundException if staff actor is not found', async () => {
      await expect(
        refundService.getRefundsDue('unknown-actor', serverNow),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

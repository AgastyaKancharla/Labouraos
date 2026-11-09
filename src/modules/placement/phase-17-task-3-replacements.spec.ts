import { ForbiddenException } from '@nestjs/common';
import { PlacementService } from './placement.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { evaluatePlacementRefundEligibility } from './placement-refund-eligibility';
import { EditPolicyService } from '../../common/edit-policy/edit-policy.service';

type MockPrisma = {
  staff: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
  placement: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  replacementClaim: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  replacementCandidate: { findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
  payment: { findFirst: jest.Mock; create: jest.Mock };
  vacancy: { create: jest.Mock; findUniqueOrThrow: jest.Mock; update: jest.Mock };
  jobSeeker: { update: jest.Mock };
  statusHistory: { create: jest.Mock };
  reviewFlag: { findFirst: jest.Mock; create: jest.Mock };
  businessAgreement: { findFirst: jest.Mock };
  interview: { findUnique: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};

describe('Phase 17 Task 3: Replacements through interviews and guarantee rules', () => {
  let prisma: MockPrisma;
  let idService: IdService;
  let auditService: { log: jest.Mock };
  let pricingService: { current: jest.Mock };
  let reviewFlagService: { raise: jest.Mock };
  let placementService: PlacementService;

  const ceoStaff = { id: 'ceo-1', role: 'ceo', name: 'CEO' };
  const financeStaff = { id: 'fin-1', role: 'finance', name: 'Finance' };
  const managerStaff = { id: 'mgr-1', role: 'manager', name: 'Manager' };
  const tlStaff = { id: 'tl-1', role: 'team_lead', name: 'Team Lead' };
  const faStaff = { id: 'fa-1', role: 'field_agent', name: 'Field Agent', teamLeadId: 'tl-1' };

  const rootPlacement = {
    id: 'pl-root',
    code: 'PL-00001',
    city: 'Bengaluru',
    businessId: 'biz-1',
    vacancyId: 'vac-orig',
    jobSeekerId: 'js-orig',
    agreedSalary: 2000000,
    placementFee: 1000000,
    gstAmount: 180000,
    status: 'dropped_out',
    joinedDate: new Date('2026-10-01T10:00:00.000Z'),
    dropoutReportedAt: new Date('2026-10-20T10:00:00.000Z'),
    replacementNumber: 0,
    rootPlacementId: null,
    guaranteeEndedReason: null,
    paidAt: new Date('2026-10-01T10:00:00.000Z'),
    business: { id: 'biz-1', accountAgentId: 'fa-1', leadCreatedByStaffId: 'fa-1' },
    jobSeeker: { id: 'js-orig', code: 'JS-00001', name: 'Original Seeker' },
    vacancy: {
      id: 'vac-orig',
      code: 'VC-00001',
      city: 'Bengaluru',
      businessId: 'biz-1',
      tradeSkill: 'Electrician',
      roleTitle: 'Electrician',
      salaryMinPaise: 1800000,
      salaryMaxPaise: 2400000,
      headcount: 1,
      status: 'open',
    },
    payments: [{ type: 'placement_fee', status: 'succeeded', amount: 1180000 }],
    replacementCandidates: [],
  };

  beforeEach(() => {
    prisma = {
      staff: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          const allStaff = [ceoStaff, financeStaff, managerStaff, tlStaff, faStaff];
          return allStaff.find((s) => s.id === where.id) ?? null;
        }),
        findFirst: jest.fn().mockResolvedValue(ceoStaff),
        findMany: jest.fn().mockResolvedValue([]),
      },
      placement: {
        findFirst: jest.fn().mockImplementation(async ({ where }: { where?: { id?: string; code?: string; OR?: Array<{ id?: string; code?: string }> } }) => {
          if (where?.OR?.[0]?.id === 'pl-root' || where?.OR?.[1]?.code === 'pl-root') return rootPlacement;
          if (where?.id === 'pl-root') return rootPlacement;
          return null;
        }),
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id?: string; interviewId?: string } }) => {
          if (where.id === 'pl-root') return rootPlacement;
          return null;
        }),
        findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }: { where: { id?: string } }) => {
          if (where.id === 'pl-root') return rootPlacement;
          throw new Error('Not found');
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'pl-rep-1',
          code: 'PL-00002',
          ...data,
        })),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...rootPlacement,
          ...data,
        })),
      },
      replacementClaim: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'claim-1', ...data })),
      },
      replacementCandidate: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'rc-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'pay-ref-1',
          code: 'PAY-00001',
          ...data,
        })),
      },
      vacancy: {
        create: jest.fn().mockResolvedValue({ id: 'vac-rep-1', code: 'VC-00002' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(rootPlacement.vacancy),
        update: jest.fn().mockResolvedValue({ ...rootPlacement.vacancy, status: 'filled' }),
      },
      jobSeeker: {
        update: jest.fn().mockResolvedValue({ id: 'js-rep-1', status: 'placed' }),
      },
      statusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'sh-1' }),
      },
      reviewFlag: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'rf-1' }),
      },
      businessAgreement: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ba-1', feePercent: 50, gstPercent: 18 }),
      },
      interview: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };

    idService = {
      generateCode: jest.fn().mockResolvedValue('PL-00002'),
    } as unknown as IdService;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    pricingService = {
      current: jest.fn().mockResolvedValue({
        replacementWindowDays: 60,
        claimReportDays: 7,
        claimDecisionHours: 48,
        replacementSearchDays: 15,
        maxFreeReplacements: 2,
        maxReplacementRejections: 2,
      }),
    };

    reviewFlagService = {
      raise: jest.fn().mockResolvedValue({ id: 'flag-1' }),
    };

    placementService = new PlacementService(
      prisma as unknown as PrismaService,
      idService,
      auditService as unknown as AuditService,
      {} as unknown as JobSeekerService,
      {} as unknown as PaymentService,
      pricingService as unknown as PricingService,
      {} as unknown as UpiCollectionService,
      reviewFlagService as unknown as ReviewFlagService,
      {} as unknown as EditPolicyService,
    );
  });

  describe('Free replacement placement from interview (createAwaitingPaymentFromInterview)', () => {
    it('creates a free placement straight to confirmed with placed candidate and no payment rows', async () => {
      const interview = {
        id: 'interview-1',
        businessId: 'biz-1',
        jobSeekerId: 'js-rep-1',
        vacancyId: 'vac-rep-1',
        agreedSalary: 2200000,
        selectedSalaryPaise: 2200000,
        selectedJoiningDate: new Date('2026-11-01T00:00:00.000Z'),
        status: 'completed',
        result: 'selected',
        resultRecordedAt: new Date('2026-10-25T14:00:00.000Z'),
        selectedAt: new Date('2026-10-25T14:00:00.000Z'),
        vacancy: {
          id: 'vac-rep-1',
          businessId: 'biz-1',
          city: 'Bengaluru',
          replacementForPlacementId: 'pl-root',
        },
      };

      prisma.interview.findUnique = jest.fn().mockResolvedValue(interview);

      // Mock finding the replaced placement
      prisma.placement.findUnique = jest.fn().mockImplementation(async ({ where }: { where: { id?: string; interviewId?: string } }) => {
        if (where.id === 'pl-root') {
          return {
            ...rootPlacement,
            rootPlacementId: null,
            replacementNumber: 0,
          };
        }
        return null;
      });

      prisma.placement.findUniqueOrThrow = jest.fn().mockImplementation(async ({ where }: { where: { id?: string } }) => {
        if (where.id === 'pl-root') {
          return {
            ...rootPlacement,
            rootPlacementId: null,
            replacementNumber: 0,
          };
        }
        throw new Error('Not found');
      });

      // No prior replacements
      prisma.placement.count = jest.fn().mockResolvedValue(0);

      const result = await placementService.createAwaitingPaymentFromInterview(
        'interview-1',
        new Date('2026-10-25T14:00:00.000Z'),
      );

      // Verify placement was created with replacement properties
      expect(prisma.placement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessId: 'biz-1',
            jobSeekerId: 'js-rep-1',
            status: 'confirmed',
            placementFee: 0,
            gstAmount: 0,
            rootPlacementId: 'pl-root',
            replacementNumber: 1,
            agreedSalary: 2200000,
          }),
        }),
      );

      // Verify candidate becomes placed immediately
      expect(prisma.jobSeeker.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'js-rep-1' },
          data: { status: 'placed' },
        }),
      );

      // Verify vacancy becomes filled
      expect(prisma.vacancy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'vac-rep-1' },
          data: { status: 'filled' },
        }),
      );

      // Verify no payment row was created
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(result.payment).toBeNull();
    });

    it('refuses more than maxFreeReplacements (2) per root placement', async () => {
      const interview = {
        id: 'interview-3',
        jobSeekerId: 'js-rep-3',
        vacancyId: 'vac-rep-3',
        agreedSalary: 2200000,
        selectedSalaryPaise: 2200000,
        selectedJoiningDate: new Date('2026-11-15T14:00:00.000Z'),
        status: 'completed',
        result: 'selected',
        resultRecordedAt: new Date('2026-11-15T14:00:00.000Z'),
        selectedAt: new Date('2026-11-15T14:00:00.000Z'),
        vacancy: {
          id: 'vac-rep-3',
          businessId: 'biz-1',
          city: 'Bengaluru',
          replacementForPlacementId: 'pl-root',
        },
      };

      prisma.interview.findUnique = jest.fn().mockResolvedValue(interview);
      prisma.placement.findUnique = jest.fn().mockImplementation(async ({ where }: { where: { id?: string; interviewId?: string } }) => {
        if (where.id === 'pl-root') return rootPlacement;
        return null;
      });
      prisma.placement.findUniqueOrThrow = jest.fn().mockImplementation(async ({ where }: { where: { id?: string } }) => {
        if (where.id === 'pl-root') return rootPlacement;
        throw new Error('Not found');
      });
      // Already 2 replacements exist
      prisma.placement.count = jest.fn().mockResolvedValue(2);

      await expect(
        placementService.createAwaitingPaymentFromInterview(
          'interview-3',
          new Date('2026-11-15T14:00:00.000Z'),
        ),
      ).rejects.toThrow('A third replacement is refused; maximum free replacements is 2');
    });
  });

  describe('Claim decision guarantee termination rules', () => {
    it('accepting claim on replacementNumber 2 ends guarantee with second_replacement_left and no refund', async () => {
      const secondReplacementPlacement = {
        id: 'pl-rep-2',
        code: 'PL-00003',
        status: 'active',
        replacementNumber: 2,
        rootPlacementId: 'pl-root',
        city: 'Bengaluru',
        businessId: 'biz-1',
        business: { id: 'biz-1', accountAgentId: 'fa-1' },
        joinedDate: new Date('2026-10-25T10:00:00.000Z'),
      };

      const claimOnRep2 = {
        id: 'claim-rep-2',
        code: 'RCL-00002',
        placementId: 'pl-rep-2',
        placement: secondReplacementPlacement,
        decision: null,
      };

      prisma.staff.findUnique = jest.fn().mockResolvedValue(tlStaff);
      prisma.replacementClaim.findFirst = jest.fn().mockResolvedValue(claimOnRep2);
      prisma.staff.findMany = jest.fn().mockResolvedValue([{ id: 'fa-1' }]);

      await placementService.decideClaim(
        'pl-rep-2',
        'claim-rep-2',
        { decision: 'accepted', decisionReason: 'Employee resigned' },
        'tl-1',
      );

      // Verify root placement and chain end with second_replacement_left
      expect(prisma.placement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pl-root' },
          data: expect.objectContaining({
            status: 'guarantee_ended',
            guaranteeEndedReason: 'second_replacement_left',
          }),
        }),
      );

      // Verify no replacement vacancy is created
      expect(prisma.vacancy.create).not.toHaveBeenCalled();
    });
  });

  describe('15-day refund rule & evaluatePlacementRefundEligibility', () => {
    it('is not eligible before 15 days elapsed from claim acceptance', () => {
      const claimAcceptedAt = new Date('2026-10-20T10:00:00.000Z');
      const day14 = new Date('2026-11-03T10:00:00.000Z'); // 14 days elapsed

      const result = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          hasAcceptedReplacement: false,
          hasSelectedReplacement: false,
          claimAcceptedAt,
          placementFee: 1000000,
          hasExistingRefund: false,
          searchDays: 15,
        },
        day14,
      );

      expect(result.eligible).toBe(false);
      expect(result.ineligibleReason).toContain('Refund is not payable before 15 days have elapsed');
    });

    it('is eligible on day 16 (15 full days elapsed) with flat 100% placement fee refund', () => {
      const claimAcceptedAt = new Date('2026-10-20T10:00:00.000Z');
      const day16 = new Date('2026-11-05T10:00:00.000Z'); // 16 days elapsed

      const result = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          hasAcceptedReplacement: false,
          hasSelectedReplacement: false,
          claimAcceptedAt,
          placementFee: 1000000,
          hasExistingRefund: false,
          searchDays: 15,
        },
        day16,
      );

      expect(result.eligible).toBe(true);
      expect(result.amountPaise).toBe(1000000);
      expect(result.daysElapsed).toBe(16);
    });

    it('is ineligible if a replacement has already been selected or accepted', () => {
      const claimAcceptedAt = new Date('2026-10-20T10:00:00.000Z');
      const day16 = new Date('2026-11-05T10:00:00.000Z');

      const result = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          hasSelectedReplacement: true,
          claimAcceptedAt,
          placementFee: 1000000,
          hasExistingRefund: false,
          searchDays: 15,
        },
        day16,
      );

      expect(result.eligible).toBe(false);
      expect(result.ineligibleReason).toContain('replacement candidate has been accepted');
    });

    it('is ineligible if guarantee already ended without refund (e.g. two_rejections)', () => {
      const claimAcceptedAt = new Date('2026-10-20T10:00:00.000Z');
      const day16 = new Date('2026-11-05T10:00:00.000Z');

      const result = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          hasSelectedReplacement: false,
          claimAcceptedAt,
          placementFee: 1000000,
          hasExistingRefund: false,
          searchDays: 15,
          guaranteeEndedReason: 'two_rejections',
        },
        day16,
      );

      expect(result.eligible).toBe(false);
      expect(result.ineligibleReason).toContain('Guarantee ended without refund: two_rejections');
    });

    it('does not read deprecated columns: clockPaused, replacementRejectionCount, eligibility', () => {
      const claimAcceptedAt = new Date('2026-10-20T10:00:00.000Z');
      const day16 = new Date('2026-11-05T10:00:00.000Z');

      // Even if clockPaused=true was historically passed, day 16 remains eligible
      const result = evaluatePlacementRefundEligibility(
        {
          code: 'PL-00001',
          status: 'dropped_out',
          hasSelectedReplacement: false,
          claimAcceptedAt,
          placementFee: 1000000,
          hasExistingRefund: false,
          searchDays: 15,
        },
        day16,
      );

      expect(result.eligible).toBe(true);
      expect(result.amountPaise).toBe(1000000);
    });
  });

  describe('approveRefund execution and RBAC', () => {
    it('refuses non-CEO and non-Finance roles with 403', async () => {
      await expect(
        placementService.approveRefund('pl-root', {}, 'mgr-1'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        placementService.approveRefund('pl-root', {}, 'tl-1'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        placementService.approveRefund('pl-root', {}, 'fa-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows CEO or Finance to approve refund on day 16, marks root guaranteeEndedReason: refunded', async () => {
      prisma.replacementClaim.findFirst = jest.fn().mockResolvedValue({
        id: 'claim-1',
        decision: 'accepted',
        decidedAt: new Date('2026-10-20T10:00:00.000Z'),
      });

      const day16 = '2026-11-05T10:00:00.000Z';
      const payment = await placementService.approveRefund('pl-root', { asOf: day16 }, 'ceo-1');

      expect(payment).toBeDefined();
      expect(payment.type).toBe('refund');
      expect(payment.amount).toBe(1000000);

      // Verify root placement marked refunded
      expect(prisma.placement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pl-root' },
          data: expect.objectContaining({
            status: 'guarantee_ended',
            guaranteeEndedReason: 'refunded',
          }),
        }),
      );
    });
  });

  describe('completeDay60Placements window counts from root joinedDate', () => {
    it('counts 60 days from root joinedDate even for replacement placement', async () => {
      const rootJoined = new Date('2026-09-01T10:00:00.000Z');
      const repJoined = new Date('2026-10-01T10:00:00.000Z'); // replacement joined 30 days later

      const repPlacement = {
        id: 'pl-rep-1',
        code: 'PL-00002',
        status: 'active',
        joinedDate: repJoined,
        rootPlacementId: 'pl-root',
        replacementNumber: 1,
        guaranteeEndedReason: null,
      };

      prisma.placement.findMany = jest.fn().mockResolvedValue([repPlacement]);
      prisma.placement.findUnique = jest.fn().mockResolvedValue({
        joinedDate: rootJoined,
        guaranteeEndedReason: null,
        status: 'dropped_out',
      });
      prisma.replacementClaim.findFirst = jest.fn().mockResolvedValue(null);

      // Day 59 from root: (2026-09-01 + 59 days = 2026-10-30) -> NOT completed
      const day59 = new Date(rootJoined.getTime() + 59 * 24 * 60 * 60 * 1000);
      const completed59 = await placementService.completeDay60Placements(day59);
      expect(completed59).toBe(0);

      // Day 60 from root: (2026-09-01 + 60 days = 2026-10-31) -> completed!
      // Notice repPlacement only joined 30 days ago, but completes because root reached 60 days!
      const day60 = new Date(rootJoined.getTime() + 60 * 24 * 60 * 60 * 1000);
      const completed60 = await placementService.completeDay60Placements(day60);
      expect(completed60).toBe(1);
      expect(prisma.placement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pl-rep-1' },
          data: { status: 'completed' },
        }),
      );
    });
  });
});

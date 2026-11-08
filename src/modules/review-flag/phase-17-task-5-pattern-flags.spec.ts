import { PatternFlagService } from './pattern-flag.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from './review-flag.service';

type MockPrisma = {
  business: {
    findMany: jest.Mock;
  };
  interview: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  vacancy: {
    findFirst: jest.Mock;
  };
  placement: {
    findFirst: jest.Mock;
  };
  staff: {
    findMany: jest.Mock;
  };
  reviewFlag: {
    findFirst: jest.Mock;
  };
};

describe('Phase 17 Task 5: Pattern flags', () => {
  let service: PatternFlagService;
  let prisma: MockPrisma;
  let pricingService: PricingService;
  let reviewFlagService: ReviewFlagService;

  const defaultPolicy = {
    patternWindowDays: 60,
    patternBusinessMinInterviews: 5,
    patternStopDays: 30,
    patternAgentMinInterviews: 10,
    patternAgentRejectionPercent: 80,
  };

  const sampleBusiness = {
    id: 'bz-1',
    code: 'BZ-00001',
    name: 'Logistics Co',
    accountAgentId: 'fa-1',
  };

  const sampleAgent = {
    id: 'fa-1',
    code: 'FA-00001',
    name: 'Field Agent 1',
    role: 'field_agent',
    teamLeadId: 'tl-1',
  };

  beforeEach(() => {
    prisma = {
      business: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      interview: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vacancy: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      placement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      staff: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      reviewFlag: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    pricingService = {
      current: jest.fn().mockResolvedValue(defaultPolicy),
    } as unknown as PricingService;

    reviewFlagService = {
      raise: jest.fn().mockResolvedValue({ id: 'flag-1', code: 'FL-00001' }),
    } as unknown as ReviewFlagService;

    service = new PatternFlagService(
      prisma as unknown as PrismaService,
      pricingService,
      reviewFlagService,
    );
  });

  describe('1. business_many_rejections', () => {
    it('fires at threshold: patternBusinessMinInterviews (5) with none selected', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      // 5 interviews with result not_selected
      prisma.interview.findMany.mockResolvedValue([
        { id: 'int-1', result: 'not_selected' },
        { id: 'int-2', result: 'not_selected' },
        { id: 'int-3', result: 'not_selected' },
        { id: 'int-4', result: 'not_selected' },
        { id: 'int-5', result: 'not_selected' },
      ]);

      const raised = await service.evaluateBusinessManyRejections(now, defaultPolicy);

      expect(raised).toBe(1);
      expect(reviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'business_many_rejections',
          subjectType: 'business',
          subjectId: sampleBusiness.id,
          raisedForStaffId: sampleBusiness.accountAgentId,
        }),
      );
    });

    it('does NOT fire one below threshold (4 interviews)', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      prisma.interview.findMany.mockResolvedValue([
        { id: 'int-1', result: 'not_selected' },
        { id: 'int-2', result: 'not_selected' },
        { id: 'int-3', result: 'not_selected' },
        { id: 'int-4', result: 'not_selected' },
      ]);

      const raised = await service.evaluateBusinessManyRejections(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });

    it('does NOT fire if at least one candidate was selected', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      prisma.interview.findMany.mockResolvedValue([
        { id: 'int-1', result: 'not_selected' },
        { id: 'int-2', result: 'not_selected' },
        { id: 'int-3', result: 'not_selected' },
        { id: 'int-4', result: 'not_selected' },
        { id: 'int-5', result: 'selected' },
      ]);

      const raised = await service.evaluateBusinessManyRejections(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });

    it('does NOT duplicate an existing open flag on a second run', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      prisma.reviewFlag.findFirst.mockResolvedValue({ id: 'existing-flag', status: 'open' });

      const raised = await service.evaluateBusinessManyRejections(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });

    it('threshold comes from PricingPolicy', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      const customPolicy = { patternWindowDays: 60, patternBusinessMinInterviews: 3 };
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      prisma.interview.findMany.mockResolvedValue([
        { id: 'int-1', result: 'not_selected' },
        { id: 'int-2', result: 'not_selected' },
        { id: 'int-3', result: 'not_selected' },
      ]);

      const raised = await service.evaluateBusinessManyRejections(now, customPolicy);

      expect(raised).toBe(1);
      expect(reviewFlagService.raise).toHaveBeenCalled();
    });
  });

  describe('2. business_stopped_after_interviews', () => {
    it('fires at threshold: patternStopDays (30) with no new vacancy and no paid placement', async () => {
      const lastInterviewDate = new Date('2026-10-01T10:00:00.000Z');
      const now = new Date('2026-10-31T11:00:00.000Z'); // 30 days later

      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      prisma.interview.findFirst.mockResolvedValue({
        id: 'int-last',
        slotStartsAt: lastInterviewDate,
        createdAt: lastInterviewDate,
      });
      prisma.vacancy.findFirst.mockResolvedValue(null);
      prisma.placement.findFirst.mockResolvedValue(null);

      const raised = await service.evaluateBusinessStoppedAfterInterviews(now, defaultPolicy);

      expect(raised).toBe(1);
      expect(reviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'business_stopped_after_interviews',
          subjectType: 'business',
          subjectId: sampleBusiness.id,
          raisedForStaffId: sampleBusiness.accountAgentId,
        }),
      );
    });

    it('does NOT fire one day below threshold (29 days)', async () => {
      const lastInterviewDate = new Date('2026-10-01T10:00:00.000Z');
      const now = new Date('2026-10-30T10:00:00.000Z'); // 29 days later

      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      prisma.interview.findFirst.mockResolvedValue({
        id: 'int-last',
        slotStartsAt: lastInterviewDate,
        createdAt: lastInterviewDate,
      });

      const raised = await service.evaluateBusinessStoppedAfterInterviews(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });

    it('does NOT fire if new vacancy was created after the last interview', async () => {
      const lastInterviewDate = new Date('2026-10-01T10:00:00.000Z');
      const now = new Date('2026-10-31T11:00:00.000Z');

      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      prisma.interview.findFirst.mockResolvedValue({
        id: 'int-last',
        slotStartsAt: lastInterviewDate,
        createdAt: lastInterviewDate,
      });
      // New vacancy exists
      prisma.vacancy.findFirst.mockResolvedValue({ id: 'vac-new' });

      const raised = await service.evaluateBusinessStoppedAfterInterviews(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });

    it('does NOT fire if a placement was paid in between', async () => {
      const lastInterviewDate = new Date('2026-10-01T10:00:00.000Z');
      const now = new Date('2026-10-31T11:00:00.000Z');

      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      prisma.interview.findFirst.mockResolvedValue({
        id: 'int-last',
        slotStartsAt: lastInterviewDate,
        createdAt: lastInterviewDate,
      });
      prisma.vacancy.findFirst.mockResolvedValue(null);
      // Paid placement exists
      prisma.placement.findFirst.mockResolvedValue({ id: 'pl-paid' });

      const raised = await service.evaluateBusinessStoppedAfterInterviews(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });

    it('does NOT duplicate an existing open flag on a second run', async () => {
      const now = new Date('2026-10-31T11:00:00.000Z');
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);
      prisma.reviewFlag.findFirst.mockResolvedValue({ id: 'existing-flag', status: 'open' });

      const raised = await service.evaluateBusinessStoppedAfterInterviews(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });
  });

  describe('3. agent_rejection_pattern', () => {
    it('fires at threshold: patternAgentMinInterviews (10) results with >= 80% rejection', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      prisma.staff.findMany.mockResolvedValue([sampleAgent]);
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);

      // 10 interviews: 8 not_selected (80%), 2 selected (20%)
      const interviews = [
        ...Array(8).fill({ id: 'int-ns', result: 'not_selected' }),
        ...Array(2).fill({ id: 'int-s', result: 'selected' }),
      ];
      prisma.interview.findMany.mockResolvedValue(interviews);

      const raised = await service.evaluateAgentRejectionPattern(now, defaultPolicy);

      expect(raised).toBe(1);
      expect(reviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'agent_rejection_pattern',
          subjectType: 'staff',
          subjectId: sampleAgent.id,
          raisedForStaffId: sampleAgent.teamLeadId,
        }),
      );
    });

    it('does NOT fire one interview below threshold (9 interviews)', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      prisma.staff.findMany.mockResolvedValue([sampleAgent]);
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);

      // 9 interviews: all not_selected (100%), but count is 9 < 10
      const interviews = Array(9).fill({ id: 'int-ns', result: 'not_selected' });
      prisma.interview.findMany.mockResolvedValue(interviews);

      const raised = await service.evaluateAgentRejectionPattern(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });

    it('does NOT fire below rejection percent threshold (70% < 80%)', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      prisma.staff.findMany.mockResolvedValue([sampleAgent]);
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);

      // 10 interviews: 7 not_selected (70%), 3 selected (30%)
      const interviews = [
        ...Array(7).fill({ id: 'int-ns', result: 'not_selected' }),
        ...Array(3).fill({ id: 'int-s', result: 'selected' }),
      ];
      prisma.interview.findMany.mockResolvedValue(interviews);

      const raised = await service.evaluateAgentRejectionPattern(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });

    it('does NOT duplicate an open flag on a second run', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      prisma.staff.findMany.mockResolvedValue([sampleAgent]);
      prisma.reviewFlag.findFirst.mockResolvedValue({ id: 'existing-flag', status: 'open' });

      const raised = await service.evaluateAgentRejectionPattern(now, defaultPolicy);

      expect(raised).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });

    it('thresholds come from PricingPolicy', async () => {
      const now = new Date('2026-11-01T10:00:00.000Z');
      const customPolicy = {
        patternWindowDays: 60,
        patternAgentMinInterviews: 5,
        patternAgentRejectionPercent: 60,
      };

      prisma.staff.findMany.mockResolvedValue([sampleAgent]);
      prisma.business.findMany.mockResolvedValue([sampleBusiness]);

      // 5 interviews: 3 not_selected (60%), 2 selected (40%)
      const interviews = [
        ...Array(3).fill({ id: 'int-ns', result: 'not_selected' }),
        ...Array(2).fill({ id: 'int-s', result: 'selected' }),
      ];
      prisma.interview.findMany.mockResolvedValue(interviews);

      const raised = await service.evaluateAgentRejectionPattern(now, customPolicy);

      expect(raised).toBe(1);
      expect(reviewFlagService.raise).toHaveBeenCalled();
    });
  });
});

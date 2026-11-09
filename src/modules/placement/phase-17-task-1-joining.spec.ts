import { BadRequestException } from '@nestjs/common';
import { PlacementService } from './placement.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { EditPolicyService } from '../../common/edit-policy/edit-policy.service';

type MockPrisma = {
  staff: Record<string, jest.Mock>;
  placement: Record<string, jest.Mock>;
  callRecord: Record<string, jest.Mock>;
  statusHistory: Record<string, jest.Mock>;
  replacementClaim: Record<string, jest.Mock>;
  $transaction: jest.Mock;
};

describe('Phase 17 Task 1: Joining Confirmed by Calls & Day 60 Completion', () => {
  let prisma: MockPrisma;
  let idService: IdService;
  let auditService: { log: jest.Mock };
  let pricingService: { current: jest.Mock };
  let paymentService: { createReferralPayout: jest.Mock };
  let placementService: PlacementService;

  const staffActor = {
    id: 'staff-call-agent-1',
    role: 'call_agent',
    name: 'Call Agent 1',
  };

  const joiningDate = new Date('2026-11-10T10:00:00.000Z');

  const basePlacement = {
    id: 'pl-12345',
    code: 'PL-00001',
    city: 'Bengaluru',
    status: 'confirmed',
    joiningDate,
    joinedDate: null,
    jobSeekerId: 'js-100',
    businessId: 'bz-200',
    rootPlacementId: 'pl-12345',
    replacementNumber: 0,
    guaranteeEndedReason: null,
    business: { id: 'bz-200', accountAgentId: 'fa-1' },
    jobSeeker: { id: 'js-100', referredById: 'ref-partner-1' },
    vacancy: { id: 'vc-1' },
    joiningWorkerCallId: null,
    joiningBusinessCallId: null,
  };

  beforeEach(() => {
    prisma = {
      staff: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          if (where.id === staffActor.id) return staffActor;
          return null;
        }),
        findFirst: jest.fn().mockResolvedValue({ id: 'staff-ceo-1', role: 'ceo' }),
      },
      placement: {
        findFirst: jest.fn().mockResolvedValue(basePlacement),
        findUnique: jest.fn().mockResolvedValue(basePlacement),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...basePlacement,
          ...data,
        })),
      },
      callRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      statusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'sh-1' }),
      },
      replacementClaim: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };

    idService = {
      generateCode: jest.fn().mockResolvedValue('AUD-00001'),
    } as unknown as IdService;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    pricingService = {
      current: jest.fn().mockResolvedValue({
        replacementWindowDays: 60,
      }),
    };

    paymentService = {
      createReferralPayout: jest.fn().mockResolvedValue({ id: 'pay-ref-1' }),
    };

    placementService = new PlacementService(
      prisma as unknown as PrismaService,
      idService,
      auditService as unknown as AuditService,
      {} as unknown as JobSeekerService,
      paymentService as unknown as PaymentService,
      pricingService as unknown as PricingService,
      {} as unknown as UpiCollectionService,
      {} as unknown as ReviewFlagService,
      {} as unknown as EditPolicyService,
    );
  });

  describe('recordJoined', () => {
    it('refuses joining if placement is not in confirmed status', async () => {
      prisma.placement.findFirst.mockResolvedValueOnce({
        ...basePlacement,
        status: 'awaiting_payment',
      });

      await expect(
        placementService.recordJoined('pl-12345', {}, staffActor.id, joiningDate),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses joining before the joining date', async () => {
      const beforeDate = new Date('2026-11-09T18:00:00.000Z');

      await expect(
        placementService.recordJoined('pl-12345', {}, staffActor.id, beforeDate),
      ).rejects.toThrow(/before the joining date/);
    });

    it('refuses joining when both confirmation calls are missing', async () => {
      prisma.callRecord.findFirst.mockResolvedValue(null);

      await expect(
        placementService.recordJoined('pl-12345', {}, staffActor.id, joiningDate),
      ).rejects.toThrow(/Both worker and business joining confirmation calls are missing or unanswered/);
    });

    it('refuses joining when only worker side is confirmed and business call is missing', async () => {
      prisma.callRecord.findFirst.mockImplementation(async ({ where }: { where: { subjectType: string } }) => {
        if (where.subjectType === 'job_seeker') {
          return {
            id: 'call-worker-1',
            answered: true,
            answeredAt: joiningDate,
          };
        }
        return null;
      });

      await expect(
        placementService.recordJoined('pl-12345', {}, staffActor.id, joiningDate),
      ).rejects.toThrow(/Business joining confirmation call is missing or was not answered/);
    });

    it('refuses joining when only business side is confirmed and worker call is missing', async () => {
      prisma.callRecord.findFirst.mockImplementation(async ({ where }: { where: { subjectType: string } }) => {
        if (where.subjectType === 'business') {
          return {
            id: 'call-biz-1',
            answered: true,
            answeredAt: joiningDate,
          };
        }
        return null;
      });

      await expect(
        placementService.recordJoined('pl-12345', {}, staffActor.id, joiningDate),
      ).rejects.toThrow(/Worker joining confirmation call is missing or was not answered/);
    });

    it('refuses joining when a call was unanswered', async () => {
      // Worker answered, but business call was not answered
      prisma.callRecord.findFirst.mockImplementation(async ({ where }: { where: { subjectType: string; answered?: boolean } }) => {
        if (where.subjectType === 'job_seeker' && where.answered) {
          return {
            id: 'call-worker-1',
            answered: true,
            answeredAt: joiningDate,
          };
        }
        // Business call query searches for answered: true, which returns null if unanswered
        return null;
      });

      await expect(
        placementService.recordJoined('pl-12345', {}, staffActor.id, joiningDate),
      ).rejects.toThrow(/Business joining confirmation call is missing or was not answered/);
    });

    it('sets active and joinedDate from the confirmation calls, storing both call IDs', async () => {
      const workerTime = new Date('2026-11-10T10:15:00.000Z');
      const bizTime = new Date('2026-11-10T10:45:00.000Z');

      prisma.callRecord.findFirst.mockImplementation(async ({ where }: { where: { subjectType: string } }) => {
        if (where.subjectType === 'job_seeker') {
          return { id: 'call-worker-100', answered: true, answeredAt: workerTime };
        }
        if (where.subjectType === 'business') {
          return { id: 'call-biz-200', answered: true, answeredAt: bizTime };
        }
        return null;
      });

      const updated = await placementService.recordJoined('pl-12345', {}, staffActor.id, bizTime);

      expect(updated.status).toBe('active');
      expect(updated.joiningWorkerCallId).toBe('call-worker-100');
      expect(updated.joiningBusinessCallId).toBe('call-biz-200');
      expect(updated.joinedDate).toEqual(bizTime);
      expect(paymentService.createReferralPayout).toHaveBeenCalledWith('pl-12345', staffActor.id);
    });

    it('ignores any joinedDate typed by an agent in request DTO', async () => {
      const workerTime = new Date('2026-11-10T11:00:00.000Z');
      const bizTime = new Date('2026-11-10T11:30:00.000Z');

      prisma.callRecord.findFirst.mockImplementation(async ({ where }: { where: { subjectType: string } }) => {
        if (where.subjectType === 'job_seeker') {
          return { id: 'call-w-1', answered: true, answeredAt: workerTime };
        }
        if (where.subjectType === 'business') {
          return { id: 'call-b-1', answered: true, answeredAt: bizTime };
        }
        return null;
      });

      // Agent typed a fake backdated or future date
      const fakeTypedDate = '2026-10-01T00:00:00.000Z';
      const updated = await placementService.recordJoined(
        'pl-12345',
        { joinedDate: fakeTypedDate },
        staffActor.id,
        bizTime,
      );

      // Must be set to the confirmation call time, NOT the agent-typed date
      expect(updated.joinedDate).toEqual(bizTime);
      expect(updated.joinedDate).not.toEqual(new Date(fakeTypedDate));
    });
  });

  describe('completeDay60Placements (Day 60 Daily Job)', () => {
    it('moves an active placement to completed on day 60 after root joinedDate', async () => {
      const rootJoined = new Date('2026-09-01T10:00:00.000Z');
      const activePlacement = {
        ...basePlacement,
        status: 'active',
        joinedDate: rootJoined,
        rootPlacementId: basePlacement.id,
      };

      prisma.placement.findMany.mockResolvedValueOnce([activePlacement]);

      // Exactly 60 days later
      const day60 = new Date(rootJoined.getTime() + 60 * 24 * 60 * 60 * 1000);
      const count = await placementService.completeDay60Placements(day60);

      expect(count).toBe(1);
      expect(prisma.placement.update).toHaveBeenCalledWith({
        where: { id: activePlacement.id },
        data: { status: 'completed' },
      });
    });

    it('does NOT complete the placement on day 59', async () => {
      const rootJoined = new Date('2026-09-01T10:00:00.000Z');
      const activePlacement = {
        ...basePlacement,
        status: 'active',
        joinedDate: rootJoined,
        rootPlacementId: basePlacement.id,
      };

      prisma.placement.findMany.mockResolvedValueOnce([activePlacement]);

      // 59 days later
      const day59 = new Date(rootJoined.getTime() + 59 * 24 * 60 * 60 * 1000);
      const count = await placementService.completeDay60Placements(day59);

      expect(count).toBe(0);
      expect(prisma.placement.update).not.toHaveBeenCalled();
    });

    it('does NOT complete a placement if an open claim exists on it', async () => {
      const rootJoined = new Date('2026-09-01T10:00:00.000Z');
      const activePlacement = {
        ...basePlacement,
        status: 'active',
        joinedDate: rootJoined,
        rootPlacementId: basePlacement.id,
      };

      prisma.placement.findMany.mockResolvedValueOnce([activePlacement]);
      // Open claim exists (decision is null)
      prisma.replacementClaim.findFirst.mockResolvedValueOnce({
        id: 'claim-1',
        placementId: activePlacement.id,
        decision: null,
      });

      const day60 = new Date(rootJoined.getTime() + 60 * 24 * 60 * 60 * 1000);
      const count = await placementService.completeDay60Placements(day60);

      expect(count).toBe(0);
      expect(prisma.placement.update).not.toHaveBeenCalled();
    });

    it('does NOT complete a placement if its guarantee has ended', async () => {
      const rootJoined = new Date('2026-09-01T10:00:00.000Z');
      const activePlacement = {
        ...basePlacement,
        status: 'active',
        joinedDate: rootJoined,
        rootPlacementId: basePlacement.id,
        guaranteeEndedReason: 'two_rejections',
      };

      prisma.placement.findMany.mockResolvedValueOnce([activePlacement]);

      const day60 = new Date(rootJoined.getTime() + 60 * 24 * 60 * 60 * 1000);
      const count = await placementService.completeDay60Placements(day60);

      expect(count).toBe(0);
      expect(prisma.placement.update).not.toHaveBeenCalled();
    });

    it('counts 60 days from the root placement joinedDate even for replacement placements', async () => {
      const rootJoined = new Date('2026-08-01T10:00:00.000Z');
      const replacementJoined = new Date('2026-09-15T10:00:00.000Z');

      const rootPlacement = {
        ...basePlacement,
        id: 'root-pl-1',
        status: 'dropped_out',
        joinedDate: rootJoined,
      };

      const replacementPlacement = {
        ...basePlacement,
        id: 'rep-pl-2',
        status: 'active',
        rootPlacementId: 'root-pl-1',
        replacementNumber: 1,
        joinedDate: replacementJoined,
      };

      prisma.placement.findMany.mockResolvedValueOnce([replacementPlacement]);
      prisma.placement.findUnique.mockResolvedValueOnce(rootPlacement);

      // On day 60 after ROOT joinedDate (approx Oct 01), which is only ~16 days after replacement joined
      const day60AfterRoot = new Date(rootJoined.getTime() + 60 * 24 * 60 * 60 * 1000);
      const count = await placementService.completeDay60Placements(day60AfterRoot);

      expect(count).toBe(1);
      expect(prisma.placement.update).toHaveBeenCalledWith({
        where: { id: replacementPlacement.id },
        data: { status: 'completed' },
      });
    });

    it('completes the placement once and does not duplicate on repeat runs', async () => {
      const rootJoined = new Date('2026-09-01T10:00:00.000Z');
      const activePlacement = {
        ...basePlacement,
        status: 'active',
        joinedDate: rootJoined,
        rootPlacementId: basePlacement.id,
      };

      prisma.placement.findMany.mockResolvedValueOnce([activePlacement]);

      const day60 = new Date(rootJoined.getTime() + 60 * 24 * 60 * 60 * 1000);
      const firstRunCount = await placementService.completeDay60Placements(day60);
      expect(firstRunCount).toBe(1);

      // On second run, findMany returns no active placements (now completed)
      prisma.placement.findMany.mockResolvedValueOnce([]);
      const secondRunCount = await placementService.completeDay60Placements(day60);
      expect(secondRunCount).toBe(0);
    });
  });
});

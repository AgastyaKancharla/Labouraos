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
  placement: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
  };
  payment: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  replacementClaim: {
    findFirst: jest.Mock;
  };
};

describe('Phase 17 Task 6: Joining reward queue', () => {
  let placementService: PlacementService;
  let prisma: MockPrisma;
  let idService: IdService;
  let auditService: AuditService;
  let pricingService: PricingService;

  const defaultPolicy = {
    joiningRewardPaise: 20000,
    joiningRewardAfterDays: 30,
    replacementWindowDays: 60,
  };

  const samplePlacement = {
    id: 'pl-1',
    code: 'PL-00001',
    city: 'Bengaluru',
    jobSeekerId: 'js-1',
    businessId: 'bz-1',
    status: 'active',
    joinedDate: new Date('2026-10-01T10:00:00.000Z'),
    replacementClaims: [],
  };

  beforeEach(() => {
    prisma = {
      placement: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pay-1', ...data })),
      },
      replacementClaim: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    idService = {
      generateCode: jest.fn().mockResolvedValue('PAY-00001'),
    } as unknown as IdService;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    pricingService = {
      current: jest.fn().mockResolvedValue(defaultPolicy),
    } as unknown as PricingService;

    placementService = new PlacementService(
      prisma as unknown as PrismaService,
      idService,
      auditService,
      {} as JobSeekerService,
      {} as PaymentService,
      pricingService,
      {} as UpiCollectionService,
      {} as ReviewFlagService,
      {} as unknown as EditPolicyService,
    );
  });

  it('queues joining reward on day 30, but NOT on day 29', async () => {
    prisma.placement.findMany.mockResolvedValue([samplePlacement]);

    // Day 29: 29 days elapsed -> not queued
    const day29 = new Date('2026-10-30T10:00:00.000Z');
    const queued29 = await placementService.queueJoiningRewards(day29);
    expect(queued29).toBe(0);
    expect(prisma.payment.create).not.toHaveBeenCalled();

    // Day 30: 30 days elapsed -> queued
    const day30 = new Date('2026-10-31T10:00:00.000Z');
    const queued30 = await placementService.queueJoiningRewards(day30);
    expect(queued30).toBe(1);
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'joining_reward',
        amount: 20000,
        status: 'pending',
        jobSeekerId: 'js-1',
        placementId: 'pl-1',
      }),
    });
  });

  it('does NOT queue joining reward if a claim was accepted before day 30', async () => {
    const placementWithAcceptedClaim = {
      ...samplePlacement,
      replacementClaims: [{ id: 'claim-1', decision: 'accepted' }],
    };
    prisma.placement.findMany.mockResolvedValue([placementWithAcceptedClaim]);

    const day30 = new Date('2026-10-31T10:00:00.000Z');
    const queued = await placementService.queueJoiningRewards(day30);

    expect(queued).toBe(0);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('never queues joining reward twice for the same placement', async () => {
    prisma.placement.findMany.mockResolvedValue([samplePlacement]);
    // Payment already exists
    prisma.payment.findFirst.mockResolvedValue({ id: 'existing-pay', type: 'joining_reward' });

    const day30 = new Date('2026-10-31T10:00:00.000Z');
    const queued = await placementService.queueJoiningRewards(day30);

    expect(queued).toBe(0);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('replacement placement earns reward counted from its own joining date', async () => {
    const replacementPlacement = {
      id: 'pl-rep-1',
      code: 'PL-00002',
      city: 'Bengaluru',
      jobSeekerId: 'js-replacement',
      businessId: 'bz-1',
      rootPlacementId: 'pl-1',
      replacementNumber: 1,
      status: 'active',
      joinedDate: new Date('2026-10-25T10:00:00.000Z'), // Joined later
      replacementClaims: [],
    };
    prisma.placement.findMany.mockResolvedValue([replacementPlacement]);

    // On day 30 of root (Oct 31): replacement has only been there 6 days -> NOT queued
    const rootDay30 = new Date('2026-10-31T10:00:00.000Z');
    const queuedEarly = await placementService.queueJoiningRewards(rootDay30);
    expect(queuedEarly).toBe(0);

    // On day 30 of replacement (Nov 24): replacement has been there 30 days -> queued
    const replacementDay30 = new Date('2026-11-24T10:00:00.000Z');
    const queuedOnTime = await placementService.queueJoiningRewards(replacementDay30);
    expect(queuedOnTime).toBe(1);
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'joining_reward',
        amount: 20000,
        status: 'pending',
        jobSeekerId: 'js-replacement',
        placementId: 'pl-rep-1',
      }),
    });
  });

  it('reward amount and day threshold come from PricingPolicy', async () => {
    const customPolicy = {
      joiningRewardPaise: 25000,
      joiningRewardAfterDays: 15,
      replacementWindowDays: 60,
    };
    (pricingService.current as jest.Mock).mockResolvedValue(customPolicy);

    prisma.placement.findMany.mockResolvedValue([samplePlacement]);

    // Day 15: queued with custom amount
    const day15 = new Date('2026-10-16T10:00:00.000Z');
    const queued = await placementService.queueJoiningRewards(day15);

    expect(queued).toBe(1);
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 25000,
      }),
    });
  });
});

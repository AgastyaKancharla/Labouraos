import { BadRequestException } from '@nestjs/common';
import { PlacementService } from './placement.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { seededPricingService } from '../../test-support/seeded-pricing';
import { ReportClaimDto } from './dto/report-claim.dto';
import { EditPolicyService } from '../../common/edit-policy/edit-policy.service';

interface MockPlacementRecord {
  id: string;
  code: string;
  city: string;
  status: string;
  joinedDate: Date | null;
  rootPlacementId: string | null;
  paidAt: Date | null;
  clockPaused: boolean;
  clockPausedAt: Date | null;
  dropoutReportedAt: Date | null;
  eligibility: string | null;
  businessId: string;
  business: { id: string; area: string; accountAgentId?: string };
  jobSeeker: { id: string };
  vacancy: { id: string };
  payments: Array<{ type: string; status: string }>;
}

const staffActor = {
  id: 'staff-1',
  role: 'call_agent',
  area: 'Indiranagar',
  teamLeadId: 'tl-1',
};

type MockTxCallback<T> = (tx: unknown) => Promise<T>;

interface MockPrismaForPlacement {
  $transaction?: <T>(fn: MockTxCallback<T> | Promise<T>[]) => Promise<T>;
  staff: {
    findUnique: jest.Mock<Promise<typeof staffActor | null>, [{ where: { id: string } }]>;
  };
  placement: {
    findFirst: jest.Mock<Promise<MockPlacementRecord | null>, []>;
    findUnique: jest.Mock<Promise<MockPlacementRecord | null>, []>;
    update: jest.Mock<Promise<MockPlacementRecord>, [{ where: { id: string }; data: Partial<MockPlacementRecord> }]>;
  };
  callRecord: {
    findUnique: jest.Mock;
  };
  replacementClaim: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
}

describe('Phase 6.5 Task 7 (Updated for Phase 17 Task 2): Enforce 60-Day Replacement Guarantee', () => {
  let placementService: PlacementService;
  let mockPrisma: MockPrismaForPlacement;
  let mockAuditService: { log: jest.Mock };

  const joinedDate = new Date('2026-06-01T10:00:00.000Z');
  let mockPlacement: MockPlacementRecord;

  const validOwnerCall = {
    id: 'call-owner-1',
    answered: true,
    subjectType: 'business',
    subjectId: 'biz-1',
  };

  beforeEach(() => {
    mockPlacement = {
      id: 'pl-1',
      code: 'PL-00001',
      city: 'Bengaluru',
      status: 'active',
      joinedDate: new Date(joinedDate),
      rootPlacementId: null,
      paidAt: new Date(joinedDate),
      clockPaused: false,
      clockPausedAt: null,
      dropoutReportedAt: null,
      eligibility: null,
      businessId: 'biz-1',
      business: { id: 'biz-1', area: 'Indiranagar', accountAgentId: 'fa-1' },
      jobSeeker: { id: 'js-1' },
      vacancy: { id: 'vac-1' },
      payments: [{ type: 'placement_fee', status: 'succeeded' }],
    };

    mockPrisma = {
      $transaction: jest
        .fn()
        .mockImplementation(<T>(fn: MockTxCallback<T> | Promise<T>[]) =>
          typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn),
        ),
      staff: {
        findUnique: jest.fn().mockResolvedValue(staffActor),
      },
      placement: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(mockPlacement)),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(mockPlacement)),
        update: jest.fn().mockImplementation(({ data }) => {
          mockPlacement = { ...mockPlacement, ...data };
          return Promise.resolve(mockPlacement);
        }),
      },
      callRecord: {
        findUnique: jest.fn().mockResolvedValue(validOwnerCall),
      },
      replacementClaim: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'rcl-1',
            ...data,
          }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockAuditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    placementService = new PlacementService(
      mockPrisma as unknown as PrismaService,
      { generateCode: jest.fn().mockResolvedValue('RCL-00001') } as unknown as IdService,
      mockAuditService as unknown as AuditService,
      {} as JobSeekerService,
      {} as PaymentService,
      seededPricingService(),
      {} as UpiCollectionService,
      { raise: jest.fn(), resolve: jest.fn() } as unknown as ReviewFlagService,
      {} as unknown as EditPolicyService,
    );
  });

  describe('1. Nullable joinedDate Handling', () => {
    it('refuses replacement claim with a clear message when joinedDate is null', async () => {
      mockPlacement.joinedDate = null;

      const dto: ReportClaimDto = {
        workerLeftOn: '2026-06-15T10:00:00.000Z',
        reason: 'resigned',
        callRecordId: 'call-owner-1',
      };

      await expect(
        placementService.reportClaim('pl-1', dto, 'staff-1'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        placementService.reportClaim('pl-1', dto, 'staff-1'),
      ).rejects.toThrow(/Placement has no recorded joinedDate; cannot evaluate replacement claim/);
    });
  });

  describe('2. 60-Day Guarantee Boundary Enforcement', () => {
    it('day 10 worker left date is accepted within guarantee window', async () => {
      const day10 = new Date(joinedDate.getTime() + 10 * 24 * 60 * 60 * 1000);
      const reportDate = new Date(day10.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days later (within 7d deadline)

      const result = await placementService.reportClaim(
        'pl-1',
        {
          workerLeftOn: day10.toISOString(),
          reason: 'resigned',
          callRecordId: 'call-owner-1',
        },
        'staff-1',
        reportDate,
      );

      expect(result.workerLeftOn).toEqual(day10);
      expect(result.reportedWithinDeadline).toBe(true);
      expect(result.decision).toBeNull(); // Pending TL decision

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'replacement_claim_reported',
        }),
      );
    });

    it('day 60 exactly is accepted (boundary stated explicitly)', async () => {
      const day60Exact = new Date(joinedDate.getTime() + 60 * 24 * 60 * 60 * 1000);
      const reportDate = new Date(day60Exact.getTime() + 1 * 24 * 60 * 60 * 1000);

      const result = await placementService.reportClaim(
        'pl-1',
        {
          workerLeftOn: day60Exact.toISOString(),
          reason: 'resigned',
          callRecordId: 'call-owner-1',
        },
        'staff-1',
        reportDate,
      );

      expect(result.workerLeftOn).toEqual(day60Exact);
      expect(result.reportedWithinDeadline).toBe(true);
    });

    it('day 61 is refused outside 60-day replacement guarantee window', async () => {
      const day61 = new Date(joinedDate.getTime() + 61 * 24 * 60 * 60 * 1000);
      const reportDate = new Date(day61.getTime() + 1 * 24 * 60 * 60 * 1000);

      await expect(
        placementService.reportClaim(
          'pl-1',
          {
            workerLeftOn: day61.toISOString(),
            reason: 'resigned',
            callRecordId: 'call-owner-1',
          },
          'staff-1',
          reportDate,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        placementService.reportClaim(
          'pl-1',
          {
            workerLeftOn: day61.toISOString(),
            reason: 'resigned',
            callRecordId: 'call-owner-1',
          },
          'staff-1',
          reportDate,
        ),
      ).rejects.toThrow(/Worker left outside the 60-day replacement guarantee window/);
    });

    it('day 70 is refused outside replacement guarantee window', async () => {
      const day70 = new Date(joinedDate.getTime() + 70 * 24 * 60 * 60 * 1000);
      const reportDate = new Date(day70.getTime() + 1 * 24 * 60 * 60 * 1000);

      await expect(
        placementService.reportClaim(
          'pl-1',
          {
            workerLeftOn: day70.toISOString(),
            reason: 'resigned',
            callRecordId: 'call-owner-1',
          },
          'staff-1',
          reportDate,
        ),
      ).rejects.toThrow(/Worker left outside the 60-day replacement guarantee window/);
    });
  });

  describe('3. Clock Pause Invariance', () => {
    it('proves a paused clock does not extend the 60-day guarantee window', async () => {
      // Even if clockPaused existed on placement, every window is strictly counted from root joinedDate
      mockPlacement.clockPaused = true;
      mockPlacement.clockPausedAt = new Date(joinedDate.getTime() + 20 * 24 * 60 * 60 * 1000);

      const day61 = new Date(joinedDate.getTime() + 61 * 24 * 60 * 60 * 1000);
      const reportDate = new Date(day61.getTime() + 1 * 24 * 60 * 60 * 1000);

      await expect(
        placementService.reportClaim(
          'pl-1',
          {
            workerLeftOn: day61.toISOString(),
            reason: 'resigned',
            callRecordId: 'call-owner-1',
          },
          'staff-1',
          reportDate,
        ),
      ).rejects.toThrow(/Worker left outside the 60-day replacement guarantee window/);
    });
  });

  describe('4. Business Fault Reasons (Replaced Business Breach Exemption)', () => {
    // Note: In Phase 5, business_breach was exempt from 60-day limits.
    // In Phase 17 Task 2, business fault reasons (salary_unpaid, unsafe_workplace, role_changed)
    // are in the fixed reject-list and auto-rejected; they cannot bypass guarantee rules.
    it('auto-rejects claims with reasons from the reject list (e.g. salary_unpaid)', async () => {
      const day20 = new Date(joinedDate.getTime() + 20 * 24 * 60 * 60 * 1000);
      const reportDate = new Date(day20.getTime() + 2 * 24 * 60 * 60 * 1000);

      const result = await placementService.reportClaim(
        'pl-1',
        {
          workerLeftOn: day20.toISOString(),
          reason: 'salary_unpaid', // Business fault reason
          callRecordId: 'call-owner-1',
        },
        'staff-1',
        reportDate,
      );

      expect(result.decision).toBe('rejected');
      expect(result.decisionReason).toContain("Reason 'salary_unpaid' is in the non-eligible rejection list");
    });

    it('reject-list claims still require an active placement with recorded joinedDate', async () => {
      mockPlacement.joinedDate = null;

      await expect(
        placementService.reportClaim(
          'pl-1',
          {
            workerLeftOn: '2026-06-20T10:00:00.000Z',
            reason: 'role_changed',
            callRecordId: 'call-owner-1',
          },
          'staff-1',
        ),
      ).rejects.toThrow(/Placement has no recorded joinedDate/);
    });
  });
});

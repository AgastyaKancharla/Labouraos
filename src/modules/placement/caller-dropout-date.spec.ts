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
  dropoutDateCallerSupplied: boolean;
  eligibility: string | null;
  placementFee: number;
  businessId: string;
  business: { id: string; area: string; accountAgentId?: string };
  jobSeeker: { id: string };
  vacancy: { id: string };
  replacementCandidates: Array<{ status: string }>;
  payments: Array<{ type: string; status: string }>;
}

const staffActor = {
  id: 'staff-1',
  role: 'call_agent',
  area: 'Indiranagar',
  teamLeadId: 'tl-1',
};

const ceoActor = {
  id: 'ceo-1',
  role: 'ceo',
  area: null,
  teamLeadId: null,
};

type MockTxCallback<T> = (tx: unknown) => Promise<T>;

interface MockPrismaForPlacement {
  $transaction?: <T>(fn: MockTxCallback<T> | Promise<T>[]) => Promise<T>;
  staff: {
    findUnique: jest.Mock<Promise<typeof staffActor | typeof ceoActor | null>, [{ where: { id: string } }]>;
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
  payment: {
    findFirst: jest.Mock<Promise<unknown | null>, []>;
    create: jest.Mock<Promise<unknown>, []>;
  };
}

describe('Phase 6.5 Task 8 (Updated for Phase 17 Task 2): Validate Worker Left Date & Origin Tracking', () => {
  let placementService: PlacementService;
  let mockPrisma: MockPrismaForPlacement;
  let mockAuditService: { log: jest.Mock };
  let mockIdService: { generateCode: jest.Mock };

  // Fixed anchor time: joined June 1, 2026; server current time June 20, 2026
  const joinedDate = new Date('2026-06-01T10:00:00.000Z');
  const serverNow = new Date('2026-06-20T10:00:00.000Z');
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
      dropoutDateCallerSupplied: false,
      eligibility: null,
      placementFee: 2500000,
      businessId: 'biz-1',
      business: { id: 'biz-1', area: 'Indiranagar', accountAgentId: 'fa-1' },
      jobSeeker: { id: 'js-1' },
      vacancy: { id: 'vac-1' },
      replacementCandidates: [],
      payments: [{ type: 'placement_fee', status: 'succeeded' }],
    };

    mockPrisma = {
      $transaction: jest
        .fn()
        .mockImplementation(<T>(fn: MockTxCallback<T> | Promise<T>[]) =>
          typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn),
        ),
      staff: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'ceo-1') return Promise.resolve(ceoActor);
          return Promise.resolve(staffActor);
        }),
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
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pay-1', ...data })),
      },
    };

    mockAuditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    mockIdService = {
      generateCode: jest.fn().mockResolvedValue('RCL-00001'),
    };

    placementService = new PlacementService(
      mockPrisma as unknown as PrismaService,
      mockIdService as unknown as IdService,
      mockAuditService as unknown as AuditService,
      {} as JobSeekerService,
      {} as PaymentService,
      seededPricingService(),
      {} as UpiCollectionService,
      { raise: jest.fn(), resolve: jest.fn() } as unknown as ReviewFlagService,
      {} as unknown as EditPolicyService,
    );
  });

  describe('1. Future Date Refusal (Zero-Tolerance Anti-Fraud)', () => {
    it('refuses a workerLeftOn in the future relative to server time', async () => {
      // 1 day after serverNow
      const futureDate = new Date(serverNow.getTime() + 24 * 60 * 60 * 1000);

      const dto: ReportClaimDto = {
        workerLeftOn: futureDate.toISOString(),
        reason: 'resigned',
        callRecordId: 'call-owner-1',
      };

      await expect(
        placementService.reportClaim('pl-1', dto, 'staff-1', serverNow),
      ).rejects.toThrow(BadRequestException);

      await expect(
        placementService.reportClaim('pl-1', dto, 'staff-1', serverNow),
      ).rejects.toThrow(/cannot be in the future/);
    });

    it('enforces strict zero-tolerance with NO grace period for clock skew (even 1ms into the future)', async () => {
      // Exactly 1 millisecond into the future
      const futureBy1ms = new Date(serverNow.getTime() + 1);

      const dto: ReportClaimDto = {
        workerLeftOn: futureBy1ms.toISOString(),
        reason: 'resigned',
        callRecordId: 'call-owner-1',
      };

      await expect(
        placementService.reportClaim('pl-1', dto, 'staff-1', serverNow),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses future date for reject-list reasons as well (real-world event cannot occur in the future)', async () => {
      const futureDate = new Date(serverNow.getTime() + 3600 * 1000);

      const dto: ReportClaimDto = {
        workerLeftOn: futureDate.toISOString(),
        reason: 'salary_unpaid', // reject-list reason (formerly business_breach)
        callRecordId: 'call-owner-1',
      };

      await expect(
        placementService.reportClaim('pl-1', dto, 'staff-1', serverNow),
      ).rejects.toThrow(/cannot be in the future/);
    });
  });

  describe('2. Earlier than joinedDate Refusal (Employee cannot leave before they started)', () => {
    it('refuses a workerLeftOn earlier than joinedDate', async () => {
      // 5 days before joinedDate
      const beforeJoined = new Date(joinedDate.getTime() - 5 * 24 * 60 * 60 * 1000);

      const dto: ReportClaimDto = {
        workerLeftOn: beforeJoined.toISOString(),
        reason: 'resigned',
        callRecordId: 'call-owner-1',
      };

      await expect(
        placementService.reportClaim('pl-1', dto, 'staff-1', serverNow),
      ).rejects.toThrow(BadRequestException);

      await expect(
        placementService.reportClaim('pl-1', dto, 'staff-1', serverNow),
      ).rejects.toThrow(/cannot be earlier than joinedDate.*employee cannot leave before they started/);
    });

    it('refuses even 1 millisecond earlier than joinedDate', async () => {
      const beforeBy1ms = new Date(joinedDate.getTime() - 1);

      const dto: ReportClaimDto = {
        workerLeftOn: beforeBy1ms.toISOString(),
        reason: 'resigned',
        callRecordId: 'call-owner-1',
      };

      await expect(
        placementService.reportClaim('pl-1', dto, 'staff-1', serverNow),
      ).rejects.toThrow(/cannot be earlier than joinedDate/);
    });
  });

  describe('3. Clean Composition & Error Message Distinctness', () => {
    it('clearly distinguishes "before you started" from "after guarantee expired"', async () => {
      // Case A: Before joinedDate
      const beforeJoined = new Date(joinedDate.getTime() - 24 * 60 * 60 * 1000);
      try {
        await placementService.reportClaim(
          'pl-1',
          { workerLeftOn: beforeJoined.toISOString(), reason: 'resigned', callRecordId: 'call-owner-1' },
          'staff-1',
          serverNow,
        );
        fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as BadRequestException;
        expect(error.message).toContain('employee cannot leave before they started');
        expect(error.message).not.toContain('replacement guarantee window');
      }

      // Case B: Past 60-day guarantee expiry (day 70)
      const serverLater = new Date('2026-09-01T10:00:00.000Z');
      const day70 = new Date(joinedDate.getTime() + 70 * 24 * 60 * 60 * 1000);
      try {
        await placementService.reportClaim(
          'pl-1',
          { workerLeftOn: day70.toISOString(), reason: 'resigned', callRecordId: 'call-owner-1' },
          'staff-1',
          serverLater,
        );
        fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as BadRequestException;
        expect(error.message).toContain('replacement guarantee window');
        expect(error.message).not.toContain('employee cannot leave before they started');
      }
    });

    it('distinguishes missing joinedDate error from date comparison errors', async () => {
      mockPlacement.joinedDate = null;
      try {
        await placementService.reportClaim(
          'pl-1',
          { workerLeftOn: '2026-06-10T10:00:00.000Z', reason: 'resigned', callRecordId: 'call-owner-1' },
          'staff-1',
          serverNow,
        );
        fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as BadRequestException;
        expect(error.message).toContain('has no recorded joinedDate');
        expect(error.message).not.toContain('cannot be in the future');
        expect(error.message).not.toContain('cannot be earlier than joinedDate');
      }
    });
  });

  describe('4. Origin and Deadline Tracking (Replacing dropoutDateCallerSupplied)', () => {
    // Note: In Phase 6.5, dropoutDateCallerSupplied tracked whether an agent typed a date or defaulted to server clock.
    // In Phase 17 Task 2, workerLeftOn is ALWAYS mandatory and verified against an answered owner call.
    // reportedWithinDeadline is automatically computed based on whether reportedAt is within claimReportDays (7 days).
    it('sets reportedWithinDeadline: true when reported within 7 days of workerLeftOn', async () => {
      const workerLeftOn = new Date('2026-06-15T10:00:00.000Z'); // 5 days before serverNow (June 20)

      const result = await placementService.reportClaim(
        'pl-1',
        {
          workerLeftOn: workerLeftOn.toISOString(),
          reason: 'resigned',
          callRecordId: 'call-owner-1',
        },
        'staff-1',
        serverNow,
      );

      expect(result.reportedWithinDeadline).toBe(true);
      expect(result.feePaidInFull).toBe(true);
      expect(result.decision).toBeNull(); // Pending TL/Manager decision
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'replacement_claim_reported',
          after: expect.objectContaining({
            reason: 'resigned',
          }),
        }),
      );
    });

    it('sets reportedWithinDeadline: false and auto-rejects when reported > 7 days after worker left', async () => {
      const workerLeftOn = new Date('2026-06-10T10:00:00.000Z'); // 10 days before serverNow (June 20)

      const result = await placementService.reportClaim(
        'pl-1',
        {
          workerLeftOn: workerLeftOn.toISOString(),
          reason: 'resigned',
          callRecordId: 'call-owner-1',
        },
        'staff-1',
        serverNow,
      );

      expect(result.reportedWithinDeadline).toBe(false);
      expect(result.decision).toBe('rejected');
      expect(result.decisionReason).toContain('Reported 10 days after worker left; deadline is 7 days');
    });
  });

  describe('5. Replacement Claim Query Visibility', () => {
    it('returns placement record on findById query for review', async () => {
      const placement = await placementService.findById('pl-1', 'ceo-1');
      expect(placement).toBeDefined();
      expect(placement.id).toBe('pl-1');
    });
  });
});

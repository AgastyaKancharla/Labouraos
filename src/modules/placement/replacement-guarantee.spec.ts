import { BadRequestException } from '@nestjs/common';
import { PlacementService } from './placement.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { replacementGuaranteeDeadline } from '../../common/money/money';

interface MockPlacementRecord {
  id: string;
  code: string;
  city: string;
  status: string;
  joinedDate: Date | null;
  clockPaused: boolean;
  clockPausedAt: Date | null;
  dropoutReportedAt: Date | null;
  eligibility: string | null;
  business: { id: string; area: string };
  jobSeeker: { id: string };
  vacancy: { id: string };
}

const staffActor = {
  id: 'staff-1',
  role: 'call_agent',
  area: 'Indiranagar',
};

interface MockPrismaForPlacement {
  staff: {
    findUnique: jest.Mock<Promise<typeof staffActor | null>, [{ where: { id: string } }]>;
  };
  placement: {
    findFirst: jest.Mock<Promise<MockPlacementRecord | null>, []>;
    update: jest.Mock<Promise<MockPlacementRecord>, [{ where: { id: string }; data: Partial<MockPlacementRecord> }]>;
  };
}

describe('Phase 6.5 Task 7: Enforce 60-Day Replacement Guarantee', () => {
  let placementService: PlacementService;
  let mockPrisma: MockPrismaForPlacement;
  let mockAuditService: { log: jest.Mock };

  const joinedDate = new Date('2026-06-01T10:00:00.000Z');
  let mockPlacement: MockPlacementRecord;

  beforeEach(() => {
    mockPlacement = {
      id: 'pl-1',
      code: 'PL-00001',
      city: 'Bengaluru',
      status: 'active',
      joinedDate: new Date(joinedDate),
      clockPaused: false,
      clockPausedAt: null,
      dropoutReportedAt: null,
      eligibility: null,
      business: { id: 'biz-1', area: 'Indiranagar' },
      jobSeeker: { id: 'js-1' },
      vacancy: { id: 'vac-1' },
    };

    mockPrisma = {
      staff: {
        findUnique: jest.fn().mockResolvedValue(staffActor),
      },
      placement: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(mockPlacement)),
        update: jest.fn().mockImplementation(({ data }) => {
          mockPlacement = { ...mockPlacement, ...data };
          return Promise.resolve(mockPlacement);
        }),
      },
    };

    mockAuditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    placementService = new PlacementService(
      mockPrisma as unknown as PrismaService,
      {} as IdService,
      mockAuditService as unknown as AuditService,
      {} as JobSeekerService,
      {} as PaymentService,
    );
  });

  describe('1. Nullable joinedDate Handling (Decision 1)', () => {
    it('refuses employee_left dropout with a clear message when joinedDate is null, and audits the refusal', async () => {
      mockPlacement.joinedDate = null;

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: '2026-06-15T10:00:00.000Z',
            reason: 'Worker disappeared',
          },
          'staff-1',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: '2026-06-15T10:00:00.000Z',
          },
          'staff-1',
        ),
      ).rejects.toThrow(/has no joinedDate recorded; cannot evaluate 60-day replacement guarantee window/);

      // Asserts that the refused attempt was audited
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout_refused',
          entityCode: 'PL-00001',
          after: expect.objectContaining({
            refusalReason: 'MISSING_JOINED_DATE',
          }),
        }),
      );
    });
  });

  describe('2. 60-Day Guarantee Boundary Enforcement', () => {
    it('day 10 dropout is accepted within guarantee window', async () => {
      const day10 = new Date(joinedDate.getTime() + 10 * 24 * 60 * 60 * 1000);

      const result = await placementService.recordDropout(
        'pl-1',
        {
          eligibility: 'employee_left',
          dropoutReportedAt: day10.toISOString(),
          reason: 'Worker left for better pay',
        },
        'staff-1',
      );

      expect(result.status).toBe('dropped_out');
      expect(result.eligibility).toBe('employee_left');
      expect(result.dropoutReportedAt).toEqual(day10);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout',
          entityCode: 'PL-00001',
        }),
      );
    });

    it('day 60 exactly is accepted (boundary stated explicitly)', async () => {
      const day60Exact = new Date(joinedDate.getTime() + 60 * 24 * 60 * 60 * 1000);

      const result = await placementService.recordDropout(
        'pl-1',
        {
          eligibility: 'employee_left',
          dropoutReportedAt: day60Exact.toISOString(),
          reason: 'Left on last day of 60-day guarantee',
        },
        'staff-1',
      );

      expect(result.status).toBe('dropped_out');
      expect(result.eligibility).toBe('employee_left');
      expect(result.dropoutReportedAt).toEqual(day60Exact);
    });

    it('day 61 is refused outside 60-day replacement guarantee window', async () => {
      const day61 = new Date(joinedDate.getTime() + 61 * 24 * 60 * 60 * 1000);
      const expectedDeadline = replacementGuaranteeDeadline(joinedDate);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: day61.toISOString(),
            reason: 'Left 1 day after guarantee ended',
          },
          'staff-1',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: day61.toISOString(),
          },
          'staff-1',
        ),
      ).rejects.toThrow(new RegExp(`Replacement guarantee expired on ${expectedDeadline.toISOString()}`));

      // Asserts that the refused attempt was audited
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout_refused',
          entityCode: 'PL-00001',
          after: expect.objectContaining({
            refusalReason: 'REPLACEMENT_GUARANTEE_EXPIRED',
            guaranteeExpiryDate: expectedDeadline.toISOString(),
          }),
        }),
      );
    });

    it('day 70 dropout is refused outside replacement guarantee window', async () => {
      const day70 = new Date(joinedDate.getTime() + 70 * 24 * 60 * 60 * 1000);
      const expectedDeadline = replacementGuaranteeDeadline(joinedDate);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: day70.toISOString(),
          },
          'staff-1',
        ),
      ).rejects.toThrow(new RegExp(`Replacement guarantee expired on ${expectedDeadline.toISOString()}`));

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout_refused',
          entityCode: 'PL-00001',
          after: expect.objectContaining({
            refusalReason: 'REPLACEMENT_GUARANTEE_EXPIRED',
          }),
        }),
      );
    });
  });

  describe('3. Clock Pause Invariance (Decision 2)', () => {
    it('proves a paused clock does not extend the 60-day guarantee window', async () => {
      // Set clockPaused on placement (simulating a pause from an earlier replacement search cycle)
      mockPlacement.clockPaused = true;
      mockPlacement.clockPausedAt = new Date(joinedDate.getTime() + 20 * 24 * 60 * 60 * 1000);

      const day61 = new Date(joinedDate.getTime() + 61 * 24 * 60 * 60 * 1000);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: day61.toISOString(),
          },
          'staff-1',
        ),
      ).rejects.toThrow(/Replacement guarantee expired/);
    });
  });

  describe('4. Business Breach Exemption', () => {
    it('business_breach is NOT subject to 60-day limit and is accepted on day 70', async () => {
      const day70 = new Date(joinedDate.getTime() + 70 * 24 * 60 * 60 * 1000);

      const result = await placementService.recordDropout(
        'pl-1',
        {
          eligibility: 'business_breach',
          dropoutReportedAt: day70.toISOString(),
          reason: 'Business failed to pay salary on time',
        },
        'staff-1',
      );

      expect(result.status).toBe('dropped_out');
      expect(result.eligibility).toBe('business_breach');
      expect(result.dropoutReportedAt).toEqual(day70);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout',
          entityCode: 'PL-00001',
          after: expect.objectContaining({
            eligibility: 'business_breach',
          }),
        }),
      );
    });

    it('business_breach is accepted even if joinedDate is null (breach does not seek guarantee)', async () => {
      mockPlacement.joinedDate = null;

      const result = await placementService.recordDropout(
        'pl-1',
        {
          eligibility: 'business_breach',
          reason: 'Employer mistreated candidate prior to formal join date',
        },
        'staff-1',
      );

      expect(result.status).toBe('dropped_out');
      expect(result.eligibility).toBe('business_breach');
    });
  });
});

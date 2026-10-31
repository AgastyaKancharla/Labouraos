import { BadRequestException } from '@nestjs/common';
import { PlacementService } from './placement.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';

interface MockPlacementRecord {
  id: string;
  code: string;
  city: string;
  status: string;
  joinedDate: Date | null;
  clockPaused: boolean;
  clockPausedAt: Date | null;
  dropoutReportedAt: Date | null;
  dropoutDateCallerSupplied: boolean;
  eligibility: string | null;
  placementFee: number;
  businessId: string;
  business: { id: string; area: string };
  jobSeeker: { id: string };
  vacancy: { id: string };
  replacementCandidates: Array<{ status: string }>;
}

const staffActor = {
  id: 'staff-1',
  role: 'call_agent',
  area: 'Indiranagar',
};

const ceoActor = {
  id: 'ceo-1',
  role: 'ceo',
  area: null,
};

interface MockPrismaForPlacement {
  staff: {
    findUnique: jest.Mock<Promise<typeof staffActor | typeof ceoActor | null>, [{ where: { id: string } }]>;
  };
  placement: {
    findFirst: jest.Mock<Promise<MockPlacementRecord | null>, []>;
    update: jest.Mock<Promise<MockPlacementRecord>, [{ where: { id: string }; data: Partial<MockPlacementRecord> }]>;
  };
  payment: {
    findFirst: jest.Mock<Promise<unknown | null>, []>;
    create: jest.Mock<Promise<unknown>, []>;
  };
}

describe('Phase 6.5 Task 8: Validate Caller-Supplied Dropout Date & Origin Tracking (Anti-Fraud)', () => {
  let placementService: PlacementService;
  let mockPrisma: MockPrismaForPlacement;
  let mockAuditService: { log: jest.Mock };
  let mockIdService: { generateCode: jest.Mock };

  // Fixed anchor time: joined June 1, 2026; server current time June 20, 2026
  const joinedDate = new Date('2026-06-01T10:00:00.000Z');
  const serverNow = new Date('2026-06-20T10:00:00.000Z');
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
      dropoutDateCallerSupplied: false,
      eligibility: null,
      placementFee: 2500000,
      businessId: 'biz-1',
      business: { id: 'biz-1', area: 'Indiranagar' },
      jobSeeker: { id: 'js-1' },
      vacancy: { id: 'vac-1' },
      replacementCandidates: [],
    };

    mockPrisma = {
      staff: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'ceo-1') return Promise.resolve(ceoActor);
          return Promise.resolve(staffActor);
        }),
      },
      placement: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(mockPlacement)),
        update: jest.fn().mockImplementation(({ data }) => {
          mockPlacement = { ...mockPlacement, ...data };
          return Promise.resolve(mockPlacement);
        }),
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
      generateCode: jest.fn().mockResolvedValue('PAY-00001'),
    };

    placementService = new PlacementService(
      mockPrisma as unknown as PrismaService,
      mockIdService as unknown as IdService,
      mockAuditService as unknown as AuditService,
      {} as JobSeekerService,
      {} as PaymentService,
    );
  });

  describe('1. Future Date Refusal (Zero-Tolerance Anti-Fraud)', () => {
    it('refuses a dropoutReportedAt in the future relative to server time, and audits the refusal', async () => {
      // 1 day after serverNow
      const futureDate = new Date(serverNow.getTime() + 24 * 60 * 60 * 1000);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: futureDate.toISOString(),
          },
          'staff-1',
          serverNow,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: futureDate.toISOString(),
          },
          'staff-1',
          serverNow,
        ),
      ).rejects.toThrow(/cannot be in the future/);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout_refused',
          entityCode: 'PL-00001',
          after: expect.objectContaining({
            refusalReason: 'FUTURE_DROPOUT_DATE',
            callerSupplied: true,
          }),
        }),
      );
    });

    it('enforces strict zero-tolerance with NO grace period for clock skew (even 1ms into the future)', async () => {
      // Exactly 1 millisecond into the future
      const futureBy1ms = new Date(serverNow.getTime() + 1);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: futureBy1ms.toISOString(),
          },
          'staff-1',
          serverNow,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout_refused',
          after: expect.objectContaining({
            refusalReason: 'FUTURE_DROPOUT_DATE',
          }),
        }),
      );
    });

    it('refuses future date for business_breach as well (real-world event cannot occur in the future)', async () => {
      const futureDate = new Date(serverNow.getTime() + 3600 * 1000);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'business_breach',
            dropoutReportedAt: futureDate.toISOString(),
          },
          'staff-1',
          serverNow,
        ),
      ).rejects.toThrow(/cannot be in the future/);
    });
  });

  describe('2. Earlier than joinedDate Refusal (Employee cannot leave before they started)', () => {
    it('refuses a dropoutReportedAt earlier than joinedDate, and audits the refusal', async () => {
      // 5 days before joinedDate
      const beforeJoined = new Date(joinedDate.getTime() - 5 * 24 * 60 * 60 * 1000);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: beforeJoined.toISOString(),
          },
          'staff-1',
          serverNow,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: beforeJoined.toISOString(),
          },
          'staff-1',
          serverNow,
        ),
      ).rejects.toThrow(/cannot be earlier than joinedDate.*employee cannot leave before they started/);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout_refused',
          entityCode: 'PL-00001',
          after: expect.objectContaining({
            refusalReason: 'DROPOUT_BEFORE_JOINED_DATE',
            callerSupplied: true,
          }),
        }),
      );
    });

    it('refuses even 1 millisecond earlier than joinedDate', async () => {
      const beforeBy1ms = new Date(joinedDate.getTime() - 1);

      await expect(
        placementService.recordDropout(
          'pl-1',
          {
            eligibility: 'employee_left',
            dropoutReportedAt: beforeBy1ms.toISOString(),
          },
          'staff-1',
          serverNow,
        ),
      ).rejects.toThrow(/cannot be earlier than joinedDate/);
    });
  });

  describe('3. Clean Composition & Error Message Distinctness', () => {
    it('clearly distinguishes "before you started" from "after guarantee expired"', async () => {
      // Case A: Before joinedDate
      const beforeJoined = new Date(joinedDate.getTime() - 24 * 60 * 60 * 1000);
      try {
        await placementService.recordDropout(
          'pl-1',
          { eligibility: 'employee_left', dropoutReportedAt: beforeJoined.toISOString() },
          'staff-1',
          serverNow,
        );
        fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as BadRequestException;
        expect(error.message).toContain('employee cannot leave before they started');
        expect(error.message).not.toContain('Replacement guarantee expired');
      }

      // Case B: Past 60-day guarantee expiry (day 70)
      const serverLater = new Date('2026-09-01T10:00:00.000Z');
      const day70 = new Date(joinedDate.getTime() + 70 * 24 * 60 * 60 * 1000);
      try {
        await placementService.recordDropout(
          'pl-1',
          { eligibility: 'employee_left', dropoutReportedAt: day70.toISOString() },
          'staff-1',
          serverLater,
        );
        fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as BadRequestException;
        expect(error.message).toContain('Replacement guarantee expired');
        expect(error.message).not.toContain('employee cannot leave before they started');
      }
    });

    it('distinguishes missing joinedDate error from date comparison errors', async () => {
      mockPlacement.joinedDate = null;
      try {
        await placementService.recordDropout(
          'pl-1',
          { eligibility: 'employee_left', dropoutReportedAt: '2026-06-10T10:00:00.000Z' },
          'staff-1',
          serverNow,
        );
        fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as BadRequestException;
        expect(error.message).toContain('has no joinedDate recorded');
        expect(error.message).not.toContain('cannot be in the future');
        expect(error.message).not.toContain('cannot be earlier than joinedDate');
      }
    });
  });

  describe('4. Origin Flag Tracking (dropoutDateCallerSupplied)', () => {
    it('sets dropoutDateCallerSupplied: true when caller supplies dropoutReportedAt', async () => {
      const validCallerDate = new Date(joinedDate.getTime() + 10 * 24 * 60 * 60 * 1000); // June 11, 2026 (<= serverNow)

      const result = await placementService.recordDropout(
        'pl-1',
        {
          eligibility: 'employee_left',
          dropoutReportedAt: validCallerDate.toISOString(),
          reason: 'Worker relocated',
        },
        'staff-1',
        serverNow,
      );

      expect(result.status).toBe('dropped_out');
      expect(result.dropoutDateCallerSupplied).toBe(true);
      expect(result.dropoutReportedAt).toEqual(validCallerDate);

      // Verify audit log has callerSupplied recorded
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout',
          after: expect.objectContaining({
            dropoutDateCallerSupplied: true,
          }),
        }),
      );
    });

    it('sets dropoutDateCallerSupplied: false when caller omits dropoutReportedAt, defaulting to server clock', async () => {
      const result = await placementService.recordDropout(
        'pl-1',
        {
          eligibility: 'employee_left',
          reason: 'Worker left suddenly',
        },
        'staff-1',
        serverNow,
      );

      expect(result.status).toBe('dropped_out');
      expect(result.dropoutDateCallerSupplied).toBe(false);
      expect(result.dropoutReportedAt).toEqual(serverNow);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'placement_dropout',
          after: expect.objectContaining({
            dropoutDateCallerSupplied: false,
          }),
        }),
      );
    });
  });

  describe('5. Refund Review & Approval Visibility', () => {
    it('returns dropoutDateCallerSupplied in approveRefund response and records it in audit log', async () => {
      // Prepare placement in dropped_out status with caller-supplied date 16 days ago
      const dropoutDate = new Date('2026-06-02T10:00:00.000Z');
      mockPlacement.status = 'dropped_out';
      mockPlacement.eligibility = 'employee_left';
      mockPlacement.dropoutReportedAt = dropoutDate;
      mockPlacement.dropoutDateCallerSupplied = true; // Caller typed this date in

      // Approval date 16 days later (June 18)
      const approvalDate = new Date('2026-06-18T10:00:00.000Z');

      const refundResult = await placementService.approveRefund(
        'pl-1',
        { asOf: approvalDate.toISOString(), reason: 'Guaranteed cash refund' },
        'ceo-1',
      );

      // The returned refund object clearly shows the caller-supplied origin flag
      expect(refundResult).toBeDefined();
      expect(refundResult.dropoutDateCallerSupplied).toBe(true);

      // The audit log for refund_approved records dropoutDateCallerSupplied for CEO/Manager accountability
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'refund_approved',
          entityCode: 'PL-00001',
          actorId: 'ceo-1',
          after: expect.objectContaining({
            dropoutDateCallerSupplied: true,
            daysElapsed: 16,
          }),
        }),
      );
    });

    it('shows dropoutDateCallerSupplied: false when approving refund for server-defaulted dropout', async () => {
      const dropoutDate = new Date('2026-06-02T10:00:00.000Z');
      mockPlacement.status = 'dropped_out';
      mockPlacement.eligibility = 'employee_left';
      mockPlacement.dropoutReportedAt = dropoutDate;
      mockPlacement.dropoutDateCallerSupplied = false; // Server-defaulted

      const approvalDate = new Date('2026-06-18T10:00:00.000Z');

      const refundResult = await placementService.approveRefund(
        'pl-1',
        { asOf: approvalDate.toISOString(), reason: 'Guaranteed cash refund' },
        'ceo-1',
      );

      expect(refundResult.dropoutDateCallerSupplied).toBe(false);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'refund_approved',
          after: expect.objectContaining({
            dropoutDateCallerSupplied: false,
            daysElapsed: 16,
          }),
        }),
      );
    });

    it('returns dropoutDateCallerSupplied on findById query for review prior to approval', async () => {
      mockPlacement.dropoutDateCallerSupplied = true;
      const placement = await placementService.findById('pl-1', 'ceo-1');

      expect(placement).toBeDefined();
      expect(placement.dropoutDateCallerSupplied).toBe(true);
    });
  });
});

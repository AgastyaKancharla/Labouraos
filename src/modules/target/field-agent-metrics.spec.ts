import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FieldAgentMetricsService } from './field-agent-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { getPeriodBoundaries } from '../../common/time/period-boundary';
import { seededPricingService } from '../../test-support/seeded-pricing';

describe('Phase 6.7 Task 4: Field Agent Metrics', () => {
  type MockPrismaService = {
    staff: { findUnique: jest.Mock };
    placement: { findMany: jest.Mock; findFirst: jest.Mock };
    replacementCandidate: { findMany: jest.Mock };
  };

  let service: FieldAgentMetricsService;
  let prismaMock: MockPrismaService;

  const mockAgentId = 'fa-uuid-001';
  const mockTeamLeadId = 'lead-uuid-001';
  const otherTeamLeadId = 'lead-uuid-002';
  const otherAgentId = 'fa-uuid-002';

  const mockFieldAgentStaff = {
    id: mockAgentId,
    code: 'FA-00001',
    name: 'Field Agent One',
    role: 'field_agent',
    city: 'Bengaluru',
    teamLeadId: mockTeamLeadId,
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const fieldAgentUser: JwtPayload = {
    sub: mockAgentId,
    code: 'FA-00001',
    email: 'fa1@laboura.local',
    role: 'field_agent',
  };

  const otherAgentUser: JwtPayload = {
    sub: otherAgentId,
    code: 'FA-00002',
    email: 'fa2@laboura.local',
    role: 'field_agent',
  };

  const teamLeadUser: JwtPayload = {
    sub: mockTeamLeadId,
    code: 'TL-00001',
    email: 'lead1@laboura.local',
    role: 'team_lead',
  };

  const otherTeamLeadUser: JwtPayload = {
    sub: otherTeamLeadId,
    code: 'TL-00002',
    email: 'lead2@laboura.local',
    role: 'team_lead',
  };

  const managerUser: JwtPayload = {
    sub: 'mgr-uuid-001',
    code: 'MGR-00001',
    email: 'mgr@laboura.local',
    role: 'manager',
  };

  const ceoUser: JwtPayload = {
    sub: 'ceo-uuid-001',
    code: 'CEO-00001',
    email: 'ceo@laboura.local',
    role: 'ceo',
  };

  const financeUser: JwtPayload = {
    sub: 'fin-uuid-001',
    code: 'FIN-00001',
    email: 'fin@laboura.local',
    role: 'finance',
  };

  beforeEach(() => {
    prismaMock = {
      staff: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === mockAgentId) return Promise.resolve(mockFieldAgentStaff);
          if (where.id === otherAgentId) {
            return Promise.resolve({
              ...mockFieldAgentStaff,
              id: otherAgentId,
              code: 'FA-00002',
              teamLeadId: otherTeamLeadId,
            });
          }
          if (where.id === 'call-agent-uuid') {
            return Promise.resolve({
              ...mockFieldAgentStaff,
              id: 'call-agent-uuid',
              code: 'CA-00001',
              role: 'call_agent',
            });
          }
          return Promise.resolve(null);
        }),
      },
      placement: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      replacementCandidate: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new FieldAgentMetricsService(
      prismaMock as unknown as PrismaService,
      seededPricingService(),
    );
  });

  describe('Metric 1: Placements Closed', () => {
    const fixedNow = new Date('2026-11-15T12:00:00.000Z');
    // November 2026 Asia/Kolkata boundary:
    // startUtc: 2026-10-31T18:30:00.000Z, endUtc: 2026-11-30T18:29:59.999Z

    it('counts placements where candidate joined AND business paid within the period', async () => {
      const placement1 = {
        id: 'pl-1',
        code: 'PL-00001',
        createdByStaffId: mockAgentId,
        joinedDate: new Date('2026-11-05T10:00:00.000Z'),
        businessId: 'biz-1',
        business: { id: 'biz-1', code: 'BZ-00001' },
        payments: [
          {
            id: 'pay-1',
            type: 'placement_fee',
            status: 'succeeded',
            createdAt: new Date('2026-11-06T10:00:00.000Z'),
            updatedAt: new Date('2026-11-06T10:00:00.000Z'),
          },
        ],
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([placement1]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.placementsClosed).toBe(1);
      expect(result.details.placementsClosed.count).toBe(1);
      expect(result.details.placementsClosed.placementCodes).toEqual(['PL-00001']);
    });

    it('uses the later date of joinedDate and paymentDate as the closing timestamp', async () => {
      // Candidate joined in October, but business paid in November -> closed in November
      const placementJoinedEarlier = {
        id: 'pl-2',
        code: 'PL-00002',
        createdByStaffId: mockAgentId,
        joinedDate: new Date('2026-10-25T10:00:00.000Z'),
        businessId: 'biz-2',
        business: { id: 'biz-2', code: 'BZ-00002' },
        payments: [
          {
            id: 'pay-2',
            type: 'placement_fee',
            status: 'completed',
            createdAt: new Date('2026-11-02T10:00:00.000Z'),
            updatedAt: new Date('2026-11-02T10:00:00.000Z'),
          },
        ],
      };

      // Business paid in October, but candidate joined in November -> closed in November
      const placementPaidEarlier = {
        id: 'pl-3',
        code: 'PL-00003',
        createdByStaffId: mockAgentId,
        joinedDate: new Date('2026-11-04T10:00:00.000Z'),
        businessId: 'biz-3',
        business: { id: 'biz-3', code: 'BZ-00003' },
        payments: [
          {
            id: 'pay-3',
            type: 'placement_fee',
            status: 'succeeded',
            createdAt: new Date('2026-10-28T10:00:00.000Z'),
            updatedAt: new Date('2026-10-28T10:00:00.000Z'),
          },
        ],
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([placementJoinedEarlier, placementPaidEarlier]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        ceoUser,
        fixedNow,
      );

      expect(result.metrics.placementsClosed).toBe(2);
      expect(result.details.placementsClosed.placementCodes).toEqual(['PL-00002', 'PL-00003']);
    });

    it('requires BOTH joined and paid: joined-but-unpaid does NOT count (revenue integrity)', async () => {
      // Joined in period, but business never paid (empty payments list)
      const joinedUnpaid = {
        id: 'pl-unpaid',
        code: 'PL-00004',
        createdByStaffId: mockAgentId,
        joinedDate: new Date('2026-11-10T10:00:00.000Z'),
        businessId: 'biz-4',
        business: { id: 'biz-4', code: 'BZ-00004' },
        payments: [], // no completed/succeeded placement_fee payment
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([joinedUnpaid]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.placementsClosed).toBe(0);
      expect(result.details.placementsClosed.placementCodes).toEqual([]);
    });

    it('excludes placements where closingDate fell outside the period', async () => {
      // Both joined and paid in October -> closing date in October
      const octoberPlacement = {
        id: 'pl-oct',
        code: 'PL-00005',
        createdByStaffId: mockAgentId,
        joinedDate: new Date('2026-10-15T10:00:00.000Z'),
        businessId: 'biz-5',
        business: { id: 'biz-5', code: 'BZ-00005' },
        payments: [
          {
            id: 'pay-oct',
            type: 'placement_fee',
            status: 'succeeded',
            createdAt: new Date('2026-10-18T10:00:00.000Z'),
            updatedAt: new Date('2026-10-18T10:00:00.000Z'),
          },
        ],
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([octoberPlacement]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.placementsClosed).toBe(0);
    });

    it('excludes placements with null attribution or created by other agents', async () => {
      // prisma.placement.findMany enforces createdByStaffId = effectiveStaffId in the query
      prismaMock.placement.findMany.mockResolvedValueOnce([]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.placementsClosed).toBe(0);
      expect(prismaMock.placement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdByStaffId: mockAgentId,
          }),
        }),
      );
    });
  });

  describe('Metric 2: Replacements Secured Inside 15 Days', () => {
    const fixedNow = new Date('2026-11-15T12:00:00.000Z');

    it('counts replacement accepted on day 10 even when joined on day 18 (acceptance saves margin)', async () => {
      const dropoutReportedAt = new Date('2026-11-01T10:00:00.000Z');
      const acceptedAt = new Date('2026-11-11T10:00:00.000Z'); // day 10 (inside 15-day window)
      const joinedDate = new Date('2026-11-19T10:00:00.000Z'); // day 18 (notice period served)

      const securedReplacement = {
        id: 'rc-sec-1',
        placementId: 'pl-orig-1',
        jobSeekerId: 'js-rep-1',
        status: 'accepted',
        acceptedAt,
        placement: {
          id: 'pl-orig-1',
          code: 'PL-ORIG-01',
          dropoutReportedAt,
          createdByStaffId: mockAgentId,
          joinedDate, // candidate joins later on day 18
        },
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([]); // joinedPlacements
      prismaMock.replacementCandidate.findMany.mockResolvedValueOnce([securedReplacement]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.replacementsSecuredInside15Days).toBe(1);
      expect(result.metrics.replacementsIn15Days).toBe(1);
      expect(result.details.replacementsSecuredInside15Days.count).toBe(1);
      expect(result.details.replacementsSecuredInside15Days.placementCodes).toEqual(['PL-ORIG-01']);
    });

    it('counts replacement accepted on day 15 exact boundary', async () => {
      const dropoutReportedAt = new Date('2026-11-01T10:00:00.000Z');
      const acceptedAt = new Date('2026-11-16T10:00:00.000Z'); // exactly 15 days later

      const boundaryReplacement = {
        id: 'rc-sec-boundary',
        placementId: 'pl-orig-boundary',
        jobSeekerId: 'js-rep-boundary',
        status: 'accepted',
        acceptedAt,
        placement: {
          id: 'pl-orig-boundary',
          code: 'PL-ORIG-15',
          dropoutReportedAt,
          createdByStaffId: mockAgentId,
        },
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([]);
      prismaMock.replacementCandidate.findMany.mockResolvedValueOnce([boundaryReplacement]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.replacementsSecuredInside15Days).toBe(1);
      expect(result.details.replacementsSecuredInside15Days.placementCodes).toEqual(['PL-ORIG-15']);
    });

    it('rejects replacement accepted on day 16 (margin protection window expired)', async () => {
      const dropoutReportedAt = new Date('2026-11-01T10:00:00.000Z');
      const day16Accepted = new Date('2026-11-17T10:00:00.000Z'); // 16 days later

      const lateReplacement = {
        id: 'rc-sec-late',
        placementId: 'pl-orig-late',
        jobSeekerId: 'js-rep-late',
        status: 'accepted',
        acceptedAt: day16Accepted,
        placement: {
          id: 'pl-orig-late',
          code: 'PL-ORIG-16',
          dropoutReportedAt,
          createdByStaffId: mockAgentId,
        },
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([]);
      prismaMock.replacementCandidate.findMany.mockResolvedValueOnce([lateReplacement]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.replacementsSecuredInside15Days).toBe(0);
      expect(result.details.replacementsSecuredInside15Days.placementCodes).toEqual([]);
    });

    it('counts replacement accepted on day 10 within the 15-day window', async () => {
      const dropoutReportedAt = new Date('2026-11-01T10:00:00.000Z');
      const acceptedAt = new Date('2026-11-11T10:00:00.000Z'); // day 10 <= 15 days

      const validReplacement = {
        id: 'rc-sec-valid',
        placementId: 'pl-orig-valid',
        jobSeekerId: 'js-rep-valid',
        status: 'accepted',
        acceptedAt,
        placement: {
          id: 'pl-orig-valid',
          code: 'PL-ORIG-VALID',
          dropoutReportedAt,
          createdByStaffId: mockAgentId,
        },
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([]);
      prismaMock.replacementCandidate.findMany.mockResolvedValueOnce([validReplacement]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.replacementsSecuredInside15Days).toBe(1);
      expect(result.details.replacementsSecuredInside15Days.placementCodes).toEqual(['PL-ORIG-VALID']);
    });

    it('excludes rows with null acceptedAt (honest-null rule)', async () => {
      // Prisma query filters acceptedAt: { not: null }
      prismaMock.placement.findMany.mockResolvedValueOnce([]);
      prismaMock.replacementCandidate.findMany.mockResolvedValueOnce([]);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.replacementsSecuredInside15Days).toBe(0);
      expect(prismaMock.replacementCandidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'accepted',
            acceptedAt: expect.objectContaining({
              not: null,
            }),
          }),
        }),
      );
    });
  });

  describe('Metric 3: Repeat Businesses', () => {
    const fixedNow = new Date('2026-11-15T12:00:00.000Z');

    it('counts businesses where agent closed a placement and the business already had an earlier joined placement', async () => {
      const closedPlacement = {
        id: 'pl-repeat-1',
        code: 'PL-RPT-01',
        createdByStaffId: mockAgentId,
        joinedDate: new Date('2026-11-10T10:00:00.000Z'),
        businessId: 'biz-loyal',
        business: { id: 'biz-loyal', code: 'BZ-LOYAL' },
        payments: [
          {
            id: 'pay-rpt-1',
            type: 'placement_fee',
            status: 'succeeded',
            createdAt: new Date('2026-11-11T10:00:00.000Z'),
            updatedAt: new Date('2026-11-11T10:00:00.000Z'),
          },
        ],
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([closedPlacement]);

      // prisma.placement.findFirst finds an earlier joined placement for biz-loyal
      prismaMock.placement.findFirst.mockResolvedValueOnce({
        id: 'earlier-pl-id',
      });

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.repeatBusinesses).toBe(1);
      expect(result.details.repeatBusinesses.count).toBe(1);
      expect(result.details.repeatBusinesses.businessCodes).toEqual(['BZ-LOYAL']);
      expect(prismaMock.placement.findFirst).toHaveBeenCalledWith({
        where: {
          businessId: 'biz-loyal',
          id: { not: 'pl-repeat-1' },
          joinedDate: {
            not: null,
            lt: new Date('2026-11-10T10:00:00.000Z'),
          },
        },
        select: { id: true },
      });
    });

    it('does NOT count first-time businesses with no prior joined placements', async () => {
      const closedPlacement = {
        id: 'pl-first-time',
        code: 'PL-NEW-01',
        createdByStaffId: mockAgentId,
        joinedDate: new Date('2026-11-10T10:00:00.000Z'),
        businessId: 'biz-new',
        business: { id: 'biz-new', code: 'BZ-NEW' },
        payments: [
          {
            id: 'pay-new-1',
            type: 'placement_fee',
            status: 'succeeded',
            createdAt: new Date('2026-11-11T10:00:00.000Z'),
            updatedAt: new Date('2026-11-11T10:00:00.000Z'),
          },
        ],
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([closedPlacement]);

      // No prior joined placement
      prismaMock.placement.findFirst.mockResolvedValueOnce(null);

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.repeatBusinesses).toBe(0);
      expect(result.details.repeatBusinesses.businessCodes).toEqual([]);
    });

    it('deduplicates multiple closed placements for the same repeat business within the period', async () => {
      const closedPl1 = {
        id: 'pl-rpt-a',
        code: 'PL-RPT-A',
        createdByStaffId: mockAgentId,
        joinedDate: new Date('2026-11-05T10:00:00.000Z'),
        businessId: 'biz-repeat-multi',
        business: { id: 'biz-repeat-multi', code: 'BZ-MULTI' },
        payments: [
          {
            id: 'pay-a',
            type: 'placement_fee',
            status: 'succeeded',
            createdAt: new Date('2026-11-06T10:00:00.000Z'),
            updatedAt: new Date('2026-11-06T10:00:00.000Z'),
          },
        ],
      };

      const closedPl2 = {
        id: 'pl-rpt-b',
        code: 'PL-RPT-B',
        createdByStaffId: mockAgentId,
        joinedDate: new Date('2026-11-20T10:00:00.000Z'),
        businessId: 'biz-repeat-multi',
        business: { id: 'biz-repeat-multi', code: 'BZ-MULTI' },
        payments: [
          {
            id: 'pay-b',
            type: 'placement_fee',
            status: 'succeeded',
            createdAt: new Date('2026-11-21T10:00:00.000Z'),
            updatedAt: new Date('2026-11-21T10:00:00.000Z'),
          },
        ],
      };

      prismaMock.placement.findMany.mockResolvedValueOnce([closedPl1, closedPl2]);

      prismaMock.placement.findFirst
        .mockResolvedValueOnce({ id: 'prior-october-placement' })
        .mockResolvedValueOnce({ id: 'prior-october-placement' });

      const result = await service.getFieldAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      // Even though 2 placements were closed for BZ-MULTI, it counts as 1 repeat business
      expect(result.metrics.repeatBusinesses).toBe(1);
      expect(result.details.repeatBusinesses.count).toBe(1);
      expect(result.details.repeatBusinesses.businessCodes).toEqual(['BZ-MULTI']);
    });
  });

  describe('Timezone Month Bucketing & Boundaries', () => {
    it('buckets events in Asia/Kolkata correctly at 00:30 IST and 23:30 IST boundaries', async () => {
      const period = getPeriodBoundaries(2026, 11, 'Asia/Kolkata');

      // 00:30 IST Nov 1 (2026-10-31T19:00:00.000Z) is inside November period
      const eventNov1At0030 = new Date('2026-10-31T19:00:00.000Z');
      expect(eventNov1At0030.getTime() >= period.startUtc.getTime()).toBe(true);
      expect(eventNov1At0030.getTime() <= period.endUtc.getTime()).toBe(true);

      // 23:30 IST Oct 31 (2026-10-31T18:00:00.000Z) is BEFORE November period
      const eventOct31At2330 = new Date('2026-10-31T18:00:00.000Z');
      expect(eventOct31At2330.getTime() < period.startUtc.getTime()).toBe(true);
    });
  });

  describe('RBAC & Scoping Rules', () => {
    it('allows Field Agent to view own metrics using staffId or "me"', async () => {
      const resById = await service.getFieldAgentMetrics(mockAgentId, 2026, 11, fieldAgentUser);
      expect(resById.staffId).toBe(mockAgentId);

      const resByMe = await service.getFieldAgentMetrics('me', 2026, 11, fieldAgentUser);
      expect(resByMe.staffId).toBe(mockAgentId);

      const otherAgentRes = await service.getFieldAgentMetrics(otherAgentId, 2026, 11, otherAgentUser);
      expect(otherAgentRes.staffId).toBe(otherAgentId);
    });

    it('refuses Field Agent attempting to view another agent metrics (403 Forbidden)', async () => {
      await expect(
        service.getFieldAgentMetrics(otherAgentId, 2026, 11, fieldAgentUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Team Lead to view their own subordinate metrics', async () => {
      const res = await service.getFieldAgentMetrics(mockAgentId, 2026, 11, teamLeadUser);
      expect(res.staffId).toBe(mockAgentId);

      const otherLeadRes = await service.getFieldAgentMetrics(otherAgentId, 2026, 11, otherTeamLeadUser);
      expect(otherLeadRes.staffId).toBe(otherAgentId);
    });

    it('refuses Team Lead attempting to view another team lead subordinate (403 Forbidden)', async () => {
      await expect(
        service.getFieldAgentMetrics(otherAgentId, 2026, 11, teamLeadUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows CEO and Manager to view any field agent metrics', async () => {
      const mgrRes = await service.getFieldAgentMetrics(mockAgentId, 2026, 11, managerUser);
      expect(mgrRes.staffId).toBe(mockAgentId);

      const ceoRes = await service.getFieldAgentMetrics(otherAgentId, 2026, 11, ceoUser);
      expect(ceoRes.staffId).toBe(otherAgentId);
    });

    it('refuses Finance role entirely (403 Forbidden)', async () => {
      await expect(
        service.getFieldAgentMetrics(mockAgentId, 2026, 11, financeUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses metrics calculation for staff with non-field_agent role (400 Bad Request)', async () => {
      await expect(
        service.getFieldAgentMetrics('call-agent-uuid', 2026, 11, managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for non-existent staff ID', async () => {
      await expect(
        service.getFieldAgentMetrics('non-existent-uuid', 2026, 11, managerUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

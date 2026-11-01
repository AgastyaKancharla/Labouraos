import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CallAgentMetricsService } from './call-agent-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { getPeriodBoundaries } from '../../common/time/period-boundary';

describe('Phase 6.7 Task 3: Call Agent Metrics', () => {
  type MockPrismaService = {
    staff: { findUnique: jest.Mock };
    jobSeeker: { count: jest.Mock; findMany: jest.Mock };
    vacancy: { count: jest.Mock };
    payment: { findMany: jest.Mock };
  };

  let service: CallAgentMetricsService;
  let prismaMock: MockPrismaService;

  const mockAgentId = 'agent-uuid-001';
  const mockTeamLeadId = 'lead-uuid-001';
  const otherTeamLeadId = 'lead-uuid-002';
  const otherAgentId = 'agent-uuid-002';

  const mockAgentStaff = {
    id: mockAgentId,
    code: 'CA-00001',
    name: 'Call Agent One',
    role: 'call_agent',
    area: 'Koramangala',
    city: 'Bengaluru',
    teamLeadId: mockTeamLeadId,
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const callAgentUser: JwtPayload = {
    sub: mockAgentId,
    code: 'CA-00001',
    email: 'ca1@laboura.local',
    role: 'call_agent',
    area: 'Koramangala',
  };

  const otherAgentUser: JwtPayload = {
    sub: otherAgentId,
    code: 'CA-00002',
    email: 'ca2@laboura.local',
    role: 'call_agent',
    area: 'Indiranagar',
  };

  const teamLeadUser: JwtPayload = {
    sub: mockTeamLeadId,
    code: 'TL-00001',
    email: 'lead1@laboura.local',
    role: 'team_lead',
    area: 'Koramangala',
  };

  const otherTeamLeadUser: JwtPayload = {
    sub: otherTeamLeadId,
    code: 'TL-00002',
    email: 'lead2@laboura.local',
    role: 'team_lead',
    area: 'Indiranagar',
  };

  const managerUser: JwtPayload = {
    sub: 'mgr-uuid-001',
    code: 'MGR-00001',
    email: 'mgr@laboura.local',
    role: 'manager',
    area: 'Koramangala',
  };

  const ceoUser: JwtPayload = {
    sub: 'ceo-uuid-001',
    code: 'CEO-00001',
    email: 'ceo@laboura.local',
    role: 'ceo',
    area: 'Koramangala',
  };

  const financeUser: JwtPayload = {
    sub: 'fin-uuid-001',
    code: 'FIN-00001',
    email: 'fin@laboura.local',
    role: 'finance',
    area: 'Koramangala',
  };

  beforeEach(() => {
    prismaMock = {
      staff: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === mockAgentId) return Promise.resolve(mockAgentStaff);
          if (where.id === otherAgentId) {
            return Promise.resolve({
              ...mockAgentStaff,
              id: otherAgentId,
              code: 'CA-00002',
              teamLeadId: otherTeamLeadId,
            });
          }
          if (where.id === 'field-agent-uuid') {
            return Promise.resolve({
              ...mockAgentStaff,
              id: 'field-agent-uuid',
              code: 'FA-00001',
              role: 'field_agent',
            });
          }
          return Promise.resolve(null);
        }),
      },
      jobSeeker: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      vacancy: {
        count: jest.fn().mockResolvedValue(0),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new CallAgentMetricsService(prismaMock as unknown as PrismaService);
  });

  describe('Metric 1: Candidates Activated', () => {
    it('counts job seekers registeredByStaffId = this agent whose ₹499 was received within period', async () => {
      // Evaluation period: November 2026 (Asia/Kolkata)
      // startUtc: 2026-10-31T18:30:00.000Z, endUtc: 2026-11-30T18:29:59.999Z
      prismaMock.jobSeeker.count.mockResolvedValue(7);

      const result = await service.getCallAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        new Date('2026-11-15T12:00:00.000Z'),
      );

      expect(result.metrics.candidatesActivated).toBe(7);
      expect(prismaMock.jobSeeker.count).toHaveBeenCalledWith({
        where: {
          registeredByStaffId: mockAgentId,
          paymentReceivedAt: {
            not: null,
            gte: new Date('2026-10-31T18:30:00.000Z'),
            lte: new Date('2026-11-30T18:29:59.999Z'),
          },
        },
      });
    });

    it('excludes candidate activations outside the month boundary or with null attribution', async () => {
      // In the database query, Prisma enforces registeredByStaffId = mockAgentId (ignoring null)
      // and paymentReceivedAt within [startUtc, endUtc].
      prismaMock.jobSeeker.count.mockResolvedValue(0);

      const result = await service.getCallAgentMetrics(
        mockAgentId,
        2026,
        11,
        ceoUser,
        new Date('2026-11-15T12:00:00.000Z'),
      );

      expect(result.metrics.candidatesActivated).toBe(0);
    });
  });

  describe('Metric 2: Refund Rate on Own Registrations', () => {
    const fixedNow = new Date('2026-11-15T12:00:00.000Z');
    // November 2026 startUtc: 2026-10-31T18:30:00.000Z
    // startPaymentDate = startUtc - 30 days = 2026-10-01T18:30:00.000Z
    const startPaymentDate = new Date(new Date('2026-10-31T18:30:00.000Z').getTime() - 30 * 24 * 60 * 60 * 1000);
    // For fixedNow (Nov 15 12:00:00 UTC), maxPaymentDate = fixedNow - 30 days = 2026-10-16T12:00:00.000Z
    const thirtyDaysAgo = new Date(fixedNow.getTime() - 30 * 24 * 60 * 60 * 1000);

    it('returns null refundRate when denominator is zero (no matured registrations in period cohort)', async () => {
      // Agent has registrations, but all are recent (e.g. registered 3 days ago)
      // No candidate has passed their 30-day deadline yet in this period cohort
      prismaMock.jobSeeker.findMany.mockResolvedValue([]);

      const result = await service.getCallAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.refundRate).toBeNull();
      expect(result.details.refundRate.maturedCount).toBe(0);
      expect(result.details.refundRate.refundedCount).toBe(0);
      expect(result.details.refundRate.rate).toBeNull();

      expect(prismaMock.jobSeeker.findMany).toHaveBeenCalledWith({
        where: {
          registeredByStaffId: mockAgentId,
          paymentReceivedAt: {
            not: null,
            gte: startPaymentDate,
            lte: thirtyDaysAgo,
          },
        },
        select: { id: true },
      });
      // Should not query payments if matured count is 0
      expect(prismaMock.payment.findMany).not.toHaveBeenCalled();
    });

    it('scopes denominator strictly to candidates whose 30-day deadline matured this month (excluding last month)', async () => {
      // Candidate 1: paid Sept 15 -> deadline Oct 15 (matured LAST month -> excluded by gte: startPaymentDate)
      // Candidate 2: paid Oct 10 -> deadline Nov 9 (matured THIS month -> included in denominator)
      // Candidate 3: paid Nov 12 -> deadline Dec 12 (matures NEXT month -> excluded by lte: maxPaymentDate)
      prismaMock.jobSeeker.findMany.mockResolvedValue([
        { id: 'js-oct10-matured-nov9' },
      ]);
      prismaMock.payment.findMany.mockResolvedValue([]);

      const result = await service.getCallAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.details.refundRate.maturedCount).toBe(1);
      expect(prismaMock.jobSeeker.findMany).toHaveBeenCalledWith({
        where: {
          registeredByStaffId: mockAgentId,
          paymentReceivedAt: {
            not: null,
            gte: startPaymentDate,
            lte: thirtyDaysAgo,
          },
        },
        select: { id: true },
      });
    });

    it('computes refund rate as 0.0 when denominator is non-zero and refunds are zero', async () => {
      prismaMock.jobSeeker.findMany.mockResolvedValue([
        { id: 'js-1' },
        { id: 'js-2' },
        { id: 'js-3' },
      ]);
      prismaMock.payment.findMany.mockResolvedValue([]);

      const result = await service.getCallAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.refundRate).toBe(0);
      expect(result.details.refundRate.maturedCount).toBe(3);
      expect(result.details.refundRate.refundedCount).toBe(0);
      expect(result.details.refundRate.rate).toBe(0);
    });

    it('computes exact refund rate when some matured candidates were refunded', async () => {
      prismaMock.jobSeeker.findMany.mockResolvedValue([
        { id: 'js-1' },
        { id: 'js-2' },
        { id: 'js-3' },
        { id: 'js-4' },
        { id: 'js-5' },
      ]);
      // 1 of the 5 was refunded
      prismaMock.payment.findMany.mockResolvedValue([
        { jobSeekerId: 'js-2' },
      ]);

      const result = await service.getCallAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.refundRate).toBe(0.2); // 1 / 5 = 0.2 (20%)
      expect(result.details.refundRate.maturedCount).toBe(5);
      expect(result.details.refundRate.refundedCount).toBe(1);
    });

    it('deduplicates duplicate refund payment rows for the same job seeker', async () => {
      prismaMock.jobSeeker.findMany.mockResolvedValue([
        { id: 'js-1' },
        { id: 'js-2' },
      ]);
      // Prisma distinct query guarantees distinct jobSeekerId
      prismaMock.payment.findMany.mockResolvedValue([
        { jobSeekerId: 'js-1' },
      ]);

      const result = await service.getCallAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        fixedNow,
      );

      expect(result.metrics.refundRate).toBe(0.5); // 1 / 2 = 50%
      expect(result.details.refundRate.refundedCount).toBe(1);
    });
  });

  describe('Metric 3: Vacancies Captured', () => {
    it('counts vacancies with capturedByStaffId = this agent created within period', async () => {
      prismaMock.vacancy.count.mockResolvedValue(12);

      const result = await service.getCallAgentMetrics(
        mockAgentId,
        2026,
        11,
        managerUser,
        new Date('2026-11-15T12:00:00.000Z'),
      );

      expect(result.metrics.vacanciesCaptured).toBe(12);
      expect(prismaMock.vacancy.count).toHaveBeenCalledWith({
        where: {
          capturedByStaffId: mockAgentId,
          createdAt: {
            gte: new Date('2026-10-31T18:30:00.000Z'),
            lte: new Date('2026-11-30T18:29:59.999Z'),
          },
        },
      });
    });
  });

  describe('Timezone Month Bucketing & Boundary Cases', () => {
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
    it('allows Call Agent to access own metrics (using staffId or "me")', async () => {
      const resById = await service.getCallAgentMetrics(mockAgentId, 2026, 11, callAgentUser);
      expect(resById.staffId).toBe(mockAgentId);

      const resByMe = await service.getCallAgentMetrics('me', 2026, 11, callAgentUser);
      expect(resByMe.staffId).toBe(mockAgentId);

      const otherAgentRes = await service.getCallAgentMetrics(otherAgentId, 2026, 11, otherAgentUser);
      expect(otherAgentRes.staffId).toBe(otherAgentId);
    });

    it('refuses Call Agent attempting to view another agent metrics (403 Forbidden)', async () => {
      await expect(
        service.getCallAgentMetrics(otherAgentId, 2026, 11, callAgentUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Team Lead to view their own subordinate metrics', async () => {
      const res = await service.getCallAgentMetrics(mockAgentId, 2026, 11, teamLeadUser);
      expect(res.staffId).toBe(mockAgentId);

      const otherLeadRes = await service.getCallAgentMetrics(otherAgentId, 2026, 11, otherTeamLeadUser);
      expect(otherLeadRes.staffId).toBe(otherAgentId);
    });

    it('refuses Team Lead attempting to view another team lead subordinate (403 Forbidden)', async () => {
      await expect(
        service.getCallAgentMetrics(otherAgentId, 2026, 11, teamLeadUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows CEO and Manager to view any call agent metrics', async () => {
      const mgrRes = await service.getCallAgentMetrics(mockAgentId, 2026, 11, managerUser);
      expect(mgrRes.staffId).toBe(mockAgentId);

      const ceoRes = await service.getCallAgentMetrics(otherAgentId, 2026, 11, ceoUser);
      expect(ceoRes.staffId).toBe(otherAgentId);
    });

    it('refuses Finance role entirely (403 Forbidden)', async () => {
      await expect(
        service.getCallAgentMetrics(mockAgentId, 2026, 11, financeUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses metrics calculation for staff with non-call_agent role (400 Bad Request)', async () => {
      await expect(
        service.getCallAgentMetrics('field-agent-uuid', 2026, 11, managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for non-existent staff ID', async () => {
      await expect(
        service.getCallAgentMetrics('non-existent-uuid', 2026, 11, managerUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

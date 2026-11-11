import { ForbiddenException } from '@nestjs/common';
import { TargetOverviewService } from './target-overview.service';
import { TargetService } from './target.service';
import { CallAgentMetricsService } from './call-agent-metrics.service';
import { FieldAgentMetricsService } from './field-agent-metrics.service';
import { MoneyAtRiskService } from './money-at-risk.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { WorkingDaysService } from '../attendance/working-days.service';
import { BEHIND_PACE_START_DAY, BEHIND_PACE_THRESHOLD, MIN_REFUND_RATE_DENOMINATOR } from './target.constants';

interface MockStaffRecord {
  id: string;
  code: string;
  name: string;
  role: string;
  city: string;
  createdAt: Date;
  teamLeadId: string | null;
  status: string;
}

interface MockTargetRecord {
  id: string;
  staffId: string;
  year: number;
  month: number;
  candidatesActivated: number | null;
  refundRate: number | null;
  vacanciesCaptured: number | null;
  placementsClosed: number | null;
  replacementsInside15Days: number | null;
  repeatBusinesses: number | null;
  createdAt: Date;
}

interface MockCallAgentMetricRecord {
  staffId: string;
  metrics: {
    candidatesActivated: number;
    vacanciesCaptured: number;
    refundRate: number | null;
  };
  details: {
    refundRate?: {
      maturedCount: number;
      refundedCount: number;
      rate: number | null;
    };
  };
}

interface MockFieldAgentMetricRecord {
  staffId: string;
  metrics: {
    placementsClosed: number;
    replacementsSecuredInside15Days: number;
    repeatBusinesses: number;
  };
  details: Record<string, unknown>;
}

describe('Phase 6.7 Task 6: Target Overview & Behind-Pace Flagging', () => {
  let service: TargetOverviewService;
  let targetService: TargetService;
  let callAgentMetricsService: CallAgentMetricsService;
  let fieldAgentMetricsService: FieldAgentMetricsService;
  let moneyAtRiskService: MoneyAtRiskService;

  const mockCallAgentId = 'ca-uuid-001';
  const mockFieldAgentId = 'fa-uuid-001';
  const otherAgentId = 'ca-uuid-002';
  const mockTeamLeadId = 'tl-uuid-001';
  const otherTeamLeadId = 'tl-uuid-002';

  const callAgentUser: JwtPayload = {
    sub: mockCallAgentId,
    code: 'CA-00001',
    email: 'ca1@laboura.local',
    role: 'call_agent',
  };

  const fieldAgentUser: JwtPayload = {
    sub: mockFieldAgentId,
    code: 'FA-00001',
    email: 'fa1@laboura.local',
    role: 'field_agent',
  };

  const otherAgentUser: JwtPayload = {
    sub: otherAgentId,
    code: 'CA-00002',
    email: 'ca2@laboura.local',
    role: 'call_agent',
  };

  const teamLeadUser: JwtPayload = {
    sub: mockTeamLeadId,
    code: 'TL-00001',
    email: 'tl1@laboura.local',
    role: 'team_lead',
  };

  const otherTeamLeadUser: JwtPayload = {
    sub: otherTeamLeadId,
    code: 'TL-00002',
    email: 'tl2@laboura.local',
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

  const mockStaffRecords: Record<string, MockStaffRecord> = {
    [mockCallAgentId]: {
      id: mockCallAgentId,
      code: 'CA-00001',
      name: 'Call Agent 1',
      role: 'call_agent',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: mockTeamLeadId,
      status: 'active',
    },
    [mockFieldAgentId]: {
      id: mockFieldAgentId,
      code: 'FA-00001',
      name: 'Field Agent 1',
      role: 'field_agent',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: mockTeamLeadId,
      status: 'active',
    },
    [otherAgentId]: {
      id: otherAgentId,
      code: 'CA-00002',
      name: 'Other Agent 2',
      role: 'call_agent',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: otherTeamLeadId,
      status: 'active',
    },
    [mockTeamLeadId]: {
      id: mockTeamLeadId,
      code: 'TL-00001',
      name: 'Team Lead 1',
      role: 'team_lead',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: null,
      status: 'active',
    },
    [otherTeamLeadId]: {
      id: otherTeamLeadId,
      code: 'TL-00002',
      name: 'Team Lead 2',
      role: 'team_lead',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: null,
      status: 'active',
    },
    'mgr-uuid-001': {
      id: 'mgr-uuid-001',
      code: 'MGR-00001',
      name: 'Manager 1',
      role: 'manager',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: null,
      status: 'active',
    },
    'ceo-uuid-001': {
      id: 'ceo-uuid-001',
      code: 'CEO-00001',
      name: 'CEO 1',
      role: 'ceo',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: null,
      status: 'active',
    },
  };

  let mockTargets: Record<string, MockTargetRecord> = {};
  let mockCallAgentMetrics: Record<string, MockCallAgentMetricRecord> = {};
  let mockFieldAgentMetrics: Record<string, MockFieldAgentMetricRecord> = {};

  beforeEach(() => {
    mockTargets = {};
    mockCallAgentMetrics = {};
    mockFieldAgentMetrics = {};

    const prismaMock = {
      staff: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          return Promise.resolve(mockStaffRecords[where.id] ?? null);
        }),
        findMany: jest.fn().mockImplementation(({ where }: { where?: { teamLeadId?: string; role?: { in: string[] } } }) => {
          let list = Object.values(mockStaffRecords);
          if (where?.teamLeadId) {
            list = list.filter((s) => s.teamLeadId === where.teamLeadId);
          }
          if (where?.role?.in) {
            list = list.filter((s) => where.role!.in.includes(s.role));
          }
          return Promise.resolve(list);
        }),
      },
      target: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { staffId_year_month: { staffId: string; year: number; month: number } } }) => {
          const key = `${where.staffId_year_month.staffId}-${where.staffId_year_month.year}-${where.staffId_year_month.month}`;
          const target = mockTargets[key];
          if (!target) return Promise.resolve(null);
          return Promise.resolve({
            ...target,
            staff: mockStaffRecords[target.staffId],
          });
        }),
      },
    };

    targetService = new TargetService(
      prismaMock as unknown as PrismaService,
      { log: jest.fn() } as unknown as AuditService,
    );

    callAgentMetricsService = {
      getCallAgentMetrics: jest.fn().mockImplementation((staffId: string) => {
        return Promise.resolve(
          mockCallAgentMetrics[staffId] ?? {
            staffId,
            metrics: {
              candidatesActivated: 0,
              vacanciesCaptured: 0,
              refundRate: null,
            },
            details: {
              refundRate: {
                maturedCount: 0,
                refundedCount: 0,
                rate: null,
              },
            },
          },
        );
      }),
    } as unknown as CallAgentMetricsService;

    fieldAgentMetricsService = {
      getFieldAgentMetrics: jest.fn().mockImplementation((staffId: string) => {
        return Promise.resolve(
          mockFieldAgentMetrics[staffId] ?? {
            staffId,
            metrics: {
              placementsClosed: 0,
              replacementsSecuredInside15Days: 0,
              repeatBusinesses: 0,
            },
            details: {},
          },
        );
      }),
    } as unknown as FieldAgentMetricsService;

    moneyAtRiskService = {
      getMoneyAtRisk: jest.fn().mockResolvedValue({
        scope: 'agent',
        totalAtRiskRupees: 499,
        totalAtRiskPaise: 49900,
        candidatesCount: 1,
        candidatesAtRiskPaise: 49900,
        placementsCount: 0,
        placementsAtRiskPaise: 0,
        rows: [],
      }),
    } as unknown as MoneyAtRiskService;

    service = new TargetOverviewService(
      prismaMock as unknown as PrismaService,
      targetService,
      callAgentMetricsService,
      fieldAgentMetricsService,
      moneyAtRiskService,
    );
  });

  describe('Server-side Visibility Scopes & RBAC', () => {
    it('finance is refused with 403 Forbidden', async () => {
      await expect(
        service.getOverview({ year: 2026, month: 11 }, financeUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('agent sees only their own target, achieved metrics, and money at risk', async () => {
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: 0.1,
        vacanciesCaptured: 20,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: {
          candidatesActivated: 15,
          vacanciesCaptured: 10,
          refundRate: 0.05,
        },
        details: {
          refundRate: {
            maturedCount: 10,
            refundedCount: 1,
            rate: 0.1,
          },
        },
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      expect(result.scope).toBe('agent');
      expect(result.agent?.staff.id).toBe(mockCallAgentId);
      expect(result.agent?.achieved.candidatesActivated).toBe(15);
      expect(result.moneyAtRisk).toBeDefined();
    });

    it('field agent sees their own field metrics and placements', async () => {
      mockTargets[`${mockFieldAgentId}-2026-11`] = {
        id: 'tgt-fa-1',
        staffId: mockFieldAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: null,
        refundRate: null,
        vacanciesCaptured: null,
        placementsClosed: 12,
        replacementsInside15Days: 2,
        repeatBusinesses: 3,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      mockFieldAgentMetrics[mockFieldAgentId] = {
        staffId: mockFieldAgentId,
        metrics: {
          placementsClosed: 10,
          replacementsSecuredInside15Days: 2,
          repeatBusinesses: 2,
        },
        details: {},
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        fieldAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      expect(result.scope).toBe('agent');
      expect(result.agent?.staff.id).toBe(mockFieldAgentId);
      expect(result.agent?.achieved.placementsClosed).toBe(10);
    });

    it('agent attempting to access another staff member throws 403 Forbidden', async () => {
      await expect(
        service.getOverview({ staffId: otherAgentId, year: 2026, month: 11 }, callAgentUser),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.getOverview({ staffId: mockCallAgentId, year: 2026, month: 11 }, otherAgentUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('team lead sees only their supervised agents, team aggregate total, and team money at risk', async () => {
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: 0.1,
        vacanciesCaptured: 20,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      mockTargets[`${mockFieldAgentId}-2026-11`] = {
        id: 'tgt-fa-1',
        staffId: mockFieldAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: null,
        refundRate: null,
        vacanciesCaptured: null,
        placementsClosed: 10,
        replacementsInside15Days: 3,
        repeatBusinesses: 2,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 20, vacanciesCaptured: 15, refundRate: 0.05 },
        details: { refundRate: { maturedCount: 10, refundedCount: 1, rate: 0.1 } },
      };

      mockFieldAgentMetrics[mockFieldAgentId] = {
        staffId: mockFieldAgentId,
        metrics: { placementsClosed: 8, replacementsSecuredInside15Days: 2, repeatBusinesses: 2 },
        details: {},
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        teamLeadUser,
        new Date('2026-11-20T12:00:00+05:30'),
      );

      expect(result.scope).toBe('team');
      expect(result.teamLead?.id).toBe(mockTeamLeadId);
      // Only agents supervised by this team lead (mockCallAgentId and mockFieldAgentId)
      expect(result.agents).toHaveLength(2);
      expect(result.agents.map((a) => a.staff.id)).toEqual([mockCallAgentId, mockFieldAgentId]);
      // otherAgentId belongs to otherTeamLeadId, must NOT be present
      expect(result.agents.find((a) => a.staff.id === otherAgentId)).toBeUndefined();

      // Team aggregate total
      expect(result.teamTotal).toBeDefined();
      expect(result.teamTotal?.agentsCount).toBe(2);
      expect(result.teamTotal?.achieved.candidatesActivated).toBe(20);
      expect(result.teamTotal?.achieved.placementsClosed).toBe(8);
      expect(result.teamTotal?.achieved.refundRate).toBe(0.1);
    });

    it('team lead can query a specific agent on their own team', async () => {
      const result = await service.getOverview(
        { staffId: mockCallAgentId, year: 2026, month: 11 },
        teamLeadUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );
      expect(result.scope).toBe('agent');
      expect(result.agent?.staff.id).toBe(mockCallAgentId);
    });

    it('team lead attempting to access an agent on another team throws 403 Forbidden', async () => {
      await expect(
        service.getOverview({ staffId: otherAgentId, year: 2026, month: 11 }, teamLeadUser),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.getOverview({ staffId: mockCallAgentId, year: 2026, month: 11 }, otherTeamLeadUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('ceo and manager see all agents city-wide and city totals', async () => {
      const result = await service.getOverview(
        { year: 2026, month: 11 },
        managerUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );
      expect(result.scope).toBe('city');
      expect(result.agents.length).toBe(3); // All 3 agents
      expect(result.totals).toBeDefined();
    });

    it('ceo and manager can query any specific agent', async () => {
      const result = await service.getOverview(
        { staffId: otherAgentId, year: 2026, month: 11 },
        ceoUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );
      expect(result.scope).toBe('agent');
      expect(result.agent?.staff.id).toBe(otherAgentId);
    });
  });

  describe('Behind-Pace Flagging Rules', () => {
    it('counts pace in working days: weekly days off and public holidays are left out', async () => {
      // November 2026: Sundays 1, 8, 15, 22, 29 and a holiday on the 10th → 24 working days.
      // On the 15th, 11 working days have passed: expected pace = 30 × 11 / 24.
      const holidays = new Set(['2026-11-10']);
      const workingDays = {
        calendar: async (from: Date, to: Date) => {
          const workingDates: Date[] = [];
          for (let at = from.getTime(); at <= to.getTime(); at += 24 * 3600 * 1000) {
            const date = new Date(at);
            if (date.getUTCDay() !== 0 && !holidays.has(date.toISOString().slice(0, 10))) {
              workingDates.push(date);
            }
          }
          return { workingDates, weeklyOffs: [], holidays: [] };
        },
      } as unknown as WorkingDaysService;
      const withCalendar = new TargetOverviewService(
        (service as unknown as { prisma: PrismaService }).prisma,
        targetService,
        callAgentMetricsService,
        fieldAgentMetricsService,
        moneyAtRiskService,
        workingDays,
      );
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-wd',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: null,
        vacanciesCaptured: null,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };
      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 11, vacanciesCaptured: 0, refundRate: null },
        details: {},
      };
      const result = await withCalendar.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );
      expect(result.agent?.metrics.candidatesActivated.expectedPace).toBeCloseTo((30 * 11) / 24, 6);
      // 11 achieved is above 80% of 13.75, so not behind on working days.
      expect(result.agent?.metrics.candidatesActivated.isBehindPace).toBe(false);
    });

    it('an agent at 50% of expected pace on day 15 is flagged', async () => {
      // November has 30 days. Target = 30 candidates.
      // On day 15, expected pace = 30 * (15/30) = 15.
      // 80% pace threshold = 0.8 * 15 = 12.
      // Achieved = 7 (50% of expected pace, 7 < 12) -> flagged!
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: null,
        vacanciesCaptured: null,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 7, vacanciesCaptured: 0, refundRate: null },
        details: {},
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-15T12:00:00+05:30'), // Day 15 IST
      );

      expect(result.agent?.metrics.candidatesActivated.expectedPace).toBe(15);
      expect(result.agent?.metrics.candidatesActivated.isBehindPace).toBe(true);
      expect(result.agent?.isBehindPace).toBe(true);
    });

    it('the same agent on day 5 (before day 8) is NOT flagged', async () => {
      // On day 5, day < BEHIND_PACE_START_DAY (8), so slow first week does NOT flag.
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: null,
        vacanciesCaptured: null,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 1, vacanciesCaptured: 0, refundRate: null },
        details: {},
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-05T12:00:00+05:30'), // Day 5 IST
      );

      expect(result.agent?.metrics.candidatesActivated.isBehindPace).toBe(false);
      expect(result.agent?.isBehindPace).toBe(false);
    });

    it('behind-pace flagging applies ONLY to higher-is-better metrics; refund rate is never flagged as behind pace', async () => {
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: 0.1,
        vacanciesCaptured: null,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      // Candidate activations on pace (15 on day 15), but high refund rate (0.50)
      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 15, vacanciesCaptured: 0, refundRate: 0.5 },
        details: { refundRate: { maturedCount: 10, refundedCount: 5, rate: 0.5 } },
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      // Volume metric is on pace
      expect(result.agent?.metrics.candidatesActivated.isBehindPace).toBe(false);
      // Refund rate is a ceiling metric, pace flagging NEVER applies to it
      expect(result.agent?.metrics.refundRate.isBehindPace).toBe(false);
      // Overall agent behind pace is false
      expect(result.agent?.isBehindPace).toBe(false);
    });

    it('a metric with status not_targeted or not_measured is never flagged', async () => {
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: null,
        vacanciesCaptured: null, // not targeted
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 15, vacanciesCaptured: 0, refundRate: null },
        details: {},
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      expect(result.agent?.metrics.vacanciesCaptured.status).toBe('not_targeted');
      expect(result.agent?.metrics.vacanciesCaptured.isBehindPace).toBe(false);
    });

    it('mid-month joiner expected pace correctly scales from their start day', async () => {
      // Create a mid-month joiner on Nov 20 in a 30-day month
      const midMonthStaffId = 'mid-month-uuid-001';
      mockStaffRecords[midMonthStaffId] = {
        id: midMonthStaffId,
        code: 'CA-00099',
        name: 'Mid Month Agent',
        role: 'call_agent',
        city: 'Bengaluru',
        createdAt: new Date('2026-11-20T10:00:00+05:30'),
        teamLeadId: mockTeamLeadId,
        status: 'active',
      };

      // Full target = 30.
      // Pro-rating: worked Nov 20 to 30 = 11 days.
      // Factor = 11/30. Effective target = floor(30 * 11/30) = 11.
      mockTargets[`${midMonthStaffId}-2026-11`] = {
        id: 'tgt-mid-1',
        staffId: midMonthStaffId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: null,
        vacanciesCaptured: null,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-20T00:00:00Z'),
      };

      // On Nov 25:
      // Current day = 25 (>= 8). Days from start (20th) = 25 - 20 + 1 = 6 days.
      // Days in period = 11 days.
      // Expected pace = 11 * (6 / 11) = 6.
      // Threshold = 0.8 * 6 = 4.8.
      // If achieved = 3 (< 4.8) -> flagged!
      mockCallAgentMetrics[midMonthStaffId] = {
        staffId: midMonthStaffId,
        metrics: { candidatesActivated: 3, vacanciesCaptured: 0, refundRate: null },
        details: {},
      };

      const result = await service.getOverview(
        { staffId: midMonthStaffId, year: 2026, month: 11 },
        ceoUser,
        new Date('2026-11-25T12:00:00+05:30'),
      );

      expect(result.agent?.target?.effective.candidatesActivated).toBe(11);
      expect(result.agent?.metrics.candidatesActivated.expectedPace).toBe(6);
      expect(result.agent?.metrics.candidatesActivated.isBehindPace).toBe(true);
    });
  });

  describe('Refund Rate Breach Flagging Rules', () => {
    it('refund rate breach flag fires when actual rate exceeds threshold with maturedCount >= 5', async () => {
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: 0.1, // 10% ceiling
        vacanciesCaptured: null,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      // 10 matured, 3 refunded -> 30% refund rate (> 10%) with denominator 10 (>= 5)
      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 15, vacanciesCaptured: 0, refundRate: 0.3 },
        details: { refundRate: { maturedCount: 10, refundedCount: 3, rate: 0.3 } },
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      expect(result.agent?.metrics.refundRate.isBreached).toBe(true);
      expect(result.agent?.isBreached).toBe(true);
    });

    it('refund rate breach flag does NOT fire when maturedCount < MIN_REFUND_RATE_DENOMINATOR (5)', async () => {
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: 0.1,
        vacanciesCaptured: null,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      // 2 matured, 1 refunded -> 50% rate, BUT sample size is only 2 (< 5)
      // Small sample is noise, NOT a breach signal!
      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 15, vacanciesCaptured: 0, refundRate: 0.5 },
        details: { refundRate: { maturedCount: 2, refundedCount: 1, rate: 0.5 } },
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      expect(result.agent?.metrics.refundRate.isBreached).toBe(false);
      expect(result.agent?.isBreached).toBe(false);
    });

    it('refund rate breach flag does NOT fire when denominator is zero', async () => {
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: 0.1,
        vacanciesCaptured: null,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 15, vacanciesCaptured: 0, refundRate: null },
        details: { refundRate: { maturedCount: 0, refundedCount: 0, rate: null } },
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      expect(result.agent?.metrics.refundRate.isBreached).toBe(false);
      expect(result.agent?.isBreached).toBe(false);
    });

    it('refund rate breach flag does NOT fire when refund rate is not targeted', async () => {
      mockTargets[`${mockCallAgentId}-2026-11`] = {
        id: 'tgt-ca-1',
        staffId: mockCallAgentId,
        year: 2026,
        month: 11,
        candidatesActivated: 30,
        refundRate: null, // Not targeted
        vacanciesCaptured: null,
        placementsClosed: null,
        replacementsInside15Days: null,
        repeatBusinesses: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      };

      mockCallAgentMetrics[mockCallAgentId] = {
        staffId: mockCallAgentId,
        metrics: { candidatesActivated: 15, vacanciesCaptured: 0, refundRate: 0.4 },
        details: { refundRate: { maturedCount: 10, refundedCount: 4, rate: 0.4 } },
      };

      const result = await service.getOverview(
        { year: 2026, month: 11 },
        callAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      expect(result.agent?.metrics.refundRate.isBreached).toBe(false);
      expect(result.agent?.isBreached).toBe(false);
    });
  });

  describe('Constants Verification', () => {
    it('constants match specified domain values', () => {
      expect(BEHIND_PACE_THRESHOLD).toBe(0.8);
      expect(BEHIND_PACE_START_DAY).toBe(8);
      expect(MIN_REFUND_RATE_DENOMINATOR).toBe(5);
    });
  });
});

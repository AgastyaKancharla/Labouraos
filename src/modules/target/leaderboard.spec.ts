import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { FieldAgentMetricsService } from './field-agent-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

interface MockStaffRecord {
  id: string;
  code: string;
  name: string;
  role: string;
  area: string;
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
  placementsClosed: number | null;
  candidatesActivated?: number | null;
  repeatBusinesses?: number | null;
}

describe('Phase 6.7 Task 7: Placements Leaderboard', () => {
  let service: LeaderboardService;
  let fieldAgentMetricsService: FieldAgentMetricsService;

  const fa1Id = 'fa-uuid-001';
  const fa2Id = 'fa-uuid-002';
  const fa3Id = 'fa-uuid-003';
  const faUntargetedId = 'fa-uuid-004';
  const caId = 'ca-uuid-001';

  const callAgentUser: JwtPayload = {
    sub: caId,
    code: 'CA-00001',
    email: 'ca@laboura.local',
    role: 'call_agent',
    area: 'Koramangala',
  };

  const fieldAgentUser: JwtPayload = {
    sub: fa1Id,
    code: 'FA-00001',
    email: 'fa1@laboura.local',
    role: 'field_agent',
    area: 'Koramangala',
  };

  const teamLeadUser: JwtPayload = {
    sub: 'tl-uuid-001',
    code: 'TL-00001',
    email: 'tl@laboura.local',
    role: 'team_lead',
    area: 'Koramangala',
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

  const mockStaffRecords: Record<string, MockStaffRecord> = {
    [fa1Id]: {
      id: fa1Id,
      code: 'FA-00001',
      name: 'Field Agent One',
      role: 'field_agent',
      area: 'Koramangala',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: null,
      status: 'active',
    },
    [fa2Id]: {
      id: fa2Id,
      code: 'FA-00002',
      name: 'Field Agent Two',
      role: 'field_agent',
      area: 'Indiranagar',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: null,
      status: 'active',
    },
    [fa3Id]: {
      id: fa3Id,
      code: 'FA-00003',
      name: 'Field Agent Three',
      role: 'field_agent',
      area: 'Whitefield',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: null,
      status: 'active',
    },
    [faUntargetedId]: {
      id: faUntargetedId,
      code: 'FA-00004',
      name: 'Untargeted New Agent',
      role: 'field_agent',
      area: 'Koramangala',
      city: 'Bengaluru',
      createdAt: new Date('2026-11-01T00:00:00Z'),
      teamLeadId: null,
      status: 'active',
    },
    [caId]: {
      id: caId,
      code: 'CA-00001',
      name: 'Call Agent One',
      role: 'call_agent',
      area: 'Koramangala',
      city: 'Bengaluru',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      teamLeadId: null,
      status: 'active',
    },
  };

  let mockTargets: MockTargetRecord[] = [];
  let mockMetrics: Record<string, { placementsClosed: number }> = {};

  beforeEach(() => {
    mockTargets = [];
    mockMetrics = {};

    const prismaMock = {
      target: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { year: number; month: number; placementsClosed?: { not: null }; staff?: { role: string } } }) => {
          return Promise.resolve(
            mockTargets
              .filter(
                (t) =>
                  t.year === where.year &&
                  t.month === where.month &&
                  (where.placementsClosed === undefined || t.placementsClosed !== null),
              )
              .filter((t) => {
                const s = mockStaffRecords[t.staffId];
                if (!s) return false;
                if (where.staff?.role && s.role !== where.staff.role) return false;
                return true;
              })
              .map((t) => ({
                ...t,
                staff: mockStaffRecords[t.staffId],
              })),
          );
        }),
      },
    };

    fieldAgentMetricsService = {
      getFieldAgentMetrics: jest.fn().mockImplementation((staffId: string) => {
        const count = mockMetrics[staffId]?.placementsClosed ?? 0;
        return Promise.resolve({
          staffId,
          metrics: {
            placementsClosed: count,
            replacementsSecuredInside15Days: 0,
            repeatBusinesses: 0,
          },
        });
      }),
    } as unknown as FieldAgentMetricsService;

    service = new LeaderboardService(
      prismaMock as unknown as PrismaService,
      fieldAgentMetricsService,
    );
  });

  describe('RBAC Access Control', () => {
    it('refuses finance user with 403 Forbidden', async () => {
      await expect(
        service.getLeaderboard({ year: 2026, month: 11 }, financeUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows call agents, field agents, team leads, manager and ceo', async () => {
      await expect(
        service.getLeaderboard({ year: 2026, month: 11 }, callAgentUser),
      ).resolves.toBeDefined();

      await expect(
        service.getLeaderboard({ year: 2026, month: 11 }, fieldAgentUser),
      ).resolves.toBeDefined();

      await expect(
        service.getLeaderboard({ year: 2026, month: 11 }, teamLeadUser),
      ).resolves.toBeDefined();

      await expect(
        service.getLeaderboard({ year: 2026, month: 11 }, managerUser),
      ).resolves.toBeDefined();

      await expect(
        service.getLeaderboard({ year: 2026, month: 11 }, ceoUser),
      ).resolves.toBeDefined();
    });
  });

  describe('Eligibility & Exclusion Rules', () => {
    it('ranks only field agents who have a placementsClosed target set for that period', async () => {
      // fa1 has placementsClosed target = 10
      mockTargets.push({
        id: 't-1',
        staffId: fa1Id,
        year: 2026,
        month: 11,
        placementsClosed: 10,
      });

      // fa2 has placementsClosed target = 15
      mockTargets.push({
        id: 't-2',
        staffId: fa2Id,
        year: 2026,
        month: 11,
        placementsClosed: 15,
      });

      // fa3 has target record, BUT placementsClosed is null (only targeted on repeatBusinesses)
      mockTargets.push({
        id: 't-3',
        staffId: fa3Id,
        year: 2026,
        month: 11,
        placementsClosed: null,
        repeatBusinesses: 5,
      });

      // Call agent has target record with candidatesActivated
      mockTargets.push({
        id: 't-ca',
        staffId: caId,
        year: 2026,
        month: 11,
        placementsClosed: 5, // Even if set erroneously on CA, role is call_agent
        candidatesActivated: 20,
      });

      // faUntargetedId has NO target record at all

      mockMetrics[fa1Id] = { placementsClosed: 5 };
      mockMetrics[fa2Id] = { placementsClosed: 8 };

      const result = await service.getLeaderboard(
        { year: 2026, month: 11 },
        fieldAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      // Only fa1 and fa2 are participants
      expect(result.totalParticipants).toBe(2);
      expect(result.leaderboard.map((e) => e.staffId)).toEqual([fa2Id, fa1Id]);

      // fa3 (null target), faUntargeted (no target), and call agent are absent
      expect(result.leaderboard.find((e) => e.staffId === fa3Id)).toBeUndefined();
      expect(result.leaderboard.find((e) => e.staffId === faUntargetedId)).toBeUndefined();
      expect(result.leaderboard.find((e) => e.staffId === caId)).toBeUndefined();
    });
  });

  describe('Ordering, Tie-breaking, and Target Secrecy', () => {
    it('orders by placements closed descending', async () => {
      mockTargets = [
        { id: 't-1', staffId: fa1Id, year: 2026, month: 11, placementsClosed: 10 },
        { id: 't-2', staffId: fa2Id, year: 2026, month: 11, placementsClosed: 10 },
        { id: 't-3', staffId: fa3Id, year: 2026, month: 11, placementsClosed: 10 },
      ];

      mockMetrics[fa1Id] = { placementsClosed: 3 };
      mockMetrics[fa2Id] = { placementsClosed: 12 };
      mockMetrics[fa3Id] = { placementsClosed: 7 };

      const result = await service.getLeaderboard(
        { year: 2026, month: 11 },
        fieldAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      expect(result.leaderboard).toHaveLength(3);
      expect(result.leaderboard[0]).toEqual({
        position: 1,
        staffId: fa2Id,
        staffCode: 'FA-00002',
        name: 'Field Agent Two',
        placementsClosed: 12,
      });
      expect(result.leaderboard[1]).toEqual({
        position: 2,
        staffId: fa3Id,
        staffCode: 'FA-00003',
        name: 'Field Agent Three',
        placementsClosed: 7,
      });
      expect(result.leaderboard[2]).toEqual({
        position: 3,
        staffId: fa1Id,
        staffCode: 'FA-00001',
        name: 'Field Agent One',
        placementsClosed: 3,
      });
    });

    it('breaks ties deterministically by staff code ascending (A->Z)', async () => {
      mockTargets = [
        { id: 't-1', staffId: fa1Id, year: 2026, month: 11, placementsClosed: 10 },
        { id: 't-2', staffId: fa2Id, year: 2026, month: 11, placementsClosed: 10 },
        { id: 't-3', staffId: fa3Id, year: 2026, month: 11, placementsClosed: 10 },
      ];

      // All three tied at 5 placements closed
      mockMetrics[fa1Id] = { placementsClosed: 5 };
      mockMetrics[fa2Id] = { placementsClosed: 5 };
      mockMetrics[fa3Id] = { placementsClosed: 5 };

      const result = await service.getLeaderboard(
        { year: 2026, month: 11 },
        fieldAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      // Deterministic order: FA-00001 (pos 1), FA-00002 (pos 2), FA-00003 (pos 3)
      expect(result.leaderboard.map((e) => e.staffCode)).toEqual([
        'FA-00001',
        'FA-00002',
        'FA-00003',
      ]);
      expect(result.leaderboard.map((e) => e.position)).toEqual([1, 2, 3]);
    });

    it('never exposes targets in the response', async () => {
      mockTargets = [
        { id: 't-1', staffId: fa1Id, year: 2026, month: 11, placementsClosed: 30 },
      ];
      mockMetrics[fa1Id] = { placementsClosed: 5 };

      const result = await service.getLeaderboard(
        { year: 2026, month: 11 },
        fieldAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      const entry = result.leaderboard[0] as unknown as Record<string, unknown>;
      expect(entry.target).toBeUndefined();
      expect(entry.effectiveTarget).toBeUndefined();
      expect(entry.storedTarget).toBeUndefined();
      expect(entry.placementsClosedTarget).toBeUndefined();
      expect(Object.keys(entry).sort()).toEqual([
        'name',
        'placementsClosed',
        'position',
        'staffCode',
        'staffId',
      ]);
    });

    it('defaults to current month and accepts past month query', async () => {
      mockTargets = [
        { id: 't-oct-1', staffId: fa1Id, year: 2026, month: 10, placementsClosed: 10 },
      ];
      mockMetrics[fa1Id] = { placementsClosed: 9 };

      const octResult = await service.getLeaderboard(
        { year: 2026, month: 10 },
        fieldAgentUser,
        new Date('2026-11-15T12:00:00+05:30'),
      );

      expect(octResult.period.year).toBe(2026);
      expect(octResult.period.month).toBe(10);
      expect(octResult.leaderboard).toHaveLength(1);
      expect(octResult.leaderboard[0].placementsClosed).toBe(9);
    });

    it('validates invalid year and month', async () => {
      await expect(
        service.getLeaderboard({ year: 1999, month: 11 }, ceoUser),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.getLeaderboard({ year: 2026, month: 13 }, ceoUser),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

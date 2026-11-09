import {
  ForbiddenException,
} from '@nestjs/common';
import { MoneyAtRiskService } from './money-at-risk.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PricingPolicy } from '../pricing/pricing.service';
import { SEEDED_PRICING_POLICY, seededPricingService } from '../../test-support/seeded-pricing';

describe('Phase 6.7 Task 5: Money at Risk', () => {
  type MockPrismaService = {
    staff: { findMany: jest.Mock; findUnique: jest.Mock };
    jobSeeker: { findMany: jest.Mock };
    jobSeekerHit: { findMany: jest.Mock };
    placement: { findMany: jest.Mock };
    payment: { findMany: jest.Mock };
    replacementClaim: { findMany: jest.Mock };
  };

  let service: MoneyAtRiskService;
  let prismaMock: MockPrismaService;
  let policy: PricingPolicy;

  const mockCallAgentId = 'ca-uuid-001';
  const mockFieldAgentId = 'fa-uuid-001';
  const otherAgentId = 'fa-uuid-002';
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

  beforeEach(() => {
    prismaMock = {
      staff: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          if (where?.teamLeadId === mockTeamLeadId) {
            return Promise.resolve([
              { id: mockCallAgentId, code: 'CA-00001', name: 'Call Agent 1' },
              { id: mockFieldAgentId, code: 'FA-00001', name: 'Field Agent 1' },
            ]);
          }
          if (where?.teamLeadId === otherTeamLeadId) {
            return Promise.resolve([
              { id: otherAgentId, code: 'FA-00002', name: 'Other Agent 2' },
            ]);
          }
          return Promise.resolve([]);
        }),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === mockCallAgentId) {
            return Promise.resolve({ id: mockCallAgentId, code: 'CA-00001', name: 'Call Agent 1' });
          }
          if (where.id === mockFieldAgentId) {
            return Promise.resolve({ id: mockFieldAgentId, code: 'FA-00001', name: 'Field Agent 1' });
          }
          if (where.id === otherAgentId) {
            return Promise.resolve({ id: otherAgentId, code: 'FA-00002', name: 'Other Agent 2' });
          }
          return Promise.resolve(null);
        }),
      },
      jobSeeker: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      jobSeekerHit: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      placement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      replacementClaim: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    policy = { ...SEEDED_PRICING_POLICY };
    service = new MoneyAtRiskService(
      prismaMock as unknown as PrismaService,
      seededPricingService(policy),
    );
  });

  describe('Candidate Money at Risk (Day-30 Approaching Window)', () => {
    const fixedNow = new Date('2026-11-15T12:00:00.000Z');

    it('candidate at 6 days out is present, at 8 days out is absent (7-day window)', async () => {
      // 30 days from paymentReceivedAt:
      // Candidate 1: paid Oct 22 -> deadline Nov 21 -> 6 days out (PRESENT)
      const candidate6DaysOut = {
        id: 'js-6days',
        code: 'JS-00001',
        city: 'Bengaluru',
        name: 'Approaching Candidate',
        phone: '+919900000001',
        tradeSkill: 'Electrician',
        paymentReceivedAt: new Date(fixedNow.getTime() - 24 * 24 * 60 * 60 * 1000), // 24 days ago -> 6 days left
        status: 'active',
        registeredByStaffId: mockCallAgentId,
        registeredBy: { id: mockCallAgentId, code: 'CA-00001', name: 'Call Agent 1' },
      };

      // Candidate 2: paid Oct 24 -> deadline Nov 23 -> 8 days out (ABSENT: > 7 days)
      const candidate8DaysOut = {
        id: 'js-8days',
        code: 'JS-00002',
        city: 'Bengaluru',
        name: 'Far Away Candidate',
        phone: '+919900000002',
        tradeSkill: 'Plumber',
        paymentReceivedAt: new Date(fixedNow.getTime() - 22 * 24 * 60 * 60 * 1000), // 22 days ago -> 8 days left
        status: 'active',
        registeredByStaffId: mockCallAgentId,
        registeredBy: { id: mockCallAgentId, code: 'CA-00001', name: 'Call Agent 1' },
      };

      prismaMock.jobSeeker.findMany.mockResolvedValue([candidate6DaysOut, candidate8DaysOut]);

      const result = await service.getMoneyAtRisk(undefined, ceoUser, fixedNow);

      expect(result.candidatesCount).toBe(1);
      expect(result.candidatesAtRiskPaise).toBe(49900);
      expect(result.totalAtRiskPaise).toBe(49900);
      expect(result.totalAtRiskRupees).toBe(499);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].code).toBe('JS-00001');
      expect(result.rows[0].daysRemaining).toBe(6);
      expect(result.rows[0].amountPaise).toBe(49900);
      expect(result.rows[0].amountRupees).toBe(499);
    });

    it('excludes candidate already past deadline (belongs on /refunds/due as lost money, not money at risk)', async () => {
      // Paid 35 days ago -> deadline passed 5 days ago (must NOT appear on money at risk)
      const pastDeadlineCandidate = {
        id: 'js-past',
        code: 'JS-PAST',
        city: 'Bengaluru',
        name: 'Past Deadline',
        phone: '+919900000003',
        tradeSkill: 'Welder',
        paymentReceivedAt: new Date(fixedNow.getTime() - 35 * 24 * 60 * 60 * 1000),
        status: 'active',
        registeredByStaffId: mockCallAgentId,
        registeredBy: { id: mockCallAgentId, code: 'CA-00001', name: 'Call Agent 1' },
      };

      prismaMock.jobSeeker.findMany.mockResolvedValue([pastDeadlineCandidate]);

      const result = await service.getMoneyAtRisk(undefined, ceoUser, fixedNow);

      expect(result.candidatesCount).toBe(0);
      expect(result.rows).toHaveLength(0);
      expect(result.totalAtRiskPaise).toBe(0);
    });

    it('excludes candidate who rejected an offer (forfeits 30-day refund guarantee)', async () => {
      const candidateRejected = {
        id: 'js-rejected',
        code: 'JS-REJ',
        city: 'Bengaluru',
        name: 'Rejected Candidate',
        phone: '+919900000004',
        tradeSkill: 'Painter',
        paymentReceivedAt: new Date(fixedNow.getTime() - 25 * 24 * 60 * 60 * 1000), // 5 days left
        status: 'active',
        registeredByStaffId: mockCallAgentId,
        registeredBy: { id: mockCallAgentId, code: 'CA-00001', name: 'Call Agent 1' },
      };

      prismaMock.jobSeeker.findMany.mockResolvedValue([candidateRejected]);
      prismaMock.jobSeekerHit.findMany.mockResolvedValue([{ jobSeekerId: 'js-rejected' }]); // offer_rejected hit

      const result = await service.getMoneyAtRisk(undefined, managerUser, fixedNow);

      expect(result.candidatesCount).toBe(0);
      expect(result.rows).toHaveLength(0);
    });

    it('excludes placed or deactivated candidates and candidates with existing refund', async () => {
      const candidatePlaced = {
        id: 'js-placed',
        code: 'JS-PLACED',
        city: 'Bengaluru',
        paymentReceivedAt: new Date(fixedNow.getTime() - 25 * 24 * 60 * 60 * 1000),
        status: 'placed',
      };
      const candidateRefunded = {
        id: 'js-refunded',
        code: 'JS-REF',
        city: 'Bengaluru',
        paymentReceivedAt: new Date(fixedNow.getTime() - 25 * 24 * 60 * 60 * 1000),
        status: 'active',
      };

      prismaMock.jobSeeker.findMany.mockResolvedValue([candidatePlaced, candidateRefunded]);
      prismaMock.payment.findMany.mockResolvedValue([{ jobSeekerId: 'js-refunded' }]);

      const result = await service.getMoneyAtRisk(undefined, ceoUser, fixedNow);

      expect(result.candidatesCount).toBe(0);
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('Placement Money at Risk (Day-15 Approaching Window)', () => {
    const fixedNow = new Date('2026-11-15T12:00:00.000Z');

    it('placement at 3 days out (day 12 of 15) is present, at 7 days out (day 8 of 15) is absent (5-day window)', async () => {
      // Placement 1: claim decided 12 days ago -> 3 days remaining (PRESENT: <= 5 days)
      const placement3DaysOut = {
        id: 'pl-3days',
        code: 'PL-00001',
        city: 'Bengaluru',
        placementFee: 1000000, // ₹10,000 (1000000 paise)
        dropoutReportedAt: new Date(fixedNow.getTime() - 12 * 24 * 60 * 60 * 1000),
        status: 'dropped_out',
        createdByStaffId: mockFieldAgentId,
        replacementCandidates: [],
        business: { name: 'Acme Corp' },
        jobSeeker: { name: 'Worker One', phone: '+919900000011' },
        createdBy: { id: mockFieldAgentId, code: 'FA-00001', name: 'Field Agent 1' },
      };

      // Placement 2: claim decided 8 days ago -> 7 days remaining (ABSENT: > 5 days)
      const placement7DaysOut = {
        id: 'pl-7days',
        code: 'PL-00002',
        city: 'Bengaluru',
        placementFee: 1500000, // ₹15,000
        dropoutReportedAt: new Date(fixedNow.getTime() - 8 * 24 * 60 * 60 * 1000),
        status: 'dropped_out',
        createdByStaffId: mockFieldAgentId,
        replacementCandidates: [],
        business: { name: 'Beta Ltd' },
        jobSeeker: { name: 'Worker Two', phone: '+919900000012' },
        createdBy: { id: mockFieldAgentId, code: 'FA-00001', name: 'Field Agent 1' },
      };

      prismaMock.replacementClaim.findMany.mockResolvedValue([
        {
          id: 'clm-3d',
          decision: 'accepted',
          decidedAt: new Date(fixedNow.getTime() - 12 * 24 * 60 * 60 * 1000),
          placement: placement3DaysOut,
        },
        {
          id: 'clm-7d',
          decision: 'accepted',
          decidedAt: new Date(fixedNow.getTime() - 8 * 24 * 60 * 60 * 1000),
          placement: placement7DaysOut,
        },
      ]);

      const result = await service.getMoneyAtRisk(undefined, ceoUser, fixedNow);

      expect(result.placementsCount).toBe(1);
      expect(result.placementsAtRiskPaise).toBe(1000000);
      expect(result.totalAtRiskPaise).toBe(1000000);
      expect(result.totalAtRiskRupees).toBe(10000);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].code).toBe('PL-00001');
      expect(result.rows[0].daysRemaining).toBe(3);
    });

    it('a business refund 10 days after claim acceptance shows as at risk', async () => {
      // 10 days after acceptance -> 15 - 10 = 5 days remaining (at risk)
      const placement10DaysOut = {
        id: 'pl-10d',
        code: 'PL-CLAIM-10D',
        city: 'Bengaluru',
        placementFee: 1500000,
        status: 'dropped_out',
        createdByStaffId: mockFieldAgentId,
        replacementCandidates: [],
        business: { name: 'TenDay Corp' },
        jobSeeker: { name: 'Worker 10D', phone: '+919900000010' },
        createdBy: { id: mockFieldAgentId, code: 'FA-00001', name: 'Field Agent 1' },
      };

      prismaMock.replacementClaim.findMany.mockResolvedValue([
        {
          id: 'clm-10d',
          decision: 'accepted',
          decidedAt: new Date(fixedNow.getTime() - 10 * 24 * 60 * 60 * 1000),
          placement: placement10DaysOut,
        },
      ]);

      const result = await service.getMoneyAtRisk(undefined, ceoUser, fixedNow);

      expect(result.placementsCount).toBe(1);
      expect(result.placementsAtRiskPaise).toBe(1500000);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].code).toBe('PL-CLAIM-10D');
      expect(result.rows[0].daysRemaining).toBe(5);
    });

    it('excludes placement past day 15 (belongs on /refunds/due as lost money, not money at risk)', async () => {
      // Claim decided 18 days ago -> day 18 (> 15 days)
      const placementPast15Days = {
        id: 'pl-past',
        code: 'PL-PAST',
        city: 'Bengaluru',
        placementFee: 1200000,
        status: 'dropped_out',
        createdByStaffId: mockFieldAgentId,
        replacementCandidates: [],
        business: { name: 'Past Corp' },
        jobSeeker: { name: 'Worker Past' },
      };

      prismaMock.replacementClaim.findMany.mockResolvedValue([
        {
          id: 'clm-past',
          decision: 'accepted',
          decidedAt: new Date(fixedNow.getTime() - 18 * 24 * 60 * 60 * 1000),
          placement: placementPast15Days,
        },
      ]);

      const result = await service.getMoneyAtRisk(undefined, ceoUser, fixedNow);

      expect(result.placementsCount).toBe(0);
      expect(result.rows).toHaveLength(0);
    });

    it('excludes placement with accepted replacement candidate (margin protected)', async () => {
      const placementSecured = {
        id: 'pl-secured',
        code: 'PL-SECURED',
        city: 'Bengaluru',
        placementFee: 1200000,
        status: 'dropped_out',
        createdByStaffId: mockFieldAgentId,
        replacementCandidates: [{ status: 'accepted' }], // accepted replacement candidate
        business: { name: 'Secured Corp' },
        jobSeeker: { name: 'Worker Secured' },
      };

      prismaMock.replacementClaim.findMany.mockResolvedValue([
        {
          id: 'clm-sec',
          decision: 'accepted',
          decidedAt: new Date(fixedNow.getTime() - 12 * 24 * 60 * 60 * 1000),
          placement: placementSecured,
        },
      ]);

      const result = await service.getMoneyAtRisk(undefined, ceoUser, fixedNow);

      expect(result.placementsCount).toBe(0);
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('Aggregation, Sum and Sorting', () => {
    const fixedNow = new Date('2026-11-15T12:00:00.000Z');

    it('sums candidate and placement amounts correctly and sorts soonest-deadline first', async () => {
      // Candidate: 4 days remaining (₹499 = 49900 paise)
      const candidate4Days = {
        id: 'js-4d',
        code: 'JS-00004',
        city: 'Bengaluru',
        name: 'Four Days',
        phone: '+919900000004',
        tradeSkill: 'Electrician',
        paymentReceivedAt: new Date(fixedNow.getTime() - 26 * 24 * 60 * 60 * 1000),
        status: 'active',
        registeredByStaffId: mockCallAgentId,
      };

      // Placement: 2 days remaining (₹12,000 = 1200000 paise)
      const placement2Days = {
        id: 'pl-2d',
        code: 'PL-00002',
        city: 'Bengaluru',
        placementFee: 1200000,
        status: 'dropped_out',
        createdByStaffId: mockFieldAgentId,
        replacementCandidates: [],
        business: { name: 'Corp B' },
        jobSeeker: { name: 'Worker B' },
      };

      // Placement: 5 days remaining (₹8,000 = 800000 paise)
      const placement5Days = {
        id: 'pl-5d',
        code: 'PL-00005',
        city: 'Bengaluru',
        placementFee: 800000,
        status: 'dropped_out',
        createdByStaffId: mockFieldAgentId,
        replacementCandidates: [],
        business: { name: 'Corp A' },
        jobSeeker: { name: 'Worker A' },
      };

      prismaMock.jobSeeker.findMany.mockResolvedValue([candidate4Days]);
      prismaMock.replacementClaim.findMany.mockResolvedValue([
        {
          id: 'clm-2d',
          decision: 'accepted',
          decidedAt: new Date(fixedNow.getTime() - 13 * 24 * 60 * 60 * 1000),
          placement: placement2Days,
        },
        {
          id: 'clm-5d',
          decision: 'accepted',
          decidedAt: new Date(fixedNow.getTime() - 10 * 24 * 60 * 60 * 1000),
          placement: placement5Days,
        },
      ]);

      const result = await service.getMoneyAtRisk(undefined, ceoUser, fixedNow);

      // Expected total: 49900 + 1200000 + 800000 = 2049900 paise (₹20,499)
      expect(result.candidatesCount).toBe(1);
      expect(result.candidatesAtRiskPaise).toBe(49900);
      expect(result.placementsCount).toBe(2);
      expect(result.placementsAtRiskPaise).toBe(2000000);
      expect(result.totalAtRiskPaise).toBe(2049900);
      expect(result.totalAtRiskRupees).toBe(20499);

      // Sorted soonest-deadline first: day 2, then day 4, then day 5
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].code).toBe('PL-00002'); // 2 days
      expect(result.rows[0].daysRemaining).toBe(2);
      expect(result.rows[1].code).toBe('JS-00004'); // 4 days
      expect(result.rows[1].daysRemaining).toBe(4);
      expect(result.rows[2].code).toBe('PL-00005'); // 5 days
      expect(result.rows[2].daysRemaining).toBe(5);

      // Sum of rows matches total
      const rowSum = result.rows.reduce((acc, r) => acc + r.amountPaise, 0);
      expect(rowSum).toBe(result.totalAtRiskPaise);
    });
  });

  describe('Scopes & RBAC Enforcement', () => {
    it('agent sees only their own money at risk', async () => {
      const res = await service.getMoneyAtRisk('me', callAgentUser);
      expect(res.scope).toBe('agent');
      expect(res.actorId).toBe(mockCallAgentId);
      expect(prismaMock.jobSeeker.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            registeredByStaffId: { in: [mockCallAgentId] },
          }),
        }),
      );

      const faRes = await service.getMoneyAtRisk('me', fieldAgentUser);
      expect(faRes.scope).toBe('agent');
      expect(faRes.actorId).toBe(mockFieldAgentId);
    });

    it('refuses agent attempting to access another agent money at risk (403 Forbidden)', async () => {
      await expect(
        service.getMoneyAtRisk(otherAgentId, callAgentUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('team lead sees their team total and agents', async () => {
      const res = await service.getMoneyAtRisk(undefined, teamLeadUser);
      expect(res.scope).toBe('team');
      expect(prismaMock.jobSeeker.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            registeredByStaffId: { in: [mockCallAgentId, mockFieldAgentId] },
          }),
        }),
      );

      const otherLeadRes = await service.getMoneyAtRisk(undefined, otherTeamLeadUser);
      expect(otherLeadRes.scope).toBe('team');
    });

    it('refuses team lead accessing agent outside their team (403 Forbidden)', async () => {
      await expect(
        service.getMoneyAtRisk(otherAgentId, teamLeadUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('CEO and Manager see city-wide money at risk', async () => {
      const resCeo = await service.getMoneyAtRisk(undefined, ceoUser);
      expect(resCeo.scope).toBe('city');
      expect(prismaMock.jobSeeker.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            registeredByStaffId: expect.anything(),
          }),
        }),
      );

      const resMgr = await service.getMoneyAtRisk(undefined, managerUser);
      expect(resMgr.scope).toBe('city');
    });

    it('refuses finance role entirely (403 Forbidden)', async () => {
      await expect(
        service.getMoneyAtRisk(undefined, financeUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Changed activation fee', () => {
    const fixedNow = new Date('2026-11-15T12:00:00.000Z');

    it('follows a changed activation fee and does not rewrite a stored payment', async () => {
      policy.activationFeePaise = 59900;
      const paidAt = new Date(fixedNow.getTime() - 24 * 24 * 60 * 60 * 1000);
      const base = {
        city: 'Bengaluru',
        name: 'Candidate',
        phone: '+919900000001',
        tradeSkill: 'Electrician',
        paymentReceivedAt: paidAt,
        status: 'active',
        registeredByStaffId: mockCallAgentId,
        registeredBy: { id: mockCallAgentId, code: 'CA-00001', name: 'Call Agent 1' },
      };

      prismaMock.jobSeeker.findMany.mockResolvedValue([
        { ...base, id: 'js-new', code: 'JS-NEW' },
        { ...base, id: 'js-old', code: 'JS-OLD', phone: '+919900000002' },
      ]);
      prismaMock.payment.findMany.mockResolvedValue([
        {
          jobSeekerId: 'js-old',
          type: 'activation',
          status: 'completed',
          amount: 49900,
        },
      ]);

      const result = await service.getMoneyAtRisk(undefined, ceoUser, fixedNow);
      const byCode = new Map(result.rows.map((row) => [row.code, row.amountPaise]));

      expect(byCode.get('JS-NEW')).toBe(59900);
      expect(byCode.get('JS-OLD')).toBe(49900);
      expect(result.candidatesAtRiskPaise).toBe(59900 + 49900);
    });
  });
});

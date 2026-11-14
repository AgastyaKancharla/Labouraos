import { BadRequestException, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { PricingService } from '../pricing/pricing.service';
import { PlacementController } from './placement.controller';
import { PlacementService } from './placement.service';
import { WorkerLeftService } from './worker-left.service';

/**
 * "Report worker left" on the new screens (replaces the old Admin
 * Dashboard's "Report Claim"). The form data comes from GET
 * /placements/:id/worker-left; the claim is still POST /placements/:id/claims
 * with all its rules (phase-17-task-2-claims.spec.ts).
 */
describe('Report worker left: form and finder', () => {
  const NOW = new Date('2026-11-14T06:00:00.000Z');
  const JOINED = new Date('2026-10-20T04:30:00.000Z');
  let prisma: {
    staff: { findUnique: jest.Mock; findMany: jest.Mock };
    placement: { findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
    callRecord: { findMany: jest.Mock };
  };
  let placements: { placementListScope: jest.Mock };
  let service: WorkerLeftService;

  const staff: Record<string, { id: string; role: string }> = {
    ceo: { id: 'ceo-1', role: 'ceo' },
    mg: { id: 'mg-1', role: 'manager' },
    tl: { id: 'tl-1', role: 'team_lead' },
    ca: { id: 'ca-1', role: 'call_agent' },
    fa: { id: 'fa-1', role: 'field_agent' },
    fa2: { id: 'fa-2', role: 'field_agent' },
    fin: { id: 'fin-1', role: 'finance' },
  };

  const placement = (over: Record<string, unknown> = {}) => ({
    id: 'pl-1',
    code: 'PL-00042',
    status: 'active',
    joinedDate: JOINED,
    rootPlacementId: null,
    businessId: 'bz-1',
    jobSeeker: { name: 'Ravi Kumar' },
    business: { id: 'bz-1', name: 'Lakshmi Tiffins', accountAgentId: 'fa-1' },
    replacementClaims: [],
    ...over,
  });

  beforeEach(() => {
    prisma = {
      staff: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(Object.values(staff).find((s) => s.id === where.id) ?? null)),
        findMany: jest.fn().mockResolvedValue([{ id: 'tl-1' }, { id: 'ca-7' }]),
      },
      placement: {
        findFirst: jest.fn().mockResolvedValue(placement()),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      callRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'call-1', code: 'CL-00001', answeredAt: new Date('2026-11-13T05:00:00Z'), startedAt: null, createdAt: new Date('2026-11-13T04:59:00Z'), durationSec: 95, staff: { name: 'Asha' } },
        ]),
      },
    };
    placements = { placementListScope: jest.fn().mockResolvedValue({ OR: [{ createdByStaffId: { in: ['x'] } }] }) };
    const pricing = { current: jest.fn().mockResolvedValue({ replacementWindowDays: 60, claimReportDays: 7, claimDecisionHours: 48 }) };
    service = new WorkerLeftService(prisma as unknown as PrismaService, pricing as unknown as PricingService, placements as unknown as PlacementService);
  });

  describe('who may open it (route guards)', () => {
    // The business behind the placement is on the person's account / team, so only the role decides.
    const business = { id: 'bz-1', accountAgentId: 'x', leadCreatedByStaffId: null, verificationStatus: 'verified' };
    const guardPrisma = {
      placement: { findFirst: jest.fn().mockResolvedValue({ business }), findUnique: jest.fn().mockResolvedValue({ business }) },
      business: { findFirst: jest.fn().mockResolvedValue(business), findUnique: jest.fn().mockResolvedValue(business) },
      staff: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) },
      visitAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const guard = () => new RbacGuard(new Reflector(), guardPrisma as unknown as PrismaService);
    const ctx = (handler: (...args: never[]) => unknown, role: string, method = 'GET', path = '/placements/pl-1/worker-left') =>
      ({
        getHandler: () => handler,
        getClass: () => PlacementController,
        switchToHttp: () => ({ getRequest: () => ({ method, path, params: path.includes('pl-1') ? { id: 'pl-1' } : {}, body: {}, user: { sub: 'x', role } }) }),
      }) as unknown as ExecutionContext;

    it('the form: Team Lead, Manager, CEO, call agent and field agent; never Finance', async () => {
      for (const role of ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent']) {
        await expect(guard().canActivate(ctx(PlacementController.prototype.workerLeftForm, role))).resolves.toBe(true);
      }
      await expect(guard().canActivate(ctx(PlacementController.prototype.workerLeftForm, 'finance'))).rejects.toThrow(ForbiddenException);
    });

    it('the finder: Team Lead, Manager, CEO and call agent; not Finance, not field agents (they report from the placement)', async () => {
      for (const role of ['ceo', 'manager', 'team_lead', 'call_agent']) {
        await expect(guard().canActivate(ctx(PlacementController.prototype.searchWorkerLeft, role, 'GET', '/placements/worker-left/search'))).resolves.toBe(true);
      }
      for (const role of ['finance', 'field_agent']) {
        await expect(guard().canActivate(ctx(PlacementController.prototype.searchWorkerLeft, role, 'GET', '/placements/worker-left/search'))).rejects.toThrow(ForbiddenException);
      }
    });

    it('the claim itself (POST /placements/:id/claims) stays open to exactly the five roles that may report', async () => {
      for (const role of ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent']) {
        await expect(guard().canActivate(ctx(PlacementController.prototype.reportClaim, role, 'POST', '/placements/pl-1/claims'))).resolves.toBe(true);
      }
      await expect(guard().canActivate(ctx(PlacementController.prototype.reportClaim, 'finance', 'POST', '/placements/pl-1/claims'))).rejects.toThrow(ForbiddenException);
    });
  });

  describe('GET /placements/:id/worker-left', () => {
    it('gives the guarantee dates, answered owner calls and the reason lists, with no phone number or money', async () => {
      const form = await service.form('pl-1', 'mg-1', NOW);
      expect(form.canReport).toBe(true);
      expect(form.blocked).toBeNull();
      expect(form.placement).toEqual({ id: 'pl-1', code: 'PL-00042', status: 'active', workerName: 'Ravi Kumar', businessId: 'bz-1', businessName: 'Lakshmi Tiffins', joinedDate: JOINED });
      expect(form.guarantee.endsAt).toEqual(new Date(JOINED.getTime() + 60 * 86400000));
      expect(form.leftOnLatest).toEqual(NOW);
      expect(form.ownerCalls).toEqual([{ id: 'call-1', code: 'CL-00001', at: new Date('2026-11-13T05:00:00Z'), durationSec: 95, by: 'Asha' }]);
      expect(form.reasons.covered).toContain('resigned');
      expect(form.reasons.notCovered).toContain('business_closed');
      expect(JSON.stringify(form)).not.toMatch(/phone|Paise|amount/i);
      // only answered calls with this business, since joining
      expect(prisma.callRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subjectType: 'business', subjectId: 'bz-1', answered: true, createdAt: { gte: JOINED } } }),
      );
    });

    it('offers a call agent or field agent only their own calls, a Team Lead their team’s', async () => {
      await service.form('pl-1', 'ca-1', NOW);
      expect(prisma.callRecord.findMany.mock.calls[0][0].where.staffId).toEqual({ in: ['ca-1'] });
      await service.form('pl-1', 'fa-1', NOW);
      expect(prisma.callRecord.findMany.mock.calls[1][0].where.staffId).toEqual({ in: ['fa-1'] });
      await service.form('pl-1', 'tl-1', NOW);
      expect(prisma.callRecord.findMany.mock.calls[2][0].where.staffId).toEqual({ in: ['tl-1', 'ca-7'] });
      await service.form('pl-1', 'ceo-1', NOW);
      expect(prisma.callRecord.findMany.mock.calls[3][0].where.staffId).toBeUndefined();
    });

    it('refuses a field agent who is not the business’s account agent, and Finance', async () => {
      await expect(service.form('pl-1', 'fa-2', NOW)).rejects.toThrow(ForbiddenException);
      await expect(service.form('pl-1', 'fin-1', NOW)).rejects.toThrow(ForbiddenException);
    });

    it('says why it cannot be reported: not active, not joined yet, or a claim already waiting', async () => {
      prisma.placement.findFirst.mockResolvedValueOnce(placement({ status: 'dropped_out' }));
      expect((await service.form('pl-1', 'ceo-1', NOW)).blocked).toBe('not_active');
      prisma.placement.findFirst.mockResolvedValueOnce(placement({ joinedDate: null }));
      expect((await service.form('pl-1', 'ceo-1', NOW)).blocked).toBe('not_joined');
      prisma.placement.findFirst.mockResolvedValueOnce(placement({ replacementClaims: [{ code: 'RC-00003', reportedAt: NOW, decisionDueAt: NOW }] }));
      const open = await service.form('pl-1', 'ceo-1', NOW);
      expect(open.blocked).toBe('open_claim');
      expect(open.canReport).toBe(false);
      expect(open.openClaim?.code).toBe('RC-00003');
    });

    it('uses the first placement’s joining date for a replacement, and stops the date picker at the end of the guarantee', async () => {
      const rootJoined = new Date('2026-08-01T04:30:00.000Z');
      prisma.placement.findFirst.mockResolvedValueOnce(placement({ rootPlacementId: 'pl-root', joinedDate: new Date('2026-09-20T00:00:00Z') }));
      prisma.placement.findUnique.mockResolvedValueOnce({ joinedDate: rootJoined });
      const form = await service.form('pl-1', 'ceo-1', NOW);
      expect(form.placement.joinedDate).toEqual(rootJoined);
      expect(form.leftOnLatest).toEqual(new Date(rootJoined.getTime() + 60 * 86400000));
    });

    it('404s an unknown placement', async () => {
      prisma.placement.findFirst.mockResolvedValueOnce(null);
      await expect(service.form('nope', 'ceo-1', NOW)).rejects.toThrow(NotFoundException);
    });
  });

  describe('GET /placements/worker-left/search', () => {
    it('finds active placements by code, worker or business inside what the person may see', async () => {
      prisma.placement.findMany.mockResolvedValueOnce([{ id: 'pl-1', code: 'PL-00042', joinedDate: JOINED, jobSeeker: { name: 'Ravi Kumar' }, business: { name: 'Lakshmi Tiffins' } }]);
      const rows = await service.search('tl-1', ' ravi ');
      expect(rows).toEqual([{ id: 'pl-1', code: 'PL-00042', workerName: 'Ravi Kumar', businessName: 'Lakshmi Tiffins', joinedDate: JOINED }]);
      expect(placements.placementListScope).toHaveBeenCalledWith({ id: 'tl-1', role: 'team_lead' });
      const where = prisma.placement.findMany.mock.calls[0][0].where;
      expect(where.AND[0]).toEqual({ OR: [{ createdByStaffId: { in: ['x'] } }] });
      expect(where.AND[2]).toEqual({ status: 'active' });
      expect(JSON.stringify(where.AND[1])).toContain('"contains":"ravi"');
    });

    it('needs at least 2 letters, and is not for field agents or Finance', async () => {
      await expect(service.search('mg-1', 'r')).rejects.toThrow(BadRequestException);
      await expect(service.search('fa-1', 'ravi')).rejects.toThrow(ForbiddenException);
      await expect(service.search('fin-1', 'ravi')).rejects.toThrow(ForbiddenException);
    });
  });
});

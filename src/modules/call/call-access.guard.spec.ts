import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CallAccessGuard, CallPlaceGuard } from './call-access.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLES_METADATA_KEY } from '../../common/rbac/roles.decorator';
import { CallController } from './call.controller';

/**
 * /calls/:id, its outcome, notes and recording: Team Leads their own team's
 * calls, agents only their own (owner rule, Master Guide 14 Nov).
 */
describe('CallAccessGuard', () => {
  const calls: Record<string, { staffId: string | null }> = {
    'call-a': { staffId: 'agent-a' },
    'call-b': { staffId: 'agent-b' },
    'call-lead': { staffId: 'tl-a' },
    'call-system': { staffId: null },
  };
  const staff: Record<string, { teamLeadId: string | null }> = {
    'agent-a': { teamLeadId: 'tl-a' },
    'agent-b': { teamLeadId: 'tl-b' },
    'tl-a': { teamLeadId: null },
  };
  const prisma = {
    callRecord: { findUnique: jest.fn(async ({ where }) => calls[where.id] ?? null) },
    // OwnTeam reads the team: direct teamLeadId links, then every link.
    staff: {
      findMany: jest.fn(async (args?: { where?: { teamLeadId?: string } }) => {
        const rows = Object.entries(staff).map(([id, row]) => ({ id, code: id, name: id, role: 'call_agent', status: 'active', reportsToId: null, ...row }));
        return args?.where?.teamLeadId ? rows.filter((r) => r.teamLeadId === args.where!.teamLeadId).map(({ id }) => ({ id })) : rows;
      }),
    },
    jobSeeker: { findFirst: jest.fn(async ({ where }) => ({ 'js-a': { registeredByStaffId: 'agent-a' }, 'js-b': { registeredByStaffId: 'agent-b' } } as Record<string, unknown>)[where.OR[0].id] ?? null) },
    referral: { findFirst: jest.fn(async ({ where }) => ({ 'rf-b': { registeredByStaffId: 'agent-b' } } as Record<string, unknown>)[where.OR[0].id] ?? null) },
    business: { findFirst: jest.fn(async ({ where }) => ({ 'bz-a': { accountAgentId: 'agent-a', leadCreatedByStaffId: null }, 'bz-b': { accountAgentId: null, leadCreatedByStaffId: 'agent-b' } } as Record<string, unknown>)[where.OR[0].id] ?? null) },
  };
  const guard = new CallAccessGuard(prisma as unknown as PrismaService);
  const check = (role: string, sub: string, id: string) =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => ({ user: { sub, role }, params: { id } }) }),
    } as unknown as ExecutionContext);

  it('the CEO and Managers open any call', async () => {
    for (const id of ['call-a', 'call-b', 'call-system']) {
      await expect(check('ceo', 'ceo-1', id)).resolves.toBe(true);
      await expect(check('manager', 'mgr-1', id)).resolves.toBe(true);
    }
  });

  it('a call or field agent opens only calls they made', async () => {
    await expect(check('call_agent', 'agent-a', 'call-a')).resolves.toBe(true);
    await expect(check('field_agent', 'agent-b', 'call-b')).resolves.toBe(true);
    await expect(check('call_agent', 'agent-a', 'call-b')).rejects.toThrow(ForbiddenException);
    await expect(check('field_agent', 'agent-a', 'call-system')).rejects.toThrow(ForbiddenException);
  });

  it('a Team Lead opens their own and their team\'s calls, not another team\'s or system calls', async () => {
    await expect(check('team_lead', 'tl-a', 'call-a')).resolves.toBe(true);
    await expect(check('team_lead', 'tl-a', 'call-lead')).resolves.toBe(true);
    await expect(check('team_lead', 'tl-a', 'call-b')).rejects.toThrow(/outside your team/);
    await expect(check('team_lead', 'tl-a', 'call-system')).rejects.toThrow(ForbiddenException);
  });

  it('an unknown call is left to the route (404)', async () => {
    await expect(check('call_agent', 'agent-a', 'nope')).resolves.toBe(true);
  });

  it('guards every /calls/:id route', () => {
    for (const handler of ['recording', 'getOne', 'outcome', 'updateNotes'] as const) {
      const guards: unknown[] = Reflect.getMetadata('__guards__', CallController.prototype[handler]) ?? [];
      expect(guards).toContain(CallAccessGuard);
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, CallController.prototype[handler])).toBeDefined();
    }
  });

  describe('placing a call (POST /calls)', () => {
    const place = new CallPlaceGuard(prisma as unknown as PrismaService);
    const try_ = (role: string, sub: string, subjectType: string, subjectId: string) =>
      place.canActivate({
        switchToHttp: () => ({ getRequest: () => ({ user: { sub, role }, body: { subjectType, subjectId } }) }),
      } as unknown as ExecutionContext);

    it('a Team Lead calls only their own team\'s job seekers, partners and businesses', async () => {
      await expect(try_('team_lead', 'tl-a', 'job_seeker', 'js-a')).resolves.toBe(true);
      await expect(try_('team_lead', 'tl-a', 'business', 'bz-a')).resolves.toBe(true);
      await expect(try_('team_lead', 'tl-a', 'job_seeker', 'js-b')).rejects.toThrow(ForbiddenException);
      await expect(try_('team_lead', 'tl-a', 'referral', 'rf-b')).rejects.toThrow(ForbiddenException);
      await expect(try_('team_lead', 'tl-a', 'business', 'bz-b')).rejects.toThrow(ForbiddenException);
    });

    it('agents, Managers and the CEO keep their reach; unknown subjects are left to the route', async () => {
      await expect(try_('call_agent', 'agent-a', 'job_seeker', 'js-b')).resolves.toBe(true);
      await expect(try_('manager', 'm-1', 'business', 'bz-b')).resolves.toBe(true);
      await expect(try_('team_lead', 'tl-a', 'job_seeker', 'nope')).resolves.toBe(true);
    });

    it('guards POST /calls', () => {
      const guards: unknown[] = Reflect.getMetadata('__guards__', CallController.prototype.place) ?? [];
      expect(guards).toContain(CallPlaceGuard);
    });
  });
});

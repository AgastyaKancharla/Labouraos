import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CallAccessGuard } from './call-access.guard';
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
    staff: { findUnique: jest.fn(async ({ where }) => staff[where.id] ?? null) },
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
});

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OwnTeam } from './own-team';
import { RbacGuard } from './rbac.guard';
import { PERMISSION_METADATA_KEY, RequiredPermission } from './permissions.decorator';
import { ROLES_METADATA_KEY } from './roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessVerificationService } from '../../modules/business/business-verification.service';
import { BusinessController } from '../../modules/business/business.controller';

/**
 * One own-team definition everywhere (Fable re-review, M3): the Team Lead, the
 * people whose teamLeadId is them, and everyone under them in the reporting
 * line. Guard and services agree, so a Team Lead who is the account agent or
 * created the lead can act on that business.
 */
const rows = [
  { id: 'tl-1', code: 'TL1', name: 'TL1', role: 'team_lead', status: 'active', teamLeadId: null, reportsToId: 'mgr-1' },
  { id: 'old-agent', code: 'A0', name: 'A0', role: 'call_agent', status: 'active', teamLeadId: 'tl-1', reportsToId: null },
  { id: 'new-agent', code: 'A1', name: 'A1', role: 'field_agent', status: 'active', teamLeadId: null, reportsToId: 'tl-1' },
  { id: 'fa-own', code: 'F1', name: 'F1', role: 'field_agent', status: 'active', teamLeadId: 'tl-1', reportsToId: 'tl-1' },
  { id: 'fa-other', code: 'F2', name: 'F2', role: 'field_agent', status: 'active', teamLeadId: 'tl-2', reportsToId: 'tl-2' },
  { id: 'tl-2', code: 'TL2', name: 'TL2', role: 'team_lead', status: 'active', teamLeadId: null, reportsToId: 'mgr-1' },
];
const staff = {
  findMany: jest.fn(async (args?: { where?: { teamLeadId?: string } }) => {
    const lead = args?.where?.teamLeadId;
    return lead ? rows.filter((row) => row.teamLeadId === lead).map(({ id }) => ({ id })) : rows;
  }),
  findUnique: jest.fn(async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null),
};

describe('OwnTeam', () => {
  const team = new OwnTeam({ staff } as unknown as PrismaService);

  it('is the Team Lead, their teamLeadId links and their reporting line', async () => {
    expect((await team.memberIds('tl-1')).sort()).toEqual(['fa-own', 'new-agent', 'old-agent', 'tl-1']);
  });

  it('a record with no owner belongs to no team; the Team Lead\'s own records count', async () => {
    expect(await team.includesAny('tl-1', [null, undefined])).toBe(false);
    expect(await team.includesAny('tl-1', ['tl-1'])).toBe(true);
    expect(await team.includes('tl-1', 'fa-other')).toBe(false);
  });
});

describe('Business reviews use the same team', () => {
  const service = new BusinessVerificationService({ staff } as never, {} as never, {} as never, {} as never, {} as never) as unknown as {
    assertTeamLeadOwnsBusiness(actor: { id: string; role: string }, lead: string | null, account: string | null): Promise<void>;
    assertTeamLeadPicksOwnAgent(actor: { id: string; role: string }, staffId: string): Promise<void>;
  };
  const tl = { id: 'tl-1', role: 'team_lead' };

  it('a Team Lead who is the account agent, or whose new-style agent created the lead, may review it', async () => {
    await expect(service.assertTeamLeadOwnsBusiness(tl, null, 'tl-1')).resolves.toBeUndefined();
    await expect(service.assertTeamLeadOwnsBusiness(tl, 'new-agent', null)).resolves.toBeUndefined();
    await expect(service.assertTeamLeadOwnsBusiness(tl, 'fa-other', null)).rejects.toThrow(ForbiddenException);
  });

  it('a Team Lead gives a visit or an account only to a field agent of their own team (L1)', async () => {
    await expect(service.assertTeamLeadPicksOwnAgent(tl, 'fa-own')).resolves.toBeUndefined();
    await expect(service.assertTeamLeadPicksOwnAgent(tl, 'fa-other')).rejects.toThrow(/own team/);
    await expect(service.assertTeamLeadPicksOwnAgent(tl, 'tl-1')).rejects.toThrow(ForbiddenException);
    await expect(service.assertTeamLeadPicksOwnAgent({ id: 'mgr-1', role: 'manager' }, 'fa-other')).resolves.toBeUndefined();
  });
});

describe('RbacGuard staff and target checks (OwnTeam, fail closed)', () => {
  function run(role: string, sub: string, route: string, params: Record<string, string>, permission: RequiredPermission) {
    const reflector = {
      getAllAndOverride: (key: string) => (key === PERMISSION_METADATA_KEY ? permission : key === ROLES_METADATA_KEY ? undefined : undefined),
    } as unknown as Reflector;
    const prisma = { staff, target: { findUnique: jest.fn(async () => ({ staffId: 'fa-other' })) } };
    const guard = new RbacGuard(reflector, prisma as unknown as PrismaService);
    const request = { method: 'GET', path: route, params, body: {}, query: {}, route: { path: route }, user: { sub, role } };
    return guard.canActivate({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext);
  }
  const staffRead = { resource: 'staff' as const, action: 'read' as const };

  it('a Team Lead opens staff in their team, including reporting-line-only agents, not another team', async () => {
    await expect(run('team_lead', 'tl-1', '/staff/:id', { id: 'new-agent' }, staffRead)).resolves.toBe(true);
    await expect(run('team_lead', 'tl-1', '/staff/:id', { id: 'old-agent' }, staffRead)).resolves.toBe(true);
    await expect(run('team_lead', 'tl-1', '/staff/:id', { id: 'fa-other' }, staffRead)).rejects.toThrow(ForbiddenException);
  });

  it('a target of another team is refused', async () => {
    await expect(
      run('team_lead', 'tl-1', '/targets/:id', { id: 't-1' }, { resource: 'target', action: 'read' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('fails closed on a staff route whose parameter is not a staff or target id', async () => {
    await expect(
      run('team_lead', 'tl-1', '/staff/devices/:deviceId', { deviceId: 'd-1' }, staffRead),
    ).rejects.toThrow(/no staff check/);
    await expect(
      run('call_agent', 'old-agent', '/staff/things/:thingId', { thingId: 'x' }, staffRead),
    ).rejects.toThrow(/no staff check/);
    // A route that says its service scopes it passes the guard (and must be listed in SERVICE_SCOPED_ROUTES).
    await expect(
      run('team_lead', 'tl-1', '/staff/things/:thingId', { thingId: 'x' }, { ...staffRead, target: 'service' }),
    ).resolves.toBe(true);
  });
});

describe('POST /businesses/:id/visits (M1)', () => {
  it('is for field agents, Team Leads (own team, via the guard), Managers and the CEO — not call agents', () => {
    const handler = BusinessController.prototype.recordVisit;
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).not.toContain('call_agent');
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).toEqual(expect.arrayContaining(['field_agent', 'team_lead']));
    expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, handler)).toMatchObject({ resource: 'business', action: 'write' });
  });
});

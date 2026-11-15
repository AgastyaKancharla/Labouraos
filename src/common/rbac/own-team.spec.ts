import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OwnTeam, businessOwners, businessesOwnedBy } from './own-team';
import { findManyOver, matchesWhere } from '../../test-support/prisma-where';
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
  findMany: jest.fn(findManyOver(rows)),
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

describe('businessOwners (owner decision, Master Guide rev 170)', () => {
  it('the account agent\'s team only, else the lead creator\'s team, else no team', () => {
    expect(businessOwners({ accountAgentId: 'fa-other', leadCreatedByStaffId: 'new-agent' })).toEqual(['fa-other']);
    expect(businessOwners({ accountAgentId: null, leadCreatedByStaffId: 'new-agent' })).toEqual(['new-agent']);
    expect(businessOwners({ accountAgentId: null, leadCreatedByStaffId: null })).toEqual([]);
  });

  it('the database filter says the same as businessOwners', () => {
    const filter = businessesOwnedBy(['tl-1', 'new-agent']);
    expect(matchesWhere({ accountAgentId: 'new-agent', leadCreatedByStaffId: 'fa-other' }, filter)).toBe(true);
    // The lead was ours but the account moved to another team: no longer ours.
    expect(matchesWhere({ accountAgentId: 'fa-other', leadCreatedByStaffId: 'new-agent' }, filter)).toBe(false);
    expect(matchesWhere({ accountAgentId: null, leadCreatedByStaffId: 'new-agent' }, filter)).toBe(true);
    expect(matchesWhere({ accountAgentId: null, leadCreatedByStaffId: null }, filter)).toBe(false);
  });

  it('an account moved from team A to team B: Team Lead A is refused, Team Lead B is allowed', async () => {
    const owners = new OwnTeam({ staff } as unknown as PrismaService);
    const moved = { accountAgentId: 'fa-other', leadCreatedByStaffId: 'new-agent' };
    expect(await owners.ownsBusiness('tl-1', moved)).toBe(false);
    expect(await owners.ownsBusiness('tl-2', moved)).toBe(true);
  });

  it('a lead with no account agent yet: the lead creator\'s Team Lead is allowed, another Team Lead is not', async () => {
    const owners = new OwnTeam({ staff } as unknown as PrismaService);
    const lead = { accountAgentId: null, leadCreatedByStaffId: 'new-agent' };
    expect(await owners.ownsBusiness('tl-1', lead)).toBe(true);
    expect(await owners.ownsBusiness('tl-2', lead)).toBe(false);
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

  it('once the account moved to another team, the lead creator\'s Team Lead no longer reviews it (rev 170)', async () => {
    await expect(service.assertTeamLeadOwnsBusiness(tl, 'new-agent', 'fa-other')).rejects.toThrow(ForbiddenException);
    await expect(service.assertTeamLeadOwnsBusiness({ id: 'tl-2', role: 'team_lead' }, 'new-agent', 'fa-other')).resolves.toBeUndefined();
  });

  it('a Team Lead gives a visit or an account only to a field agent of their own team (L1)', async () => {
    await expect(service.assertTeamLeadPicksOwnAgent(tl, 'fa-own')).resolves.toBeUndefined();
    // body:assignedStaffId on POST /businesses/:businessId/visit-assignments/:assignmentId/assign: another team's agent is refused
    // body:accountAgentId on POST /businesses/:id/verification/approve: another team's agent is refused
    // body:accountAgentId on POST /businesses/:id/account-agent: another team's agent is refused
    await expect(service.assertTeamLeadPicksOwnAgent(tl, 'fa-other')).rejects.toThrow(/own team/);
    await expect(service.assertTeamLeadPicksOwnAgent(tl, 'tl-1')).rejects.toThrow(ForbiddenException);
    await expect(service.assertTeamLeadPicksOwnAgent({ id: 'mgr-1', role: 'manager' }, 'fa-other')).resolves.toBeUndefined();
  });
});

describe('RbacGuard staff and target checks (OwnTeam, fail closed)', () => {
  function run(role: string, sub: string, route: string, params: Record<string, string>, permission: RequiredPermission, extra: Record<string, unknown> = {}) {
    const reflector = {
      getAllAndOverride: (key: string) => (key === PERMISSION_METADATA_KEY ? permission : key === ROLES_METADATA_KEY ? undefined : undefined),
    } as unknown as Reflector;
    const prisma = { staff, target: { findUnique: jest.fn(async () => ({ staffId: 'fa-other' })) }, ...extra };
    const guard = new RbacGuard(reflector, prisma as unknown as PrismaService);
    const request = { method: permission.action === 'write' ? 'POST' : 'GET', path: route, params, body: {}, query: {}, route: { path: route }, user: { sub, role } };
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

  it('a business whose account moved from team A to team B: Team Lead A refused, Team Lead B allowed (rev 170)', async () => {
    const moved = { id: 'b-1', accountAgentId: 'fa-other', leadCreatedByStaffId: 'new-agent', verificationStatus: 'verified' };
    const lead = { id: 'b-2', accountAgentId: null, leadCreatedByStaffId: 'new-agent', verificationStatus: 'lead' };
    const businesses = [moved, lead];
    const business = { findFirst: jest.fn(async ({ where }: { where: { OR?: Array<{ id?: string; code?: string }>; id?: string } }) => {
      const ids = [where.id, ...(where.OR ?? []).map((part) => part.id ?? part.code)];
      return businesses.find((row) => ids.includes(row.id)) ?? null;
    }) };
    const write = { resource: 'business' as const, action: 'write' as const };
    await expect(run('team_lead', 'tl-1', '/businesses/:id/pause', { id: 'b-1' }, write, { business })).rejects.toThrow(ForbiddenException);
    await expect(run('team_lead', 'tl-2', '/businesses/:id/pause', { id: 'b-1' }, write, { business })).resolves.toBe(true);
    // No account agent yet: the team of the agent who created the lead.
    await expect(run('team_lead', 'tl-1', '/businesses/:id/pause', { id: 'b-2' }, write, { business })).resolves.toBe(true);
    await expect(run('team_lead', 'tl-2', '/businesses/:id/pause', { id: 'b-2' }, write, { business })).rejects.toThrow(ForbiddenException);
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

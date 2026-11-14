import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacGuard } from './rbac.guard';
import { PERMISSION_METADATA_KEY, RequiredPermission } from './permissions.decorator';
import { ROLES_METADATA_KEY } from './roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Owner rule (Master Guide, 14 Nov): a Team Lead works only on their own team.
 * The guard checks the team for every action on a job seeker or referral
 * partner, not only for reading it, and checks one vacancy against that
 * vacancy's own business rather than a businessId the caller put in the body.
 */
describe('RbacGuard: own-team and own-account checks on every action', () => {
  const TL = 'tl-a';
  const MY_AGENT = 'agent-a';
  const OTHER_AGENT = 'agent-b';

  const seekers: Record<string, { id: string; registeredByStaffId: string | null }> = {
    'js-mine': { id: 'js-mine', registeredByStaffId: MY_AGENT },
    'js-lead': { id: 'js-lead', registeredByStaffId: TL },
    'js-theirs': { id: 'js-theirs', registeredByStaffId: OTHER_AGENT },
    'js-nobody': { id: 'js-nobody', registeredByStaffId: null },
  };
  const hits: Record<string, string> = { 'hit-mine': 'js-mine', 'hit-theirs': 'js-theirs' };
  const partners: Record<string, { id: string; registeredByStaffId: string | null }> = {
    'rf-mine': { id: 'rf-mine', registeredByStaffId: MY_AGENT },
    'rf-theirs': { id: 'rf-theirs', registeredByStaffId: OTHER_AGENT },
  };
  const businesses: Record<string, { id: string; accountAgentId: string | null; leadCreatedByStaffId: string | null; verificationStatus: string }> = {
    'b-fa': { id: 'b-fa', accountAgentId: 'fa-1', leadCreatedByStaffId: null, verificationStatus: 'verified' },
    'b-other': { id: 'b-other', accountAgentId: 'fa-2', leadCreatedByStaffId: null, verificationStatus: 'verified' },
  };
  const vacancies: Record<string, string> = { 'v-other': 'b-other', 'v-fa': 'b-fa' };
  const teamOf: Record<string, { teamLeadId: string | null; reportsToId: string | null }> = {
    [MY_AGENT]: { teamLeadId: TL, reportsToId: null },
    [OTHER_AGENT]: { teamLeadId: 'tl-b', reportsToId: null },
  };

  const idOf = (where: { id?: string; OR?: Array<{ id?: string; code?: string }> }) =>
    where.id ?? where.OR?.[0]?.id ?? where.OR?.[1]?.code;

  const prisma = {
    jobSeeker: { findFirst: jest.fn(async ({ where }) => seekers[idOf(where) as string] ?? null) },
    jobSeekerHit: {
      findUnique: jest.fn(async ({ where }) => {
        const seekerId = hits[where.id];
        return seekerId ? { jobSeeker: seekers[seekerId] } : null;
      }),
    },
    referral: { findFirst: jest.fn(async ({ where }) => partners[idOf(where) as string] ?? null) },
    business: { findFirst: jest.fn(async ({ where }) => businesses[idOf(where) as string] ?? null) },
    vacancy: {
      findFirst: jest.fn(async ({ where }) => {
        const businessId = vacancies[idOf(where) as string];
        return businessId ? { business: businesses[businessId] } : null;
      }),
    },
    visitAssignment: { findFirst: jest.fn(async () => null) },
    staff: {
      findFirst: jest.fn(async ({ where }) => {
        const row = teamOf[where.id as string];
        if (!row) return null;
        const conditions: Array<{ teamLeadId?: string; reportsToId?: string }> = where.OR ?? [{ teamLeadId: where.teamLeadId }];
        return conditions.some((c) =>
          (c.teamLeadId !== undefined && c.teamLeadId === row.teamLeadId) ||
          (c.reportsToId !== undefined && c.reportsToId === row.reportsToId))
          ? { id: where.id }
          : null;
      }),
      findUnique: jest.fn(async () => null),
    },
  };

  function run(opts: {
    role: string;
    sub?: string;
    method: string;
    path: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    permission: RequiredPermission;
  }): Promise<boolean> {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === PERMISSION_METADATA_KEY ? opts.permission : key === ROLES_METADATA_KEY ? undefined : undefined,
    } as unknown as Reflector;
    const guard = new RbacGuard(reflector, prisma as unknown as PrismaService);
    const request = {
      method: opts.method,
      path: opts.path,
      params: opts.params ?? {},
      body: opts.body ?? {},
      user: { sub: opts.sub ?? TL, role: opts.role },
    };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context);
  }

  const seekerWrites: Array<[string, string]> = [
    ['POST', 'activation-payment'],
    ['POST', 'resend-payment'],
    ['POST', 'identity-verification'],
    ['POST', 'identity-verification/provider'],
    ['POST', 'payment-only-link'],
    ['POST', 'hits'],
    ['POST', 'reactivate'],
    ['POST', 'found-own-job'],
    ['PATCH', ''],
    ['PATCH', 'profile'],
    ['POST', 'photo'],
    ['POST', 'status'],
    ['POST', 'trades'],
    ['PATCH', 'trades/t1'],
    ['DELETE', 'trades/t1'],
    ['POST', 'languages'],
    ['PATCH', 'languages/l1'],
    ['DELETE', 'languages/l1'],
  ];

  describe.each(seekerWrites)('Team Lead %s /job-seekers/:id/%s', (method, suffix) => {
    const path = (id: string) => `/job-seekers/${id}${suffix ? `/${suffix}` : ''}`;
    const write = { resource: 'job_seeker' as const, action: 'write' as const };

    it('is refused on another team\'s job seeker', async () => {
      await expect(
        run({ role: 'team_lead', method, path: path('js-theirs'), params: { id: 'js-theirs' }, permission: write }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('is refused on a job seeker no team registered', async () => {
      await expect(
        run({ role: 'team_lead', method, path: path('js-nobody'), params: { id: 'js-nobody' }, permission: write }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('is allowed on their own team\'s job seeker and their own', async () => {
      await expect(
        run({ role: 'team_lead', method, path: path('js-mine'), params: { id: 'js-mine' }, permission: write }),
      ).resolves.toBe(true);
      await expect(
        run({ role: 'team_lead', method, path: path('js-lead'), params: { id: 'js-lead' }, permission: write }),
      ).resolves.toBe(true);
    });
  });

  it('agents keep their city-wide job seeker writes (role table)', async () => {
    await expect(
      run({
        role: 'call_agent', sub: 'ca-x', method: 'POST', path: '/job-seekers/js-theirs/hits',
        params: { id: 'js-theirs' }, permission: { resource: 'job_seeker', action: 'write' },
      }),
    ).resolves.toBe(true);
  });

  describe('job seeker hits', () => {
    const read = { resource: 'job_seeker' as const, action: 'read' as const };
    it('GET /job-seeker-hits/:id: a Team Lead is refused another team\'s hit and allowed their own', async () => {
      await expect(
        run({ role: 'team_lead', method: 'GET', path: '/job-seeker-hits/hit-theirs', params: { id: 'hit-theirs' }, permission: read }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        run({ role: 'team_lead', method: 'GET', path: '/job-seeker-hits/hit-mine', params: { id: 'hit-mine' }, permission: read }),
      ).resolves.toBe(true);
    });

    it('POST /job-seeker-hits/:id/reverse is refused for another team, with the "own team" wording', async () => {
      await expect(
        run({
          role: 'team_lead', method: 'POST', path: '/job-seeker-hits/hit-theirs/reverse',
          params: { id: 'hit-theirs' }, permission: { resource: 'job_seeker', action: 'write' },
        }),
      ).rejects.toThrow(/own team/);
    });
  });

  it('POST /consent/links: a Team Lead sends links only for their own team\'s job seekers', async () => {
    const write = { resource: 'job_seeker' as const, action: 'write' as const };
    await expect(
      run({ role: 'team_lead', method: 'POST', path: '/consent/links', body: { jobSeekerId: 'js-theirs' }, permission: write }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      run({ role: 'team_lead', method: 'POST', path: '/consent/links', body: { jobSeekerId: 'js-mine' }, permission: write }),
    ).resolves.toBe(true);
  });

  describe('referral partners', () => {
    const cases: Array<[string, string, 'read' | 'write']> = [
      ['GET', '', 'read'],
      ['PATCH', '', 'write'],
      ['POST', 'terms-links', 'write'],
      ['GET', 'registration-status', 'read'],
    ];
    it.each(cases)('%s /referrals/:id/%s: another team\'s partner is not found; their own is allowed', async (method, suffix, action) => {
      const path = (id: string) => `/referrals/${id}${suffix ? `/${suffix}` : ''}`;
      await expect(
        run({ role: 'team_lead', method, path: path('rf-theirs'), params: { id: 'rf-theirs' }, permission: { resource: 'referral', action } }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        run({ role: 'team_lead', method, path: path('rf-mine'), params: { id: 'rf-mine' }, permission: { resource: 'referral', action } }),
      ).resolves.toBe(true);
    });
  });

  describe('one vacancy is checked against its own business, not a businessId in the body', () => {
    const write = { resource: 'vacancy' as const, action: 'write' as const };
    it('a field agent cannot name their own business in the body to act on another account\'s vacancy', async () => {
      await expect(
        run({
          role: 'field_agent', sub: 'fa-1', method: 'POST', path: '/vacancies/v-other/introductions',
          params: { id: 'v-other' }, body: { businessId: 'b-fa' }, permission: write,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a field agent still acts on a vacancy at their own account', async () => {
      await expect(
        run({
          role: 'field_agent', sub: 'fa-1', method: 'POST', path: '/vacancies/v-fa/introductions',
          params: { id: 'v-fa' }, body: { businessId: 'b-other' }, permission: write,
        }),
      ).resolves.toBe(true);
    });

    it('creating a vacancy (no vacancy id) is still checked against the businessId in the body', async () => {
      await expect(
        run({ role: 'field_agent', sub: 'fa-1', method: 'POST', path: '/vacancies', body: { businessId: 'b-other' }, permission: write }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        run({ role: 'field_agent', sub: 'fa-1', method: 'POST', path: '/vacancies', body: { businessId: 'b-fa' }, permission: write }),
      ).resolves.toBe(true);
    });
  });
});

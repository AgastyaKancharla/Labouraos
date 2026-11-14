import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacGuard } from './rbac.guard';
import { PERMISSION_METADATA_KEY, RequiredPermission } from './permissions.decorator';
import { ROLES_METADATA_KEY } from './roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSION_METADATA_KEY as PERMISSION_KEY } from './permissions.decorator';
import { VacancyController } from '../../modules/vacancy/vacancy.controller';
import { InterviewController } from '../../modules/vacancy/interview.controller';
import { ConsentController } from '../../modules/consent/consent.controller';
import { ScreensCallRegistrationController } from '../../modules/screens-call-registration/screens-call-registration.controller';
import { TelephonyController } from '../../modules/telephony/telephony.controller';

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
    'b-team': { id: 'b-team', accountAgentId: MY_AGENT, leadCreatedByStaffId: null, verificationStatus: 'verified' },
  };
  const vacancies: Record<string, string> = { 'v-other': 'b-other', 'v-fa': 'b-fa', 'v-team': 'b-team' };
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
      // OwnTeam reads the team: direct teamLeadId links, and every link for
      // the reporting-line walk.
      findMany: jest.fn(async (args?: { where?: { teamLeadId?: string } }) => {
        const rows = Object.entries(teamOf).map(([id, row]) => ({
          id, code: id, name: id, role: 'call_agent', status: 'active', ...row,
        }));
        const teamLeadId = args?.where?.teamLeadId;
        return teamLeadId ? rows.filter((row) => row.teamLeadId === teamLeadId).map(({ id }) => ({ id })) : rows;
      }),
      findUnique: jest.fn(async () => null),
    },
  };

  /** "/job-seekers/:id/hits" from "/job-seekers/js-1/hits" and { id: 'js-1' }. */
  function declared(path: string, params: Record<string, string>): string {
    let out = path.toLowerCase();
    for (const [key, value] of Object.entries(params)) {
      out = out.replace(`/${value.toLowerCase()}`, `/:${key}`);
    }
    return out;
  }

  function run(opts: {
    role: string;
    sub?: string;
    method: string;
    path: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
    permission: RequiredPermission;
    /** The declared route pattern; by default the path with each param value replaced by :name. */
    route?: string;
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
      query: opts.query ?? {},
      route: { path: opts.route ?? declared(opts.path, opts.params ?? {}) },
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
    const write = { resource: 'job_seeker' as const, action: 'write' as const, target: { kind: 'job_seeker' as const, from: 'body:jobSeekerId' as const } };
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
      const write = { resource: 'vacancy' as const, action: 'write' as const, target: { kind: 'business' as const, from: 'body:businessId' as const } };
      await expect(
        run({ role: 'field_agent', sub: 'fa-1', method: 'POST', path: '/vacancies', body: { businessId: 'b-other' }, permission: write }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        run({ role: 'field_agent', sub: 'fa-1', method: 'POST', path: '/vacancies', body: { businessId: 'b-fa' }, permission: write }),
      ).resolves.toBe(true);
    });
  });

  describe('GET /interviews/vacancies/:vacancyId/slots is scoped like reading the vacancy', () => {
    const read = { resource: 'vacancy' as const, action: 'read' as const, target: { kind: 'vacancy' as const, from: 'param:vacancyId' as const } };
    const slots = (role: string, vacancyId: string, sub?: string) =>
      run({ role, sub, method: 'GET', path: `/interviews/vacancies/${vacancyId}/slots`, params: { vacancyId }, permission: read });

    it('a Team Lead is refused another team\'s vacancy and allowed their own team\'s', async () => {
      await expect(slots('team_lead', 'v-other')).rejects.toThrow(ForbiddenException);
      await expect(slots('team_lead', 'v-team')).resolves.toBe(true);
    });

    it('field and call agents keep their city-wide vacancy read (role table)', async () => {
      await expect(slots('field_agent', 'v-other', 'fa-1')).resolves.toBe(true);
      await expect(slots('call_agent', 'v-other', 'ca-1')).resolves.toBe(true);
    });
  });

  describe('letter case in the URL changes nothing: the declared route is checked', () => {
    const write = { resource: 'job_seeker' as const, action: 'write' as const };
    it.each([
      ['POST', '/JOB-SEEKERS/js-theirs/status', '/job-seekers/:id/status'],
      ['GET', '/Job-Seekers/js-theirs', '/job-seekers/:id'],
      ['PATCH', '/Job-Seekers/js-theirs/Profile', '/job-seekers/:id/profile'],
      ['GET', '/Job-Seeker-Hits/hit-theirs', '/job-seeker-hits/:id'],
    ])('Team Lead %s %s is refused', async (method, path, route) => {
      const id = path.split('/')[2];
      await expect(
        run({ role: 'team_lead', method, path, route, params: { id }, permission: { ...write, action: method === 'GET' ? 'read' : 'write' } }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('PATCH /Referrals/:id is refused (404) for another team', async () => {
      await expect(
        run({ role: 'team_lead', method: 'PATCH', path: '/Referrals/rf-theirs', route: '/referrals/:id', params: { id: 'rf-theirs' }, permission: { resource: 'referral', action: 'write' } }),
      ).rejects.toThrow(NotFoundException);
    });

    it('PATCH /Vacancies/:id with a businessId of their own in the body is still refused', async () => {
      await expect(
        run({
          role: 'field_agent', sub: 'fa-1', method: 'PATCH', path: '/Vacancies/v-other', route: '/vacancies/:id',
          params: { id: 'v-other' }, body: { businessId: 'b-fa' }, permission: { resource: 'vacancy', action: 'write' },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('POST /Businesses/:id/vacancies checks the business in the URL, not the businessId in the body', async () => {
      await expect(
        run({
          role: 'field_agent', sub: 'fa-1', method: 'POST', path: '/Businesses/b-other/vacancies', route: '/businesses/:id/vacancies',
          params: { id: 'b-other' }, body: { businessId: 'b-fa' }, permission: { resource: 'vacancy', action: 'write' },
        }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        run({
          role: 'team_lead', method: 'POST', path: '/BUSINESSES/b-other/vacancies', route: '/businesses/:id/vacancies',
          params: { id: 'b-other' }, body: { businessId: 'b-team' }, permission: { resource: 'vacancy', action: 'write' },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('POST /Consent/links is refused for another team\'s job seeker', async () => {
      await expect(
        run({
          role: 'team_lead', method: 'POST', path: '/Consent/links', route: '/consent/links', body: { jobSeekerId: 'js-theirs' },
          permission: { resource: 'job_seeker', action: 'write', target: { kind: 'job_seeker', from: 'body:jobSeekerId' } },
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('fails closed', () => {
    it('refuses a scoped role on a route whose id it cannot place', async () => {
      await expect(
        run({ role: 'team_lead', method: 'GET', path: '/somewhere/x', route: '/somewhere/:id', params: { id: 'x' }, permission: { resource: 'job_seeker', action: 'read' } }),
      ).rejects.toThrow(/no team or account check/);
    });

    it('refuses when the record the route names is missing from the request', async () => {
      await expect(
        run({
          role: 'team_lead', method: 'POST', path: '/consent/links', body: {},
          permission: { resource: 'job_seeker', action: 'write', target: { kind: 'job_seeker', from: 'body:jobSeekerId' } },
        }),
      ).rejects.toThrow(/not named/);
      await expect(
        run({
          role: 'team_lead', method: 'POST', path: '/consent/links', body: { jobSeekerId: { id: 'js-mine' } },
          permission: { resource: 'job_seeker', action: 'write', target: { kind: 'job_seeker', from: 'body:jobSeekerId' } },
        }),
      ).rejects.toThrow(/not named/);
    });

    it('answers 404 for a record that does not exist', async () => {
      await expect(
        run({ role: 'team_lead', method: 'POST', path: '/job-seekers/nope/status', params: { id: 'nope' }, permission: { resource: 'job_seeker', action: 'write' } }),
      ).rejects.toThrow(NotFoundException);
    });

    it('the CEO and Managers are not affected', async () => {
      await expect(
        run({ role: 'manager', method: 'GET', path: '/somewhere/x', route: '/somewhere/:id', params: { id: 'x' }, permission: { resource: 'job_seeker', action: 'read' } }),
      ).resolves.toBe(true);
    });
  });

  describe('job seekers named in the body or query', () => {
    const intro = {
      resource: 'vacancy' as const,
      action: 'write' as const,
      target: [
        { kind: 'vacancy' as const, from: 'param:id' as const },
        { kind: 'job_seeker' as const, from: 'body:jobSeekerIds[]' as const },
      ],
    };
    it('showing candidates on a vacancy: a Team Lead only their own team\'s job seekers', async () => {
      const send = (jobSeekerIds: string[]) =>
        run({ role: 'team_lead', method: 'POST', path: '/vacancies/v-team/introductions', params: { id: 'v-team' }, body: { jobSeekerIds }, permission: intro });
      await expect(send(['js-mine', 'js-lead'])).resolves.toBe(true);
      await expect(send(['js-mine', 'js-theirs'])).rejects.toThrow(ForbiddenException);
    });

    it('a field agent shows any candidate at their own account\'s vacancy (job seekers are city-wide for agents)', async () => {
      await expect(
        run({ role: 'field_agent', sub: 'fa-1', method: 'POST', path: '/vacancies/v-fa/introductions', params: { id: 'v-fa' }, body: { jobSeekerIds: ['js-theirs'] }, permission: intro }),
      ).resolves.toBe(true);
    });

    it('consent withdrawal and its eligibility: a Team Lead only their own team\'s job seekers', async () => {
      const withdraw = { resource: 'job_seeker' as const, action: 'write' as const, target: { kind: 'job_seeker' as const, from: 'body:jobSeekerId' as const } };
      const eligibility = { resource: 'job_seeker' as const, action: 'read' as const, target: { kind: 'job_seeker' as const, from: 'query:jobSeekerId' as const } };
      await expect(run({ role: 'team_lead', method: 'POST', path: '/consent/withdraw', body: { jobSeekerId: 'js-theirs' }, permission: withdraw })).rejects.toThrow(ForbiddenException);
      await expect(run({ role: 'team_lead', method: 'POST', path: '/consent/withdraw', body: { jobSeekerId: 'js-mine' }, permission: withdraw })).resolves.toBe(true);
      await expect(run({ role: 'team_lead', method: 'GET', path: '/consent/withdrawal-eligibility', query: { jobSeekerId: 'js-theirs' }, permission: eligibility })).rejects.toThrow(ForbiddenException);
      await expect(run({ role: 'call_agent', sub: 'ca-1', method: 'GET', path: '/consent/withdrawal-eligibility', query: { jobSeekerId: 'js-theirs' }, permission: eligibility })).resolves.toBe(true);
    });
  });

  it('the controllers declare the records these checks use', () => {
    const meta = (proto: object, name: string) => Reflect.getMetadata(PERMISSION_KEY, (proto as Record<string, object>)[name]);
    expect(meta(VacancyController.prototype, 'createVacancy').target).toEqual({ kind: 'business', from: 'body:businessId' });
    expect(meta(VacancyController.prototype, 'shareCandidates').target).toEqual(expect.arrayContaining([{ kind: 'job_seeker', from: 'body:jobSeekerIds[]' }]));
    expect(meta(VacancyController.prototype, 'showCandidatesInPerson').target).toEqual(expect.arrayContaining([{ kind: 'job_seeker', from: 'body:jobSeekerIds[]' }]));
    expect(meta(InterviewController.prototype, 'book').target).toEqual({ kind: 'job_seeker', from: 'body:jobSeekerId' });
    expect(meta(InterviewController.prototype, 'slots').target).toEqual({ kind: 'vacancy', from: 'param:vacancyId' });
    expect(meta(ConsentController.prototype, 'withdraw').target).toEqual({ kind: 'job_seeker', from: 'body:jobSeekerId' });
    expect(meta(ConsentController.prototype, 'withdrawalEligibility').target).toEqual({ kind: 'job_seeker', from: 'query:jobSeekerId' });
    expect(meta(ConsentController.prototype, 'createLink').target).toEqual({ kind: 'job_seeker', from: 'body:jobSeekerId' });
    for (const name of ['jobSeeker', 'signedConsent', 'business', 'referral']) {
      expect(meta(ScreensCallRegistrationController.prototype, name).target).toMatchObject({ from: 'param:id' });
    }
    expect(meta(TelephonyController.prototype, 'assignCallback').target).toBe('service');
  });
});

import { MatchingService } from './matching.service';
import { VacancyService } from './vacancy.service';

/**
 * Owner decision (14 Nov): a Team Lead's candidate lists for a vacancy
 * (GET /vacancies/:id/shortlist and /candidates) hold only job seekers their
 * own team registered (OwnTeam). The CEO, Managers and agents keep the
 * city-wide pool.
 */
describe('Team Lead candidate lists: own team only', () => {
  const vacancy = {
    id: 'vac-1',
    code: 'VC-00001',
    status: 'open',
    city: 'Bengaluru',
    tradeSkill: 'Electrician',
    salaryMinPaise: 1500000,
    business: { id: 'bz-1', verificationStatus: 'verified', pausedAt: null, inPersonOnboardedAt: null },
  };
  // tl-1's team: agent-1 (teamLeadId); everyone else is another team.
  const staffRows = [
    { id: 'tl-1', code: 'TL', name: 'TL', role: 'team_lead', status: 'active', teamLeadId: null, reportsToId: null },
    { id: 'agent-1', code: 'A1', name: 'A1', role: 'call_agent', status: 'active', teamLeadId: 'tl-1', reportsToId: 'tl-1' },
    { id: 'agent-2', code: 'A2', name: 'A2', role: 'call_agent', status: 'active', teamLeadId: 'tl-2', reportsToId: 'tl-2' },
  ];
  const staff = {
    findMany: jest.fn(async (args?: { where?: { teamLeadId?: string } }) => {
      const lead = args?.where?.teamLeadId;
      return lead ? staffRows.filter((row) => row.teamLeadId === lead).map(({ id }) => ({ id })) : staffRows;
    }),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => staffRows.find((row) => row.id === where.id) ?? null),
  };

  describe('GET /vacancies/:id/shortlist (MatchingService.match)', () => {
    function build() {
      const jobSeekerFindMany = jest.fn(async () => []);
      const prisma = {
        vacancy: { findFirst: jest.fn(async () => vacancy) },
        trade: { findFirst: jest.fn(async () => ({ id: 'trade-1' })) },
        jobSeeker: { findMany: jobSeekerFindMany },
        consent: { findMany: jest.fn(async () => []) },
        staff,
      };
      const pricing = { current: jest.fn(async () => ({ matchPageSize: 3, matchingWeights: { clock: 30, distance: 20, experience: 15, salary: 15, reliability: 10, completeness: 5, pastResults: 5 }, salaryDaysPerMonth: 26, maxHits: 3, adultMinimumAge: 18, jobSeekerGuaranteeDays: 30, refundPriorityWindowDays: 7 })) };
      const clock = { now: () => new Date('2027-01-10T06:00:00.000Z') };
      const service = new MatchingService(prisma as never, pricing as never, clock as never);
      return { service, jobSeekerFindMany };
    }

    it("a Team Lead's pool is only job seekers registered by their own team", async () => {
      const { service, jobSeekerFindMany } = build();
      await service.match('vac-1', { page: 1, viewer: { id: 'tl-1', role: 'team_lead' } });
      const where = (jobSeekerFindMany.mock.calls[0] as unknown as [{ where: { registeredByStaffId?: { in: string[] } } }])[0].where;
      expect(where.registeredByStaffId?.in).toEqual(expect.arrayContaining(['tl-1', 'agent-1']));
      expect(where.registeredByStaffId?.in).not.toContain('agent-2');
    });

    it.each(['ceo', 'manager', 'call_agent', 'field_agent'])('%s keeps the city-wide pool', async (role) => {
      const { service, jobSeekerFindMany } = build();
      await service.match('vac-1', { page: 1, viewer: { id: 'someone', role } });
      const where = (jobSeekerFindMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
      expect(where.registeredByStaffId).toBeUndefined();
    });
  });

  describe('GET /vacancies/:id/candidates (VacancyService.getCandidates)', () => {
    function build() {
      const jobSeekerFindMany = jest.fn(async () => []);
      const prisma = {
        vacancy: { findFirst: jest.fn(async () => vacancy) },
        consent: { findMany: jest.fn(async () => [{ subjectId: 'js-a' }, { subjectId: 'js-b' }]) },
        jobSeeker: { findMany: jobSeekerFindMany },
        staff,
      };
      const service = new VacancyService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
      return { service, jobSeekerFindMany };
    }

    it("a Team Lead sees only their own team's job seekers", async () => {
      const { service, jobSeekerFindMany } = build();
      await service.getCandidates('vac-1', 'tl-1');
      const where = (jobSeekerFindMany.mock.calls[0] as unknown as [{ where: { registeredByStaffId?: { in: string[] } } }])[0].where;
      expect(where.registeredByStaffId?.in).toEqual(expect.arrayContaining(['tl-1', 'agent-1']));
      expect(where.registeredByStaffId?.in).not.toContain('agent-2');
    });

    it('an agent keeps the city-wide list', async () => {
      const { service, jobSeekerFindMany } = build();
      await service.getCandidates('vac-1', 'agent-2');
      const where = (jobSeekerFindMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
      expect(where.registeredByStaffId).toBeUndefined();
    });
  });

  it('the shortlist route passes the signed-in person to the matching service', async () => {
    const { VacancyController } = await import('./vacancy.controller');
    const matching = { match: jest.fn(async () => ({})) };
    const proto = VacancyController.prototype as unknown as {
      getShortlist: (this: unknown, id: string, req: unknown, page?: string) => Promise<unknown>;
    };
    await proto.getShortlist.call({ matchingService: matching }, 'vac-1', { user: { sub: 'tl-1', role: 'team_lead' } }, '2');
    expect(matching.match).toHaveBeenCalledWith('vac-1', { page: 2, viewer: { id: 'tl-1', role: 'team_lead' } });
  });
});

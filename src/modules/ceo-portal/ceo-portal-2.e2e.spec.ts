import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * CEO portal part 2 against a real database: every new screen read answers the
 * CEO and nobody else; the team name shows on Team & access; and the Areas
 * list is managed by the CEO and Managers, seeded, read by the registration
 * forms, and merging moves records to the other area.
 */
describe('CEO portal part 2 endpoints and the Areas list', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const areaIds: string[] = [];
  let counter = 0;
  type StaffRow = Awaited<ReturnType<PrismaService['staff']['create']>>;
  let ceo: StaffRow;
  let manager: StaffRow;
  let lead: StaffRow;
  let agent: StaffRow;
  let fieldAgent: StaffRow;
  const tokens: Record<string, string> = {};

  async function makeStaff(role: string, reportsToId: string | null): Promise<StaffRow> {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `W4C-${role.slice(0, 3).toUpperCase()}-${stamp}-${counter}`,
        name: `W4C ${role} ${counter}`,
        email: `w4c-${role}-${stamp}-${counter}@laboura.local`,
        passwordHash: await bcrypt.hash('W4C-Password-1', 4),
        role,
        city: 'Bengaluru',
        status: 'active',
        reportsToId,
        teamLeadId: ['call_agent', 'field_agent'].includes(role) ? reportsToId : null,
      },
    });
    staffIds.push(staff.id);
    tokens[role] = jwt.sign({ sub: staff.id, email: staff.email, role: staff.role, code: staff.code, teamLeadId: staff.teamLeadId });
    return staff;
  }

  const server = () => app.getHttpServer();
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    ceo = await makeStaff('ceo', null);
    manager = await makeStaff('manager', ceo.id);
    await makeStaff('finance', ceo.id);
    lead = await makeStaff('team_lead', manager.id);
    agent = await makeStaff('call_agent', lead.id);
    fieldAgent = await makeStaff('field_agent', lead.id);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.target.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.businessVisit.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.area.deleteMany({ where: { id: { in: areaIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const GET_ROUTES = [
    '/ceo/team',
    '/ceo/teams',
    '/ceo/devices',
    '/ceo/access',
    '/ceo/targets',
    '/ceo/attendance',
    '/ceo/call-center',
    '/ceo/field-ops',
    '/ceo/leaderboard',
    '/ceo/check-ins',
    '/ceo/audit',
    '/ceo/flags',
    '/ceo/privacy',
    '/ceo/privacy/consents',
    '/ceo/system',
    '/ceo/pricing/history',
    '/ceo/pricing/minimum-wage',
    '/ceo/pricing/trades',
  ];

  it('shows a visit to a shop that is not registered yet on Field operations', async () => {
    // A "Visit a shop" visit starts outside, before the shop registers, so it has no business.
    await prisma.businessVisit.create({
      data: { staffId: fieldAgent.id, businessId: null, shopName: `W4C Tea Stall ${stamp}`, latitude: 12.9, longitude: 77.6 },
    });
    const res = await request(server()).get('/ceo/field-ops').set(as('ceo'));
    expect(res.status).toBe(200);
    const row = (res.body.rows as Array<{ staff: { id: string }; lastVisit: { business: string; area: string | null } | null }>).find(
      (r) => r.staff.id === fieldAgent.id,
    );
    expect(row?.lastVisit).toEqual(expect.objectContaining({ business: `W4C Tea Stall ${stamp}`, area: null }));
  });

  it('Field operations: average visit time per agent and revisits due this week', async () => {
    const now = Date.now();
    await prisma.businessVisit.create({
      data: { staffId: fieldAgent.id, shopName: `W4C Timed ${stamp}`, latitude: 12.91, longitude: 77.61, durationSeconds: 600, visitedAt: new Date(now - 60_000) },
    });
    await prisma.businessVisit.create({
      data: { staffId: fieldAgent.id, shopName: `W4C Timed 2 ${stamp}`, latitude: 12.91, longitude: 77.61, durationSeconds: 1200, visitedAt: new Date(now - 30_000) },
    });
    const due = new Date(now + 2 * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
    const later = await prisma.businessVisit.create({
      data: { staffId: fieldAgent.id, shopName: `W4C Revisit ${stamp}`, latitude: 12.91, longitude: 77.61, outcome: 'owner_not_there', revisitOn: new Date(`${due}T00:00:00.000Z`) },
    });
    const res = await request(server()).get('/ceo/field-ops').set(as('ceo')).expect(200);
    const row = (res.body.rows as Array<{ staff: { id: string }; avgVisitSeconds: number | null }>).find((r) => r.staff.id === fieldAgent.id);
    expect(row?.avgVisitSeconds).toBe(900);
    const revisit = (res.body.revisitsDue as Array<{ id: string; on: string; shopName: string }>).find((r) => r.id === later.id);
    expect(revisit).toMatchObject({ on: due, shopName: `W4C Revisit ${stamp}` });
    expect(Array.isArray(res.body.requests)).toBe(true);
  });

  it('serves every part-2 screen to the CEO', async () => {
    for (const path of GET_ROUTES) {
      const res = await request(server()).get(path).set(as('ceo'));
      expect({ path, status: res.status, body: res.status === 200 ? 'ok' : res.body }).toEqual({ path, status: 200, body: 'ok' });
    }
  }, 180000);

  it('refuses Managers, Finance, Team Leads and agents on every part-2 screen and action', async () => {
    for (const role of ['manager', 'finance', 'team_lead', 'call_agent']) {
      for (const path of GET_ROUTES) {
        const res = await request(server()).get(path).set(as(role));
        expect({ role, path, status: res.status }).toEqual({ role, path, status: 403 });
      }
      const name = await request(server()).post(`/ceo/teams/${lead.id}`).set(as(role)).send({ name: 'Nope' });
      expect(name.status).toBe(403);
      const copy = await request(server()).post('/ceo/targets/copy').set(as(role)).send({});
      expect(copy.status).toBe(403);
    }
    expect((await request(server()).get('/ceo/team')).status).toBe(401);
  }, 180000);

  it('names a team and shows it for the Team Lead and their agents on Team & access', async () => {
    await request(server()).post(`/ceo/teams/${lead.id}`).set(as('ceo')).send({ name: 'Team South' }).expect(201);
    const team = await request(server()).get('/ceo/team').set(as('ceo')).expect(200);
    const row = team.body.rows.find((r: { id: string }) => r.id === agent.id);
    expect(row).toMatchObject({ team: 'Team South', reportsTo: { id: lead.id }, state: 'active' });
    expect(team.body.organisation.teamLeads.find((t: { id: string }) => t.id === lead.id)).toMatchObject({ team: 'Team South', callAgents: 1, fieldAgents: 1 });
    const teams = await request(server()).get('/ceo/teams').set(as('ceo')).expect(200);
    expect(teams.body.rows.find((t: { id: string }) => t.id === lead.id)).toMatchObject({ team: 'Team South', manager: { id: manager.id } });
    const audit = await request(server()).get('/ceo/audit').query({ search: 'team_named', type: 'policy' }).set(as('ceo')).expect(200);
    expect(audit.body.rows.some((r: { entityCode: string }) => r.entityCode === lead.id)).toBe(true);
  });

  it('starts the Areas list from the seeded Bengaluru areas and serves it to the registration forms', async () => {
    expect(await prisma.area.count({ where: { nameKey: 'koramangala' } })).toBe(1);
    const options = await request(server()).get('/screens/call-registration/options').set(as('call_agent')).expect(200);
    expect(options.body.areas.some((a: { name: string; pincode: string }) => a.name === 'Koramangala' && a.pincode === '560034')).toBe(true);
    const list = await request(server()).get('/areas').set(as('field_agent')).expect(200);
    expect(list.body.areas.length).toBe(options.body.areas.length);
  });

  it('lets a Manager add an area, the CEO merge a duplicate into it, and moves the records', async () => {
    const created = await request(server())
      .post('/areas')
      .set(as('manager'))
      .send({ name: `W4C Begur ${stamp}`, pincode: '560068', latitude: 12.88, longitude: 77.62 })
      .expect(201);
    areaIds.push(created.body.id);
    const dup = await request(server())
      .post('/areas')
      .set(as('ceo'))
      .send({ name: `W4C Begur Road ${stamp}`, pincode: '560068', latitude: 12.881, longitude: 77.621 })
      .expect(201);
    areaIds.push(dup.body.id);
    await request(server()).post('/areas').set(as('ceo')).send({ name: `w4c  begur ${stamp}`, pincode: '560068', latitude: 12.88, longitude: 77.62 }).expect(409);

    counter += 1;
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-W4C-${stamp}-${counter}`,
        name: 'W4C Seeker',
        phone: `+9196${stamp.slice(-6)}${String(counter).padStart(2, '0')}`,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        locality: `W4C Begur Road ${stamp}`,
        preferredLocalities: [`W4C Begur Road ${stamp}`],
      },
    });
    seekerIds.push(seeker.id);

    const manage = await request(server()).get('/areas/manage').query({ search: `begur road ${stamp}` }).set(as('manager')).expect(200);
    expect(manage.body.rows[0]).toMatchObject({ id: dup.body.id, jobSeekers: 1 });

    const merged = await request(server()).post(`/areas/${dup.body.id}/merge`).set(as('ceo')).send({ intoId: created.body.id }).expect(201);
    expect(merged.body.moved.jobSeeker).toBe(1);
    const after = await prisma.jobSeeker.findUnique({ where: { id: seeker.id } });
    expect(after?.locality).toBe(`W4C Begur ${stamp}`);
    expect(after?.preferredLocalities).toEqual([`W4C Begur ${stamp}`]);
    const dupAfter = await prisma.area.findUnique({ where: { id: dup.body.id } });
    expect(dupAfter).toMatchObject({ active: false, mergedIntoId: created.body.id });
    const options = await request(server()).get('/screens/call-registration/options').set(as('call_agent')).expect(200);
    expect(options.body.areas.some((a: { name: string }) => a.name === `W4C Begur Road ${stamp}`)).toBe(false);
    expect(options.body.areas.some((a: { name: string }) => a.name === `W4C Begur ${stamp}`)).toBe(true);
  });

  it('refuses Finance, Team Leads and agents when they try to manage areas', async () => {
    for (const role of ['finance', 'team_lead', 'call_agent', 'field_agent']) {
      expect((await request(server()).get('/areas/manage').set(as(role))).status).toBe(403);
      expect((await request(server()).post('/areas').set(as(role)).send({ name: 'X', pincode: '560068', latitude: 12.9, longitude: 77.6 })).status).toBe(403);
    }
    expect((await request(server()).get('/areas').set(as('finance'))).status).toBe(403);
  });
});

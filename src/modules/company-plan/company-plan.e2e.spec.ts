import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

/**
 * The CEO's monthly company plan (CEO only) and the Managers' split of it into
 * their own teams (MG-Targets), with every change audited, and the plan used
 * by MG-Home / MG-Plan when it is set.
 */
describe('Company plan and team split', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const ts = Date.now();
  const ids: string[] = [];
  const people: Record<string, { id: string; code: string; token: string }> = {};
  const now = new Date();
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(now));
  const month = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(now));
  // A month far ahead, so no other test or run holds a plan for it.
  const ahead = { year: year + 3, month };
  const past = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: {
        code: `CPL-${key}-${ts}`,
        name: `Plan ${key}`,
        email: `cpl_${key}_${ts}@laboura.local`,
        role,
        passwordHash: await bcrypt.hash('Some-Password-123', 4),
        status: 'active',
        ...extra,
      },
    });
    ids.push(staff.id);
    const session = await prisma.staffSession.create({
      data: { staffId: staff.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000), absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), lastActivityAt: new Date() },
    });
    const payload: JwtPayload = { sub: staff.id, role, email: staff.email, code: staff.code, teamLeadId: staff.teamLeadId, sid: session.id };
    people[key] = { id: staff.id, code: staff.code, token: jwt.sign(payload, { expiresIn: '15m' }) };
    return staff;
  }

  const get = (who: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${people[who].token}`);
  const put = (who: string, path: string, body: Record<string, unknown>) => request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${people[who].token}`).send(body);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const ceo = await mk('ceo', 'ceo');
    const mgrA = await mk('mgrA', 'manager', { reportsToId: ceo.id });
    const mgrB = await mk('mgrB', 'manager', { reportsToId: ceo.id });
    const tlA = await mk('tlA', 'team_lead', { reportsToId: mgrA.id, teamName: 'Team South' });
    await mk('tlB', 'team_lead', { reportsToId: mgrB.id, teamName: 'Team North' });
    await mk('caA', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
  });

  afterAll(async () => {
    await prisma.teamPlan.deleteMany({ where: { OR: [{ teamLeadId: { in: ids } }, { setByStaffId: { in: ids } }] } });
    await prisma.companyPlan.deleteMany({ where: { setByStaffId: { in: ids } } });
    await prisma.target.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('only the CEO reads and sets the company plan; a past month is refused; every change is audited', async () => {
    for (const who of ['mgrA', 'tlA', 'caA']) {
      expect((await get(who, `/plans/company?year=${ahead.year}&month=${ahead.month}`)).status).toBe(403);
      expect((await put(who, '/plans/company', { ...ahead, paid: 1 })).status).toBe(403);
    }
    expect((await put('ceo', '/plans/company', { ...past, paid: 10 })).status).toBe(400);
    expect((await put('ceo', '/plans/company', { ...ahead, paid: 1.5 })).status).toBe(400);
    expect((await put('ceo', '/plans/company', { ...ahead })).status).toBe(400);

    const set = await put('ceo', '/plans/company', { ...ahead, registered: 400, paid: 320, businessesSignedUp: 60, placed: 45, vacancies: 90, repeatBusinesses: 8, leftWithin30: 4 });
    expect(set.status).toBe(200);
    expect(set.body.plan).toMatchObject({ registered: 400, paid: 320, businessesSignedUp: 60, placed: 45, vacancies: 90, repeatBusinesses: 8, leftWithin30: 4, interviewsDone: null });
    const changed = await put('ceo', '/plans/company', { ...ahead, paid: 330 });
    expect(changed.body.plan.paid).toBe(330);
    expect(changed.body.plan.placed).toBe(45);

    const audits = await prisma.auditLog.findMany({ where: { actorId: people.ceo.id, entityType: 'company_plan' }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual(['company_plan.set', 'company_plan.updated']);
    expect(audits[1].before).toMatchObject({ paid: 320 });
    expect(audits[1].after).toMatchObject({ paid: 330 });
  });

  it('a Manager splits the plan for their own teams only; the board says whether it adds up; changes are audited', async () => {
    expect((await put('mgrA', '/manager/targets/split', { ...ahead, rows: [{ teamLeadId: people.tlB.id, paid: 10 }] })).status).toBe(403);
    expect((await put('ceo', '/manager/targets/split', { ...ahead, rows: [{ teamLeadId: people.tlA.id, paid: 10 }] })).status).toBe(403);
    expect((await put('mgrA', '/manager/targets/split', { ...past, rows: [{ teamLeadId: people.tlA.id, paid: 10 }] })).status).toBe(400);

    await put('mgrA', '/manager/targets', { ...ahead, rows: [{ staffId: people.caA.id, candidatesActivated: 40 }] });
    const saved = await put('mgrA', '/manager/targets/split', { ...ahead, rows: [{ teamLeadId: people.tlA.id, paid: 200, placed: 25 }] });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ created: 1, updated: 0 });

    let board = (await get('mgrA', `/manager/targets?year=${ahead.year}&month=${ahead.month}`)).body;
    expect(board.plan.company).toMatchObject({ paid: 330, placed: 45 });
    const south = board.plan.teams.find((t: { teamLeadId: string }) => t.teamLeadId === people.tlA.id);
    expect(south.split).toMatchObject({ paid: 200, placed: 25 });
    // The team's agents' targets, shown against the split.
    expect(south.agents.paid).toBe(40);
    expect(board.plan.difference.paid).toBe(-130);
    expect(board.plan.otherTeams).toBeNull();

    // The other Manager splits the rest: now it adds up.
    await put('mgrB', '/manager/targets/split', { ...ahead, rows: [{ teamLeadId: people.tlB.id, paid: 130, placed: 20 }] });
    board = (await get('mgrA', `/manager/targets?year=${ahead.year}&month=${ahead.month}`)).body;
    expect(board.plan.otherTeams).toMatchObject({ paid: 130, placed: 20 });
    expect(board.plan.difference).toMatchObject({ paid: 0, placed: 0 });
    expect(JSON.stringify(board)).not.toMatch(/₹|paise/i);

    const again = await put('mgrA', '/manager/targets/split', { ...ahead, rows: [{ teamLeadId: people.tlA.id, paid: 210 }] });
    expect(again.body).toMatchObject({ created: 0, updated: 1 });
    const audits = await prisma.auditLog.findMany({ where: { actorId: people.mgrA.id, entityType: 'team_plan' }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual(['team_plan.set', 'team_plan.updated']);
    expect(audits[1].entityCode).toBe(`${people.tlA.code}:${ahead.year}-${String(ahead.month).padStart(2, '0')}`);
    expect(audits[1].before).toMatchObject({ paid: 200 });
    expect(audits[1].after).toMatchObject({ paid: 210, placed: 25 });

    const ceoBoard = (await get('ceo', `/plans/company?year=${ahead.year}&month=${ahead.month}`)).body;
    expect(ceoBoard.teams.find((t: { teamLeadId: string }) => t.teamLeadId === people.tlA.id).split.paid).toBe(210);
  });

  it("Home and Plan vs actual use the team split when it is set, and the agents' targets when it isn't", async () => {
    let overview = (await get('mgrA', '/manager/overview')).body;
    const placedBefore = overview.bringMoney.find((r: { metric: string }) => r.metric === 'placed');
    expect(placedBefore.target).toBeNull();
    expect(overview.planSource.placed).toBeNull();

    await put('mgrA', '/manager/targets', { year, month, rows: [{ staffId: people.caA.id, candidatesActivated: 30 }] });
    overview = (await get('mgrA', '/manager/overview')).body;
    expect(overview.bringMoney.find((r: { metric: string }) => r.metric === 'paid').target).toBe(30);
    expect(overview.planSource.paid).toBe('agent_targets');

    await put('mgrA', '/manager/targets/split', { year, month, rows: [{ teamLeadId: people.tlA.id, paid: 50, placed: 9, registered: 80 }] });
    overview = (await get('mgrA', '/manager/overview')).body;
    expect(overview.bringMoney.find((r: { metric: string }) => r.metric === 'placed').target).toBe(9);
    expect(overview.bringMoney.find((r: { metric: string }) => r.metric === 'paid').target).toBe(50);
    expect(overview.leadToMoney.find((r: { metric: string }) => r.metric === 'registered').target).toBe(80);
    expect(overview.planSource).toMatchObject({ placed: 'team_split', paid: 'team_split', registered: 'team_split' });
    const team = overview.byTeam.find((t: { teamLeadId: string }) => t.teamLeadId === people.tlA.id);
    expect(team.rows.find((r: { metric: string }) => r.metric === 'placed').target).toBe(9);
  });
});

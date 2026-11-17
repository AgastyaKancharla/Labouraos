import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { TargetSplitService } from './target-split.service';

/**
 * The automatic target split (17 Nov) end to end: the CEO's plan reaches the
 * agents; a Team Lead changes only their own agents, a Manager only their own
 * tree; past months are refused; "Reset to automatic", "Transfer target" and
 * the re-split when an agent leaves or joins; every step audited. Other
 * tests' staff share the database, so the far-ahead month is this test's own
 * and the numbers are checked by how they add up.
 */
describe('Automatic target split', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let split: TargetSplitService;

  const ts = Date.now();
  const ids: string[] = [];
  const people: Record<string, { id: string; code: string; token: string }> = {};
  const now = new Date();
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(now));
  const month = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(now));
  const ahead = { year: year + 4, month };
  const later = { year: year + 5, month };
  const past = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const key = (m: { year: number; month: number }) => `${m.year}-${String(m.month).padStart(2, '0')}`;

  async function mk(name: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: {
        code: `TSP-${name}-${ts}`,
        name: `Split ${name}`,
        email: `tsp_${name}_${ts}@laboura.local`,
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
    people[name] = { id: staff.id, code: staff.code, token: jwt.sign(payload, { expiresIn: '15m' }) };
    return staff;
  }

  const http = () => request(app.getHttpServer());
  const get = (who: string, path: string) => http().get(path).set('Authorization', `Bearer ${people[who].token}`);
  const put = (who: string, path: string, body: Record<string, unknown>) => http().put(path).set('Authorization', `Bearer ${people[who].token}`).send(body);
  const post = (who: string, path: string, body: Record<string, unknown>) => http().post(path).set('Authorization', `Bearer ${people[who].token}`).send(body);
  const target = (who: string, m: { year: number; month: number }) => prisma.target.findUnique({ where: { staffId_year_month: { staffId: people[who].id, year: m.year, month: m.month } } });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    split = app.get(TargetSplitService);

    const ceo = await mk('ceo', 'ceo');
    const mgrA = await mk('mgrA', 'manager', { reportsToId: ceo.id });
    const mgrB = await mk('mgrB', 'manager', { reportsToId: ceo.id });
    const tlA = await mk('tlA', 'team_lead', { reportsToId: mgrA.id, teamName: 'Team Split A' });
    const tlB = await mk('tlB', 'team_lead', { reportsToId: mgrA.id, teamName: 'Team Split B' });
    const tlC = await mk('tlC', 'team_lead', { reportsToId: mgrB.id, teamName: 'Team Split C' });
    for (const [name, role, lead] of [
      ['ca1', 'call_agent', tlA.id],
      ['ca2', 'call_agent', tlA.id],
      ['fa1', 'field_agent', tlA.id],
      ['ca3', 'call_agent', tlB.id],
      ['ca4', 'call_agent', tlC.id],
    ] as const) {
      await mk(name, role, { teamLeadId: lead, reportsToId: lead, createdAt: new Date(Date.UTC(year - 1, 0, 1)) });
    }
  });

  afterAll(async () => {
    const created = await prisma.staff.findMany({ where: { OR: [{ id: { in: ids } }, { reportsToId: { in: ids } }] }, select: { id: true } });
    const all = [...new Set([...ids, ...created.map((s) => s.id)])];
    for (const m of [ahead, later]) {
      await prisma.teamPlan.deleteMany({ where: { year: m.year, month: m.month } });
      await prisma.target.deleteMany({ where: { year: m.year, month: m.month } });
    }
    await prisma.teamPlan.deleteMany({ where: { OR: [{ teamLeadId: { in: all } }, { setByStaffId: { in: all } }] } });
    await prisma.target.deleteMany({ where: { OR: [{ staffId: { in: all } }, { createdById: { in: all } }] } });
    await prisma.companyPlan.deleteMany({ where: { setByStaffId: { in: all } } });
    await prisma.staffAwayPeriod.deleteMany({ where: { staffId: { in: all } } });
    await prisma.staffPasswordReset.deleteMany({ where: { staffId: { in: all } } });
    await prisma.statusHistory.deleteMany({ where: { changedByStaffId: { in: all } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: all } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: all } } });
    await prisma.staff.updateMany({ where: { id: { in: all } }, data: { teamLeadId: null, reportsToId: null, tempPasswordIssuedByStaffId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: all } } });
    await app.close();
  });

  it('the CEO\'s plan reaches the teams and agents by work type, and the toast count comes back', async () => {
    const saved = await put('ceo', '/plans/company', { ...ahead, paid: 9000, placed: 3000, vacancies: 600, registered: 12000 });
    expect(saved.status).toBe(200);
    expect(saved.body.split.teams).toBeGreaterThanOrEqual(3);

    const board = (await get('mgrA', `/manager/targets?year=${ahead.year}&month=${ahead.month}`)).body;
    const team = (id: string) => board.plan.teams.find((t: { teamLeadId: string }) => t.teamLeadId === id);
    const a = team(people.tlA.id);
    const b = team(people.tlB.id);
    // mgrA: 4 agents (3 in A, 1 in B), so A gets three times B's share.
    expect(a.split.paid + b.split.paid).toBe(board.plan.share.paid);
    expect(Math.abs(a.split.paid - 3 * b.split.paid)).toBeLessThanOrEqual(3);
    expect(a.split.registered).toBeGreaterThan(0);

    const [ca1, ca2, fa1] = await Promise.all([target('ca1', ahead), target('ca2', ahead), target('fa1', ahead)]);
    // Paid and vacancies to call agents only; placements to the field agent.
    expect(ca1!.candidatesActivated! + ca2!.candidatesActivated!).toBe(a.split.paid);
    expect(ca1!.vacanciesCaptured! + ca2!.vacanciesCaptured!).toBe(a.split.vacancies);
    expect(ca1!.placementsClosed).toBeNull();
    expect(fa1!.placementsClosed).toBe(a.split.placed);
    expect(fa1!.candidatesActivated).toBeNull();
    expect(ca1!.handSetFields).toEqual([]);
    // Team B has no field agent: its placements stay with the team, flagged.
    expect(b.flags.join(' ')).toMatch(/No field agents in Team Split B for placements/);

    const runs = await prisma.auditLog.findMany({ where: { action: 'target_split.run', entityCode: key(ahead), actorId: people.ceo.id } });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].after).toMatchObject({ trigger: 'company_plan_saved' });
  });

  it('a Team Lead changes only their own agents, within the team number; the rest is re-spread; past months refused', async () => {
    const plan = (await get('tlA', `/team-lead/targets/plan?year=${ahead.year}&month=${ahead.month}`)).body;
    expect(plan.automatic).toBe(true);
    expect(plan.team).toHaveLength(8);
    const teamPaid = plan.team.find((r: { key: string }) => r.key === 'paid').target as number;
    expect(plan.agents.map((r: { staff: { id: string } }) => r.staff.id).sort()).toEqual([people.ca1.id, people.ca2.id, people.fa1.id].sort());

    // Not his agents, a past month, other roles: refused.
    expect((await put('tlA', '/team-lead/targets', { ...ahead, rows: [{ staffId: people.ca3.id, candidatesActivated: 1 }] })).status).toBe(403);
    expect((await put('tlA', '/team-lead/targets', { ...past, rows: [{ staffId: people.ca1.id, candidatesActivated: 1 }] })).status).toBe(400);
    expect((await put('ca1', '/team-lead/targets', { ...ahead, rows: [{ staffId: people.ca1.id, candidatesActivated: 1 }] })).status).toBe(403);
    expect((await put('mgrA', '/team-lead/targets', { ...ahead, rows: [{ staffId: people.ca1.id, candidatesActivated: 1 }] })).status).toBe(403);
    expect((await post('tlA', '/team-lead/targets/reset', { ...ahead, staffId: people.ca3.id })).status).toBe(403);

    const over = await put('tlA', '/team-lead/targets', { ...ahead, rows: [{ staffId: people.ca1.id, candidatesActivated: teamPaid + 1 }] });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/more than Team Split A's/);

    const saved = await put('tlA', '/team-lead/targets', { ...ahead, rows: [{ staffId: people.ca1.id, candidatesActivated: 7 }] });
    expect(saved.status).toBe(200);
    const row = saved.body.agents.find((r: { staff: { id: string } }) => r.staff.id === people.ca1.id);
    expect(row.fields.find((f: { field: string }) => f.field === 'candidatesActivated')).toMatchObject({ target: 7, handSet: true });
    expect((await target('ca2', ahead))!.candidatesActivated).toBe(teamPaid - 7);

    const audit = await prisma.auditLog.findFirst({ where: { actorId: people.tlA.id, action: 'target.update' } });
    expect(audit?.after).toMatchObject({ candidatesActivated: 7, handSet: ['candidatesActivated'], by: 'team_lead' });

    // Reset to automatic: an even split again.
    const reset = await post('tlA', '/team-lead/targets/reset', { ...ahead, staffId: people.ca1.id, field: 'candidatesActivated' });
    expect(reset.status).toBe(200);
    expect(reset.body.reset).toEqual(['candidatesActivated']);
    const [ca1, ca2] = await Promise.all([target('ca1', ahead), target('ca2', ahead)]);
    expect(ca1!.handSetFields).toEqual([]);
    expect(Math.abs(ca1!.candidatesActivated! - ca2!.candidatesActivated!)).toBeLessThanOrEqual(1);
    expect(await prisma.auditLog.count({ where: { actorId: people.tlA.id, action: 'target_split.reset' } })).toBe(1);
  });

  it('a Manager works only in their own tree; the CEO and Team Leads cannot use the Manager actions', async () => {
    expect((await put('mgrA', '/manager/targets', { ...ahead, rows: [{ staffId: people.ca4.id, candidatesActivated: 1 }] })).status).toBe(403);
    expect((await post('mgrA', '/manager/targets/reset', { ...ahead, kind: 'team', id: people.tlC.id })).status).toBe(403);
    expect((await post('mgrA', '/manager/targets/reset', { ...ahead, kind: 'agent', id: people.ca4.id })).status).toBe(403);
    expect((await post('mgrA', '/manager/targets/transfer', { ...ahead, fromStaffId: people.ca1.id, toStaffId: people.ca4.id })).status).toBe(403);
    expect((await post('mgrA', '/manager/targets/transfer', { ...ahead, fromStaffId: people.ca4.id, toStaffId: people.ca1.id })).status).toBe(403);
    expect((await post('mgrA', '/manager/targets/reset', { ...past, kind: 'agent', id: people.ca1.id })).status).toBe(400);
    expect((await post('mgrA', '/manager/targets/transfer', { ...past, fromStaffId: people.ca1.id, toStaffId: people.ca2.id })).status).toBe(400);
    expect((await post('ceo', '/manager/targets/reset', { ...ahead, kind: 'team', id: people.tlA.id })).status).toBe(403);
    expect((await post('tlA', '/manager/targets/transfer', { ...ahead, fromStaffId: people.ca1.id, toStaffId: people.ca2.id })).status).toBe(403);
    expect((await post('tlA', '/team-lead/targets/transfer', { ...ahead, fromStaffId: people.ca1.id, toStaffId: people.ca3.id })).status).toBe(403);
    expect((await put('ceo', '/team-lead/targets', { ...ahead, rows: [{ staffId: people.ca1.id, candidatesActivated: 1 }] })).status).toBe(403);
  });

  it('Transfer target moves what is not reached yet; both values become hand-set; same work type only', async () => {
    expect((await post('mgrA', '/manager/targets/transfer', { ...ahead, fromStaffId: people.ca1.id, toStaffId: people.fa1.id })).status).toBe(400);
    const before = await Promise.all([target('ca1', ahead), target('ca3', ahead)]);
    const boardBefore = (await get('mgrA', `/manager/targets?year=${ahead.year}&month=${ahead.month}`)).body;
    const teamPaid = (id: string, b: typeof boardBefore) => b.plan.teams.find((t: { teamLeadId: string }) => t.teamLeadId === id).split.paid;

    // Across two of mgrA's teams: the teams' numbers move with it.
    const moved = await post('mgrA', '/manager/targets/transfer', { ...ahead, fromStaffId: people.ca1.id, toStaffId: people.ca3.id });
    expect(moved.status).toBe(200);
    expect(moved.body.moved.candidatesActivated).toBe(before[0]!.candidatesActivated);
    const [ca1, ca3] = await Promise.all([target('ca1', ahead), target('ca3', ahead)]);
    expect(ca1!.candidatesActivated).toBe(0);
    expect(ca3!.candidatesActivated).toBe(before[0]!.candidatesActivated! + before[1]!.candidatesActivated!);
    expect(ca1!.handSetFields).toEqual(expect.arrayContaining(['candidatesActivated', 'vacanciesCaptured']));
    expect(ca3!.handSetFields).toEqual(expect.arrayContaining(['candidatesActivated']));
    const boardAfter = (await get('mgrA', `/manager/targets?year=${ahead.year}&month=${ahead.month}`)).body;
    expect(teamPaid(people.tlA.id, boardAfter)).toBe(teamPaid(people.tlA.id, boardBefore) - before[0]!.candidatesActivated!);
    expect(teamPaid(people.tlA.id, boardAfter) + teamPaid(people.tlB.id, boardAfter)).toBe(boardAfter.plan.share.paid);
    expect(boardAfter.plan.difference.paid).toBe(0);

    // Nothing left to move now.
    expect((await post('tlA', '/team-lead/targets/transfer', { ...ahead, fromStaffId: people.ca1.id, toStaffId: people.ca2.id })).status).toBe(400);
    const audit = await prisma.auditLog.findFirst({ where: { actorId: people.mgrA.id, action: 'target.transferred' } });
    expect(audit?.after).toMatchObject({ from: people.ca1.code, to: people.ca3.code });
  });

  it('the CEO\'s own target edits are hand-set; a split is re-run by "Split again" and by the backfill only where none ran', async () => {
    const ca4 = await target('ca4', ahead);
    const res = await http().patch(`/targets/${ca4!.id}`).set('Authorization', `Bearer ${people.ceo.token}`).send({ candidatesActivated: ca4!.candidatesActivated! + 0 + 1 });
    expect(res.status).toBe(200);
    expect((await target('ca4', ahead))!.handSetFields).toContain('candidatesActivated');

    expect((await post('mgrA', '/plans/company/split', { ...ahead })).status).toBe(403);
    expect((await post('ceo', '/plans/company/split', { ...past })).status).toBe(400);
    const again = await post('ceo', '/plans/company/split', { ...ahead });
    expect(again.status).toBe(200);
    expect(again.body.split.teams).toBeGreaterThanOrEqual(3);
    // The hand-set value survived.
    expect((await target('ca4', ahead))!.candidatesActivated).toBe(ca4!.candidatesActivated! + 1);

    // Backfill: a plan saved without a split (as before 17 Nov) is split once; the typed numbers are kept.
    await prisma.companyPlan.create({ data: { ...later, paid: 400, setByStaffId: people.ceo.id } });
    await prisma.target.create({ data: { staffId: people.ca2.id, ...later, candidatesActivated: 3, handSetFields: ['candidatesActivated'], createdById: people.mgrA.id } });
    const runs = await split.backfill(now);
    expect(runs.map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`)).toContain(key(later));
    expect(runs.map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`)).not.toContain(key(ahead));
    expect((await target('ca2', later))!.candidatesActivated).toBe(3);
    expect((await target('ca1', later))!.candidatesActivated).toBeGreaterThan(0);
    expect(await split.backfill(now)).toEqual([]);
  });

  it('this month: an agent who leaves passes their unreached part to the team; a joiner gets a share for the days left', async () => {
    const existing = await prisma.companyPlan.findUnique({ where: { year_month: { year, month } } });
    if (existing) return; // another run's plan for this month: leave it alone
    expect((await put('ceo', '/plans/company', { year, month, paid: 9000 })).status).toBe(200);
    const teamA = async () => (await prisma.teamPlan.findMany({ where: { year, month } })).find((p) => p.teamLeadId === people.tlA.id)!;
    const paidA = (await teamA()).paid!;
    const before = await Promise.all([target('ca1', { year, month }), target('ca2', { year, month })]);
    expect(before[0]!.candidatesActivated! + before[1]!.candidatesActivated!).toBe(paidA);

    // ca2 leaves having done nothing: all of ca2's target goes to ca1; the team's number does not change.
    expect((await post('mgrA', `/staff/${people.ca2.id}/deactivate`, {})).status).toBe(200);
    expect((await teamA()).paid).toBe(paidA);
    expect((await target('ca1', { year, month }))!.candidatesActivated).toBe(paidA);
    expect((await teamA()).leaverCredit).toMatchObject({ paid: 0 });

    // A joiner today counts from today: a share for the working days left, not pro-rated again.
    const joined = await post('mgrA', '/staff', { name: `Split joiner ${ts}`, role: 'call_agent', teamLeadId: people.tlA.id });
    expect(joined.status).toBe(201);
    const joiner = await prisma.target.findUnique({ where: { staffId_year_month: { staffId: joined.body.staff.id, year, month } } });
    const ca1 = await target('ca1', { year, month });
    expect(joiner!.candidatesActivated! + ca1!.candidatesActivated!).toBe(paidA);
    const day = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(now));
    if (day > 1) {
      expect(joiner!.splitFromDay).toBe(day);
      expect(joiner!.candidatesActivated!).toBeLessThanOrEqual(ca1!.candidatesActivated!);
    }
    const runs = await prisma.auditLog.findMany({ where: { action: 'target_split.run', entityCode: key({ year, month }), actorId: people.mgrA.id } });
    expect(runs.map((r) => (r.after as { trigger: string }).trigger)).toEqual(expect.arrayContaining(['staff_left', 'staff_joined']));
  });
});

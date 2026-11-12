import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

/**
 * Manager portal endpoints (/manager/*): a Manager only, their own reporting
 * tree only, phone numbers masked and no money anywhere.
 */
describe('Manager portal endpoints', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const ts = Date.now();
  const tail = String(ts).slice(-6);
  const ids: string[] = [];
  const seekerIds: string[] = [];
  const flagIds: string[] = [];
  const people: Record<string, { id: string; code: string; token: string }> = {};
  const now = new Date();
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(now));
  const month = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(now));
  // Seeker 2 started registering 25 hours ago and never paid: stuck work.
  const stuckAt = new Date(now.getTime() - 25 * 3600 * 1000);
  const istMonth = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(d);
  const registeredThisMonth = istMonth(stuckAt) === istMonth(now) ? 2 : 1;
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: {
        code: `MGP-${key}-${ts}`,
        name: `Mgr ${key}`,
        email: `mgp_${key}_${ts}@laboura.local`,
        role,
        passwordHash: await bcrypt.hash('Some-Password-123', 4),
        status: 'active',
        ...extra,
      },
    });
    ids.push(staff.id);
    const session = await prisma.staffSession.create({
      data: {
        staffId: staff.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });
    const payload: JwtPayload = { sub: staff.id, role, email: staff.email, code: staff.code, teamLeadId: staff.teamLeadId, sid: session.id };
    people[key] = { id: staff.id, code: staff.code, token: jwt.sign(payload, { expiresIn: '15m' }) };
    return staff;
  }

  const get = (who: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${people[who].token}`);
  const send = (who: string, method: 'post' | 'put', path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${people[who].token}`).send(body);

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
    const tlB = await mk('tlB', 'team_lead', { reportsToId: mgrB.id });
    await mk('caA', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('faA', 'field_agent', { teamLeadId: tlA.id, reportsToId: tlA.id, isIntern: true });
    await mk('caB', 'call_agent', { teamLeadId: tlB.id, reportsToId: tlB.id });

    for (const [i, owner] of [['1', 'caA'], ['2', 'caA'], ['3', 'caB']] as const) {
      const s = await prisma.jobSeeker.create({
        data: {
          code: `JS-MGP-${tail}-${i}`,
          name: `Seeker ${i}`,
          phone: `9${tail}${i}12`.slice(0, 10).padEnd(10, '0'),
          registeredByStaffId: people[owner].id,
          minSalary: 1500000,
          maxSalary: 2000000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          paymentReceivedAt: i === '1' ? new Date() : null,
          status: i === '1' ? 'active' : 'lead',
          ...(i === '2' ? { createdAt: stuckAt } : {}),
        },
      });
      seekerIds.push(s.id);
    }
    const flagA = await prisma.reviewFlag.create({ data: { code: `RF-MGP-${tail}-1`, kind: 'visit_short', subjectType: 'staff', subjectId: people.faA.id, raisedForStaffId: people.faA.id } });
    const flagMoney = await prisma.reviewFlag.create({ data: { code: `RF-MGP-${tail}-2`, kind: 'bypass_suspected', subjectType: 'business', subjectId: 'x', raisedForStaffId: people.faA.id } });
    const flagB = await prisma.reviewFlag.create({ data: { code: `RF-MGP-${tail}-3`, kind: 'visit_short', subjectType: 'staff', subjectId: people.caB.id, raisedForStaffId: people.caB.id } });
    flagIds.push(flagA.id, flagMoney.id, flagB.id);
  });

  afterAll(async () => {
    const codes = (await prisma.staff.findMany({ where: { id: { in: ids } }, select: { code: true } })).map((s) => s.code);
    await prisma.reviewFlag.deleteMany({ where: { id: { in: flagIds } } });
    await prisma.followUpTask.deleteMany({ where: { OR: [{ assignedStaffId: { in: ids } }, { subjectId: { in: seekerIds } }] } });
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: ids } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.target.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffCoachingNote.deleteMany({ where: { OR: [{ staffId: { in: ids } }, { authorStaffId: { in: ids } }] } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityCode: { in: codes } }] } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('only a Manager opens /manager/*: the CEO, a Team Lead and an agent are refused', async () => {
    for (const who of ['ceo', 'tlA', 'caA']) {
      expect((await get(who, '/manager/overview')).status).toBe(403);
      expect((await get(who, '/manager/staff')).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get('/manager/overview')).status).toBe(401);
  });

  it('overview: plan vs actual for their own tree only, in counts, with no money', async () => {
    const res = await get('mgrA', '/manager/overview');
    expect(res.status).toBe(200);
    expect(res.body.teams).toEqual(['Team South']);
    const paid = res.body.bringMoney.find((r: { metric: string }) => r.metric === 'paid');
    expect(paid.done).toBe(1);
    const registered = res.body.leadToMoney.find((r: { metric: string }) => r.metric === 'registered');
    expect(registered.done).toBe(registeredThisMonth); // caB's seeker is in Manager B's tree
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/₹\s?\d/);
    expect(text).not.toMatch(/paise|revenue|"fee/i);
  });

  it('teams, agents and staff list only their own people', async () => {
    const teams = await get('mgrA', '/manager/teams');
    expect(teams.status).toBe(200);
    expect(teams.body.cards.map((c: { teamLeadId: string }) => c.teamLeadId)).toEqual([people.tlA.id]);

    const agents = await get('mgrA', '/manager/agents');
    const agentIds = agents.body.rows.map((r: { staff: { id: string } }) => r.staff.id).sort();
    expect(agentIds).toEqual([people.caA.id, people.faA.id].sort());
    expect(agents.body.rows.find((r: { staff: { id: string; isIntern: boolean } }) => r.staff.id === people.faA.id).staff.isIntern).toBe(true);

    const staff = await get('mgrA', '/manager/staff');
    expect(staff.body.rows.map((r: { id: string }) => r.id)).not.toContain(people.caB.id);
    expect(staff.body.creatableRoles).toEqual(['team_lead', 'call_agent', 'field_agent']);
    expect(JSON.stringify(staff.body)).not.toMatch(/salary|passwordHash/i);
  });

  it('one agent or Team Lead outside the tree: 403', async () => {
    expect((await get('mgrA', `/manager/agents/${people.caA.id}`)).status).toBe(200);
    expect((await get('mgrA', `/manager/agents/${people.caB.id}`)).status).toBe(403);
    expect((await get('mgrA', `/manager/teams/${people.tlA.id}`)).status).toBe(200);
    expect((await get('mgrA', `/manager/teams/${people.tlB.id}`)).status).toBe(403);
  });

  it('coaching notes and written warnings: inside the tree, audit-logged without the text', async () => {
    const res = await send('mgrA', 'post', `/manager/people/${people.caA.id}/notes`, { kind: 'written_warning', text: 'Third late login this week' });
    expect(res.status).toBe(201);
    const agent = await get('mgrA', `/manager/agents/${people.caA.id}`);
    expect(agent.body.notes[0]).toMatchObject({ kind: 'written_warning', text: 'Third late login this week' });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'staff.written_warning_given', entityCode: people.caA.code } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain('Third late login');
    expect((await send('mgrA', 'post', `/manager/people/${people.caB.id}/notes`, { text: 'x' })).status).toBe(403);
    expect((await send('mgrA', 'post', `/manager/people/${people.caA.id}/notes`, { kind: 'bonus', text: 'x' })).status).toBe(400);
  });

  it('flags: the same scope as /requests/flags; money and bypass flags never go to a Manager; Send to CEO', async () => {
    // A flag about nobody in particular reaches the Managers too.
    const nobody = await prisma.reviewFlag.create({ data: { code: `RF-MGP-${tail}-4`, kind: 'duplicate_business', subjectType: 'business', subjectId: 'y', raisedForStaffId: null } });
    flagIds.push(nobody.id);
    const res = await get('mgrA', '/manager/flags');
    const flagRowIds = res.body.rows.map((r: { id: string }) => r.id);
    expect(flagRowIds).toEqual(expect.arrayContaining([flagIds[0], nobody.id]));
    // Changed on purpose (brief, 12 Nov): the bypass flag used to be listed with "Goes to CEO"; now it is not listed at all.
    expect(flagRowIds).not.toContain(flagIds[1]);
    expect(flagRowIds).not.toContain(flagIds[2]);
    expect(res.body.summary.forCeo).toBe(1);
    expect(res.body.rows.find((r: { id: string }) => r.id === nobody.id)).toMatchObject({ staff: null, canResolve: true, canEscalate: true });
    // /requests/flags shows the Manager the same flags.
    const ours = (list: string[]) => list.filter((id) => flagIds.includes(id)).sort();
    const shared = (await get('mgrA', '/requests/flags?status=open')).body.map((r: { id: string }) => r.id);
    expect(ours(shared)).toEqual(ours(flagRowIds));

    expect((await send('mgrA', 'post', `/manager/flags/${flagIds[1]}/resolve`, { resolution: 'checked' })).status).toBe(403);
    expect((await send('mgrA', 'post', `/manager/flags/${flagIds[2]}/resolve`, { resolution: 'checked' })).status).toBe(403);
    const ok = await send('mgrA', 'post', `/manager/flags/${flagIds[0]}/resolve`, { resolution: 'Spoke to the agent' });
    expect(ok.status).toBe(200);
    expect((await prisma.reviewFlag.findUniqueOrThrow({ where: { id: flagIds[0] } })).status).toBe('resolved');

    // Send to CEO: a note is needed; then only the CEO closes it.
    expect((await send('mgrA', 'post', `/manager/flags/${nobody.id}/escalate`, {})).status).toBe(400);
    const up = await send('mgrA', 'post', `/manager/flags/${nobody.id}/escalate`, { note: 'Same owner under two names' });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ ownerRole: 'ceo', canResolve: false, canEscalate: false });
    const after = (await get('mgrA', '/manager/flags')).body.rows.find((r: { id: string }) => r.id === nobody.id);
    expect(after).toMatchObject({ goesToCeo: true, escalated: { note: 'Same owner under two names' } });
    expect((await send('mgrA', 'post', `/manager/flags/${nobody.id}/resolve`, { resolution: 'x' })).status).toBe(403);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'review_flag.escalated', entityCode: nobody.code } });
    expect(audit?.reason).toBe('Same owner under two names');
    expect((await send('mgrB', 'post', `/manager/flags/${flagIds[0]}/escalate`, { note: 'x' })).status).toBe(404);
  });

  it('targets: save, copy from last month (own agents only), and the board sums teams', async () => {
    const save = await send('mgrA', 'put', '/manager/targets', {
      year: next.year,
      month: next.month,
      rows: [
        { staffId: people.caA.id, candidatesActivated: 40, vacanciesCaptured: 5 },
        { staffId: people.faA.id, placementsClosed: 6, candidatesActivated: 10 },
      ],
    });
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({ created: 2 });
    expect((await send('mgrA', 'put', '/manager/targets', { year: next.year, month: next.month, rows: [{ staffId: people.caB.id, candidatesActivated: 1 }] })).status).toBe(403);

    const board = await get('mgrA', `/manager/targets?year=${next.year}&month=${next.month}`);
    expect(board.status).toBe(200);
    expect(board.body.teams[0]).toMatchObject({ teamLeadId: people.tlA.id, candidatesActivated: 50, placementsClosed: 6 });

    // Manager B's agent has a target this month; Manager A's copy must not touch it.
    await prisma.target.create({ data: { staffId: people.caB.id, year, month, candidatesActivated: 9, createdById: people.ceo.id } });
    const nextNext = next.month === 12 ? { year: next.year + 1, month: 1 } : { year: next.year, month: next.month + 1 };
    const copy = await send('mgrA', 'post', '/manager/targets/copy', { fromYear: next.year, fromMonth: next.month, toYear: nextNext.year, toMonth: nextNext.month });
    expect(copy.status).toBe(201);
    expect(copy.body.copied).toBe(2);
    const copiedB = await prisma.target.count({ where: { staffId: people.caB.id, year: nextNext.year, month: nextNext.month } });
    expect(copiedB).toBe(0);
    const again = await send('mgrA', 'post', '/manager/targets/copy', { fromYear: next.year, fromMonth: next.month, toYear: nextNext.year, toMonth: nextNext.month });
    expect(again.body.copied).toBe(0);
  });

  it('pipeline: counts, and "Remind the agent" only for their own agents', async () => {
    const res = await get('mgrA', '/manager/pipeline');
    expect(res.status).toBe(200);
    expect(res.body.funnel).toMatchObject({ registered: registeredThisMonth, paid: 1 });
    expect(res.body.stuck.map((s: { kind: string }) => s.kind)).toEqual(['registrations', 'vacancies', 'interview_results', 'offers', 'no_vacancy']);
    expect(JSON.stringify(res.body)).not.toMatch(/Paise|atStake/);

    const mine = await send('mgrA', 'post', '/manager/pipeline/remind', { kind: 'job_seeker', id: seekerIds[0] });
    expect(mine.status).toBe(200);
    expect(mine.body.created).toBe(true);
    const twice = await send('mgrA', 'post', '/manager/pipeline/remind', { kind: 'job_seeker', id: seekerIds[0] });
    expect(twice.body.created).toBe(false);
    expect((await send('mgrA', 'post', '/manager/pipeline/remind', { kind: 'job_seeker', id: seekerIds[2] })).status).toBe(403);
  });

  it('"Remind the agents" on stuck work sends a bell to their own agents', async () => {
    const res = await send('mgrA', 'post', '/manager/pipeline/stuck/registrations/remind');
    expect(res.status).toBe(200);
    expect(res.body.reminded).toBe(1);
    const bell = await prisma.notification.findMany({ where: { kind: 'stuck_work_reminder', recipientStaffId: { in: [people.caA.id, people.caB.id] } } });
    expect(bell.map((n) => n.recipientStaffId)).toEqual([people.caA.id]);
    expect((await send('mgrA', 'post', '/manager/pipeline/stuck/nonsense/remind')).status).toBe(400);
  });

  it('call center, field ops, attendance, leave and weekly reports answer for the tree', async () => {
    const cc = await get('mgrA', '/manager/call-center');
    expect(cc.status).toBe(200);
    expect(cc.body.rows.map((r: { staff: { id: string } }) => r.staff.id)).toEqual([people.caA.id]);
    const fo = await get('mgrA', '/manager/field-ops');
    expect(fo.body.rows.map((r: { staff: { id: string } }) => r.staff.id)).toEqual([people.faA.id]);
    const att = await get('mgrA', '/manager/attendance');
    expect(att.status).toBe(200);
    expect(att.body.rows.map((r: { staff: { id: string } }) => r.staff.id)).not.toContain(people.caB.id);
    const leave = await get('mgrA', '/manager/leave');
    expect(leave.status).toBe(200);
    expect(leave.body.balances.map((r: { staff: { id: string } }) => r.staff.id)).not.toContain(people.caB.id);
    const codes = await get('mgrA', '/manager/login-codes');
    expect(codes.status).toBe(200);
    expect(codes.body.summary).toEqual(expect.objectContaining({ waiting: expect.any(Number), codesToday: expect.any(Number) }));
    const weekly = await get('mgrA', '/manager/reports/weekly');
    expect(weekly.status).toBe(200);
    expect(weekly.body.teams.map((t: { teamLeadId: string }) => t.teamLeadId)).toEqual([people.tlA.id]);
  });

  it('a Manager adds an intern field agent under their own Team Lead, with a start date', async () => {
    const res = await send('mgrA', 'post', '/staff', { name: 'New Intern', role: 'field_agent', teamLeadId: people.tlA.id, intern: true, joinedOn: '2026-11-16' });
    expect(res.status).toBe(201);
    ids.push(res.body.staff.id);
    expect(res.body.staff).toMatchObject({ role: 'field_agent', isIntern: true, reportsToId: people.tlA.id });
    expect(String(res.body.staff.joinedOn)).toContain('2026-11-16');
    expect((await send('mgrA', 'post', '/staff', { name: 'Bad', role: 'team_lead', reportsToId: people.mgrA.id, intern: true })).status).toBe(400);
    expect((await send('mgrA', 'post', '/staff', { name: 'Other', role: 'call_agent', teamLeadId: people.tlB.id })).status).toBe(403);
  });

  it('lock and unlock with a reason, both audit-logged; outside the tree refused', async () => {
    const lock = await send('mgrA', 'post', `/staff/${people.caA.id}/lock`, { reason: 'Phone lost' });
    expect(lock.status).toBe(200);
    const listed = await get('mgrA', '/manager/staff');
    expect(listed.body.rows.find((r: { id: string }) => r.id === people.caA.id).state).toBe('locked');
    const unlock = await send('mgrA', 'post', `/staff/${people.caA.id}/unlock`, { reason: 'Found the phone' });
    expect(unlock.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'staff.unlocked', entityCode: people.caA.code }, orderBy: { createdAt: 'desc' } });
    expect(audit?.reason).toBe('Found the phone');
    expect((await send('mgrA', 'post', `/staff/${people.caB.id}/lock`, { reason: 'x' })).status).toBe(403);
  });
});

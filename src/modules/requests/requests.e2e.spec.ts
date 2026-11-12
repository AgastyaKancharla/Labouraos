import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { AttendanceClock } from '../attendance/attendance-clock';

jest.setTimeout(180000);

const shared = { at: new Date('2027-05-03T04:30:00.000Z') };

class FixedClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string };
type View = {
  ref: string;
  kind: string;
  id: string;
  status: string;
  where: string;
  whyWithYou: string | null;
  canDecide: boolean;
  canForward: boolean;
  canOverturn: boolean;
  routeReason: string;
  decided: { by: { id: string } | null; role: string | null } | null;
  details: Record<string, unknown>;
};

describe('Requests and escalation (Team Lead and Manager portals)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const jobSeekerIds: string[] = [];
  const flagIds: string[] = [];

  let ceo: Person;
  let managerA: Person;
  let managerB: Person;
  let leadA: Person;
  let leadB: Person;
  let agentA1: Person;
  let agentA2: Person;
  let agentB1: Person;

  function token(person: Person) {
    return jwt.sign({ sub: person.id, email: `${person.id}@laboura.local`, role: person.role, code: person.code });
  }
  const post = (p: Person, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token(p)}`).send(body);
  const get = (p: Person, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token(p)}`);
  const at = (y: number, m: number, d: number, h: number, min = 0) => {
    shared.at = localCalendarToUtc(y, m, d, h, min);
  };

  async function make(role: string, prefix: string, reportsToId?: string): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} requests`,
        email: `${prefix.toLowerCase()}.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        teamLeadId: agent ? (reportsToId ?? null) : null,
        reportsToId: reportsToId ?? null,
      },
    });
    staffIds.push(row.id);
    return row;
  }

  async function waiting(p: Person): Promise<View[]> {
    const res = await get(p, '/requests/waiting');
    expect(res.status).toBe(200);
    return res.body as View[];
  }

  async function seekerWithHit(registeredBy: Person, n: number) {
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-RQ-${stamp}-${n}`,
        name: `Manjula ${n}`,
        phone: `+9198${stamp.slice(-7)}${n}`.slice(0, 13),
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: 'active',
        hitCount: 1,
        registeredByStaffId: registeredBy.id,
      },
    });
    jobSeekerIds.push(seeker.id);
    const hit = await prisma.jobSeekerHit.create({
      data: { jobSeekerId: seeker.id, reason: 'no_pickup', recordedBy: 'system', recordedAt: shared.at },
    });
    return { seeker, hit };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(FixedClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    ceo = await make('ceo', 'CEORQ');
    managerA = await make('manager', 'MGARQ', ceo.id);
    managerB = await make('manager', 'MGBRQ', ceo.id);
    leadA = await make('team_lead', 'TLARQ', managerA.id);
    leadB = await make('team_lead', 'TLBRQ', managerB.id);
    agentA1 = await make('call_agent', 'CAARQ', leadA.id);
    agentA2 = await make('field_agent', 'FAARQ', leadA.id);
    agentB1 = await make('call_agent', 'CABRQ', leadB.id);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: staffIds } } });
    await prisma.staffRequest.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staffCoachingNote.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.reviewFlag.deleteMany({ where: { id: { in: flagIds } } });
    await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
    await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: { in: jobSeekerIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: jobSeekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: jobSeekerIds } } });
    await prisma.target.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.leaveRequest.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('refuses agents and Finance on the decision lists', async () => {
    expect((await get(agentA1, '/requests/waiting')).status).toBe(403);
    expect((await get(agentA1, '/requests/decided')).status).toBe(403);
    expect((await get(agentA1, '/requests/flags')).status).toBe(403);
  });

  it("puts an agent's leave with their own Team Lead only, and with the Manager too after 24 hours", async () => {
    at(2027, 5, 3, 10);
    const res = await post(agentA1, '/attendance/leave', { kind: 'emergency', fromDate: '2027-05-12', toDate: '2027-05-12', reason: 'Fever' });
    expect(res.status).toBe(201);
    const ref = `leave.${res.body.id}`;

    const lead = await waiting(leadA);
    const mine = lead.find((row) => row.ref === ref);
    expect(mine).toMatchObject({ kind: 'leave', where: 'with_team_lead', whyWithYou: 'team_lead', canDecide: true, canForward: true });

    expect((await waiting(leadB)).some((row) => row.ref === ref)).toBe(false);
    expect((await get(leadB, `/requests/${ref}`)).status).toBe(404);
    expect((await waiting(managerA)).some((row) => row.ref === ref)).toBe(false);
    const open = (await get(managerA, '/requests/open')).body as View[];
    expect(open.find((row) => row.ref === ref)).toMatchObject({ where: 'with_team_lead', canDecide: false });

    at(2027, 5, 4, 11);
    const manager = await waiting(managerA);
    expect(manager.find((row) => row.ref === ref)).toMatchObject({ whyWithYou: 'team_lead_24h', canDecide: true });
    expect((await waiting(managerB)).some((row) => row.ref === ref)).toBe(false);

    // Decided by the Team Lead: closes for both; the Manager may overturn it, one level up.
    const decided = await post(leadA, `/requests/${ref}/decide`, { decision: 'approved' });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ status: 'approved', where: 'decided' });
    expect((await waiting(managerA)).some((row) => row.ref === ref)).toBe(false);
    expect((await post(managerA, `/requests/${ref}/decide`, { decision: 'rejected', reason: 'late' })).status).toBe(409);

    const week = (await get(managerA, '/requests/decided')).body as View[];
    expect(week.find((row) => row.ref === ref)).toMatchObject({ canOverturn: true });
    expect((await post(managerB, `/requests/${ref}/overturn`, { reason: 'Not mine' })).status).toBe(404);
    expect((await post(managerA, `/requests/${ref}/overturn`, {})).status).toBe(400);
    const over = await post(managerA, `/requests/${ref}/overturn`, { reason: 'Three people off that day' });
    expect(over.status).toBe(200);
    expect(over.body.status).toBe('rejected');
    expect(over.body.overturned.reason).toBe('Three people off that day');
  });

  it('needs a reason to reject, and lets the Team Lead send a request to the Manager with a note', async () => {
    at(2027, 5, 5, 10);
    const res = await post(agentA2, '/attendance/leave', { kind: 'casual', fromDate: '2027-05-19', toDate: '2027-05-19', reason: 'Wedding' });
    const ref = `leave.${res.body.id}`;
    expect((await post(leadA, `/requests/${ref}/decide`, { decision: 'rejected' })).status).toBe(400);
    expect((await post(leadA, `/requests/${ref}/forward`, {})).status).toBe(400);
    const sent = await post(leadA, `/requests/${ref}/forward`, { note: 'Busy week, please decide' });
    expect(sent.status).toBe(200);
    expect(sent.body.where).toBe('with_manager');
    expect((await waiting(managerA)).find((row) => row.ref === ref)?.whyWithYou).toBe('forwarded');
    expect((await post(leadA, `/requests/${ref}/decide`, { decision: 'approved' })).status).toBe(403);
  });

  it("lets an agent ask to remove a hit; their Team Lead decides; another team's Team Lead cannot", async () => {
    const { hit } = await seekerWithHit(agentA1, 1);
    const asked = await post(agentA1, '/requests', { kind: 'hit_removal', hitId: hit.id, reason: 'She was at an interview we booked' });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ kind: 'hit_removal', routeReason: 'team_lead', where: 'with_team_lead' });
    expect(asked.body.details.hitNumber).toBe(1);
    const ref = asked.body.ref as string;
    expect((await post(agentB1, '/requests', { kind: 'hit_removal', hitId: hit.id, reason: 'x' })).status).toBe(403);
    expect((await post(leadB, `/requests/${ref}/decide`, { decision: 'approved' })).status).toBe(404);
    expect((await post(agentA1, `/requests/${ref}/decide`, { decision: 'approved' })).status).toBe(403);
    const ok = await post(leadA, `/requests/${ref}/decide`, { decision: 'approved', reason: 'Checked the interview' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('approved');
    const fresh = await prisma.jobSeekerHit.findUniqueOrThrow({ where: { id: hit.id } });
    expect(fresh.reversedAt).not.toBeNull();
    expect(fresh.reversedByStaffId).toBe(leadA.id);
  });

  it('sends a 3rd hit removal on one job seeker to the Manager', async () => {
    const { seeker, hit } = await seekerWithHit(agentA1, 2);
    await prisma.jobSeekerHit.createMany({
      data: [
        { jobSeekerId: seeker.id, reason: 'no_pickup', recordedBy: 'system', reversedAt: shared.at, reversalReason: 'one' },
        { jobSeekerId: seeker.id, reason: 'no_pickup', recordedBy: 'system', reversedAt: shared.at, reversalReason: 'two' },
      ],
    });
    const asked = await post(leadA, '/requests', { kind: 'hit_removal', hitId: hit.id, reason: 'He was in hospital' });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ routeReason: 'third_hit', where: 'with_manager' });
    expect((await waiting(leadA)).some((row) => row.ref === asked.body.ref)).toBe(false);
    expect((await waiting(managerA)).find((row) => row.ref === asked.body.ref)?.whyWithYou).toBe('third_hit');
  });

  it('changes a day at once for the Team Lead, but sends the 3rd change in a month to the Manager, who can overturn it', async () => {
    at(2027, 5, 10, 12);
    const days = [];
    for (const date of ['2027-05-03', '2027-05-04', '2027-05-05']) {
      days.push(
        await prisma.attendanceDay.create({
          data: {
            staffId: agentA1.id,
            date: new Date(`${date}T00:00:00.000Z`),
            dayType: 'half',
            loginAt: new Date(`${date}T04:00:00.000Z`),
            logoutAt: new Date(`${date}T08:30:00.000Z`),
            productionSeconds: 4 * 3600 + 600,
          },
        }),
      );
    }
    const first = await post(leadA, '/requests', { kind: 'day_change', dayId: days[0].id, dayType: 'full', reason: 'Calling system down 35 min' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'approved', where: 'decided' });
    expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: days[0].id } })).dayType).toBe('full');
    const second = await post(leadA, '/requests', { kind: 'day_change', dayId: days[1].id, dayType: 'full', reason: 'Outage' });
    expect(second.body.status).toBe('approved');
    const third = await post(leadA, '/requests', { kind: 'day_change', dayId: days[2].id, dayType: 'full', reason: 'Outage again' });
    expect(third.body).toMatchObject({ status: 'pending', routeReason: 'third_day_change', where: 'with_manager' });
    expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: days[2].id } })).dayType).toBe('half');
    expect((await post(leadB, '/requests', { kind: 'day_change', dayId: days[2].id, dayType: 'full', reason: 'x' })).status).toBe(403);

    const decidedByLead = ((await get(managerA, '/requests/decided')).body as View[]).find((row) => row.ref === first.body.ref);
    expect(decidedByLead).toMatchObject({ canOverturn: true });
    const undo = await post(managerA, `/requests/${first.body.ref}/overturn`, { reason: 'Worked only 4h 10m' });
    expect(undo.status).toBe(200);
    expect(undo.body.status).toBe('rejected');
    expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: days[0].id } })).dayType).toBe('half');
    // The CEO only overturns a Manager's decision, never a Team Lead's directly.
    const second2 = ((await get(ceo, '/requests/decided')).body as View[]).find((row) => row.ref === second.body.ref);
    expect(second2?.canOverturn).toBe(false);
  });

  it("lets a Team Lead ask the Manager to change a target; the Manager's approval sets it", async () => {
    at(2027, 5, 10, 12);
    expect((await post(leadA, '/requests', { kind: 'target_change', staffId: agentB1.id, metric: 'candidatesActivated', to: 50, reason: 'x' })).status).toBe(403);
    expect((await post(agentA1, '/requests', { kind: 'target_change', staffId: agentA1.id, metric: 'candidatesActivated', to: 50, reason: 'x' })).status).toBe(403);
    const asked = await post(leadA, '/requests', { kind: 'target_change', staffId: agentA1.id, metric: 'candidatesActivated', to: 50, reason: 'Doing well' });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ routeReason: 'target_change', where: 'with_manager' });
    expect((await post(leadA, `/requests/${asked.body.ref}/decide`, { decision: 'approved' })).status).toBe(403);
    expect((await post(managerB, `/requests/${asked.body.ref}/decide`, { decision: 'approved' })).status).toBe(404);
    const ok = await post(managerA, `/requests/${asked.body.ref}/decide`, { decision: 'approved', reason: 'Fine' });
    expect(ok.status).toBe(200);
    const target = await prisma.target.findUniqueOrThrow({ where: { staffId_year_month: { staffId: agentA1.id, year: 2027, month: 5 } } });
    expect(target.candidatesActivated).toBe(50);
  });

  it('rings the bell of whoever the request is with', async () => {
    at(2027, 5, 10, 12);
    const { hit } = await seekerWithHit(agentA2, 3);
    const asked = await post(agentA2, '/requests', { kind: 'hit_removal', hitId: hit.id, reason: 'Wrong number' });
    const bell = await prisma.notification.findFirst({ where: { recipientStaffId: leadA.id, kind: 'staff_request', subjectId: asked.body.id, clearedAt: null } });
    expect(bell?.link).toBe(`/team-lead/requests/${asked.body.ref}`);
    await post(leadA, `/requests/${asked.body.ref}/decide`, { decision: 'rejected', reason: 'The hit stands' });
    const cleared = await prisma.notification.findFirst({ where: { recipientStaffId: leadA.id, kind: 'staff_request', subjectId: asked.body.id } });
    expect(cleared?.clearedAt).not.toBeNull();
    expect(cleared?.clearedByStaffId).toBe(leadA.id);
  });

  describe('review flags: scope and escalation', () => {
    let short: { id: string };
    let money: { id: string };
    let bypass: { id: string };

    beforeAll(async () => {
      short = await prisma.reviewFlag.create({ data: { code: `RF-RQ-${stamp}-1`, kind: 'visit_short', subjectType: 'business_visit', subjectId: 'v1', raisedForStaffId: agentA2.id } });
      money = await prisma.reviewFlag.create({ data: { code: `RF-RQ-${stamp}-2`, kind: 'payment_mismatch', subjectType: 'payment', subjectId: 'p1', raisedForStaffId: agentA2.id, ownerRole: 'ceo' } });
      bypass = await prisma.reviewFlag.create({ data: { code: `RF-RQ-${stamp}-3`, kind: 'bypass_suspected', subjectType: 'business', subjectId: 'b1', raisedForStaffId: agentA2.id, ownerRole: 'ceo' } });
      flagIds.push(short.id, money.id, bypass.id);
    });

    it("shows a Team Lead only their team's flags and a Manager only their tree, never money flags", async () => {
      const lead = (await get(leadA, '/requests/flags?status=open')).body as Array<{ id: string; canResolve: boolean; canEscalate: boolean; ownerRole: string }>;
      expect(lead.find((f) => f.id === short.id)).toMatchObject({ ownerRole: 'team_lead', canResolve: true, canEscalate: true });
      expect(lead.find((f) => f.id === bypass.id)).toMatchObject({ ownerRole: 'ceo', canResolve: false, canEscalate: false });
      expect(lead.some((f) => f.id === money.id)).toBe(false);
      expect(((await get(leadB, '/requests/flags')).body as Array<{ id: string }>).some((f) => f.id === short.id)).toBe(false);
      expect(((await get(managerB, '/requests/flags')).body as Array<{ id: string }>).some((f) => f.id === short.id)).toBe(false);
      expect(((await get(managerA, '/requests/flags')).body as Array<{ id: string }>).some((f) => f.id === money.id)).toBe(false);
      expect(((await get(ceo, '/requests/flags')).body as Array<{ id: string }>).some((f) => f.id === money.id)).toBe(true);
    });

    it('moves a flag up one level at a time: Team Lead → Manager → CEO', async () => {
      expect((await post(leadA, `/requests/flags/${short.id}/escalate`, {})).status).toBe(400);
      const toManager = await post(leadA, `/requests/flags/${short.id}/escalate`, { note: 'Second short visit this week' });
      expect(toManager.status).toBe(200);
      expect(toManager.body).toMatchObject({ ownerRole: 'manager', canResolve: false, canEscalate: false });
      expect((await post(leadA, `/requests/flags/${short.id}/resolve`, { resolution: 'ok' })).status).toBe(403);
      const bell = await prisma.notification.findFirst({ where: { recipientStaffId: managerA.id, subjectId: short.id, clearedAt: null } });
      expect(bell).not.toBeNull();
      const toCeo = await post(managerA, `/requests/flags/${short.id}/escalate`, { note: 'Pattern' });
      expect(toCeo.body.ownerRole).toBe('ceo');
      expect((await post(managerA, `/requests/flags/${short.id}/resolve`, { resolution: 'ok' })).status).toBe(403);
      expect((await post(managerA, `/requests/flags/${bypass.id}/resolve`, { resolution: 'ok' })).status).toBe(403);
      const done = await post(ceo, `/requests/flags/${short.id}/resolve`, { resolution: 'Spoke to him' });
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('resolved');
    });
  });
});

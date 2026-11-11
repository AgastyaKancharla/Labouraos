import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { AttendanceClock } from './attendance-clock';

jest.setTimeout(180000);

const shared = { at: new Date('2027-05-01T04:30:00.000Z') };

class DayClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string };
type Body = Record<string, unknown>;
type RequestView = {
  id: string;
  kind: string;
  status: string;
  routedToRole: string;
  routeReason: string;
  routeReasonText: string;
  whyWithYou?: string;
  whyWithYouText?: string;
  decided: { by: { id: string } | null; reason: string } | null;
};

const HOUR = 3600;
const MIN = 60;

describe('Phase 21 Task 4: leave and corrections', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];

  let ceo: Person;
  let managerA: Person;
  let managerB: Person;
  let leadA: Person;
  let leadB: Person;
  let finance: Person;

  function tokenFor(staff: Person) {
    return jwt.sign({
      sub: staff.id,
      email: `${staff.id}@laboura.local`,
      role: staff.role,
      code: staff.code,
    });
  }

  function at(year: number, month: number, day: number, hour: number, minute = 0) {
    shared.at = localCalendarToUtc(year, month, day, hour, minute);
  }

  async function make(
    role: string,
    prefix: string,
    reportsToId?: string,
    createdAt?: Date,
  ): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} leave`,
        email: `${prefix.toLowerCase()}.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        city: 'Bengaluru',
        teamLeadId: agent ? (reportsToId ?? null) : null,
        reportsToId: reportsToId ?? null,
        ...(createdAt ? { createdAt } : {}),
      },
    });
    staffIds.push(row.id);
    return row;
  }

  function post(person: Person, path: string, body: Body = {}) {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${tokenFor(person)}`)
      .send(body);
  }

  function get(person: Person, path: string) {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${tokenFor(person)}`);
  }

  function leave(person: Person, kind: string, fromDate: string, toDate = fromDate) {
    return post(person, '/attendance/leave', { kind, fromDate, toDate, reason: 'Family function' });
  }

  function decide(person: Person, kind: string, id: string, action: string, body: Body = { reason: 'Fine' }) {
    return post(person, `/attendance/requests/${kind}/${id}/${action}`, body);
  }

  async function waitingIds(person: Person): Promise<RequestView[]> {
    const res = await get(person, '/attendance/requests/waiting');
    expect(res.status).toBe(200);
    return res.body as RequestView[];
  }

  async function workDay(person: Person, ymd: [number, number, number], steps: Array<[string, string]>) {
    for (const [time, action] of steps) {
      const [hour, minute] = time.split(':').map((part) => Number(part));
      at(ymd[0], ymd[1], ymd[2], hour, minute);
      const path =
        action === 'login' ? '/attendance/login' : action === 'logout' ? '/attendance/logout' : '/attendance/status';
      const res = await post(person, path, action === 'login' || action === 'logout' ? {} : { status: action });
      expect(res.status).toBe(201);
    }
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AttendanceClock)
      .useClass(DayClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    ceo = await make('ceo', 'CEO4');
    managerA = await make('manager', 'MGA4', ceo.id);
    managerB = await make('manager', 'MGB4', ceo.id);
    leadA = await make('team_lead', 'TLA4', managerA.id);
    leadB = await make('team_lead', 'TLB4', managerB.id);
    finance = await make('finance', 'FIN4', ceo.id);
  });

  afterAll(async () => {
    try {
      if (staffIds.length > 0) {
        const dayRows = await prisma.attendanceDay.findMany({
          where: { staffId: { in: staffIds } },
          select: { id: true },
        });
        await prisma.statusHistory.deleteMany({
          where: { subjectType: 'attendance_day', subjectId: { in: dayRows.map((row) => row.id) } },
        });
        await prisma.messageLog.deleteMany({
          where: { subjectType: 'staff', subjectId: { in: staffIds } },
        });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      await app.close();
    }
  });

  it('earns leave on the 1st of each month and carries unused days forward', async () => {
    at(2027, 5, 10, 10);
    const mid = await make('call_agent', 'BAL4', leadA.id, new Date('2026-12-15T06:00:00.000Z'));
    const first = await make('call_agent', 'BAF4', leadA.id, localCalendarToUtc(2027, 3, 1, 0, 0));
    const midBalance = await get(mid, '/attendance/leave/balance').expect(200);
    expect(midBalance.body.casual).toMatchObject({ earned: 5, taken: 0, left: 5 });
    expect(midBalance.body.emergency).toMatchObject({ earned: 5, taken: 0, left: 5 });
    const firstBalance = await get(first, '/attendance/leave/balance').expect(200);
    // No leave in the joining month, even when joining on the 1st (decided 11 Nov):
    // created 1 March earns on 1 April and 1 May.
    expect(firstBalance.body.casual.earned).toBe(2);

    const asked = await leave(mid, 'casual', '2027-05-12', '2027-05-13');
    expect(asked.status).toBe(201);
    expect((await decide(leadA, 'leave', asked.body.id, 'approve')).status).toBe(201);
    const after = await get(leadA, `/attendance/leave/balance?staffId=${mid.id}`).expect(200);
    expect(after.body.casual).toMatchObject({ earned: 5, taken: 2, paidTaken: 2, left: 3 });

    at(2027, 6, 2, 10);
    const nextMonth = await get(mid, '/attendance/leave/balance').expect(200);
    expect(nextMonth.body.casual).toMatchObject({ earned: 6, taken: 2, left: 4 });
    expect(nextMonth.body.emergency).toMatchObject({ earned: 6, left: 6 });
    const accruals = await prisma.leaveAccrual.count({ where: { staffId: mid.id } });
    expect(accruals).toBe(6);

    expect((await get(leadB, `/attendance/leave/balance?staffId=${mid.id}`)).status).toBe(403);
    expect((await get(finance, `/attendance/leave/balance?staffId=${mid.id}`)).status).toBe(200);
  });

  it('sends the 4th planned day in a month to the Manager; emergency leave does not count; beyond the balance is unpaid', async () => {
    at(2027, 5, 1, 10);
    const agent = await make('call_agent', 'LIM4', leadA.id, new Date('2027-04-15T06:00:00.000Z'));
    // 3 casual days Mon–Wed: with the Team Lead. Only 1 day is in the paid balance.
    const three = await leave(agent, 'casual', '2027-05-03', '2027-05-05');
    expect(three.status).toBe(201);
    expect(three.body).toMatchObject({ routedToRole: 'team_lead', routeReason: 'team_lead', days: 3 });
    const approved = await decide(leadA, 'leave', three.body.id, 'approve');
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ status: 'approved', paidDays: 1, unpaidDays: 2 });

    const emergency = await leave(agent, 'emergency', '2027-05-06');
    expect(emergency.body).toMatchObject({ routedToRole: 'team_lead', routeReason: 'team_lead' });
    expect((await decide(leadA, 'leave', emergency.body.id, 'approve')).body).toMatchObject({
      paidDays: 1,
      unpaidDays: 0,
    });

    const fourth = await leave(agent, 'casual', '2027-05-07');
    expect(fourth.status).toBe(201);
    expect(fourth.body).toMatchObject({
      routedToRole: 'manager',
      routeReason: 'over_limit',
      routeReasonText: 'More than 3 planned days in a month',
      casualDaysTakenThisMonth: 3,
    });
    const managerList = await waitingIds(managerA);
    const listed = managerList.find((row) => row.id === fourth.body.id);
    expect(listed).toMatchObject({ whyWithYou: 'over_limit', whyWithYouText: 'More than 3 planned days in a month' });
    expect((await waitingIds(leadA)).some((row) => row.id === fourth.body.id)).toBe(false);
    expect((await decide(leadA, 'leave', fourth.body.id, 'approve')).status).toBe(403);
    const byManager = await decide(managerA, 'leave', fourth.body.id, 'approve', { reason: 'Quiet week' });
    expect(byManager.status).toBe(201);
    expect(byManager.body).toMatchObject({ paidDays: 0, unpaidDays: 1 });

    const month = await get(leadA, `/attendance/month?month=2027-05&staffId=${agent.id}`).expect(200);
    expect(month.body.paidLeaveDays).toEqual({ casual: 1, emergency: 1, total: 2 });
    expect(month.body.unpaidLeaveDays).toBe(3);
    const sms = await prisma.messageLog.findMany({
      where: { subjectType: 'staff', subjectId: agent.id, template: 'attendance_leave_decision' },
    });
    expect(sms.length).toBe(3);
  });

  it("sends a Team Lead's own leave to their Manager, and a Manager's or Finance's to the CEO; nobody decides their own", async () => {
    at(2027, 5, 1, 10);
    const own = await leave(leadA, 'casual', '2027-05-17');
    expect(own.body).toMatchObject({
      routedToRole: 'manager',
      routeReason: 'team_lead_own',
      routeReasonText: "Team Lead's own request",
    });
    expect((await waitingIds(managerA)).find((row) => row.id === own.body.id)?.whyWithYou).toBe('team_lead_own');
    expect((await waitingIds(managerB)).some((row) => row.id === own.body.id)).toBe(false);
    expect((await decide(leadA, 'leave', own.body.id, 'approve')).status).toBe(403);
    expect((await decide(managerB, 'leave', own.body.id, 'approve')).status).toBe(403);
    expect((await decide(managerA, 'leave', own.body.id, 'approve')).status).toBe(201);

    const managerOwn = await leave(managerA, 'emergency', '2027-05-18');
    expect(managerOwn.body).toMatchObject({ routedToRole: 'ceo', routeReason: 'manager_own' });
    expect((await decide(managerA, 'leave', managerOwn.body.id, 'approve')).status).toBe(403);
    const financeOwn = await leave(finance, 'casual', '2027-05-18');
    expect(financeOwn.body).toMatchObject({ routedToRole: 'ceo', routeReason: 'finance_own' });
    const ceoList = await waitingIds(ceo);
    expect(ceoList.map((row) => row.id)).toEqual(expect.arrayContaining([managerOwn.body.id, financeOwn.body.id]));
    expect((await decide(ceo, 'leave', financeOwn.body.id, 'approve')).status).toBe(201);

    const agent = await make('call_agent', 'OWN4', leadA.id);
    const mine = await leave(agent, 'casual', '2027-05-19');
    expect((await decide(agent, 'leave', mine.body.id, 'approve')).status).toBe(403);
    expect((await post(ceo, '/attendance/leave', { kind: 'casual', fromDate: '2027-05-19', reason: 'x' })).status).toBe(403);
  });

  it('escalates after 24 and 48 hours without removing the request, and the first decision closes it for all', async () => {
    const agent = await make('call_agent', 'ESC4', leadA.id);
    at(2027, 5, 12, 10);
    const asked = await leave(agent, 'casual', '2027-05-20');
    const id = asked.body.id as string;

    at(2027, 5, 13, 9, 59);
    expect((await waitingIds(leadA)).some((row) => row.id === id)).toBe(true);
    expect((await waitingIds(managerA)).some((row) => row.id === id)).toBe(false);
    expect((await decide(managerA, 'leave', id, 'approve')).status).toBe(403);

    at(2027, 5, 13, 10, 0);
    expect((await waitingIds(leadA)).some((row) => row.id === id)).toBe(true);
    const withManager = (await waitingIds(managerA)).find((row) => row.id === id);
    expect(withManager).toMatchObject({
      whyWithYou: 'team_lead_24h',
      whyWithYouText: "The Team Lead hasn't answered in 24 hours",
    });
    expect((await waitingIds(managerB)).some((row) => row.id === id)).toBe(false);
    expect((await waitingIds(ceo)).some((row) => row.id === id)).toBe(false);

    at(2027, 5, 15, 10, 0);
    expect((await waitingIds(leadA)).some((row) => row.id === id)).toBe(true);
    expect((await waitingIds(managerA)).some((row) => row.id === id)).toBe(true);
    expect((await waitingIds(ceo)).find((row) => row.id === id)?.whyWithYou).toBe('manager_48h');

    const first = await decide(leadA, 'leave', id, 'approve', { reason: 'Covered by the team' });
    expect(first.status).toBe(201);
    const late = await decide(managerA, 'leave', id, 'reject', { reason: 'Too late' });
    expect(late.status).toBe(409);
    expect(late.body.message).toContain(leadA.code);
    expect(late.body.details?.decidedBy ?? late.body.decidedBy).toMatchObject({ code: leadA.code });
    expect((await decide(ceo, 'leave', id, 'approve')).status).toBe(409);
    for (const person of [leadA, managerA, ceo]) {
      expect((await waitingIds(person)).some((row) => row.id === id)).toBe(false);
    }
    const decided = await get(managerA, '/attendance/requests/decided').expect(200);
    const row = (decided.body as RequestView[]).find((item) => item.id === id);
    expect(row?.decided).toMatchObject({ by: { id: leadA.id }, reason: 'Covered by the team' });
    const mine = await get(agent, '/attendance/requests/mine').expect(200);
    expect((mine.body as RequestView[]).find((item) => item.id === id)?.decided?.by?.id).toBe(leadA.id);
    const team = await get(leadA, '/attendance/requests/team').expect(200);
    expect((team.body as RequestView[]).some((item) => item.id === id)).toBe(true);
    const otherTeam = await get(leadB, '/attendance/requests/team').expect(200);
    expect((otherTeam.body as RequestView[]).some((item) => item.id === id)).toBe(false);
  });

  it('lets the Team Lead forward with a note, and a Manager overturn a Team Lead decision only with a reason', async () => {
    const agent = await make('call_agent', 'FWD4', leadA.id);
    at(2027, 5, 12, 10);
    const asked = await leave(agent, 'casual', '2027-05-21');
    expect((await decide(leadA, 'leave', asked.body.id, 'forward', {})).status).toBe(400);
    const forwarded = await decide(leadA, 'leave', asked.body.id, 'forward', { note: 'Your call, busy week' });
    expect(forwarded.status).toBe(201);
    expect((await waitingIds(managerA)).find((row) => row.id === asked.body.id)?.whyWithYou).toBe('forwarded');
    expect((await decide(leadA, 'leave', asked.body.id, 'approve')).status).toBe(403);
    expect((await decide(managerA, 'leave', asked.body.id, 'reject', { reason: 'Busy week' })).status).toBe(201);

    const second = await leave(agent, 'casual', '2027-05-24');
    expect((await decide(leadA, 'leave', second.body.id, 'reject', { reason: 'Short staffed' })).status).toBe(201);
    expect((await decide(managerA, 'leave', second.body.id, 'overturn', {})).status).toBe(400);
    expect((await decide(managerB, 'leave', second.body.id, 'overturn', { reason: 'x' })).status).toBe(403);
    expect((await decide(leadA, 'leave', second.body.id, 'overturn', { reason: 'x' })).status).toBe(403);
    const overturned = await decide(managerA, 'leave', second.body.id, 'overturn', { reason: 'Wedding, approved' });
    expect(overturned.status).toBe(201);
    expect(overturned.body).toMatchObject({
      status: 'approved',
      overturned: { by: { id: managerA.id }, reason: 'Wedding, approved' },
      decided: { by: { id: leadA.id } },
    });
    const day = await prisma.attendanceDay.findFirstOrThrow({
      where: { staffId: agent.id, date: new Date('2027-05-24T00:00:00.000Z') },
    });
    expect(day).toMatchObject({ dayType: 'leave', leaveKind: 'casual', leaveRequestId: second.body.id });
    expect((await decide(managerA, 'leave', second.body.id, 'overturn', { reason: 'again' })).status).toBe(400);
  });

  it('applies an approved correction, recalculates the day, and sends the third correction in a month to the Manager', async () => {
    const agent = await make('call_agent', 'COR4', leadA.id);
    // Mon 10 May: system down, logged in at 10:15 → 45 minutes late, 7h 15m production.
    await workDay(agent, [2027, 5, 10], [
      ['10:15', 'login'],
      ['10:15', 'team_meeting'],
      ['17:30', 'logout'],
    ]);
    // Tue 11 May: a one-hour "break" that was really training.
    await workDay(agent, [2027, 5, 11], [
      ['09:30', 'login'],
      ['09:30', 'team_meeting'],
      ['11:00', 'short_break'],
      ['12:00', 'team_meeting'],
      ['18:00', 'logout'],
    ]);
    const before = await prisma.attendanceDay.findFirstOrThrow({
      where: { staffId: agent.id, date: new Date('2027-05-10T00:00:00.000Z') },
    });
    expect(before).toMatchObject({ lateMinutes: 45, dayType: 'full', shortfallSeconds: 45 * MIN });

    at(2027, 5, 12, 10);
    const first = await post(agent, '/attendance/corrections', {
      date: '2027-05-10',
      from: '09:30',
      to: '10:15',
      reason: 'System was down, I was working 9:30 to 10:15',
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ routedToRole: 'team_lead', monthNumber: 1 });
    expect((await decide(agent, 'correction', first.body.id, 'approve', { reason: 'mine' })).status).toBe(403);
    expect((await decide(leadA, 'correction', first.body.id, 'approve', {})).status).toBe(400);
    expect(
      (await decide(leadA, 'correction', first.body.id, 'approve', { reason: 'Outage confirmed by IT' })).status,
    ).toBe(201);
    const fixed = await prisma.attendanceDay.findFirstOrThrow({
      where: { staffId: agent.id, date: new Date('2027-05-10T00:00:00.000Z') },
      include: { segments: true },
    });
    expect(fixed).toMatchObject({
      lateMinutes: 0,
      productionSeconds: 8 * HOUR,
      dayType: 'full',
      shortfallSeconds: 0,
    });
    expect(fixed.loginAt?.toISOString()).toBe(localCalendarToUtc(2027, 5, 10, 9, 30).toISOString());
    expect(fixed.segments.some((segment) => segment.source === 'correction')).toBe(true);

    const second = await post(agent, '/attendance/corrections', {
      date: '2027-05-11',
      from: '11:15',
      to: '12:00',
      status: 'training',
      reason: 'Was in product training, not on break',
    });
    expect(second.body).toMatchObject({ routedToRole: 'team_lead', monthNumber: 2 });
    expect((await decide(leadA, 'correction', second.body.id, 'approve', { reason: 'Trainer confirmed' })).status).toBe(201);
    const tuesday = await prisma.attendanceDay.findFirstOrThrow({
      where: { staffId: agent.id, date: new Date('2027-05-11T00:00:00.000Z') },
    });
    expect(tuesday).toMatchObject({
      productionSeconds: 8 * HOUR + 15 * MIN,
      breakSeconds: 15 * MIN,
      makeUpSeconds: 15 * MIN,
      shortfallSeconds: 0,
    });
    const kept = await prisma.attendanceCorrection.findUniqueOrThrow({ where: { id: second.body.id } });
    expect(kept.replacedSegments).toEqual([
      expect.objectContaining({ status: 'short_break', source: 'staff' }),
    ]);

    const third = await post(agent, '/attendance/corrections', {
      date: '2027-05-11',
      from: '17:45',
      to: '18:00',
      reason: 'Stayed for a call',
    });
    expect(third.body).toMatchObject({
      routedToRole: 'manager',
      routeReason: 'third_correction',
      routeReasonText: 'Third correction this month',
      monthNumber: 3,
    });
    expect((await decide(leadA, 'correction', third.body.id, 'approve')).status).toBe(403);
    expect((await waitingIds(managerA)).find((row) => row.id === third.body.id)?.whyWithYou).toBe('third_correction');

    const future = await post(agent, '/attendance/corrections', {
      date: '2027-05-12',
      from: '09:30',
      to: '18:00',
      reason: 'later today',
    });
    expect(future.status).toBe(400);
  });
});

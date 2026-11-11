import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { AttendanceClock } from './attendance-clock';
import { AttendanceDaysService } from './attendance-days.service';
import { AttendanceService } from './attendance.service';

jest.setTimeout(180000);

const shared = { at: new Date('2027-02-01T04:00:00.000Z') };

class DayClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string };
type Step = [string, string];

const HOUR = 3600;
const MIN = 60;

describe('Phase 21 Task 3: full days, half days, shortfall and the month', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let days: AttendanceDaysService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];

  let ceo: Person;
  let managerA: Person;
  let managerB: Person;
  let leadA: Person;
  let leadB: Person;
  let agentA: Person;
  let agentB: Person;
  let finance: Person;

  function tokenFor(staff: Person) {
    return jwt.sign({
      sub: staff.id,
      email: `${staff.id}@laboura.local`,
      role: staff.role,
      code: staff.code,
    });
  }

  function at(year: number, month: number, day: number, hour: number, minute: number) {
    shared.at = localCalendarToUtc(year, month, day, hour, minute);
  }

  async function make(role: string, prefix: string, reportsToId?: string): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} day rules`,
        email: `${prefix.toLowerCase()}.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        city: 'Bengaluru',
        teamLeadId: agent ? (reportsToId ?? null) : null,
        reportsToId: reportsToId ?? null,
      },
    });
    staffIds.push(row.id);
    return row;
  }

  /** Runs one day: each step is [HH:MM IST, login | logout | a status]. */
  async function workDay(person: Person, ymd: [number, number, number], steps: Step[]) {
    const token = tokenFor(person);
    for (const [time, action] of steps) {
      const [hour, minute] = time.split(':').map((part) => Number(part));
      at(ymd[0], ymd[1], ymd[2], hour, minute);
      const path =
        action === 'login' ? '/attendance/login' : action === 'logout' ? '/attendance/logout' : '/attendance/status';
      const res = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .send(action === 'login' || action === 'logout' ? {} : { status: action });
      expect(res.status).toBe(201);
    }
  }

  /** A day of team meeting from start to end, so production equals the time logged in. */
  function straightDay(person: Person, ymd: [number, number, number], start: string, end: string) {
    return workDay(person, ymd, [
      [start, 'login'],
      [start, 'team_meeting'],
      [end, 'logout'],
    ]);
  }

  async function dayOn(person: Person, date: string) {
    return prisma.attendanceDay.findFirstOrThrow({
      where: { staffId: person.id, date: new Date(`${date}T00:00:00.000Z`) },
    });
  }

  function month(viewer: Person, monthLabel: string, staffId?: string) {
    const query = staffId ? `month=${monthLabel}&staffId=${staffId}` : `month=${monthLabel}`;
    return request(app.getHttpServer())
      .get(`/attendance/month?${query}`)
      .set('Authorization', `Bearer ${tokenFor(viewer)}`);
  }

  function changeDay(viewer: Person, dayId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/attendance/days/${dayId}/day-type`)
      .set('Authorization', `Bearer ${tokenFor(viewer)}`)
      .send(body);
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
    days = app.get(AttendanceDaysService);

    ceo = await make('ceo', 'CEO3');
    managerA = await make('manager', 'MGA3', ceo.id);
    managerB = await make('manager', 'MGB3', ceo.id);
    leadA = await make('team_lead', 'TLA3', managerA.id);
    leadB = await make('team_lead', 'TLB3', managerB.id);
    agentA = await make('call_agent', 'CAA3', leadA.id);
    agentB = await make('call_agent', 'CAB3', leadB.id);
    finance = await make('finance', 'FIN3', ceo.id);
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
        await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      await app.close();
    }
  });

  it('sets the day type when a day closes, with the tolerance at both lines', async () => {
    const person = await make('call_agent', 'BND3', leadA.id);
    await straightDay(person, [2027, 3, 1], '09:30', '17:22'); // 7h 52m
    await straightDay(person, [2027, 3, 2], '09:30', '17:20'); // 7h 50m
    await straightDay(person, [2027, 3, 3], '09:30', '17:19'); // 7h 49m
    await straightDay(person, [2027, 3, 4], '09:30', '13:50'); // 4h 20m
    await straightDay(person, [2027, 3, 5], '09:30', '13:49'); // 4h 19m

    expect(await dayOn(person, '2027-03-01')).toMatchObject({
      dayType: 'full',
      productionSeconds: 7 * HOUR + 52 * MIN,
      shortfallSeconds: 0,
      makeUpSeconds: 0,
    });
    expect(await dayOn(person, '2027-03-02')).toMatchObject({ dayType: 'full', shortfallSeconds: 0 });
    expect(await dayOn(person, '2027-03-03')).toMatchObject({
      dayType: 'full',
      shortfallSeconds: 11 * MIN,
    });
    expect(await dayOn(person, '2027-03-04')).toMatchObject({
      dayType: 'full',
      shortfallSeconds: 3 * HOUR + 40 * MIN,
    });
    expect(await dayOn(person, '2027-03-05')).toMatchObject({
      dayType: 'half',
      shortfallSeconds: 0,
      makeUpSeconds: 0,
    });

    // Sunday is the weekly day off: time worked is all make-up.
    await straightDay(person, [2027, 3, 7], '10:00', '12:00');
    expect(await dayOn(person, '2027-03-07')).toMatchObject({
      dayType: 'off',
      shortfallSeconds: 0,
      makeUpSeconds: 2 * HOUR,
    });

    const summary = await month(person, '2027-03').expect(200);
    expect(summary.body).toMatchObject({
      fullDays: 4,
      halfDays: 1,
      offDaysWorked: 1,
      shortfallSeconds: 11 * MIN + 220 * MIN,
      makeUpSeconds: 2 * HOUR,
      deductibleShortfallSeconds: 111 * MIN,
    });
  });

  it('a forgotten logout also gets its day type', async () => {
    const person = await make('call_agent', 'FGT3', leadA.id);
    await workDay(person, [2027, 3, 8], [
      ['09:30', 'login'],
      ['09:30', 'team_meeting'],
      ['13:00', 'available'],
    ]);
    // The day closes at the last activity: 13:00, production 3h 30m.
    at(2027, 3, 9, 5, 30);
    await app.get(AttendanceService).closeForgottenDays(person.id);
    expect(await dayOn(person, '2027-03-08')).toMatchObject({
      dayType: 'half',
      closedReason: 'auto_closed_no_logout',
      flagged: true,
    });
  });

  it('make-up time reduces shortfall only within the same month', async () => {
    const person = await make('call_agent', 'MKU3', leadA.id);
    await straightDay(person, [2027, 1, 29], '09:30', '19:30'); // 10h, January
    await straightDay(person, [2027, 2, 2], '09:30', '16:30'); // 7h, February
    const january = await month(person, '2027-01').expect(200);
    expect(january.body).toMatchObject({
      makeUpSeconds: 2 * HOUR,
      shortfallSeconds: 0,
      deductibleShortfallSeconds: 0,
    });
    const february = await month(person, '2027-02').expect(200);
    expect(february.body).toMatchObject({
      makeUpSeconds: 0,
      shortfallSeconds: HOUR,
      deductibleShortfallSeconds: HOUR,
    });

    await straightDay(person, [2027, 2, 3], '09:30', '18:10'); // 8h 40m
    const after = await month(person, '2027-02').expect(200);
    expect(after.body).toMatchObject({
      makeUpSeconds: 40 * MIN,
      shortfallSeconds: HOUR,
      deductibleShortfallSeconds: 20 * MIN,
    });
  });

  it('the month summary matches a hand-worked example', async () => {
    // Mon 1 Feb: 09:30–17:30 in a meeting → 8h, full.
    await straightDay(agentA, [2027, 2, 1], '09:30', '17:30');
    // Tue 2 Feb: logs in 09:45 (15 min late), out 16:45 → 7h, full with 1h shortfall.
    await straightDay(agentA, [2027, 2, 2], '09:45', '16:45');
    // Wed 3 Feb: 09:30–19:00 with a 20-minute short break → 9h 10m, 1h 10m make-up, break 5 min over.
    await workDay(agentA, [2027, 2, 3], [
      ['09:30', 'login'],
      ['09:30', 'team_meeting'],
      ['11:00', 'short_break'],
      ['11:20', 'team_meeting'],
      ['19:00', 'logout'],
    ]);
    // Thu 4 Feb: 09:30–13:00 → 3h 30m, half day.
    await straightDay(agentA, [2027, 2, 4], '09:30', '13:00');
    // Fri 5 Feb: no login, no leave → absent (nightly job).
    const absent = await days.markAbsentDays(new Date('2027-02-05T00:00:00.000Z'), [agentA.id]);
    expect(absent).toEqual({ date: '2027-02-05', marked: 1 });
    // Sat 6 Feb: logs in 10:00 (30 min late), no heartbeat → Idle from 10:11, meeting 10:30–18:00.
    await workDay(agentA, [2027, 2, 6], [
      ['10:00', 'login'],
      ['10:30', 'team_meeting'],
      ['18:00', 'logout'],
    ]);
    // Sun 7 Feb: weekly day off → never absent.
    expect(
      await days.markAbsentDays(new Date('2027-02-07T00:00:00.000Z'), [agentA.id]),
    ).toEqual({ date: '2027-02-07', marked: 0 });
    // A day already worked is not marked again; a date before the account existed is not marked.
    expect(
      (await days.markAbsentDays(new Date('2027-02-01T00:00:00.000Z'), [agentA.id])).marked,
    ).toBe(0);
    expect(
      (await days.markAbsentDays(new Date('2026-01-05T00:00:00.000Z'), [agentA.id])).marked,
    ).toBe(0);

    const res = await month(agentA, '2027-02').expect(200);
    const sat = 11 * MIN + 7.5 * HOUR; // Available 10:00–10:11, then meeting 10:30–18:00
    expect(res.body).toMatchObject({
      staff: { id: agentA.id, code: agentA.code, role: 'call_agent' },
      month: '2027-02',
      fullDays: 4,
      halfDays: 1,
      absentDays: 1,
      paidLeaveDays: { casual: 0, emergency: 0, total: 0 },
      unpaidLeaveDays: 0,
      lateLogins: {
        count: 2,
        days: [
          { date: '2027-02-02', minutes: 15 },
          { date: '2027-02-06', minutes: 30 },
        ],
      },
      productionSeconds: 8 * HOUR + 7 * HOUR + (9 * HOUR + 10 * MIN) + 3.5 * HOUR + sat,
      breakSeconds: 20 * MIN,
      breakOverSeconds: 5 * MIN,
      idleSeconds: 19 * MIN,
      shortfallSeconds: HOUR + (8 * HOUR - sat),
      makeUpSeconds: 70 * MIN,
      deductibleShortfallSeconds: HOUR + (8 * HOUR - sat) - 70 * MIN,
    });
    expect(res.body.deductibleShortfallSeconds).toBe(9 * MIN);
    expect(res.body.days.map((row: { date: string; dayType: string }) => [row.date, row.dayType])).toEqual([
      ['2027-02-01', 'full'],
      ['2027-02-02', 'full'],
      ['2027-02-03', 'full'],
      ['2027-02-04', 'half'],
      ['2027-02-05', 'absent'],
      ['2027-02-06', 'full'],
    ]);
    const bad = await month(agentA, 'February');
    expect(bad.status).toBe(400);
  });

  it('shows a month only to the person, their Team Lead, Managers over them, Finance and the CEO', async () => {
    for (const viewer of [agentA, leadA, managerA, finance, ceo]) {
      const res = await month(viewer, '2027-02', agentA.id);
      expect(res.status).toBe(200);
      expect(res.body.staff.id).toBe(agentA.id);
    }
    for (const viewer of [leadB, managerB, agentB]) {
      const res = await month(viewer, '2027-02', agentA.id);
      expect(res.status).toBe(403);
    }
  });

  it('Change day is recorded with a reason and only by the Team Lead, a Manager over them or the CEO', async () => {
    const person = await make('call_agent', 'CHG3', leadA.id);
    await straightDay(person, [2027, 4, 5], '09:30', '13:00'); // half
    const day = await dayOn(person, '2027-04-05');
    expect(day.dayType).toBe('half');

    expect((await changeDay(person, day.id, { dayType: 'full', reason: 'mine' })).status).toBe(403);
    expect((await changeDay(leadB, day.id, { dayType: 'full', reason: 'other team' })).status).toBe(403);
    expect((await changeDay(managerB, day.id, { dayType: 'full', reason: 'other tree' })).status).toBe(403);
    expect((await changeDay(finance, day.id, { dayType: 'full', reason: 'finance' })).status).toBe(403);
    expect((await changeDay(leadA, day.id, { dayType: 'full' })).status).toBe(400);
    expect((await changeDay(leadA, day.id, { dayType: 'leave', reason: 'x' })).status).toBe(400);

    at(2027, 4, 5, 15, 0);
    const changed = await changeDay(leadA, day.id, {
      dayType: 'full',
      reason: 'System was down from 1 PM',
    });
    expect(changed.status).toBe(201);
    expect(changed.body).toMatchObject({
      dayType: 'full',
      shortfallSeconds: 0,
      change: { byStaffId: leadA.id, reason: 'System was down from 1 PM' },
    });

    at(2027, 4, 5, 16, 0);
    const back = await changeDay(managerA, day.id, { dayType: 'half', reason: 'Checked the logs' });
    expect(back.status).toBe(201);
    expect(back.body.dayType).toBe('half');

    const history = await request(app.getHttpServer())
      .get(`/attendance/days/${day.id}/history`)
      .set('Authorization', `Bearer ${tokenFor(person)}`)
      .expect(200);
    expect(history.body).toEqual([
      expect.objectContaining({ from: 'full', to: 'half', reason: 'Checked the logs', changedByStaffId: managerA.id }),
      expect.objectContaining({ from: 'half', to: 'full', reason: 'System was down from 1 PM', changedByStaffId: leadA.id }),
    ]);
    const audit = await prisma.auditLog.findMany({
      where: { action: 'attendance.day_changed', actorId: { in: [leadA.id, managerA.id] } },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);

    // An absent day can be changed; a Team Lead cannot change their own day.
    await days.markAbsentDays(new Date('2027-04-06T00:00:00.000Z'), [person.id]);
    const absentDay = await dayOn(person, '2027-04-06');
    const fixed = await changeDay(ceo, absentDay.id, { dayType: 'full', reason: 'Was at a client site' });
    expect(fixed.status).toBe(201);
    expect(fixed.body.dayType).toBe('full');

    await straightDay(leadA, [2027, 4, 5], '09:30', '13:00');
    const leadDay = await dayOn(leadA, '2027-04-05');
    expect((await changeDay(leadA, leadDay.id, { dayType: 'full', reason: 'own' })).status).toBe(403);
    expect((await changeDay(managerA, leadDay.id, { dayType: 'full', reason: 'Training ran late' })).status).toBe(201);

    // A day still open cannot be changed.
    at(2027, 4, 7, 9, 30);
    await request(app.getHttpServer())
      .post('/attendance/login')
      .set('Authorization', `Bearer ${tokenFor(person)}`)
      .send({})
      .expect(201);
    const openDay = await dayOn(person, '2027-04-07');
    expect((await changeDay(leadA, openDay.id, { dayType: 'full', reason: 'early' })).status).toBe(400);
  });
});

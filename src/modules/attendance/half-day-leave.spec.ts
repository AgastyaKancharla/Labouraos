import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { PayrollService } from '../finance/payroll.service';
import { ManagerOpsService } from '../screens-manager/manager-ops.service';
import { AttendanceClock } from './attendance-clock';

jest.setTimeout(180000);

const shared = { at: new Date('2032-06-01T04:30:00.000Z') };

class DayClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string };
type Body = Record<string, unknown>;

/**
 * Half-day leave against a real database (owner decision 12 Nov): "Staff request
 * leave with a calendar and a reason, for full days or a half day (first half or
 * second half); a half day of leave uses half a day of the balance, and the other
 * half is a normal working half day."
 *
 * June 2032: 1 June is a Tuesday; Sundays 6, 13, 20, 27 are the weekly days off
 * (default Settings), so June has 26 working days. Default shift 09:30–18:30,
 * 8 production hours a full day, half day under 4.5, 10 minutes' tolerance,
 * 1 casual + 1 emergency leave earned on the 1st of each month.
 */
describe('Half-day leave', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let payroll: PayrollService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];

  let ceo: Person;
  let manager: Person;
  let lead: Person;

  function tokenFor(staff: Person) {
    return jwt.sign({ sub: staff.id, email: `${staff.id}@laboura.local`, role: staff.role, code: staff.code });
  }

  function at(year: number, month: number, day: number, hour: number, minute = 0) {
    shared.at = localCalendarToUtc(year, month, day, hour, minute);
  }

  async function make(role: string, prefix: string, reportsToId?: string, createdAt?: Date): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} half day`,
        email: `${prefix.toLowerCase()}.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        city: 'Bengaluru',
        teamLeadId: agent ? (reportsToId ?? null) : null,
        reportsToId: reportsToId ?? null,
        // The joining date, so a first login during the test does not move it (leave counts from joining).
        ...(createdAt ? { createdAt, joinedOn: new Date(`${createdAt.toISOString().slice(0, 10)}T00:00:00.000Z`) } : {}),
      },
    });
    staffIds.push(row.id);
    return row;
  }

  function post(person: Person, path: string, body: Body = {}) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${tokenFor(person)}`).send(body);
  }

  function del(person: Person, path: string) {
    return request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${tokenFor(person)}`);
  }

  function get(person: Person, path: string) {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(person)}`);
  }

  function leave(person: Person, kind: string, fromDate: string, half?: string, toDate?: string) {
    return post(person, '/attendance/leave', { kind, fromDate, toDate: toDate ?? fromDate, half, reason: 'Bank work in the morning' });
  }

  function decide(person: Person, id: string, action: string, body: Body = { reason: 'Fine' }) {
    return post(person, `/attendance/requests/leave/${id}/${action}`, body);
  }

  /** A day of team meeting from start to end, so production equals the time logged in. */
  async function straightDay(person: Person, ymd: [number, number, number], start: string, end: string) {
    for (const [time, path, body] of [
      [start, '/attendance/login', {}],
      [start, '/attendance/status', { status: 'team_meeting' }],
      [end, '/attendance/logout', {}],
    ] as Array<[string, string, Body]>) {
      const [hour, minute] = time.split(':').map(Number);
      at(ymd[0], ymd[1], ymd[2], hour, minute);
      const res = await post(person, path, body);
      expect(res.status).toBe(201);
    }
  }

  function dayOn(person: Person, date: string) {
    return prisma.attendanceDay.findUniqueOrThrow({
      where: { staffId_date: { staffId: person.id, date: new Date(`${date}T00:00:00.000Z`) } },
    });
  }

  const MAY_10 = new Date('2032-05-10T06:00:00.000Z');

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(DayClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    payroll = app.get(PayrollService);
    ceo = await make('ceo', 'CEOH');
    manager = await make('manager', 'MGH', ceo.id);
    lead = await make('team_lead', 'TLH', manager.id);
  });

  afterAll(async () => {
    try {
      if (staffIds.length > 0) {
        const dayRows = await prisma.attendanceDay.findMany({ where: { staffId: { in: staffIds } }, select: { id: true } });
        await prisma.statusHistory.deleteMany({ where: { subjectType: 'attendance_day', subjectId: { in: dayRows.map((row) => row.id) } } });
        await prisma.messageLog.deleteMany({ where: { subjectType: 'staff', subjectId: { in: staffIds } } });
        await prisma.staffSalary.deleteMany({ where: { staffId: { in: staffIds } } });
        await prisma.leaveRequest.deleteMany({ where: { staffId: { in: staffIds } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      await app.close();
    }
  });

  it('a paid half day uses half a day of the balance, and the other half is a working half day needing half the production', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDP', lead.id, MAY_10);
    const asked = await leave(agent, 'casual', '2032-06-02', 'first');
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ half: 'first', days: 0.5, routedToRole: 'team_lead', fromDate: '2032-06-02', toDate: '2032-06-02' });

    const approved = await decide(lead, asked.body.id, 'approve');
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ status: 'approved', half: 'first', paidDays: 0.5, unpaidDays: 0 });
    const balance = await get(agent, '/attendance/leave/balance').expect(200);
    expect(balance.body.casual).toMatchObject({ earned: 1, taken: 0.5, paidTaken: 0.5, unpaidTaken: 0, left: 0.5 });
    expect(await dayOn(agent, '2032-06-02')).toMatchObject({ dayType: 'leave', leaveHalf: 'first', leaveKind: 'casual', leaveUnpaid: false });

    // The second half is worked: the working half starts at 14:00 (half way through 09:30–18:30), so
    // logging in then is not late, and 4 hours of production (not 8) is a full day.
    await straightDay(agent, [2032, 6, 2], '14:00', '17:55');
    const worked = await dayOn(agent, '2032-06-02');
    expect(worked).toMatchObject({ dayType: 'full', lateMinutes: 0, shortfallSeconds: 0, leaveHalf: 'first', leaveKind: 'casual' });

    const after = await get(agent, '/attendance/leave/balance').expect(200);
    expect(after.body.casual).toMatchObject({ taken: 0.5, left: 0.5 });
    const month = await get(lead, `/attendance/month?month=2032-06&staffId=${agent.id}`).expect(200);
    expect(month.body).toMatchObject({ fullDays: 0.5, absentDays: 0, unpaidLeaveDays: 0 });
    expect(month.body.paidLeaveDays).toMatchObject({ casual: 0.5, total: 0.5 });
    expect(month.body.days[0]).toMatchObject({ date: '2032-06-02', leaveHalf: 'first' });

    // Under 2¼ hours (half of 4.5, less the tolerance) the working half was not worked.
    const short = await make('call_agent', 'HDS', lead.id, MAY_10);
    at(2032, 6, 1, 10);
    const second = await leave(short, 'casual', '2032-06-03', 'second');
    await decide(lead, second.body.id, 'approve').expect(201);
    await straightDay(short, [2032, 6, 3], '09:30', '11:30');
    expect(await dayOn(short, '2032-06-03')).toMatchObject({ dayType: 'half', lateMinutes: 0, leaveHalf: 'second' });
  });

  it('refuses a half day over more than one date, and an unknown half', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDV', lead.id, MAY_10);
    const twoDates = await leave(agent, 'casual', '2032-06-08', 'first', '2032-06-09');
    expect(twoDates.status).toBe(400);
    expect(twoDates.body.message).toMatch(/one date/);
    expect((await leave(agent, 'casual', '2032-06-08', 'morning')).status).toBe(400);
    // A half day on a weekly day off is refused like a full one.
    expect((await leave(agent, 'casual', '2032-06-06', 'second')).status).toBe(400);
    // "full" (or nothing) is full days.
    const full = await leave(agent, 'casual', '2032-06-08', 'full', '2032-06-09');
    expect(full.body).toMatchObject({ half: null, days: 2 });
  });

  it('beyond the paid balance a half day is unpaid, and a full day with half a day left is half paid, half unpaid', async () => {
    at(2032, 6, 1, 10);
    const used = await make('call_agent', 'HDU', lead.id, MAY_10);
    const full = await leave(used, 'casual', '2032-06-03');
    expect((await decide(lead, full.body.id, 'approve')).body).toMatchObject({ paidDays: 1, unpaidDays: 0 });
    const half = await leave(used, 'casual', '2032-06-04', 'second');
    const unpaid = await decide(lead, half.body.id, 'approve');
    expect(unpaid.body).toMatchObject({ paidDays: 0, unpaidDays: 0.5 });
    expect(await dayOn(used, '2032-06-04')).toMatchObject({ dayType: 'leave', leaveHalf: 'second', leaveUnpaid: true });
    expect((await get(used, '/attendance/leave/balance')).body.casual).toMatchObject({ paidTaken: 1, unpaidTaken: 0.5, taken: 1.5, left: 0 });

    const split = await make('call_agent', 'HDX', lead.id, MAY_10);
    const morning = await leave(split, 'casual', '2032-06-07', 'first');
    expect((await decide(lead, morning.body.id, 'approve')).body).toMatchObject({ paidDays: 0.5, unpaidDays: 0 });
    const next = await leave(split, 'casual', '2032-06-08');
    expect((await decide(lead, next.body.id, 'approve')).body).toMatchObject({ paidDays: 0.5, unpaidDays: 0.5 });
    expect(await dayOn(split, '2032-06-08')).toMatchObject({ dayType: 'leave', leaveHalf: null, leaveUnpaid: false, leavePartUnpaid: true });
    expect((await get(split, '/attendance/leave/balance')).body.casual).toMatchObject({ paidTaken: 1, unpaidTaken: 0.5, left: 0 });
    const month = await get(lead, `/attendance/month?month=2032-06&staffId=${split.id}`).expect(200);
    expect(month.body.paidLeaveDays.casual).toBe(1);
    expect(month.body.unpaidLeaveDays).toBe(0.5);

    // Overturned, the half day comes off the record and the balance again.
    const overturned = await decide(manager, morning.body.id, 'overturn', { reason: 'Was at work after all' });
    expect(overturned.status).toBe(201);
    expect(await prisma.attendanceDay.findUnique({ where: { staffId_date: { staffId: split.id, date: new Date('2032-06-07T00:00:00.000Z') } } })).toBeNull();
  });

  it('counts a half day as ½ towards the Team Lead\'s 3 planned days a month', async () => {
    at(2032, 6, 1, 10);
    // Created in March: 3 casual days earned by June.
    const agent = await make('call_agent', 'HDL', lead.id, new Date('2032-03-10T06:00:00.000Z'));
    const two = await leave(agent, 'casual', '2032-06-14', undefined, '2032-06-15');
    await decide(lead, two.body.id, 'approve').expect(201);
    const halfOne = await leave(agent, 'casual', '2032-06-16', 'first');
    expect(halfOne.body).toMatchObject({ routedToRole: 'team_lead', casualDaysTakenThisMonth: 2 });
    await decide(lead, halfOne.body.id, 'approve').expect(201);

    // 2½ taken + ½ = 3: still the Team Lead's.
    const halfTwo = await leave(agent, 'casual', '2032-06-17', 'second');
    expect(halfTwo.body).toMatchObject({ routedToRole: 'team_lead', routeReason: 'team_lead', casualDaysTakenThisMonth: 2.5 });
    await decide(lead, halfTwo.body.id, 'approve').expect(201);

    // 3 taken + ½ = 3½: the Manager's.
    const halfThree = await leave(agent, 'casual', '2032-06-18', 'first');
    expect(halfThree.body).toMatchObject({ routedToRole: 'manager', routeReason: 'over_limit', casualDaysTakenThisMonth: 3 });
    expect((await decide(lead, halfThree.body.id, 'approve')).status).toBe(403);
    const byManager = await decide(manager, halfThree.body.id, 'approve', { reason: 'Quiet day' });
    expect(byManager.status).toBe(201);
    expect(byManager.body).toMatchObject({ paidDays: 0, unpaidDays: 0.5 });

    // The Manager's and Team Lead's request lists say "half day".
    const listed = await get(manager, `/requests/leave.${halfThree.body.id}`).expect(200);
    expect(listed.body.summary).toMatch(/half day \(first half\)/);
    expect(listed.body.details).toMatchObject({ half: 'first', days: 0.5 });
  });

  it('payroll: an unpaid half day of leave costs half a day (salary ÷ 26 ÷ 2); a paid one costs nothing', async () => {
    at(2032, 6, 1, 10);
    const SALARY = 2_600_000; // ₹26,000: ₹1,000 a day, ₹500 a half day
    const person = await make('call_agent', 'HDPAY', lead.id, MAY_10);
    await prisma.staffSalary.create({ data: { staffId: person.id, monthlyPaise: SALARY, effectiveFromMonth: '2032-05', setByStaffId: ceo.id } });

    // 1 June: a paid full day of leave uses the balance; 9 June: half a day of unpaid leave, the morning worked.
    const paid = await leave(person, 'casual', '2032-06-01');
    await decide(lead, paid.body.id, 'approve').expect(201);
    const halfUnpaid = await leave(person, 'casual', '2032-06-09', 'second');
    expect((await decide(lead, halfUnpaid.body.id, 'approve')).body).toMatchObject({ paidDays: 0, unpaidDays: 0.5 });
    await straightDay(person, [2032, 6, 9], '09:30', '13:35');
    expect(await dayOn(person, '2032-06-09')).toMatchObject({ dayType: 'full', shortfallSeconds: 0 });

    // Every other working day of June is a full day.
    for (let d = 2; d <= 30; d += 1) {
      const date = new Date(Date.UTC(2032, 5, d));
      if (date.getUTCDay() === 0 || d === 9) continue;
      await prisma.attendanceDay.create({
        data: { staffId: person.id, date, loginAt: new Date(date.getTime() + 4 * 3600_000), logoutAt: new Date(date.getTime() + 13 * 3600_000), dayType: 'full', productionSeconds: 8 * 3600 },
      });
    }
    const { rows } = await payroll.draft('2032-06', new Date('2032-07-02T06:00:00.000Z'));
    const line = rows.find((row) => row.staffId === person.id)!;
    expect(line).toMatchObject({
      workingDays: 26,
      fullDays: 24.5,
      paidLeaveDays: 1,
      unpaidLeaveDays: 0.5,
      absentDays: 0,
      unmarkedDays: 0,
      lossOfPayDays: 0.5,
      lossOfPayPaise: 50_000,
      netPaise: 2_550_000,
    });
    expect(Number.isInteger(line.lossOfPayPaise) && Number.isInteger(line.netPaise)).toBe(true);
  });

  const MARCH_10 = new Date('2032-03-10T06:00:00.000Z');
  const dayRow = (person: Person, date: string) =>
    prisma.attendanceDay.findUnique({ where: { staffId_date: { staffId: person.id, date: new Date(`${date}T00:00:00.000Z`) } } });

  it('refuses leave on a date or half already asked for; the other half (same kind) joins it into a full leave day', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDO', lead.id, MARCH_10);
    const first = await leave(agent, 'casual', '2032-06-07', 'first');
    expect(first.status).toBe(201);
    const again = await leave(agent, 'casual', '2032-06-07', 'first');
    expect(again.status).toBe(400);
    // The code and date ride on the error (under `details` once the app's exception filter wraps it).
    const detail = (res: { body: { details?: Record<string, unknown> } & Record<string, unknown> }) => res.body.details ?? res.body;
    expect(detail(again)).toMatchObject({ code: 'leave_overlap', date: '2032-06-07' });
    expect(again.body.message).toMatch(/already have leave asked for or approved on 2032-06-07/);
    expect(detail(await leave(agent, 'casual', '2032-06-07')).code).toBe('leave_overlap');
    expect(detail(await leave(agent, 'casual', '2032-06-05', undefined, '2032-06-08')).code).toBe('leave_overlap');
    expect(detail(await leave(agent, 'emergency', '2032-06-07', 'second')).code).toBe('leave_other_kind');
    const second = await leave(agent, 'casual', '2032-06-07', 'second');
    expect(second.status).toBe(201);

    await decide(lead, first.body.id, 'approve').expect(201);
    expect((await decide(lead, second.body.id, 'approve')).body).toMatchObject({ paidDays: 0.5, unpaidDays: 0 });
    // Not skipped: the two halves make one full, paid leave day.
    expect(await dayRow(agent, '2032-06-07')).toMatchObject({
      dayType: 'leave', leaveHalf: null, leaveRequestId: first.body.id, otherLeaveRequestId: second.body.id, leaveUnpaid: false, leavePartUnpaid: false,
    });
    expect((await get(agent, '/attendance/leave/balance')).body.casual).toMatchObject({ taken: 1, left: 2 });

    // Overturning one half leaves the other half day.
    await decide(manager, second.body.id, 'overturn', { reason: 'Came in for the afternoon' }).expect(201);
    expect(await dayRow(agent, '2032-06-07')).toMatchObject({ dayType: 'leave', leaveHalf: 'first', leaveRequestId: first.body.id, otherLeaveRequestId: null });
    expect((await get(agent, '/attendance/leave/balance')).body.casual).toMatchObject({ taken: 0.5, left: 2.5 });

    // The Manager's "used this month" counts the half day as half.
    const board = await app.get(ManagerOpsService).leaveBoard({ id: manager.id, role: 'manager' }, new Date('2032-06-20T06:00:00.000Z'));
    expect(board.balances.find((row) => row.staff.id === agent.id)).toMatchObject({ plannedUsedThisMonth: 0.5 });
  });

  it('two half days of one date approved at the same moment both land, as one full leave day (per-person lock)', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDC', lead.id, MAY_10);
    const a = await leave(agent, 'casual', '2032-06-08', 'first');
    const b = await leave(agent, 'casual', '2032-06-08', 'second');
    const [ra, rb] = await Promise.all([decide(lead, a.body.id, 'approve'), decide(lead, b.body.id, 'approve')]);
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(ra.body.paidDays + rb.body.paidDays).toBe(1);
    const row = await dayRow(agent, '2032-06-08');
    expect(row).toMatchObject({ dayType: 'leave', leaveHalf: null, leaveUnpaid: false });
    expect([row!.leaveRequestId, row!.otherLeaveRequestId].sort()).toEqual([a.body.id, b.body.id].sort());
    expect(await prisma.attendanceDay.count({ where: { staffId: agent.id } })).toBe(1);
  });

  it('works lateness out again when a first-half leave is approved or overturned after login', async () => {
    const agent = await make('call_agent', 'HDLT', lead.id, MAY_10);
    at(2032, 6, 9, 14, 0);
    await post(agent, '/attendance/login').expect(201);
    expect((await dayRow(agent, '2032-06-09'))!.lateMinutes).toBe(270);
    const asked = await leave(agent, 'casual', '2032-06-09', 'first');
    await decide(lead, asked.body.id, 'approve').expect(201);
    expect(await dayRow(agent, '2032-06-09')).toMatchObject({ lateMinutes: 0, leaveHalf: 'first', dayType: 'open' });
    // The today view needs half the production.
    expect((await get(agent, '/attendance/today')).body).toMatchObject({ leaveHalf: 'first' });
    await decide(manager, asked.body.id, 'overturn', { reason: 'Was not on leave' }).expect(201);
    expect(await dayRow(agent, '2032-06-09')).toMatchObject({ lateMinutes: 270, leaveHalf: null, leaveKind: null, dayType: 'open' });
  });

  it('counts the working half of a half day of leave as absent only once the day has passed; before login the target is half', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDF', lead.id, MAY_10);
    const asked = await leave(agent, 'casual', '2032-06-25', 'first');
    await decide(lead, asked.body.id, 'approve').expect(201);
    const before = await get(lead, `/attendance/month?month=2032-06&staffId=${agent.id}`).expect(200);
    expect(before.body).toMatchObject({ absentDays: 0 });
    expect(before.body.paidLeaveDays.casual).toBe(0.5);
    at(2032, 6, 25, 8);
    expect((await get(agent, '/attendance/today')).body).toMatchObject({ leaveHalf: 'first', shortfallSeconds: 4 * 3600 });
    at(2032, 6, 26, 10);
    const after = await get(lead, `/attendance/month?month=2032-06&staffId=${agent.id}`).expect(200);
    expect(after.body.absentDays).toBe(0.5);
  });

  it('overturning a day change on a second-half-leave day uses half the production (5 h worked: no shortfall)', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDDC', lead.id, MAY_10);
    const asked = await leave(agent, 'casual', '2032-06-10', 'second');
    await decide(lead, asked.body.id, 'approve').expect(201);
    await straightDay(agent, [2032, 6, 10], '09:30', '14:30');
    const day = (await dayRow(agent, '2032-06-10'))!;
    expect(day).toMatchObject({ dayType: 'full', shortfallSeconds: 0, makeUpSeconds: 3600 });
    at(2032, 6, 10, 16);
    const change = await post(lead, '/requests', { kind: 'day_change', dayId: day.id, dayType: 'half', reason: 'Left early' });
    expect(change.status).toBe(201);
    expect((await dayRow(agent, '2032-06-10'))!.dayType).toBe('half');
    const undo = await post(manager, `/requests/${change.body.ref}/overturn`, { reason: 'Worked 5 hours of a half day' });
    expect(undo.status).toBe(200);
    expect(await dayRow(agent, '2032-06-10')).toMatchObject({ dayType: 'full', shortfallSeconds: 0, makeUpSeconds: 3600 });
  });

  it('approving "part" of a half day is the half day; dates outside it are refused', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDPA', lead.id, MAY_10);
    const asked = await leave(agent, 'casual', '2032-06-11', 'first');
    expect((await decide(lead, asked.body.id, 'approve', { reason: 'Fine', fromDate: '2032-06-12', toDate: '2032-06-12' })).status).toBe(400);
    const ok = await decide(lead, asked.body.id, 'approve', { reason: 'Fine', fromDate: '2032-06-11', toDate: '2032-06-11' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ status: 'approved', approvedDays: null, paidDays: 0.5 });
    expect(await dayRow(agent, '2032-06-11')).toMatchObject({ leaveHalf: 'first', dayType: 'leave' });
  });

  it('overturns a half day both ways: a rejection becomes an approval, and an approval a rejection', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDOT', lead.id, MAY_10);
    const rejected = await leave(agent, 'casual', '2032-06-12', 'second');
    await decide(lead, rejected.body.id, 'reject', { reason: 'Busy day' }).expect(201);
    expect(await dayRow(agent, '2032-06-12')).toBeNull();
    const approvedNow = await decide(manager, rejected.body.id, 'overturn', { reason: 'Cover found' });
    expect(approvedNow.body).toMatchObject({ status: 'approved', paidDays: 0.5 });
    expect(await dayRow(agent, '2032-06-12')).toMatchObject({ leaveHalf: 'second', leaveUnpaid: false });

    const approved = await leave(agent, 'emergency', '2032-06-14', 'first');
    await decide(lead, approved.body.id, 'approve').expect(201);
    const rejectedNow = await decide(manager, approved.body.id, 'overturn', { reason: 'No emergency' });
    expect(rejectedNow.body).toMatchObject({ status: 'rejected', paidDays: 0, unpaidDays: 0 });
    expect(await dayRow(agent, '2032-06-14')).toBeNull();
    expect((await get(agent, '/attendance/leave/balance')).body.emergency).toMatchObject({ taken: 0, left: 1 });
  });

  it('a holiday added on a half-day leave date takes the leave off; removed again, the half day comes back', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDHO', lead.id, MAY_10);
    const asked = await leave(agent, 'casual', '2032-06-22', 'second');
    await decide(lead, asked.body.id, 'approve').expect(201);
    await prisma.holiday.deleteMany({ where: { date: new Date('2032-06-22T00:00:00.000Z') } });
    const holiday = await post(ceo, '/attendance/holidays', { date: '2032-06-22', name: 'Half-day spec holiday' });
    expect(holiday.status).toBe(201);
    try {
      expect(await dayRow(agent, '2032-06-22')).toBeNull();
      expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: asked.body.id } })).toMatchObject({ paidDays: 0, unpaidDays: 0 });
      expect((await get(agent, '/attendance/leave/balance')).body.casual).toMatchObject({ taken: 0, left: 1 });
      await del(ceo, `/attendance/holidays/${holiday.body.id}`).expect(200);
      expect(await dayRow(agent, '2032-06-22')).toMatchObject({ dayType: 'leave', leaveHalf: 'second', leaveUnpaid: false });
      expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: asked.body.id } })).toMatchObject({ paidDays: 0.5, unpaidDays: 0 });
    } finally {
      await prisma.holiday.deleteMany({ where: { date: new Date('2032-06-22T00:00:00.000Z') } });
    }
  });

  it('shows a half day today as a half day on the Team Lead leave board, not as off', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HDTL', lead.id, MAY_10);
    const asked = await leave(agent, 'casual', '2032-06-16', 'second');
    await decide(lead, asked.body.id, 'approve').expect(201);
    at(2032, 6, 16, 10);
    const board = await get(lead, '/team-lead/leave').expect(200);
    const mine = board.body.schedule.find((row: { id: string }) => row.id === asked.body.id);
    expect(mine).toMatchObject({ half: 'second' });
    type Row = { status: string; fromDate: string; toDate: string; half: string | null };
    const covering = (board.body.schedule as Row[]).filter((row) => row.status === 'approved' && row.fromDate <= '2032-06-16' && row.toDate >= '2032-06-16');
    expect(board.body.summary.halfDayToday).toBe(covering.filter((row) => row.half).length);
    expect(board.body.summary.offToday).toBe(covering.filter((row) => !row.half).length);
    expect(board.body.summary.halfDayToday).toBeGreaterThanOrEqual(1);
  });

  it('refuses a half day in a month payroll can no longer work out again', async () => {
    const months = Array.from({ length: 13 }, (_, i) => `${2034 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
    await prisma.payrollRun.deleteMany({ where: { month: { in: months } } });
    await prisma.payrollRun.createMany({
      data: months.map((month) => ({ month, status: 'paid', people: 0, grossPaise: 0, deductionsPaise: 0, netPaise: 0, preparedByStaffId: ceo.id, preparedAt: new Date('2035-02-01T04:00:00.000Z') })),
    });
    try {
      at(2035, 2, 2, 10);
      const agent = await make('call_agent', 'HDPW', lead.id, new Date('2033-12-10T06:00:00.000Z'));
      const asked = await leave(agent, 'casual', '2034-01-10', 'first');
      expect(asked.status).toBe(201);
      const refused = await decide(lead, asked.body.id, 'approve');
      expect(refused.status).toBe(400);
      expect(refused.body.message).toMatch(/January 2034 pay.*manual correction/);
      expect(await dayRow(agent, '2034-01-10')).toBeNull();
      expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: asked.body.id } })).status).toBe('pending');
    } finally {
      await prisma.payrollRun.deleteMany({ where: { month: { in: months } } });
    }
  });

  it('payroll: a part-month joiner with an unpaid half day is paid for the days on staff less half a day, never below zero', async () => {
    at(2032, 6, 28, 10);
    const SALARY = 2_600_000;
    const joiner = await make('call_agent', 'HDJ', lead.id, new Date('2032-06-28T03:00:00.000Z'));
    await prisma.staffSalary.create({ data: { staffId: joiner.id, monthlyPaise: SALARY, effectiveFromMonth: '2032-06', setByStaffId: ceo.id } });
    // Joined in June: no paid leave yet, so the half day is unpaid.
    const asked = await leave(joiner, 'casual', '2032-06-29', 'second');
    expect((await decide(lead, asked.body.id, 'approve')).body).toMatchObject({ paidDays: 0, unpaidDays: 0.5 });
    await straightDay(joiner, [2032, 6, 29], '09:30', '13:35');
    for (const d of [28, 30]) {
      const date = new Date(Date.UTC(2032, 5, d));
      await prisma.attendanceDay.create({
        data: { staffId: joiner.id, date, loginAt: new Date(date.getTime() + 4 * 3600_000), logoutAt: new Date(date.getTime() + 13 * 3600_000), dayType: 'full', productionSeconds: 8 * 3600 },
      });
    }
    const { rows } = await payroll.draft('2032-06', new Date('2032-07-02T06:00:00.000Z'));
    const line = rows.find((row) => row.staffId === joiner.id)!;
    // 3 working days on staff: ₹26,000 ÷ 26 × 3 = ₹3,000; less ½ day (₹500).
    expect(line).toMatchObject({ notEmployedDays: 23, unmarkedDays: 0, fullDays: 2.5, unpaidLeaveDays: 0.5, lossOfPayPaise: 50_000, netPaise: 250_000 });
    expect(line.netPaise).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(line.netPaise)).toBe(true);
  });

  it('a paid month does not change when a half day in it is overturned later', async () => {
    at(2032, 6, 1, 10);
    const SALARY = 2_600_000;
    const person = await make('call_agent', 'HDPM', lead.id, MAY_10);
    await prisma.staffSalary.create({ data: { staffId: person.id, monthlyPaise: SALARY, effectiveFromMonth: '2032-05', setByStaffId: ceo.id } });
    const asked = await leave(person, 'casual', '2032-06-15', 'first');
    await decide(lead, asked.body.id, 'approve').expect(201);
    await prisma.payrollRun.deleteMany({ where: { month: '2032-06' } });
    const run = await prisma.payrollRun.create({
      data: { month: '2032-06', status: 'paid', people: 1, grossPaise: SALARY, deductionsPaise: 0, netPaise: SALARY, preparedByStaffId: ceo.id, preparedAt: new Date('2032-07-01T04:00:00.000Z'), paidAt: new Date('2032-07-02T04:00:00.000Z') },
    });
    try {
      const line = await prisma.payrollLine.create({
        data: {
          runId: run.id, staffId: person.id, staffCode: person.code, name: 'HDPM', role: 'call_agent', monthlyPaise: SALARY, salaryDays: 26, calendarDays: 30, workingDays: 26, holidays: 0,
          fullDays: 25.5, halfDays: 0, paidLeaveDays: 0.5, unpaidLeaveDays: 0, absentDays: 0, notEmployedDays: 0, lossOfPayHalfDays: 0, paidHalfDays: 52, shortfallMinutes: 0,
          basicPaise: 1_300_000, hraPaise: 520_000, specialPaise: 780_000, grossPaise: SALARY, lossOfPayPaise: 0, shortfallPaise: 0, deductionsPaise: 0, netPaise: SALARY, status: 'paid',
        },
      });
      at(2032, 7, 5, 10);
      await decide(manager, asked.body.id, 'overturn', { reason: 'Was at work' }).expect(201);
      const after = await prisma.payrollLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(after).toMatchObject({ netPaise: SALARY, paidLeaveDays: 0.5, lossOfPayPaise: 0, status: 'paid' });
      expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('paid');
    } finally {
      await prisma.payrollRun.delete({ where: { id: run.id } });
    }
  });

  // ---- Two half days of one date: a full-day leave in every respect (owner rule, Fable re-check).
  async function joined(agent: Person, date: string, kind = 'casual') {
    const a = await leave(agent, kind, date, 'first');
    const b = await leave(agent, kind, date, 'second');
    await decide(lead, a.body.id, 'approve').expect(201);
    const second = await decide(lead, b.body.id, 'approve');
    expect(second.status).toBe(201);
    return { a: a.body.id as string, b: b.body.id as string, second: second.body };
  }

  it('a joined day worked for 5 h stays a full leave day: no shortfall, no make-up, never late, also when both halves are unpaid', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HJW', lead.id, MARCH_10);
    await joined(agent, '2032-06-17');
    await straightDay(agent, [2032, 6, 17], '14:00', '19:00');
    expect(await dayRow(agent, '2032-06-17')).toMatchObject({ dayType: 'leave', shortfallSeconds: 0, makeUpSeconds: 0, lateMinutes: 0, leaveUnpaid: false });
    expect((await get(agent, '/attendance/leave/balance')).body.casual).toMatchObject({ taken: 1, paidTaken: 1 });

    // Joined in June: no paid leave, so both halves are unpaid — still exactly a full leave day.
    at(2032, 6, 1, 10);
    const fresh = await make('call_agent', 'HJU', lead.id, new Date('2032-06-01T03:00:00.000Z'));
    await joined(fresh, '2032-06-17');
    await straightDay(fresh, [2032, 6, 17], '09:30', '14:30');
    expect(await dayRow(fresh, '2032-06-17')).toMatchObject({ dayType: 'leave', shortfallSeconds: 0, makeUpSeconds: 0, lateMinutes: 0, leaveUnpaid: true });
    at(2032, 6, 18, 10);
    const month = await get(lead, `/attendance/month?month=2032-06&staffId=${fresh.id}`).expect(200);
    expect(month.body).toMatchObject({ unpaidLeaveDays: 1, fullDays: 0, absentDays: 0, shortfallSeconds: 0 });
  });

  it('keeps both requests’ paid and unpaid days matching a joined day whenever it changes', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HJT', lead.id, MAY_10);
    const full = await leave(agent, 'casual', '2032-06-03');
    await decide(lead, full.body.id, 'approve').expect(201);
    const first = await leave(agent, 'casual', '2032-06-07', 'first');
    expect((await decide(lead, first.body.id, 'approve')).body).toMatchObject({ paidDays: 0, unpaidDays: 0.5 });
    // The full day is overturned: the balance is free again, then the other half joins the day.
    await decide(manager, full.body.id, 'overturn', { reason: 'Came in' }).expect(201);
    const second = await leave(agent, 'casual', '2032-06-07', 'second');
    const approved = await decide(lead, second.body.id, 'approve');
    expect(approved.status).toBe(201);
    const row = (await dayRow(agent, '2032-06-07'))!;
    expect(row).toMatchObject({ otherLeaveRequestId: second.body.id, leavePartUnpaid: true });
    // Half a day paid on the day: the paid half counts to the first request, the unpaid one to the second.
    expect(approved.body).toMatchObject({ paidDays: 0, unpaidDays: 0.5 });
    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: first.body.id } })).toMatchObject({ paidDays: 0.5, unpaidDays: 0 });
    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: second.body.id } })).toMatchObject({ paidDays: 0, unpaidDays: 0.5 });
  });

  it('a holiday added on a joined leave day that was worked takes the leave off, like any leave day', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HJH', lead.id, MARCH_10);
    const ids = await joined(agent, '2032-06-23');
    await straightDay(agent, [2032, 6, 23], '09:30', '12:00');
    await prisma.holiday.deleteMany({ where: { date: new Date('2032-06-23T00:00:00.000Z') } });
    const holiday = await post(ceo, '/attendance/holidays', { date: '2032-06-23', name: 'Joined-day spec holiday' });
    try {
      expect(holiday.status).toBe(201);
      expect(await dayRow(agent, '2032-06-23')).toMatchObject({ dayType: 'off', leaveKind: null, otherLeaveRequestId: null, leaveRequestId: null });
      for (const id of [ids.a, ids.b]) {
        expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ paidDays: 0, unpaidDays: 0 });
      }
      expect((await get(agent, '/attendance/leave/balance')).body.casual).toMatchObject({ taken: 0 });
    } finally {
      await prisma.holiday.deleteMany({ where: { date: new Date('2032-06-23T00:00:00.000Z') } });
    }
  });

  it('counts a joined day in the balance while it is still open, so the balance is never paid twice', async () => {
    const agent = await make('call_agent', 'HJO', lead.id, MAY_10);
    at(2032, 6, 1, 10);
    const first = await leave(agent, 'casual', '2032-06-24', 'first');
    await decide(lead, first.body.id, 'approve').expect(201);
    at(2032, 6, 24, 14, 0);
    await post(agent, '/attendance/login').expect(201);
    const second = await leave(agent, 'casual', '2032-06-24', 'second');
    await decide(lead, second.body.id, 'approve').expect(201);
    expect(await dayRow(agent, '2032-06-24')).toMatchObject({ dayType: 'open', otherLeaveRequestId: second.body.id, lateMinutes: 0 });
    expect((await get(agent, '/attendance/leave/balance')).body.casual).toMatchObject({ taken: 1, left: 0 });
    const next = await leave(agent, 'casual', '2032-06-25');
    expect((await decide(lead, next.body.id, 'approve')).body).toMatchObject({ paidDays: 0, unpaidDays: 1 });
    // Closing the day keeps it a leave day.
    at(2032, 6, 24, 18, 0);
    await post(agent, '/attendance/logout').expect(201);
    expect(await dayRow(agent, '2032-06-24')).toMatchObject({ dayType: 'leave', shortfallSeconds: 0, makeUpSeconds: 0 });
  });

  it('overturning one half of a joined day that had a Team Lead change closes the day properly (never left open)', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HJC', lead.id, MARCH_10);
    const first = await leave(agent, 'casual', '2032-06-18', 'first');
    await decide(lead, first.body.id, 'approve').expect(201);
    await straightDay(agent, [2032, 6, 18], '14:00', '20:00');
    const day = (await dayRow(agent, '2032-06-18'))!;
    expect(day.dayType).toBe('full');
    at(2032, 6, 18, 21);
    const change = await post(lead, '/requests', { kind: 'day_change', dayId: day.id, dayType: 'half', reason: 'Left the floor early' });
    expect(change.status).toBe(201);
    const second = await leave(agent, 'casual', '2032-06-18', 'second');
    await decide(lead, second.body.id, 'approve').expect(201);
    expect((await dayRow(agent, '2032-06-18'))!.dayType).toBe('leave');
    await decide(manager, second.body.id, 'overturn', { reason: 'Was in the morning after all' }).expect(201);
    const after = (await dayRow(agent, '2032-06-18'))!;
    expect(after.dayType).not.toBe('open');
    expect(['full', 'half']).toContain(after.dayType);
    expect(after).toMatchObject({ leaveHalf: 'first', otherLeaveRequestId: null, shortfallSeconds: 0 });
    // Payroll can run for June: no day of this person is left open.
    expect(await prisma.attendanceDay.count({ where: { staffId: agent.id, dayType: 'open' } })).toBe(0);
  });

  it('refuses to overturn a rejection into an approval when the date has been taken since', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HJR', lead.id, MARCH_10);
    const half = await leave(agent, 'casual', '2032-06-19', 'first');
    await decide(lead, half.body.id, 'reject', { reason: 'Busy' }).expect(201);
    const full = await leave(agent, 'casual', '2032-06-19');
    await decide(lead, full.body.id, 'approve').expect(201);
    const refused = await decide(manager, half.body.id, 'overturn', { reason: 'Changed my mind' });
    expect(refused.status).toBe(400);
    expect((refused.body.details ?? refused.body).code).toBe('leave_overlap');
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: half.body.id } })).status).toBe('rejected');
  });

  it('counts people on the Team Lead board: both halves of today is off, not two half days', async () => {
    at(2032, 6, 17, 8);
    const board = await get(lead, '/team-lead/leave').expect(200);
    type Row = { status: string; fromDate: string; toDate: string; half: string | null; staff: { id: string } };
    const halves = new Map<string, number>();
    for (const row of board.body.schedule as Row[]) {
      if (row.status !== 'approved' || row.fromDate > '2032-06-17' || row.toDate < '2032-06-17') continue;
      halves.set(row.staff.id, (halves.get(row.staff.id) ?? 0) + (row.half ? 1 : 2));
    }
    expect(board.body.summary.offToday).toBe([...halves.values()].filter((h) => h >= 2).length);
    expect(board.body.summary.halfDayToday).toBe([...halves.values()].filter((h) => h === 1).length);
    // The joined people of 17 June (HJW, HJU) are off, not on a half day.
    expect(board.body.summary.offToday).toBeGreaterThanOrEqual(2);
  });

  it('hands follow-ups over only for a full leave day: a half day keeps them, two joined halves move them', async () => {
    at(2032, 6, 1, 10);
    const agent = await make('call_agent', 'HJF', lead.id, MARCH_10);
    const task = await prisma.followUpTask.create({
      data: { code: `FU-HJF-${stamp}`, kind: 'refund_check', subjectType: 'job_seeker', subjectId: agent.id, dueAt: new Date('2032-06-26T06:00:00.000Z'), assignedStaffId: agent.id },
    });
    try {
      const first = await leave(agent, 'casual', '2032-06-26', 'first');
      const approve = (id: string) => post(lead, `/requests/leave.${id}/decide`, { decision: 'approved', reason: 'Fine', followUps: { mode: 'share' } });
      expect((await approve(first.body.id)).status).toBe(200);
      expect((await prisma.followUpTask.findUniqueOrThrow({ where: { id: task.id } })).assignedStaffId).toBe(agent.id);
      const second = await leave(agent, 'casual', '2032-06-26', 'second');
      expect((await approve(second.body.id)).status).toBe(200);
      const moved = await prisma.followUpTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(moved.assignedStaffId).not.toBe(agent.id);
      expect(moved.assignedStaffId).not.toBeNull();
    } finally {
      await prisma.followUpHandover.deleteMany({ where: { followUpTaskId: task.id } });
      await prisma.followUpTask.delete({ where: { id: task.id } });
    }
  });
});

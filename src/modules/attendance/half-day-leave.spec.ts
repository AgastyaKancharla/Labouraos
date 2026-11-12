import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { PayrollService } from '../finance/payroll.service';
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
        ...(createdAt ? { createdAt } : {}),
      },
    });
    staffIds.push(row.id);
    return row;
  }

  function post(person: Person, path: string, body: Body = {}) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${tokenFor(person)}`).send(body);
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
    await prisma.staff.update({ where: { id: person.id }, data: { joinedOn: new Date('2032-05-10T00:00:00.000Z') } });
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
});

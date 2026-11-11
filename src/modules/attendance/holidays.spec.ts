import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { AttendanceClock } from './attendance-clock';
import { AttendanceDaysService } from './attendance-days.service';
import { WorkingDaysService } from './working-days.service';

jest.setTimeout(180000);

const shared = { at: new Date('2027-08-02T04:30:00.000Z') };

class DayClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string };

const HOUR = 3600;
const d = (label: string) => new Date(`${label}T00:00:00.000Z`);

describe('Public holidays', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let days: AttendanceDaysService;
  let workingDays: WorkingDaysService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const holidayYears = [2027, 2029];

  let ceo: Person;
  let manager: Person;
  let lead: Person;
  let finance: Person;

  function tokenFor(staff: Person) {
    return jwt.sign({ sub: staff.id, email: `${staff.id}@laboura.local`, role: staff.role, code: staff.code });
  }

  function at(year: number, month: number, day: number, hour: number, minute = 0) {
    shared.at = localCalendarToUtc(year, month, day, hour, minute);
  }

  async function make(role: string, prefix: string, reportsToId?: string): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} holidays`,
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

  function send(method: 'post' | 'put' | 'patch' | 'delete', person: Person, path: string, body: Record<string, unknown> = {}) {
    return request(app.getHttpServer())[method](path)
      .set('Authorization', `Bearer ${tokenFor(person)}`)
      .send(body);
  }

  function get(person: Person, path: string) {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(person)}`);
  }

  async function workDay(person: Person, ymd: [number, number, number], start: string, end: string) {
    for (const [time, action] of [
      [start, 'login'],
      [start, 'team_meeting'],
      [end, 'logout'],
    ] as Array<[string, string]>) {
      const [hour, minute] = time.split(':').map((part) => Number(part));
      at(ymd[0], ymd[1], ymd[2], hour, minute);
      const path =
        action === 'login' ? '/attendance/login' : action === 'logout' ? '/attendance/logout' : '/attendance/status';
      const res = await send('post', person, path, action === 'team_meeting' ? { status: action } : {});
      expect(res.status).toBe(201);
    }
  }

  async function dayOn(person: Person, label: string) {
    return prisma.attendanceDay.findUnique({
      where: { staffId_date: { staffId: person.id, date: d(label) } },
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(DayClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    days = app.get(AttendanceDaysService);
    workingDays = app.get(WorkingDaysService);
    ceo = await make('ceo', 'CEOH');
    manager = await make('manager', 'MGRH', ceo.id);
    lead = await make('team_lead', 'TLH', manager.id);
    finance = await make('finance', 'FINH', ceo.id);
  });

  afterAll(async () => {
    try {
      for (const year of holidayYears) {
        await prisma.holiday.deleteMany({
          where: { date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
        });
      }
      if (staffIds.length > 0) {
        await prisma.messageLog.deleteMany({ where: { subjectType: 'staff', subjectId: { in: staffIds } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      await app.close();
    }
  });

  it('lets only the CEO add, change or remove a holiday, audited; everyone reads the list', async () => {
    const agent = await make('call_agent', 'CAH1', lead.id);
    for (const person of [manager, lead, finance, agent]) {
      expect((await send('post', person, '/attendance/holidays', { date: '2029-01-26', name: 'Republic Day' })).status).toBe(403);
      expect((await send('put', person, '/attendance/holidays/2029', { holidays: [] })).status).toBe(403);
    }
    const added = await send('post', ceo, '/attendance/holidays', { date: '2029-01-26', name: 'Republic Day' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ date: '2029-01-26', name: 'Republic Day' });
    expect((await send('post', ceo, '/attendance/holidays', { date: '2029-01-26', name: 'Again' })).status).toBe(409);
    expect((await send('post', ceo, '/attendance/holidays', { date: '2029-02-30', name: 'Bad' })).status).toBe(400);
    expect((await send('post', ceo, '/attendance/holidays', { date: '2029-03-01' })).status).toBe(400);

    for (const person of [manager, lead, finance, agent]) {
      expect((await send('patch', person, `/attendance/holidays/${added.body.id}`, { name: 'x' })).status).toBe(403);
      expect((await send('delete', person, `/attendance/holidays/${added.body.id}`)).status).toBe(403);
    }
    const renamed = await send('patch', ceo, `/attendance/holidays/${added.body.id}`, { name: 'Republic Day (India)' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Republic Day (India)');

    const set = await send('put', ceo, '/attendance/holidays/2029', {
      holidays: [
        { date: '2029-01-26', name: 'Republic Day' },
        { date: '2029-08-15', name: 'Independence Day' },
        { date: '2029-10-02', name: 'Gandhi Jayanti' },
      ],
    });
    expect(set.status).toBe(200);
    expect(set.body.holidays.map((row: { date: string }) => row.date)).toEqual(['2029-01-26', '2029-08-15', '2029-10-02']);
    expect((await send('put', ceo, '/attendance/holidays/2029', { holidays: [{ date: '2030-01-01', name: 'x' }] })).status).toBe(400);
    expect(
      (
        await send('put', ceo, '/attendance/holidays/2029', {
          holidays: [
            { date: '2029-05-01', name: 'a' },
            { date: '2029-05-01', name: 'b' },
          ],
        })
      ).status,
    ).toBe(400);

    const read = await get(agent, '/attendance/holidays?year=2029').expect(200);
    expect(read.body.holidays).toHaveLength(3);
    const gandhi = read.body.holidays.find((row: { date: string }) => row.date === '2029-10-02');
    expect((await send('delete', ceo, `/attendance/holidays/${gandhi.id}`)).status).toBe(200);
    expect((await get(agent, '/attendance/holidays?year=2029')).body.holidays).toHaveLength(2);

    const audit = await prisma.auditLog.findMany({ where: { actorId: ceo.id, entityType: 'holiday' } });
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'attendance.holiday_added',
        'attendance.holiday_changed',
        'attendance.holidays_set',
        'attendance.holiday_removed',
      ]),
    );
  });

  it('a holiday is never absent, uses no leave, is make-up when worked, and is not a working day in the month', async () => {
    at(2027, 8, 2, 10);
    expect((await send('post', ceo, '/attendance/holidays', { date: '2027-08-11', name: 'Test holiday' })).status).toBe(201);
    const agent = await make('call_agent', 'CAH2', lead.id);

    expect((await days.markAbsentDays(d('2027-08-11'), [agent.id])).marked).toBe(0);
    expect(await dayOn(agent, '2027-08-11')).toBeNull();

    // Leave Tue 10 to Thu 12 spans the holiday: 2 leave days, not 3.
    const leave = await send('post', agent, '/attendance/leave', {
      kind: 'casual',
      fromDate: '2027-08-10',
      toDate: '2027-08-12',
      reason: 'Trip home',
    });
    expect(leave.status).toBe(201);
    expect(leave.body.days).toBe(2);
    const approved = await send('post', lead, `/attendance/requests/leave/${leave.body.id}/approve`, { reason: 'Fine' });
    expect(approved.status).toBe(201);
    expect(approved.body.paidDays + approved.body.unpaidDays).toBe(2);
    expect(await dayOn(agent, '2027-08-11')).toBeNull();

    // Working 3 hours on the holiday is all make-up, never a half day.
    const worker = await make('call_agent', 'CAH3', lead.id);
    await workDay(worker, [2027, 8, 11], '10:00', '13:00');
    expect(await dayOn(worker, '2027-08-11')).toMatchObject({
      dayType: 'off',
      shortfallSeconds: 0,
      makeUpSeconds: 3 * HOUR,
    });

    // August 2027: 31 days, 5 Sundays, 1 holiday → 25 working days.
    const month = await get(lead, `/attendance/month?month=2027-08&staffId=${worker.id}`).expect(200);
    expect(month.body.workingDays).toBe(25);
    expect(month.body.holidays).toEqual([{ date: '2027-08-11', name: 'Test holiday' }]);
    const calendar = await workingDays.calendar(d('2027-08-01'), d('2027-08-31'));
    expect(calendar.workingDates.map((date) => date.toISOString().slice(0, 10))).not.toContain('2027-08-11');
    expect(await workingDays.reasonFor(d('2027-08-11'))).toBe('holiday');
    expect(await workingDays.reasonFor(d('2027-08-08'))).toBe('weekly_off');
    expect(await workingDays.reasonFor(d('2027-08-12'))).toBeNull();
  });

  it('changing the list re-works the days of the current month, past days included, and leaves earlier months alone', async () => {
    const absentee = await make('call_agent', 'CAH4', lead.id);
    const halfDay = await make('call_agent', 'CAH5', lead.id);
    const onLeave = await make('call_agent', 'CAH6', lead.id);

    // July: an absent day that must stay absent (a closed month).
    await days.markAbsentDays(d('2027-07-20'), [absentee.id]);
    // Wed 18 Aug: one absent, one 3-hour half day, one approved paid leave day.
    await days.markAbsentDays(d('2027-08-18'), [absentee.id]);
    await workDay(halfDay, [2027, 8, 18], '09:30', '12:30');
    at(2027, 8, 16, 10);
    const leave = await send('post', onLeave, '/attendance/leave', {
      kind: 'casual',
      fromDate: '2027-08-18',
      reason: 'Errand',
    });
    await send('post', lead, `/attendance/requests/leave/${leave.body.id}/approve`, { reason: 'Fine' }).expect(201);
    const balanceBefore = await get(onLeave, '/attendance/leave/balance').expect(200);

    expect(await dayOn(absentee, '2027-08-18')).toMatchObject({ dayType: 'absent' });
    expect(await dayOn(halfDay, '2027-08-18')).toMatchObject({ dayType: 'half' });
    expect(await dayOn(onLeave, '2027-08-18')).toMatchObject({ dayType: 'leave', leaveUnpaid: false });

    // On 20 Aug the CEO makes 18 Aug a holiday (and 20 Jul, in a closed month).
    at(2027, 8, 20, 10);
    const added = await send('post', ceo, '/attendance/holidays', { date: '2027-08-18', name: 'Local festival' });
    expect(added.status).toBe(201);
    const july = await send('post', ceo, '/attendance/holidays', { date: '2027-07-20', name: 'Late entry' });
    expect(july.status).toBe(201);

    expect(await dayOn(absentee, '2027-08-18')).toBeNull();
    expect(await dayOn(absentee, '2027-07-20')).toMatchObject({ dayType: 'absent' });
    expect(await dayOn(halfDay, '2027-08-18')).toMatchObject({
      dayType: 'off',
      shortfallSeconds: 0,
      makeUpSeconds: 3 * HOUR,
    });
    expect(await dayOn(onLeave, '2027-08-18')).toBeNull();
    const request1 = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.body.id } });
    expect(request1).toMatchObject({ paidDays: 0, unpaidDays: 0 });
    const balanceHoliday = await get(onLeave, '/attendance/leave/balance').expect(200);
    expect(balanceHoliday.body.casual.left).toBe(balanceBefore.body.casual.left + 1);

    // Moving the holiday to 19 Aug puts 18 Aug back as a working day.
    const moved = await send('patch', ceo, `/attendance/holidays/${added.body.id}`, { date: '2027-08-19' });
    expect(moved.status).toBe(200);
    expect(await dayOn(absentee, '2027-08-18')).toMatchObject({ dayType: 'absent' });
    expect(await dayOn(halfDay, '2027-08-18')).toMatchObject({ dayType: 'half', makeUpSeconds: 0 });
    expect(await dayOn(onLeave, '2027-08-18')).toMatchObject({ dayType: 'leave', leaveUnpaid: false });
    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.body.id } })).toMatchObject({
      paidDays: 1,
      unpaidDays: 0,
    });
    // 19 Aug, a past day with no login, is a holiday now: nobody is marked absent on it.
    expect((await days.markAbsentDays(d('2027-08-19'), [absentee.id])).marked).toBe(0);

    // Removing it works 19 Aug out again: a past working day with no login is absent.
    expect((await send('delete', ceo, `/attendance/holidays/${added.body.id}`)).status).toBe(200);
    expect(await dayOn(absentee, '2027-08-19')).toMatchObject({ dayType: 'absent' });
  });
});

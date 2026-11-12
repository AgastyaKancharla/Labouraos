import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { AttendanceClock } from './attendance-clock';
import { AttendanceDaysService } from './attendance-days.service';

jest.setTimeout(180000);

const shared = { at: new Date('2027-06-07T04:00:00.000Z') };

class DayClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string; name: string; email: string | null };
type LiveRow = { staff: { id: string }; status: string; since: string | null; overBreak: boolean; idle: boolean };
type TeamRow = { staff: { id: string }; productionSeconds: number; hoursLostSeconds: number; lateLogins: number; absentDays: number };

const HOUR = 3600;
const MIN = 60;

describe('Phase 21 Task 5: attendance reports and the live board', () => {
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
  let agentA1: Person;
  let agentA2: Person;
  let agentA3: Person;
  let agentB1: Person;
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

  async function make(role: string, prefix: string, reportsToId?: string): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} reports`,
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

  function post(person: Person, path: string, body: Record<string, unknown> = {}) {
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
    days = app.get(AttendanceDaysService);

    ceo = await make('ceo', 'CEO5');
    managerA = await make('manager', 'MGA5', ceo.id);
    managerB = await make('manager', 'MGB5', ceo.id);
    leadA = await make('team_lead', 'TLA5', managerA.id);
    leadB = await make('team_lead', 'TLB5', managerB.id);
    agentA1 = await make('call_agent', 'CA15', leadA.id);
    agentA2 = await make('call_agent', 'CA25', leadA.id);
    agentA3 = await make('call_agent', 'CA35', leadA.id);
    agentB1 = await make('call_agent', 'CB15', leadB.id);
    finance = await make('finance', 'FIN5', ceo.id);

    // The month: agent A3 in June 2027.
    // Tue 8 Jun: 20 minutes late, 7h 40m production → full, 20 minutes shortfall.
    await workDay(agentA3, [2027, 6, 8], [
      ['09:50', 'login'],
      ['09:50', 'team_meeting'],
      ['17:30', 'logout'],
    ]);
    // Wed 9 Jun: idle 09:41–10:00, then a meeting to 18:00 → 8h 11m production, 11 minutes make-up.
    await workDay(agentA3, [2027, 6, 9], [
      ['09:30', 'login'],
      ['10:00', 'team_meeting'],
      ['18:00', 'logout'],
    ]);
    // Thu 10 Jun: no login → absent.
    await days.markAbsentDays(new Date('2027-06-10T00:00:00.000Z'), [agentA3.id]);
    // Fri 11 Jun: 3 hours → half day.
    await workDay(agentA3, [2027, 6, 11], [
      ['09:30', 'login'],
      ['09:30', 'team_meeting'],
      ['12:30', 'logout'],
    ]);
    // Mon 14 Jun: one paid casual day.
    at(2027, 6, 11, 13);
    const leave = await post(agentA3, '/attendance/leave', {
      kind: 'casual',
      fromDate: '2027-06-14',
      reason: 'Family function',
    });
    expect(leave.status).toBe(201);
    expect(
      (await post(leadA, `/attendance/requests/leave/${leave.body.id}/approve`, { reason: 'Fine' })).status,
    ).toBe(201);
  });

  afterAll(async () => {
    try {
      if (staffIds.length > 0) {
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

  it('shows the live board only for the people each role may see, with over-break and idle', async () => {
    await workDay(agentA1, [2027, 6, 7], [
      ['09:30', 'login'],
      ['09:30', 'team_meeting'],
      ['09:40', 'short_break'],
    ]);
    await workDay(agentA2, [2027, 6, 7], [['09:30', 'login']]);
    await workDay(agentB1, [2027, 6, 7], [['09:30', 'login'], ['09:30', 'training']]);
    at(2027, 6, 7, 10, 0);

    const lead = await get(leadA, '/attendance/live').expect(200);
    const leadIds = (lead.body.people as LiveRow[]).map((row) => row.staff.id);
    expect(leadIds).toEqual(expect.arrayContaining([agentA1.id, agentA2.id, agentA3.id]));
    expect(leadIds).not.toContain(agentB1.id);
    expect(leadIds).not.toContain(leadA.id);
    const onBreak = (lead.body.people as LiveRow[]).find((row) => row.staff.id === agentA1.id);
    expect(onBreak).toMatchObject({
      status: 'short_break',
      overBreak: true,
      since: localCalendarToUtc(2027, 6, 7, 9, 40).toISOString(),
    });
    const idle = (lead.body.people as LiveRow[]).find((row) => row.staff.id === agentA2.id);
    expect(idle).toMatchObject({ status: 'idle', idle: true });
    const notIn = (lead.body.people as LiveRow[]).find((row) => row.staff.id === agentA3.id);
    expect(notIn?.status).toBe('not_logged_in');
    expect(lead.body.counts).toMatchObject({ overBreak: 1, idle: 1 });

    const manager = await get(managerA, '/attendance/live').expect(200);
    const managerIds = (manager.body.people as LiveRow[]).map((row) => row.staff.id);
    expect(managerIds).toEqual(expect.arrayContaining([leadA.id, agentA1.id, agentA2.id, agentA3.id]));
    expect(managerIds).not.toContain(agentB1.id);
    expect(managerIds).not.toContain(leadB.id);

    const other = await get(leadB, '/attendance/live').expect(200);
    expect((other.body.people as LiveRow[]).map((row) => row.staff.id)).toEqual([agentB1.id]);

    const everyone = await get(ceo, '/attendance/live').expect(200);
    const ceoIds = (everyone.body.people as LiveRow[]).map((row) => row.staff.id);
    expect(ceoIds).toEqual(expect.arrayContaining([agentA1.id, agentB1.id, leadA.id, managerA.id, finance.id]));
    expect(ceoIds).not.toContain(ceo.id);

    expect((await get(finance, '/attendance/live')).status).toBe(403);
    expect((await get(agentA1, '/attendance/live')).status).toBe(403);
  });

  it('reports one person over a date range: late logins, production by day, idle and hours lost', async () => {
    const res = await get(leadA, `/attendance/report?staffId=${agentA3.id}&from=2027-06-08&to=2027-06-09`);
    expect(res.status).toBe(200);
    expect(res.body.lateLogins).toEqual({ count: 1, days: [{ date: '2027-06-08', minutes: 20 }] });
    // Each day carries its id (for Change day) and any change made to it.
    expect(res.body.days.every((row: { id: string; change: unknown }) => typeof row.id === 'string' && 'change' in row)).toBe(true);
    expect(res.body.days.map((row: { date: string; productionSeconds: number }) => [row.date, row.productionSeconds])).toEqual([
      ['2027-06-08', 7 * HOUR + 40 * MIN],
      ['2027-06-09', 8 * HOUR + 11 * MIN],
    ]);
    expect(res.body.totals).toMatchObject({
      idleSeconds: 19 * MIN,
      shortfallSeconds: 20 * MIN,
      hoursLostSeconds: 39 * MIN,
      lateLogins: 1,
    });
    expect((await get(agentA3, '/attendance/report?from=2027-06-08&to=2027-06-09')).status).toBe(200);
    expect((await get(managerA, `/attendance/report?staffId=${agentA3.id}&from=2027-06-08&to=2027-06-09`)).status).toBe(200);
    expect((await get(finance, `/attendance/report?staffId=${agentA3.id}&from=2027-06-08&to=2027-06-09`)).status).toBe(200);
    expect((await get(leadB, `/attendance/report?staffId=${agentA3.id}&from=2027-06-08&to=2027-06-09`)).status).toBe(403);
    expect((await get(managerB, `/attendance/report?staffId=${agentA3.id}&from=2027-06-08&to=2027-06-09`)).status).toBe(403);
    expect((await get(agentA1, `/attendance/report?staffId=${agentA3.id}&from=2027-06-08&to=2027-06-09`)).status).toBe(403);
    expect((await get(leadA, `/attendance/report?staffId=${agentA3.id}&from=2027-06-09&to=2027-06-08`)).status).toBe(400);
  });

  it('counts the short breaks each day, and the ones past the two a day the shift allows', async () => {
    // Tue 15 Jun: three short breaks and lunch.
    await workDay(agentA2, [2027, 6, 15], [
      ['09:30', 'login'],
      ['09:30', 'team_meeting'],
      ['11:00', 'short_break'],
      ['11:10', 'team_meeting'],
      ['13:00', 'lunch'],
      ['13:30', 'team_meeting'],
      ['15:00', 'short_break'],
      ['15:10', 'team_meeting'],
      ['16:30', 'short_break'],
      ['16:40', 'team_meeting'],
      ['18:30', 'logout'],
    ]);
    const res = await get(leadA, `/attendance/report?staffId=${agentA2.id}&from=2027-06-15&to=2027-06-15`);
    expect(res.status).toBe(200);
    expect(res.body.days[0]).toMatchObject({ date: '2027-06-15', breakCount: 3, extraBreaks: 1 });
  });

  it('summarises the team per person and in total, scoped to each role', async () => {
    const res = await get(leadA, '/attendance/team-summary?from=2027-06-01&to=2027-06-30');
    expect(res.status).toBe(200);
    const rows = res.body.people as TeamRow[];
    expect(rows.map((row) => row.staff.id)).toEqual(expect.arrayContaining([agentA1.id, agentA2.id, agentA3.id]));
    expect(rows.map((row) => row.staff.id)).not.toContain(agentB1.id);
    const a3 = rows.find((row) => row.staff.id === agentA3.id);
    expect(a3).toMatchObject({
      productionSeconds: 7 * HOUR + 40 * MIN + 8 * HOUR + 11 * MIN + 3 * HOUR,
      hoursLostSeconds: 39 * MIN,
      lateLogins: 1,
      absentDays: 1,
    });
    expect(res.body.total.people).toBe(rows.length);
    expect(res.body.total.absentDays).toBe(rows.reduce((sum, row) => sum + row.absentDays, 0));
    expect(res.body.total.productionSeconds).toBe(rows.reduce((sum, row) => sum + row.productionSeconds, 0));

    const other = await get(managerB, '/attendance/team-summary?from=2027-06-01&to=2027-06-30').expect(200);
    expect((other.body.people as TeamRow[]).map((row) => row.staff.id)).not.toContain(agentA3.id);
    const all = await get(finance, '/attendance/team-summary?from=2027-06-01&to=2027-06-30').expect(200);
    expect((all.body.people as TeamRow[]).map((row) => row.staff.id)).toEqual(
      expect.arrayContaining([agentA3.id, agentB1.id]),
    );
    expect((await get(agentA1, '/attendance/team-summary?from=2027-06-01&to=2027-06-30')).status).toBe(403);
  });

  it('builds the month sheet from the month summaries, for Finance and the CEO only', async () => {
    const sheet = await get(finance, '/attendance/month-sheet?month=2027-06').expect(200);
    const row = sheet.body.rows.find((item: { staffCode: string }) => item.staffCode === agentA3.code);
    expect(row).toEqual({
      staffCode: agentA3.code,
      name: agentA3.name,
      role: 'call_agent',
      workingDays: 26,
      holidays: 0,
      fullDays: 2,
      halfDays: 1,
      paidLeaveDays: 1,
      absentDays: 1,
      unpaidLeaveDays: 0,
      paidDays: 3.5,
      unpaidDays: 1.5,
      deductibleShortfallMinutes: 9,
    });

    const summary = await get(finance, `/attendance/month?month=2027-06&staffId=${agentA3.id}`).expect(200);
    expect(row.fullDays).toBe(summary.body.fullDays);
    expect(row.halfDays).toBe(summary.body.halfDays);
    expect(row.absentDays).toBe(summary.body.absentDays);
    expect(row.paidLeaveDays).toBe(summary.body.paidLeaveDays.total);
    expect(row.unpaidLeaveDays).toBe(summary.body.unpaidLeaveDays);
    expect(row.deductibleShortfallMinutes).toBe(Math.floor(summary.body.deductibleShortfallSeconds / 60));
    expect(row.workingDays).toBe(summary.body.workingDays);
    expect(row.holidays).toBe(summary.body.holidays.length);
    expect(row.paidDays).toBe(
      summary.body.fullDays + summary.body.halfDays * 0.5 + summary.body.paidLeaveDays.total,
    );
    expect(row.unpaidDays).toBe(
      summary.body.absentDays + summary.body.unpaidLeaveDays + summary.body.halfDays * 0.5,
    );
    expect(sheet.body.rows.some((item: { role: string }) => item.role === 'ceo')).toBe(false);

    expect((await get(ceo, '/attendance/month-sheet?month=2027-06')).status).toBe(200);
    expect((await get(managerA, '/attendance/month-sheet?month=2027-06')).status).toBe(403);
    expect((await get(managerA, '/attendance/month-sheet?month=2027-06&format=csv')).status).toBe(403);
    expect((await get(leadA, '/attendance/month-sheet?month=2027-06')).status).toBe(403);
    expect((await get(finance, '/attendance/month-sheet?month=June')).status).toBe(400);
  });

  it('downloads the month sheet as CSV with only name, staff code and role as personal data', async () => {
    const res = await get(finance, '/attendance/month-sheet?month=2027-06&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attendance-month-sheet-2027-06.csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe(
      'Staff code,Name,Role,Working days,Holidays,Full days,Half days,Paid leave days,Absent days,Unpaid leave days,Paid days,Unpaid days,Deductible shortfall (minutes)',
    );
    const line = lines.find((item) => item.startsWith(`${agentA3.code},`));
    expect(line).toBe(`${agentA3.code},${agentA3.name},call_agent,26,0,2,1,1,1,0,3.5,1.5,9`);
    expect(res.text).not.toContain(agentA3.email as string);
    expect(res.text).not.toContain('@');
    expect(res.text).not.toMatch(/₹|paise|salary/i);
  });
});

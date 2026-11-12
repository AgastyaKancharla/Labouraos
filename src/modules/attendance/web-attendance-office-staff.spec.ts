import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { Subscription } from 'rxjs';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LiveEventsService, LiveMessage } from '../../common/live/live-events.service';
import { AttendanceClock } from './attendance-clock';

jest.setTimeout(120000);

const shared = { at: new Date('2026-11-10T04:00:00.000Z') };

class OfficeClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

/**
 * The web app's attendance (call agent console and the Team Lead, Manager
 * and Finance headers): the today view carries what the CA14 screens show,
 * every status change reaches the person's open screens on the live channel,
 * and an office person's day lands on the live board, the reports and the
 * salary month sheet exactly like a call agent's (owner decision 12 Nov).
 */
describe('Web attendance: today view, live status and office staff days', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let live: LiveEventsService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const subscriptions: Subscription[] = [];
  const start = new Date('2026-11-10T04:00:00.000Z'); // Tue 10 Nov, 9:30 AM IST

  function at(minutes: number) {
    shared.at = new Date(start.getTime() + minutes * 60 * 1000);
  }

  function tokenFor(staff: { id: string; role: string; code: string }) {
    return jwt.sign({ sub: staff.id, email: `${staff.id}@laboura.local`, role: staff.role, code: staff.code });
  }

  async function make(role: string, prefix: string, line?: { teamLeadId?: string; reportsToId?: string }) {
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} web attendance`,
        email: `${prefix.toLowerCase()}.web.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        city: 'Bengaluru',
        teamLeadId: line?.teamLeadId ?? null,
        reportsToId: line?.reportsToId ?? null,
      },
    });
    staffIds.push(row.id);
    return row;
  }

  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body);
  const get = (token: string, path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  /** Works (a heartbeat every 5 minutes) from one minute to another, so nobody goes Idle. */
  async function work(token: string, from: number, to: number) {
    for (let minute = from + 5; minute < to; minute += 5) {
      at(minute);
      await post(token, '/attendance/heartbeat').expect(201);
    }
  }

  function listen(staffId: string): LiveMessage[] {
    const seen: LiveMessage[] = [];
    subscriptions.push(live.streamFor(staffId).subscribe((message) => seen.push(message)));
    return seen;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(OfficeClock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    live = app.get(LiveEventsService);
  });

  afterAll(async () => {
    for (const subscription of subscriptions) subscription.unsubscribe();
    try {
      if (staffIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      await app.close();
    }
  });

  it('shows a Team Lead’s whole day: status since, breaks and lunch apart, meetings, the timeline and the settings', async () => {
    const ceo = await make('ceo', 'WCEO');
    const manager = await make('manager', 'WMGR', { reportsToId: ceo.id });
    const lead = await make('team_lead', 'WTL', { reportsToId: manager.id });
    const token = tokenFor(lead);

    at(-10);
    const before = await get(token, '/attendance/today').expect(200);
    expect(before.body.loginAt).toBeNull();
    expect(before.body.statusSince).toBeNull();
    expect(before.body.segments).toEqual([]);
    expect(before.body.policy).toEqual({
      productionHoursFullDay: 8,
      lateGraceMinutes: 10,
      shortBreakMinutes: 15,
      lunchMinutes: 30,
      idleAfterMinutes: 10,
      idlePromptMinutes: 1,
    });

    at(0);
    const loggedIn = await post(token, '/attendance/login').expect(201);
    expect(loggedIn.body.status).toBe('available');
    expect(loggedIn.body.statusSince).toBe(start.toISOString());
    expect(loggedIn.body.lateMinutes).toBe(0);

    await work(token, 0, 30);
    at(30);
    await post(token, '/attendance/status', { status: 'team_meeting' }).expect(201);
    at(55);
    await post(token, '/attendance/status', { status: 'available' }).expect(201);
    await work(token, 55, 120);
    at(120);
    await post(token, '/attendance/status', { status: 'short_break' }).expect(201);
    at(135);
    await post(token, '/attendance/status', { status: 'available' }).expect(201);
    await work(token, 135, 240);
    at(240);
    await post(token, '/attendance/status', { status: 'lunch' }).expect(201);
    at(250);
    const onLunch = await get(token, '/attendance/today').expect(200);
    expect(onLunch.body.status).toBe('lunch');
    expect(onLunch.body.statusSince).toBe(new Date(start.getTime() + 240 * 60000).toISOString());
    expect(onLunch.body.shortBreakSeconds).toBe(15 * 60);
    expect(onLunch.body.shortBreaks).toBe(1);
    expect(onLunch.body.lunchSeconds).toBe(10 * 60);
    expect(onLunch.body.meetingSeconds).toBe(25 * 60);
    expect(onLunch.body.segments.map((s: { status: string }) => s.status)).toEqual([
      'available',
      'team_meeting',
      'available',
      'short_break',
      'available',
      'lunch',
    ]);
    expect(onLunch.body.segments[0]).toMatchObject({ source: 'staff', approved: null, endedAt: new Date(start.getTime() + 30 * 60000).toISOString() });
    expect(onLunch.body.segments[5].endedAt).toBeNull();

    at(270);
    await post(token, '/attendance/status', { status: 'available' }).expect(201);
    await work(token, 270, 540);
    at(540);
    const ended = await post(token, '/attendance/logout').expect(201);
    expect(ended.body.status).toBeNull();
    expect(ended.body.statusSince).toBeNull();
    expect(ended.body.dayType).toBe('full');
    // 9 hours logged in, less a 15-minute break and a 30-minute lunch.
    expect(ended.body.productionSeconds).toBe((540 - 45) * 60);
    expect(ended.body.lunchSeconds).toBe(30 * 60);
  });

  it('puts Team Leads, Managers and Finance on the live board, the reports and the salary month sheet like call agents', async () => {
    const ceo = await make('ceo', 'XCEO');
    const manager = await make('manager', 'XMGR', { reportsToId: ceo.id });
    const lead = await make('team_lead', 'XTL', { reportsToId: manager.id });
    const finance = await make('finance', 'XFIN', { reportsToId: ceo.id });
    const agent = await make('call_agent', 'XCA', { teamLeadId: lead.id, reportsToId: lead.id });

    at(5);
    for (const person of [manager, lead, finance, agent]) {
      await post(tokenFor(person), '/attendance/login').expect(201);
    }
    // Read the boards a few minutes after login; nobody calls the server again
    // until they log out, so nobody is marked Idle in between.
    at(10);
    await post(tokenFor(lead), '/attendance/status', { status: 'one_to_one' }).expect(201);
    await post(tokenFor(finance), '/attendance/status', { status: 'training' }).expect(201);

    const managerBoard = await get(tokenFor(manager), '/attendance/live').expect(200);
    const managerRows = managerBoard.body.people;
    const leadRow = managerRows.find((row: { staff: { id: string } }) => row.staff.id === lead.id);
    expect(leadRow?.status).toBe('one_to_one');

    const ceoBoard = await get(tokenFor(ceo), '/attendance/live').expect(200);
    const ceoRows = ceoBoard.body.people;
    const ids = ceoRows.map((row: { staff: { id: string } }) => row.staff.id);
    expect(ids).toEqual(expect.arrayContaining([manager.id, lead.id, finance.id, agent.id]));
    expect(ceoRows.find((row: { staff: { id: string } }) => row.staff.id === finance.id)?.status).toBe('training');

    at(5 + 540);
    for (const person of [manager, lead, finance, agent]) {
      await post(tokenFor(person), '/attendance/logout').expect(201);
    }

    for (const person of [manager, lead, finance]) {
      const month = await get(tokenFor(person), '/attendance/month?month=2026-11').expect(200);
      const day = month.body.days.find((row: { date: string }) => row.date === '2026-11-10');
      expect(day).toMatchObject({ dayType: 'full', lateMinutes: 0 });
    }

    const sheet = await get(tokenFor(ceo), '/attendance/month-sheet?month=2026-11').expect(200);
    for (const person of [manager, lead, finance, agent]) {
      const row = sheet.body.rows.find((r: { staffCode: string }) => r.staffCode === person.code);
      expect(row).toBeDefined();
      expect(row.fullDays).toBeGreaterThanOrEqual(1);
    }
  });

  it('sends every status change to the person’s open screens on the live channel', async () => {
    const ceo = await make('ceo', 'LCEO');
    const lead = await make('team_lead', 'LTL', { reportsToId: ceo.id });
    const agent = await make('call_agent', 'LCA', { teamLeadId: lead.id, reportsToId: lead.id });
    const seen = listen(agent.id);
    const other = listen(lead.id);
    const token = tokenFor(agent);

    at(0);
    await post(token, '/attendance/login').expect(201);
    at(10);
    await post(token, '/attendance/status', { status: 'short_break' }).expect(201);
    at(20);
    await post(token, '/attendance/status', { status: 'available' }).expect(201);
    // No heartbeat for the idle setting plus the one-minute prompt: the server marks Idle.
    at(20 + 11);
    await get(token, '/attendance/today').expect(200);
    at(40);
    await post(token, '/attendance/logout').expect(201);

    const statuses = seen
      .filter((message) => message.type === 'attendance_status')
      .map((message) => message.data.status);
    expect(statuses).toEqual(['available', 'short_break', 'available', 'idle', null]);
    const idle = seen.find((message) => message.data.status === 'idle');
    expect(idle?.data.since).toBe(new Date(start.getTime() + 31 * 60000).toISOString());
    // Only the person's own screens hear about it.
    expect(other.filter((message) => message.type === 'attendance_status')).toEqual([]);
  });
});

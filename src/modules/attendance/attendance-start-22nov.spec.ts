import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StaffSignInHooks } from '../../common/auth/sign-in-hooks';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { PricingService } from '../pricing/pricing.service';
import { onShiftCallAgents } from '../telephony/call-agent-load';
import { loadLeadAgents } from '../whatsapp-inbox/lead-assignment';
import { AttendanceClock } from './attendance-clock';
import { AttendanceService } from './attendance.service';
import { START_OF_DAY_STATUS, STAFF_PICKED_STATUSES, startsDayAtSignIn } from './attendance.constants';

jest.setTimeout(120000);

/**
 * Attendance start and console layout (Master Guide rev 206, decided 22 Nov):
 * the first sign-in of the day opens the attendance day in Start of day for
 * call agents, field agents, Team Leads and Managers; Start of day is
 * unproductive, never receives calls or new work, and more than 15 minutes in
 * it rings the Team Lead (the Manager for a Team Lead) once a day.
 */
const shared = { at: new Date('2026-11-24T04:00:00.000Z') };

class TestClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string };

describe('Attendance start (22 Nov): the day opens at sign-in in Start of day', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let attendance: AttendanceService;
  let hooks: StaffSignInHooks;
  let bells: NotificationSourcesService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  let ceo: Person;
  let manager: Person;
  let lead: Person;

  const at = (iso: string) => {
    shared.at = new Date(iso);
  };
  const tokenFor = (staff: Person) => jwt.sign({ sub: staff.id, email: `${staff.id}@laboura.local`, role: staff.role, code: staff.code });

  async function make(role: string, prefix: string, extra: Record<string, unknown> = {}): Promise<Person> {
    const row = await prisma.staff.create({
      data: { code: `${prefix}-${stamp}-${staffIds.length}`, name: `${prefix} person`, passwordHash: 'hash', role, status: 'active', city: 'Bengaluru', ...extra },
    });
    staffIds.push(row.id);
    return row;
  }
  const agentOf = (teamLead: Person, prefix: string, role = 'call_agent') => make(role, prefix, { teamLeadId: teamLead.id, reportsToId: teamLead.id });
  const signIn = (person: Person, location: { latitude?: number; longitude?: number } = {}) =>
    hooks.signedIn({ staffId: person.id, role: person.role, sessionId: `session-${person.id}`, location });
  const http = () => request(app.getHttpServer());
  const post = (person: Person, path: string, body: Record<string, unknown> = {}) => http().post(path).set('Authorization', `Bearer ${tokenFor(person)}`).send(body);
  const today = (person: Person) => http().get('/attendance/today').set('Authorization', `Bearer ${tokenFor(person)}`);
  const dayOf = (person: Person) => prisma.attendanceDay.findFirst({ where: { staffId: person.id }, include: { segments: { orderBy: { startedAt: 'asc' } } } });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(TestClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    attendance = app.get(AttendanceService);
    hooks = app.get(StaffSignInHooks);
    bells = app.get(NotificationSourcesService);
    ceo = await make('ceo', 'SCEO');
    manager = await make('manager', 'SMGR', { reportsToId: ceo.id });
    lead = await make('team_lead', 'STL', { reportsToId: manager.id });
  });

  beforeEach(() => at('2026-11-24T04:00:00.000Z'));

  afterAll(async () => {
    await prisma.attendanceSegment.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: staffIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('Start of day is its own status: not production, not a break, never picked by hand', () => {
    expect(START_OF_DAY_STATUS).toBe('start_of_day');
    expect(STAFF_PICKED_STATUSES as readonly string[]).not.toContain('start_of_day');
    expect(startsDayAtSignIn({ role: 'call_agent' })).toBe(true);
    expect(startsDayAtSignIn({ role: 'field_agent' })).toBe(true);
    expect(startsDayAtSignIn({ role: 'team_lead' })).toBe(true);
    expect(startsDayAtSignIn({ role: 'manager' })).toBe(true);
    expect(startsDayAtSignIn({ role: 'ceo' })).toBe(false);
    expect(startsDayAtSignIn({ role: 'finance' })).toBe(false);
    expect(startsDayAtSignIn({ role: 'call_agent', isOwnerAccount: true })).toBe(false);
  });

  it('the first sign-in of the day opens it in Start of day, late from the sign-in; a second sign-in changes nothing', async () => {
    const agent = await agentOf(lead, 'SIA');
    at('2026-11-24T04:30:00.000Z'); // 10:00 IST: 30 minutes after the 09:30 shift start.
    await signIn(agent);
    const day = await dayOf(agent);
    expect(day?.loginAt?.toISOString()).toBe('2026-11-24T04:30:00.000Z');
    expect(day?.lateMinutes).toBe(30);
    expect(day?.segments.map((s) => [s.status, s.startedAt.toISOString(), s.endedAt])).toEqual([['start_of_day', '2026-11-24T04:30:00.000Z', null]]);
    const view = await today(agent).expect(200);
    expect(view.body).toMatchObject({ status: 'start_of_day', statusSince: '2026-11-24T04:30:00.000Z', lateMinutes: 30, startsAtSignIn: true, productionSeconds: 0 });

    at('2026-11-24T05:00:00.000Z');
    await signIn(agent);
    const again = await dayOf(agent);
    expect(again?.loginAt?.toISOString()).toBe('2026-11-24T04:30:00.000Z');
    expect(again?.segments).toHaveLength(1);
    // The old "Start my day" call still answers (compatibility) and changes nothing.
    expect((await post(agent, '/attendance/login').expect(201)).body.status).toBe('start_of_day');
  });

  it('Team Leads and Managers too; the CEO, Finance and owner accounts are unchanged', async () => {
    const tl = await make('team_lead', 'SIT', { reportsToId: manager.id });
    const mgr = await make('manager', 'SIM', { reportsToId: ceo.id });
    const fin = await make('finance', 'SIF', { reportsToId: ceo.id });
    const boss = await make('ceo', 'SIC');
    const owner = await make('call_agent', 'SIO', { reportsToId: ceo.id, isOwnerAccount: true });
    for (const person of [tl, mgr, fin, boss, owner]) await signIn(person);
    expect((await dayOf(tl))?.segments.map((s) => s.status)).toEqual(['start_of_day']);
    expect((await dayOf(mgr))?.segments.map((s) => s.status)).toEqual(['start_of_day']);
    expect(await dayOf(fin)).toBeNull();
    expect(await dayOf(boss)).toBeNull();
    expect(await dayOf(owner)).toBeNull();
    // Finance still starts the day with the button, as Available.
    expect((await post(fin, '/attendance/login').expect(201)).body).toMatchObject({ status: 'available', startsAtSignIn: false });
    // An owner account's day still starts by itself as Available when its app opens.
    expect((await today(owner).expect(200)).body.status).toBe('available');
  });

  it('a day that ended is never reopened by signing in; Resume my day comes back to Start of day', async () => {
    const agent = await agentOf(lead, 'SIR');
    await signIn(agent);
    await post(agent, '/attendance/status', { status: 'available' }).expect(201);
    at('2026-11-24T06:00:00.000Z');
    await post(agent, '/attendance/logout').expect(201);
    at('2026-11-24T06:10:00.000Z');
    await signIn(agent);
    const ended = await today(agent).expect(200);
    expect(ended.body).toMatchObject({ logoutAt: '2026-11-24T06:00:00.000Z', status: null, canResume: true });
    at('2026-11-24T06:15:00.000Z');
    const resumed = await post(agent, '/attendance/resume').expect(201);
    expect(resumed.body).toMatchObject({ status: 'start_of_day', statusSince: '2026-11-24T06:15:00.000Z' });

    // A day closed by a senior (or the clean-up) stays closed when the person signs in.
    const other = await agentOf(lead, 'SIS');
    await signIn(other);
    const day = await dayOf(other);
    await prisma.attendanceSegment.updateMany({ where: { dayId: day!.id }, data: { endedAt: new Date('2026-11-24T04:05:00.000Z') } });
    await prisma.attendanceDay.update({ where: { id: day!.id }, data: { logoutAt: new Date('2026-11-24T04:05:00.000Z'), closedReason: 'auto_closed_no_logout', dayType: 'full', dayTypeChangedAt: new Date('2026-11-24T04:06:00.000Z'), dayTypeChangedById: lead.id } });
    at('2026-11-24T05:00:00.000Z');
    await signIn(other);
    expect((await dayOf(other))?.logoutAt?.toISOString()).toBe('2026-11-24T04:05:00.000Z');
    expect((await today(other).expect(200)).body.status).toBeNull();
  });

  it('field agents: the location sent with the sign-in is kept; without one Laboura Field saves it next', async () => {
    const withGps = await agentOf(lead, 'SFA', 'field_agent');
    await signIn(withGps, { latitude: 12.97, longitude: 77.59 });
    expect(await dayOf(withGps)).toMatchObject({ loginLat: 12.97, loginLng: 77.59 });
    expect((await today(withGps).expect(200)).body).toMatchObject({ status: 'start_of_day', locationSaved: true });

    const noGps = await agentOf(lead, 'SFB', 'field_agent');
    await signIn(noGps);
    expect((await today(noGps).expect(200)).body).toMatchObject({ status: 'start_of_day', locationSaved: false });
    // Asking again without a location is not an error on an open day.
    await post(noGps, '/attendance/login').expect(201);
    const saved = await post(noGps, '/attendance/login', { latitude: 12.93, longitude: 77.62 }).expect(201);
    expect(saved.body).toMatchObject({ status: 'start_of_day', locationSaved: true });
    expect(await dayOf(noGps)).toMatchObject({ loginLat: 12.93, loginLng: 77.62 });
    // A call agent's answer carries no location field.
    const agent = await agentOf(lead, 'SFC');
    await signIn(agent);
    expect((await today(agent).expect(200)).body.locationSaved).toBeUndefined();
  });

  it('a sign-in made today whose day did not open opens it when the app asks for today; never for an older sign-in', async () => {
    const agent = await agentOf(lead, 'SIY');
    const base = { tokenHash: null, app: 'office', deviceId: null, ipAddress: null, userAgent: null, expiresAt: new Date('2026-11-24T12:00:00.000Z'), absoluteExpiresAt: new Date('2026-11-24T12:00:00.000Z') };
    const old = await prisma.staffSession.create({
      data: { ...base, staffId: agent.id, lastActivityAt: new Date('2026-11-23T15:00:00.000Z'), createdAt: new Date('2026-11-23T15:00:00.000Z') },
    });
    expect((await attendance.todayForSelf(agent.id, old.id)).status).toBeNull();
    const fresh = await prisma.staffSession.create({
      data: { ...base, staffId: agent.id, lastActivityAt: new Date('2026-11-24T03:50:00.000Z'), createdAt: new Date('2026-11-24T03:50:00.000Z') },
    });
    const opened = await attendance.todayForSelf(agent.id, fresh.id);
    expect(opened).toMatchObject({ status: 'start_of_day', loginAt: '2026-11-24T04:00:00.000Z' });
    // Someone else's session opens nothing.
    const stranger = await agentOf(lead, 'SIZ');
    expect((await attendance.todayForSelf(stranger.id, fresh.id)).status).toBeNull();
  });

  it('Start of day is unproductive, shown on its own; nobody in it gets calls, missed calls or leads', async () => {
    const waiting = await agentOf(lead, 'SUW');
    const active = await agentOf(lead, 'SUA');
    await signIn(waiting);
    await signIn(active);
    await post(active, '/attendance/status', { status: 'available' }).expect(201);
    at('2026-11-24T04:05:00.000Z');
    expect(await attendance.isAvailable(waiting.id)).toBe(false);
    expect(await attendance.isAvailable(active.id)).toBe(true);
    const policy = await app.get(PricingService).current();
    const now = new Date('2026-11-24T04:05:00.000Z');
    expect(await onShiftCallAgents(prisma, now, [waiting.id, active.id], policy)).toEqual([active.id]);
    const leads = (await loadLeadAgents(prisma, now, policy)).filter((row) => [waiting.id, active.id].includes(row.id));
    expect(leads.find((row) => row.id === waiting.id)?.onShift).toBe(false);
    expect(leads.find((row) => row.id === active.id)?.onShift).toBe(true);

    at('2026-11-24T04:20:00.000Z');
    await post(waiting, '/attendance/status', { status: 'available' }).expect(201);
    at('2026-11-24T04:30:00.000Z');
    const view = (await today(waiting).expect(200)).body;
    expect(view).toMatchObject({ status: 'available', startOfDaySeconds: 20 * 60, productionSeconds: 10 * 60, breakSeconds: 0, idleSeconds: 0 });
    expect(view.segments.map((s: { status: string }) => s.status)).toEqual(['start_of_day', 'available']);
    // The live board and the reports carry it with its own name.
    const board = (await http().get('/attendance/live').set('Authorization', `Bearer ${tokenFor(lead)}`).expect(200)).body;
    expect(board.people.find((row: { staff: { id: string } }) => row.staff.id === waiting.id)).toMatchObject({ startOfDaySeconds: 20 * 60, status: 'available' });
    at('2026-11-24T13:30:00.000Z');
    await post(waiting, '/attendance/logout').expect(201);
    expect(await dayOf(waiting)).toMatchObject({ startOfDaySeconds: 20 * 60 });
    const month = (await http().get('/attendance/month').query({ month: '2026-11', staffId: waiting.id }).set('Authorization', `Bearer ${tokenFor(lead)}`).expect(200)).body;
    expect(month.startOfDaySeconds).toBe(20 * 60);
    expect(month.days[0].startOfDaySeconds).toBe(20 * 60);
    const report = (await http().get('/attendance/report').query({ staffId: waiting.id, from: '2026-11-24', to: '2026-11-24' }).set('Authorization', `Bearer ${tokenFor(lead)}`).expect(200)).body;
    expect(report.days[0].startOfDaySeconds).toBe(20 * 60);
    expect(report.totals.startOfDaySeconds).toBe(20 * 60);
  });

  it('more than 15 minutes in Start of day rings the Team Lead (the Manager for a Team Lead), once a day, cleared when they pick a status', async () => {
    const agent = await agentOf(lead, 'SBA');
    const tl = await make('team_lead', 'SBT', { reportsToId: manager.id });
    await signIn(agent);
    await signIn(tl);
    await bells.syncStartOfDay(new Date('2026-11-24T04:10:00.000Z'));
    const agentDay = await dayOf(agent);
    const tlDay = await dayOf(tl);
    const bellsFor = (dayId: string) => prisma.notification.findMany({ where: { kind: 'start_of_day_long', subjectId: dayId } });
    expect(await bellsFor(agentDay!.id)).toHaveLength(0);

    await bells.syncStartOfDay(new Date('2026-11-24T04:16:00.000Z'));
    const first = await bellsFor(agentDay!.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ recipientStaffId: lead.id, clearedAt: null, link: '/team-lead/attendance/live' });
    expect(first[0].title).toContain('still in Start of day');
    const tlBells = await bellsFor(tlDay!.id);
    expect(tlBells).toHaveLength(1);
    expect(tlBells[0].recipientStaffId).toBe(manager.id);

    // Picking a status clears it at once.
    at('2026-11-24T04:20:00.000Z');
    await post(agent, '/attendance/status', { status: 'team_meeting' }).expect(201);
    const cleared = await bellsFor(agentDay!.id);
    expect(cleared[0]).toMatchObject({ clearedReason: 'start_of_day_ended' });
    expect(cleared[0].clearedAt).not.toBeNull();

    // Back in Start of day the same day (Resume): no second bell.
    at('2026-11-24T05:00:00.000Z');
    await post(agent, '/attendance/logout').expect(201);
    at('2026-11-24T05:05:00.000Z');
    await post(agent, '/attendance/resume').expect(201);
    await bells.syncStartOfDay(new Date('2026-11-24T05:30:00.000Z'));
    expect(await bellsFor(agentDay!.id)).toHaveLength(1);
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from './attendance-clock';
import { AttendanceService, idleDeadline } from './attendance.service';
import { shouldNote } from './attendance-activity.interceptor';
import { lateMinutesFor } from './day-rules';
import { onShiftAt, shiftEndOn, shiftFor, shiftProblem, withShift } from './staff-shift';

jest.setTimeout(120000);

/**
 * Call agent and field agent fixes, decided 21 Nov (Master Guide rev 202):
 * own shifts, presence and "Still there?", the clean-up only closing earlier
 * days, Resume my day, a Team Lead's Reopen, saved work counting as activity.
 */
const shared = { at: new Date('2026-11-24T04:00:00.000Z') };

class TestClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

describe('Attendance fixes (21 Nov): own shifts, idle, closing and reopening days', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let attendance: AttendanceService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  let ceo: { id: string; role: string; code: string };
  let manager: { id: string; role: string; code: string };
  let lead: { id: string; role: string; code: string };
  let otherLead: { id: string; role: string; code: string };

  const at = (iso: string) => {
    shared.at = new Date(iso);
  };
  const tokenFor = (staff: { id: string; role: string; code: string }) =>
    jwt.sign({ sub: staff.id, email: `${staff.id}@laboura.local`, role: staff.role, code: staff.code });

  async function make(role: string, prefix: string, extra: Record<string, unknown> = {}) {
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} person`,
        passwordHash: 'hash',
        role,
        status: 'active',
        ...extra,
      },
    });
    staffIds.push(row.id);
    return row;
  }
  const agentOf = (teamLead: { id: string }, prefix = 'AG', extra: Record<string, unknown> = {}) =>
    make('call_agent', prefix, { teamLeadId: teamLead.id, reportsToId: teamLead.id, ...extra });

  const http = () => request(app.getHttpServer());
  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    http().post(path).set('Authorization', `Bearer ${token}`).send(body);
  const today = (token: string) => http().get('/attendance/today').set('Authorization', `Bearer ${token}`);

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
    ceo = await make('ceo', 'ACEO');
    manager = await make('manager', 'AMGR', { reportsToId: ceo.id });
    lead = await make('team_lead', 'ATL', { reportsToId: manager.id });
    otherLead = await make('team_lead', 'ATL2', { reportsToId: ceo.id });
  });

  beforeEach(() => at('2026-11-24T04:00:00.000Z'));

  afterAll(async () => {
    await prisma.attendanceSegment.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: staffIds } } });
    await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  describe('own shifts', () => {
    it('shift helpers: own shift or the company shift, validation, lateness from the own shift', () => {
      const policy = { shiftStart: '09:30', shiftEnd: '18:30', lateGraceMinutes: 10 };
      expect(shiftFor(null, policy)).toEqual({ start: '09:30', end: '18:30', own: false });
      expect(shiftFor({ shiftStart: '13:00', shiftEnd: null }, policy)).toEqual({ start: '09:30', end: '18:30', own: false });
      const own = shiftFor({ shiftStart: '12:00', shiftEnd: '21:00' }, policy);
      expect(own).toEqual({ start: '12:00', end: '21:00', own: true });
      expect(shiftProblem('12:00', '21:00')).toBeNull();
      expect(shiftProblem('21:00', '12:00')).toMatch(/end after/);
      expect(shiftProblem('9:30', '18:30')).toMatch(/HH:MM/);
      expect(shiftProblem('09:00', '09:30')).toMatch(/between 1 and 14/);
      expect(shiftProblem('06:00', '21:00')).toMatch(/between 1 and 14/);
      // 12:05 IST is on time for a 12:00 shift, 12:25 IST is 25 minutes late.
      expect(lateMinutesFor(new Date('2026-11-24T06:35:00.000Z'), withShift(policy, own))).toBe(0);
      expect(lateMinutesFor(new Date('2026-11-24T06:55:00.000Z'), withShift(policy, own))).toBe(25);
      // The same login is late on the company shift.
      expect(lateMinutesFor(new Date('2026-11-24T06:35:00.000Z'), policy)).toBe(155);
      expect(shiftEndOn(new Date('2026-11-24T06:35:00.000Z'), own).toISOString()).toBe('2026-11-24T15:30:00.000Z');
      expect(onShiftAt(new Date('2026-11-24T06:35:00.000Z'), own)).toBe(true);
      expect(onShiftAt(new Date('2026-11-24T05:00:00.000Z'), own)).toBe(false);
    });

    it('the Team Lead sets a team agent\'s shift; lateness and the screens follow it; others are refused', async () => {
      const agent = await agentOf(lead, 'SHA');
      const tl = tokenFor(lead);
      // A Team Lead of another team, the agent himself and a bad time are refused.
      await http().put(`/attendance/shifts/${agent.id}`).set('Authorization', `Bearer ${tokenFor(otherLead)}`).send({ shiftStart: '12:00', shiftEnd: '21:00' }).expect(403);
      await http().put(`/attendance/shifts/${agent.id}`).set('Authorization', `Bearer ${tokenFor(agent)}`).send({ shiftStart: '12:00', shiftEnd: '21:00' }).expect(403);
      await http().put(`/attendance/shifts/${agent.id}`).set('Authorization', `Bearer ${tl}`).send({ shiftStart: '21:00', shiftEnd: '12:00' }).expect(400);

      const set = await http().put(`/attendance/shifts/${agent.id}`).set('Authorization', `Bearer ${tl}`).send({ shiftStart: '12:00', shiftEnd: '21:00', reason: 'Evening cover' }).expect(200);
      expect(set.body).toMatchObject({ staffId: agent.id, shiftStart: '12:00', shiftEnd: '21:00', own: true });
      const audit = await prisma.auditLog.findFirst({ where: { actorId: lead.id, action: 'staff.shift_changed', entityCode: agent.code } });
      expect(audit?.before).toEqual({ shiftStart: null, shiftEnd: null });
      expect(audit?.after).toEqual({ shiftStart: '12:00', shiftEnd: '21:00' });

      // The Manager over the team and the CEO see it in their list; the other Team Lead does not.
      const mine = await http().get('/attendance/shifts').set('Authorization', `Bearer ${tl}`).expect(200);
      expect(mine.body.companyShift).toEqual({ start: '09:30', end: '18:30' });
      expect(mine.body.people.find((p: { staffId: string }) => p.staffId === agent.id)).toMatchObject({ shiftStart: '12:00', own: true });
      const mgr = await http().get('/attendance/shifts').set('Authorization', `Bearer ${tokenFor(manager)}`).expect(200);
      expect(mgr.body.people.some((p: { staffId: string }) => p.staffId === agent.id)).toBe(true);
      const other = await http().get('/attendance/shifts').set('Authorization', `Bearer ${tokenFor(otherLead)}`).expect(200);
      expect(other.body.people.some((p: { staffId: string }) => p.staffId === agent.id)).toBe(false);
      await http().get('/attendance/shifts').set('Authorization', `Bearer ${tokenFor(agent)}`).expect(403);

      // Before login the screens show the own shift; a 12:05 IST login is on time.
      const token = tokenFor(agent);
      const before = await today(token).expect(200);
      expect(before.body.clocks).toMatchObject({ shiftStart: '12:00', shiftEnd: '21:00' });
      expect(before.body.ownShift).toBe(true);
      at('2026-11-24T06:35:00.000Z');
      const started = await post(token, '/attendance/login').expect(201);
      expect(started.body.lateMinutes).toBe(0);

      // Cleared: back to the company shift.
      const cleared = await http().put(`/attendance/shifts/${agent.id}`).set('Authorization', `Bearer ${tokenFor(manager)}`).send({ shiftStart: null, shiftEnd: null }).expect(200);
      expect(cleared.body).toMatchObject({ shiftStart: '09:30', shiftEnd: '18:30', own: false });
    });

    it('an agent without an own shift is late from the company shift', async () => {
      const agent = await agentOf(lead, 'SHB');
      at('2026-11-24T04:30:00.000Z'); // 10:00 IST
      const started = await post(tokenFor(agent), '/attendance/login').expect(201);
      expect(started.body.lateMinutes).toBe(30);
      expect(started.body.ownShift).toBe(false);
    });
  });

  describe('present and "Still there?"', () => {
    it('idle deadline: away after 10 + 1 minutes without any heartbeat, quiet after the setting + 1 without a click', () => {
      const since = new Date('2026-11-24T04:00:00.000Z');
      const plus = (m: number) => new Date(since.getTime() + m * 60_000);
      // Nothing heard: away first.
      expect(idleDeadline({ lastHeartbeatAt: null, lastActiveAt: null }, since, 30)).toEqual(plus(11));
      // Present (heartbeats) but no click: "Still there?" after 30, Idle after 31.
      expect(idleDeadline({ lastHeartbeatAt: plus(29), lastActiveAt: since }, since, 30)).toEqual(plus(31));
      // The CEO set 45.
      expect(idleDeadline({ lastHeartbeatAt: plus(44), lastActiveAt: since }, since, 45)).toEqual(plus(46));
      // Old rows with no lastActiveAt count from the last heartbeat.
      expect(idleDeadline({ lastHeartbeatAt: plus(5), lastActiveAt: null }, since, 30)).toEqual(plus(16));
    });

    it('an open, visible console keeps an agent Available past 11 minutes; 30 quiet minutes make him Idle; a click brings him back, presence does not', async () => {
      const agent = await agentOf(lead, 'IDL');
      const token = tokenFor(agent);
      at('2026-11-24T04:00:00.000Z');
      await post(token, '/attendance/login').expect(201);
      for (const minute of [5, 10, 15, 20, 25, 29]) {
        at(new Date(Date.parse('2026-11-24T04:00:00.000Z') + minute * 60_000).toISOString());
        const beat = await post(token, '/attendance/heartbeat', { kind: 'presence' }).expect(201);
        expect(beat.body.status).toBe('available');
      }
      at('2026-11-24T04:30:30.000Z');
      expect((await today(token)).body.status).toBe('available');
      at('2026-11-24T04:31:30.000Z');
      await post(token, '/attendance/heartbeat', { kind: 'presence' }).expect(201);
      const idle = await today(token).expect(200);
      expect(idle.body.status).toBe('idle');
      // Presence alone does not end Idle …
      at('2026-11-24T04:33:00.000Z');
      expect((await post(token, '/attendance/heartbeat', { kind: 'presence' }).expect(201)).body.status).toBe('idle');
      // … a click does (the old body-less heartbeat is a click too).
      expect((await post(token, '/attendance/heartbeat').expect(201)).body.status).toBe('available');
    });

    it('a closed console (no heartbeat at all) is Idle after 11 minutes', async () => {
      const agent = await agentOf(lead, 'IDC');
      const token = tokenFor(agent);
      await post(token, '/attendance/login').expect(201);
      at('2026-11-24T04:10:30.000Z');
      expect((await today(token)).body.status).toBe('available');
      at('2026-11-24T04:11:30.000Z');
      expect((await today(token)).body.status).toBe('idle');
    });

    it('saved work counts as activity: Idle ends and the quiet clock starts again (Field interviews, registrations, selections)', async () => {
      const agent = await make('field_agent', 'FAW', { teamLeadId: lead.id, reportsToId: lead.id });
      await post(tokenFor(agent), '/attendance/login', { latitude: 12.9, longitude: 77.6 }).expect(201);
      at('2026-11-24T04:12:00.000Z');
      expect((await today(tokenFor(agent))).body.status).toBe('idle');
      await attendance.noteActivity(agent.id);
      const back = await today(tokenFor(agent));
      expect(back.body.status).toBe('available');
      const day = await prisma.attendanceDay.findFirstOrThrow({ where: { staffId: agent.id } });
      expect(day.lastActiveAt?.toISOString()).toBe('2026-11-24T04:12:00.000Z');
      // Which requests count: a signed-in person's own writes, not reads, not attendance or sign-in calls.
      const user = { sub: agent.id, role: 'field_agent' };
      expect(shouldNote({ method: 'POST', path: '/field-selling/interviews/x/arrived', user })).toBe(agent.id);
      expect(shouldNote({ method: 'POST', path: '/job-seekers', user })).toBe(agent.id);
      expect(shouldNote({ method: 'GET', path: '/job-seekers', user })).toBeNull();
      expect(shouldNote({ method: 'POST', path: '/attendance/heartbeat', user })).toBeNull();
      expect(shouldNote({ method: 'POST', path: '/auth/logout', user })).toBeNull();
      expect(shouldNote({ method: 'POST', path: '/job-seekers', user: { sub: 'x', role: 'ceo' } })).toBeNull();
      expect(shouldNote({ method: 'POST', path: '/job-seekers' })).toBeNull();
    });
  });

  describe('calls during a visit (Builder C request, 21 Nov)', () => {
    async function fieldAgentOnDay(prefix: string) {
      const agent = await make('field_agent', prefix, { teamLeadId: lead.id, reportsToId: lead.id });
      await post(tokenFor(agent), '/attendance/login', { latitude: 12.9, longitude: 77.6 }).expect(201);
      return agent;
    }
    const status = async (staff: { id: string; role: string; code: string }) => (await today(tokenFor(staff))).body.status as string;

    it('a call at the shop ends back On visit, a call while travelling back Travelling — not Available', async () => {
      const agent = await fieldAgentOnDay('CV1');
      await attendance.noteBusinessCheckIn(agent.id);
      at('2026-11-24T04:05:00.000Z');
      await attendance.onCallAnswered(agent.id);
      expect(await status(agent)).toBe('on_call');
      at('2026-11-24T04:06:00.000Z');
      await attendance.onCallEnded(agent.id);
      expect(await status(agent)).toBe('on_visit');

      await attendance.noteBusinessCheckOut(agent.id);
      at('2026-11-24T04:10:00.000Z');
      await attendance.onCallAnswered(agent.id);
      at('2026-11-24T04:11:00.000Z');
      await attendance.onCallEnded(agent.id);
      expect(await status(agent)).toBe('travelling');
      // An answered-and-ended event in one go during a visit leaves the visit as it is.
      await attendance.noteBusinessCheckIn(agent.id);
      await attendance.onCallEnded(agent.id);
      expect(await status(agent)).toBe('on_visit');
    });

    it('a call agent still gets 2 minutes of After-call notes, then Available', async () => {
      const agent = await agentOf(lead, 'CV2');
      await post(tokenFor(agent), '/attendance/login').expect(201);
      at('2026-11-24T04:05:00.000Z');
      await attendance.onCallAnswered(agent.id);
      at('2026-11-24T04:06:00.000Z');
      await attendance.onCallEnded(agent.id);
      expect(await status(agent)).toBe('after_call_notes');
      at('2026-11-24T04:08:30.000Z');
      expect(await status(agent)).toBe('available');
    });

    it('On call never sticks: with no call record keeping it open (mock telephony, a lost end event) it ends after 2 minutes', async () => {
      const agent = await fieldAgentOnDay('CV3');
      await attendance.noteBusinessCheckIn(agent.id);
      at('2026-11-24T04:05:00.000Z');
      await attendance.onCallAnswered(agent.id);
      at('2026-11-24T04:06:00.000Z');
      expect(await status(agent)).toBe('on_call');
      at('2026-11-24T04:08:00.000Z');
      expect(await status(agent)).toBe('on_visit');

      const caller = await agentOf(lead, 'CV4');
      await post(tokenFor(caller), '/attendance/login').expect(201);
      at('2026-11-24T04:20:00.000Z');
      await attendance.onCallAnswered(caller.id);
      at('2026-11-24T04:23:00.000Z');
      expect(await status(caller)).toBe('after_call_notes');
      at('2026-11-24T04:26:00.000Z');
      expect(await status(caller)).toBe('available');
    });
  });

  describe('closing and reopening days', () => {
    it('the forgotten-logout clean-up closes only earlier days, never today\'s', async () => {
      const agent = await agentOf(lead, 'FGT');
      await post(tokenFor(agent), '/attendance/login').expect(201);
      at('2026-11-24T10:00:00.000Z');
      expect(await attendance.closeForgottenDays(agent.id)).toEqual({ closed: 0 });
      expect((await today(tokenFor(agent))).body.logoutAt).toBeNull();
      at('2026-11-25T00:00:00.000Z');
      expect(await attendance.closeForgottenDays(agent.id)).toEqual({ closed: 1 });
    });

    it('Resume my day after a Log out by mistake: the same day, recorded, the gap not counted', async () => {
      const agent = await agentOf(lead, 'RES');
      const token = tokenFor(agent);
      // Before Log in there is nothing to resume.
      expect((await post(token, '/attendance/resume')).status).toBe(400);
      await post(token, '/attendance/login').expect(201);
      at('2026-11-24T06:00:00.000Z');
      const ended = await post(token, '/attendance/logout').expect(201);
      expect(ended.body.canResume).toBe(true);
      // Log in again answers with Resume my day.
      const again = await post(token, '/attendance/login');
      expect(again.status).toBe(400);
      expect(JSON.stringify(again.body)).toContain('Resume my day');

      at('2026-11-24T06:20:00.000Z');
      const resumed = await post(token, '/attendance/resume').expect(201);
      expect(resumed.body).toMatchObject({ logoutAt: null, status: 'available', canResume: false, flagged: false, dayType: 'open' });
      // 2 hours worked before; the 20 minutes in between are not production.
      at('2026-11-24T06:30:00.000Z');
      const later = await today(token).expect(200);
      expect(later.body.productionSeconds).toBe(2 * 3600 + 10 * 60);
      const audit = await prisma.auditLog.findFirst({ where: { actorId: agent.id, action: 'attendance.day_resumed' } });
      expect(audit?.before).toMatchObject({ closedReason: 'logout' });
      // Resuming an open day just shows it.
      await post(token, '/attendance/resume').expect(201);
    });

    it('a day closed by the night clean-up cannot be resumed (it is yesterday\'s); the new day starts with Log in', async () => {
      const agent = await agentOf(lead, 'RNC');
      const token = tokenFor(agent);
      await post(token, '/attendance/login').expect(201);
      at('2026-11-25T00:00:00.000Z');
      await attendance.closeForgottenDays(agent.id);
      at('2026-11-25T04:00:00.000Z');
      const res = await post(token, '/attendance/resume');
      expect(res.status).toBe(400);
      await post(token, '/attendance/login').expect(201);
    });

    it('the Team Lead reopens today\'s closed day with a reason; others and earlier days are refused', async () => {
      const agent = await agentOf(lead, 'REO');
      const token = tokenFor(agent);
      await post(token, '/attendance/login').expect(201);
      at('2026-11-24T05:00:00.000Z');
      await post(token, '/attendance/logout').expect(201);
      const day = await prisma.attendanceDay.findFirstOrThrow({ where: { staffId: agent.id } });

      await post(tokenFor(lead), `/attendance/days/${day.id}/reopen`, {}).expect(400);
      await post(tokenFor(otherLead), `/attendance/days/${day.id}/reopen`, { reason: 'Logged out by mistake' }).expect(403);
      await post(token, `/attendance/days/${day.id}/reopen`, { reason: 'mine' }).expect(403);
      at('2026-11-24T05:10:00.000Z');
      await post(tokenFor(lead), `/attendance/days/${day.id}/reopen`, { reason: 'Logged out by mistake' }).expect(201);
      expect((await today(token)).body).toMatchObject({ logoutAt: null, status: 'available' });
      const audit = await prisma.auditLog.findFirst({ where: { actorId: lead.id, action: 'attendance.day_reopened' } });
      expect(audit?.reason).toBe('Logged out by mistake');
      // Still open: nothing to reopen.
      await post(tokenFor(lead), `/attendance/days/${day.id}/reopen`, { reason: 'again' }).expect(400);

      // Yesterday's day: a correction, not Reopen.
      at('2026-11-24T06:00:00.000Z');
      await post(token, '/attendance/logout').expect(201);
      at('2026-11-25T05:00:00.000Z');
      await post(tokenFor(manager), `/attendance/days/${day.id}/reopen`, { reason: 'late' }).expect(400);
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthClock, AuthService } from './auth.service';
import { applyTrustProxy } from '../http/trust-proxy';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';
import { Clock as LoginCodeClock, LoginCodeService } from '../../modules/login-code/login-code.service';
import { AttendanceClock } from '../../modules/attendance/attendance-clock';
import { NotificationClock } from '../../modules/notification/notification-clock';
import { SessionDayService } from './session-day.service';
import { StaffDeviceService } from '../../modules/staff/staff-device.service';
import { SignInBellsService } from '../../modules/login-code/sign-in-bells.service';

/**
 * Staying signed in (Master Guide rev 202, decided 21 Nov): the login code is
 * needed once, at the first sign-in of the day; after that the person stays
 * signed in on that approved device for the whole working day — no 2-hour or
 * 1-hour-idle sign-out while the attendance day is open — up to a safety cap
 * of the end of their own shift + 2 hours. Team Leads (and the Manager above)
 * get a bell for every login-code and new-device request.
 */
describe('Day-long sessions, a login code once a day, sign-in bells (21 Nov)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // Tue 24 Nov 2026, 09:00 IST.
  const start = new Date('2026-11-24T03:30:00.000Z');
  let now = start;
  const clock = { now: () => now };
  const password = 'Day-Long-Password-1';
  const createdIds: string[] = [];
  let counter = 0;
  let ip = 0;
  const freshIp = () => `10.77.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
  const plus = (minutes: number, from = start) => new Date(from.getTime() + minutes * 60 * 1000);
  let ceo: { id: string };
  let manager: { id: string };
  let lead: { id: string; code: string };

  async function person(role: string, extra: Record<string, unknown> = {}) {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `DL-${role.slice(0, 3).toUpperCase()}-${Date.now()}-${counter}`,
        name: `Day ${role} ${counter}`,
        passwordHash: await bcrypt.hash(password, 4),
        role,
        status: 'active',
        ...extra,
      },
    });
    createdIds.push(staff.id);
    return staff;
  }

  async function agent(role = 'call_agent', extra: Record<string, unknown> = {}) {
    const staff = await person(role, { teamLeadId: lead.id, reportsToId: lead.id, ...extra });
    const deviceId = `dl-device-${staff.id}`;
    await prisma.staffDevice.create({
      data: { staffId: staff.id, deviceId, label: 'Laptop', platform: 'web', status: 'approved', approvedAt: plus(-60 * 24 * 3) },
    });
    return { staff, deviceId };
  }

  const http = () => request(app.getHttpServer());

  async function signIn(code: string, deviceId: string, app?: 'field' | 'office') {
    return http().post('/auth/login').set('X-Forwarded-For', freshIp()).send({ staffCode: code, password, deviceId, ...(app ? { app } : {}) });
  }

  async function signInWithCode(code: string, deviceId: string, app?: 'field' | 'office') {
    const waiting = await signIn(code, deviceId, app);
    expect(waiting.body.status).toBe('awaiting_code');
    const res = await http()
      .post('/auth/login/verify-code')
      .set('X-Forwarded-For', freshIp())
      .send({
        loginRequestId: waiting.body.loginRequestId,
        code: loginCodeFor(waiting.body.loginRequestId),
        deviceId,
        loginRequestProof: waiting.body.loginRequestProof,
        ...(app ? { app } : {}),
      });
    expect(res.status).toBe(200);
    return res.body as { accessToken: string; sessionId: string; refreshToken: string };
  }

  const today = (token: string) => http().get('/attendance/today').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthClock)
      .useValue(clock)
      .overrideProvider(AttendanceClock)
      .useValue(clock)
      .overrideProvider(LoginCodeClock)
      .useValue(clock)
      .overrideProvider(NotificationClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    ceo = await person('ceo');
    manager = await person('manager', { reportsToId: ceo.id });
    lead = await person('team_lead', { reportsToId: manager.id });
  });

  beforeEach(() => {
    now = start;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: createdIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.staff.updateMany({ where: { id: { in: createdIds } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await app.close();
  });

  it('stays signed in past 2 hours and 1 hour idle while the attendance day is open; Log out brings the old limits back', async () => {
    const { staff, deviceId } = await agent();
    const s = await signInWithCode(staff.code, deviceId);
    await http().post('/attendance/login').set('Authorization', `Bearer ${s.accessToken}`).send({}).expect(201);

    // 3 hours after sign-in (past the 2-hour limit) …
    now = plus(180);
    await today(s.accessToken).expect(200);
    // … and 70 quiet minutes later (past the 1-hour idle limit): still signed in.
    now = plus(250);
    await today(s.accessToken).expect(200);

    // Log out ends the day: the old limits apply again, so the 2-hour limit has passed.
    await http().post('/attendance/logout').set('Authorization', `Bearer ${s.accessToken}`).expect(201);
    const after = await today(s.accessToken);
    expect(after.status).toBe(401);
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(row.endedReason).toBe('max_length');
  });

  it('a session that never opened the attendance day still ends after 2 hours', async () => {
    const { staff, deviceId } = await agent();
    const s = await signInWithCode(staff.code, deviceId);
    now = plus(121);
    expect((await today(s.accessToken)).status).toBe(401);
  });

  it('hard safety cap: the end of the person\'s own shift + 2 hours, even with the day open', async () => {
    const { staff, deviceId } = await agent();
    const s = await signInWithCode(staff.code, deviceId);
    await http().post('/attendance/login').set('Authorization', `Bearer ${s.accessToken}`).send({}).expect(201);
    // Company shift ends 18:30 IST = 13:00 UTC; cap 20:30 IST.
    now = new Date('2026-11-24T14:59:00.000Z');
    await today(s.accessToken).expect(200);
    now = new Date('2026-11-24T15:01:00.000Z');
    expect((await today(s.accessToken)).status).toBe(401);

    // An own shift to 20:00 IST moves the cap to 22:00 IST (16:30 UTC).
    const late = await agent('call_agent', { shiftStart: '11:00', shiftEnd: '20:00' });
    now = new Date('2026-11-24T05:30:00.000Z');
    const t = await signInWithCode(late.staff.code, late.deviceId);
    await http().post('/attendance/login').set('Authorization', `Bearer ${t.accessToken}`).send({}).expect(201);
    now = new Date('2026-11-24T16:29:00.000Z');
    await today(t.accessToken).expect(200);
    now = new Date('2026-11-24T16:31:00.000Z');
    expect((await today(t.accessToken)).status).toBe(401);
  });

  it('the login code is needed once a day per approved device; a password change, lock or new day asks again', async () => {
    const { staff, deviceId } = await agent();
    await signInWithCode(staff.code, deviceId);

    // Later the same day, same device: the password is enough.
    now = plus(240);
    const again = await signIn(staff.code, deviceId);
    expect(again.status).toBe(200);
    if (!again.body.accessToken) throw new Error(JSON.stringify(again.body));
    expect(again.body.accessToken).toEqual(expect.any(String));
    expect(again.body.status).toBeUndefined();
    const audit = await prisma.auditLog.findFirst({
      where: { actorId: staff.id, action: 'auth.login.succeeded' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.after).toMatchObject({ withoutCode: 'code_accepted_earlier_today' });

    // Another approved device still needs its own code.
    const other = `dl-other-${staff.id}`;
    await prisma.staffDevice.create({ data: { staffId: staff.id, deviceId: other, label: 'Phone', platform: 'web', status: 'approved', approvedAt: start } });
    expect((await signIn(staff.code, other)).body.status).toBe('awaiting_code');

    // The next day: a code again.
    now = plus(24 * 60);
    expect((await signIn(staff.code, deviceId)).body.status).toBe('awaiting_code');

    // Signed in with a code that day, then every session ended by a reset or lock: a code again.
    await signInWithCode(staff.code, deviceId);
    now = plus(24 * 60 + 30);
    await app.get(AuthService).revokeAllSessionsForStaff(staff.id);
    now = plus(24 * 60 + 31);
    expect((await signIn(staff.code, deviceId)).body.status).toBe('awaiting_code');
  });

  it('a device removed and approved again needs a new code', async () => {
    const { staff, deviceId } = await agent();
    await signInWithCode(staff.code, deviceId);
    now = plus(60);
    await prisma.staffDevice.update({
      where: { staffId_deviceId: { staffId: staff.id, deviceId } },
      data: { status: 'approved', approvedAt: now },
    });
    now = plus(61);
    expect((await signIn(staff.code, deviceId)).body.status).toBe('awaiting_code');
  });

  it('Laboura Field restores the session past 2 hours while the field agent\'s day is open', async () => {
    const { staff, deviceId } = await agent('field_agent');
    const s = await signInWithCode(staff.code, deviceId, 'field');
    await http()
      .post('/attendance/login')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ latitude: 12.9, longitude: 77.6 })
      .expect(201);
    now = plus(200);
    const res = await http()
      .post('/auth/field/refresh')
      .set('X-Forwarded-For', freshIp())
      .send({ sessionId: s.sessionId, refreshToken: s.refreshToken, deviceId });
    expect(res.status).toBe(200);
  });

  it('day rule details: approved device, open day, CEO by the IST day', async () => {
    const days = app.get(SessionDayService);
    const { staff, deviceId } = await agent();
    const session = { staffId: staff.id, deviceId, createdAt: start, lastActivityAt: start, absoluteExpiresAt: plus(120) };
    // No attendance day yet: the old rule.
    expect(await days.dayLongUntil(session, plus(150))).toBeNull();
    await prisma.attendanceDay.create({ data: { staffId: staff.id, date: new Date('2026-11-24T00:00:00.000Z'), loginAt: start, dayType: 'open' } });
    expect(await days.dayLongUntil(session, plus(150))).toEqual(new Date('2026-11-24T15:00:00.000Z'));
    expect(await days.endFor(session, plus(150))).toBeNull();
    // A device no longer approved: the old rule (the session ends).
    await prisma.staffDevice.update({ where: { staffId_deviceId: { staffId: staff.id, deviceId } }, data: { status: 'revoked' } });
    expect(await days.endFor(session, plus(150))).toBe('max_length');
    // A session without a device never gets the day rule.
    expect(await days.dayLongUntil({ ...session, deviceId: null }, plus(150))).toBeNull();

    // The CEO marks no attendance: his day is the IST day the session began.
    const ceoDevice = `dl-ceo-${ceo.id}`;
    await prisma.staffDevice.create({ data: { staffId: ceo.id, deviceId: ceoDevice, label: 'Laptop', platform: 'web', status: 'approved', approvedAt: start } });
    const ceoSession = { staffId: ceo.id, deviceId: ceoDevice, createdAt: start, lastActivityAt: start, absoluteExpiresAt: plus(120) };
    expect(await days.endFor(ceoSession, plus(300))).toBeNull();
    expect(await days.endFor(ceoSession, plus(24 * 60))).toBe('max_length');
  });

  it('Team Lead and Manager get a bell for a login-code request; it clears when the code is given', async () => {
    const { staff, deviceId } = await agent();
    const waiting = await signIn(staff.code, deviceId);
    expect(waiting.body.status).toBe('awaiting_code');
    const open = await prisma.notification.findMany({
      where: { kind: 'login_code_request', subjectId: waiting.body.loginRequestId, clearedAt: null },
    });
    expect(open.map((n) => n.recipientStaffId).sort()).toEqual([lead.id, manager.id].sort());
    expect(open.find((n) => n.recipientStaffId === lead.id)?.link).toBe('/team-lead/login-codes');
    for (const n of open) expect(`${n.title} ${n.body}`).not.toMatch(/\+91|\b[6-9]\d{9}\b/);

    await app.get(LoginCodeService).reveal(waiting.body.loginRequestId, { id: lead.id, role: 'team_lead' });
    const after = await prisma.notification.findMany({
      where: { kind: 'login_code_request', subjectId: waiting.body.loginRequestId },
    });
    expect(after.every((n) => n.clearedAt !== null)).toBe(true);
    expect(after.find((n) => n.recipientStaffId === lead.id)?.clearedByStaffId).toBe(lead.id);
  });

  it('a new device rings the Team Lead and Manager; approving clears it; the sweep clears expired code bells', async () => {
    const staff = await person('call_agent', { teamLeadId: lead.id, reportsToId: lead.id });
    const res = await signIn(staff.code, `dl-new-${staff.id}`);
    expect(res.status).toBe(401);
    const device = await prisma.staffDevice.findUniqueOrThrow({ where: { staffId_deviceId: { staffId: staff.id, deviceId: `dl-new-${staff.id}` } } });
    const open = await prisma.notification.findMany({ where: { kind: 'device_approval_request', subjectId: device.id, clearedAt: null } });
    expect(open.map((n) => n.recipientStaffId).sort()).toEqual([lead.id, manager.id].sort());
    await app.get(StaffDeviceService).approve(device.id, { id: lead.id, role: 'team_lead' });
    const after = await prisma.notification.findMany({ where: { kind: 'device_approval_request', subjectId: device.id } });
    expect(after.every((n) => n.clearedAt !== null)).toBe(true);

    // A code request nobody answered runs out: the sweep clears its bell.
    now = plus(5);
    const waiting = await signIn(staff.code, `dl-new-${staff.id}`);
    expect(waiting.body.status).toBe('awaiting_code');
    expect(await prisma.notification.count({ where: { kind: 'login_code_request', subjectId: waiting.body.loginRequestId, clearedAt: null } })).toBe(2);
    now = plus(5 + 60 * 3);
    await app.get(SignInBellsService).syncAll(now);
    expect(await prisma.notification.count({ where: { kind: 'login_code_request', subjectId: waiting.body.loginRequestId, clearedAt: null } })).toBe(0);
  });
});

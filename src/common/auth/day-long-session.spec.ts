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
import { LiveController } from '../live/live.controller';
import { JwtService } from '@nestjs/jwt';

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const FIREFOX_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

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

  async function signIn(code: string, deviceId: string, app?: 'field' | 'office', opts: { ip?: string; ua?: string; password?: string } = {}) {
    return http()
      .post('/auth/login')
      .set('X-Forwarded-For', opts.ip ?? freshIp())
      .set('User-Agent', opts.ua ?? CHROME_ANDROID)
      .send({ staffCode: code, password: opts.password ?? password, deviceId, ...(app ? { app } : {}) });
  }

  async function signInWithCode(code: string, deviceId: string, app?: 'field' | 'office', opts: { ip?: string; ua?: string } = {}) {
    const waiting = await signIn(code, deviceId, app, opts);
    expect(waiting.body.status).toBe('awaiting_code');
    const res = await http()
      .post('/auth/login/verify-code')
      .set('X-Forwarded-For', opts.ip ?? freshIp())
      .set('User-Agent', opts.ua ?? CHROME_ANDROID)
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

  describe('hardening after the independent check (21 Nov)', () => {
    it('5 wrong passwords lock the account and the next sign-in needs a login code again', async () => {
      const { staff, deviceId } = await agent();
      await signInWithCode(staff.code, deviceId);
      now = plus(60);
      for (let i = 0; i < 5; i += 1) expect((await signIn(staff.code, deviceId, undefined, { password: 'Wrong-Password-9' })).status).toBe(401);
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).lockedUntil).toBeTruthy();
      now = plus(60 + 16);
      expect((await signIn(staff.code, deviceId)).body.status).toBe('awaiting_code');
    });

    it('the no-code shortcut needs the same browser or app family as the sign-in that had the code', async () => {
      const { staff, deviceId } = await agent();
      await signInWithCode(staff.code, deviceId, undefined, { ua: CHROME_ANDROID });
      now = plus(30);
      expect((await signIn(staff.code, deviceId, undefined, { ua: FIREFOX_WINDOWS })).body.status).toBe('awaiting_code');
      // A newer version of the same browser on the same platform is the same family.
      const newer = CHROME_ANDROID.replace('Chrome/131.0', 'Chrome/132.0');
      expect((await signIn(staff.code, deviceId, undefined, { ua: newer })).body.accessToken).toEqual(expect.any(String));
    });

    it('a no-code sign-in that ends a live session or comes from a new network rings the Team Lead and Manager and shows on Login codes', async () => {
      const { staff, deviceId } = await agent();
      const first = await signInWithCode(staff.code, deviceId, undefined, { ip: '10.9.9.1' });
      // Used for real a minute ago (not a background poll).
      now = plus(19);
      await http().get('/attendance/today').set('Authorization', `Bearer ${first.accessToken}`).expect(200);
      now = plus(20);
      // Same network, the first session still in use: it is ended — the seniors hear.
      const again = await signIn(staff.code, deviceId, undefined, { ip: '10.9.9.1' });
      expect(again.body.accessToken).toEqual(expect.any(String));
      const bells = await prisma.notification.findMany({ where: { kind: 'signed_in_without_code', subjectId: again.body.sessionId } });
      expect(bells.map((b) => b.recipientStaffId).sort()).toEqual([lead.id, manager.id].sort());
      expect(bells[0].title).toContain('ended the earlier session');
      expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: first.sessionId } })).endedReason).toBe('replaced');
      const leadToken = app.get(JwtService).sign({ sub: lead.id, role: 'team_lead', code: lead.code, email: null });
      const list = await http().get('/login-codes/without-code').set('Authorization', `Bearer ${leadToken}`).expect(200);
      expect(list.body.some((row: { title: string }) => row.title.includes(staff.code))).toBe(true);

      // Logged out first and the same network: no bell.
      await http().post('/auth/logout').set('Authorization', `Bearer ${again.body.accessToken}`).expect(200);
      now = plus(25);
      const quiet = await signIn(staff.code, deviceId, undefined, { ip: '10.9.9.1' });
      expect(await prisma.notification.count({ where: { kind: 'signed_in_without_code', subjectId: quiet.body.sessionId } })).toBe(0);

      // A network not seen today: a bell even with no live session.
      await http().post('/auth/logout').set('Authorization', `Bearer ${quiet.body.accessToken}`).expect(200);
      now = plus(30);
      const elsewhere = await signIn(staff.code, deviceId, undefined, { ip: '10.9.9.77' });
      const far = await prisma.notification.findMany({ where: { kind: 'signed_in_without_code', subjectId: elsewhere.body.sessionId } });
      expect(far).toHaveLength(2);
      expect(far[0].title).toContain('from a new network');
    });

    it('closing the browser and signing in again later on the same network and browser rings nobody', async () => {
      const { staff, deviceId } = await agent();
      await signInWithCode(staff.code, deviceId, undefined, { ip: '10.9.8.1' });
      // The tab was closed: the session is still open but nobody used it for 30 minutes.
      now = plus(30);
      const again = await signIn(staff.code, deviceId, undefined, { ip: '10.9.8.1' });
      expect(again.body.accessToken).toEqual(expect.any(String));
      expect(await prisma.notification.count({ where: { kind: 'signed_in_without_code', subjectId: again.body.sessionId } })).toBe(0);
    });

    it('a lost renewal answer on the same phone ends the session but keeps today\'s code; elsewhere it is a full revoke', async () => {
      const { staff, deviceId } = await agent();
      const s = await signInWithCode(staff.code, deviceId, undefined, { ua: CHROME_ANDROID });
      const renew = (refreshToken: string, ua: string) =>
        http().post('/auth/session/refresh').set('X-Forwarded-For', freshIp()).set('User-Agent', ua).send({ sessionId: s.sessionId, refreshToken, deviceId });
      now = plus(20);
      expect((await renew(s.refreshToken, CHROME_ANDROID)).status).toBe(200);
      // The answer never arrived; two minutes later the phone tries its old token again.
      now = plus(23);
      const lost = await renew(s.refreshToken, CHROME_ANDROID);
      expect(lost.status).toBe(401);
      expect(lost.body.reason ?? lost.body.details?.reason).toBe('expired');
      expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } })).endedReason).toBe('refresh_reused');
      // Password only: today's code still counts.
      const back = await signIn(staff.code, deviceId, undefined, { ua: CHROME_ANDROID });
      expect(back.body.accessToken).toEqual(expect.any(String));
    });

    it('a senior ending one session asks for a code again at the next sign-in', async () => {
      const { staff, deviceId } = await agent();
      const s = await signInWithCode(staff.code, deviceId);
      now = plus(10);
      await app.get(AuthService).revokeSession(s.sessionId, { sub: ceo.id, role: 'ceo' } as never);
      now = plus(11);
      expect((await signIn(staff.code, deviceId)).body.status).toBe('awaiting_code');
    });

    it('a refresh token used again: a second tab within a minute is refused softly, later reuse ends the session', async () => {
      const { staff, deviceId } = await agent();
      const s = await signInWithCode(staff.code, deviceId);
      const renew = (refreshToken: string) =>
        http().post('/auth/session/refresh').set('X-Forwarded-For', freshIp()).send({ sessionId: s.sessionId, refreshToken, deviceId });
      now = plus(20);
      const first = await renew(s.refreshToken);
      expect(first.status).toBe(200);
      const tab = await renew(s.refreshToken);
      expect(tab.status).toBe(401);
      expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } })).revokedAt).toBeNull();
      now = plus(23);
      const replay = await renew(s.refreshToken);
      expect(replay.status).toBe(401);
      const ended = await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } });
      expect(ended.endedReason).toBe('revoked');
      expect(await prisma.auditLog.count({ where: { action: 'auth.refresh_token_reused', entityCode: s.sessionId } })).toBe(1);
      // The newer token no longer works either, and the next sign-in needs a code.
      expect((await renew(first.body.refreshToken)).status).toBe(401);
      expect((await signIn(staff.code, deviceId)).body.status).toBe('awaiting_code');
    });

    it('the office refresh follows the day rule: past 2 hours while the day is open, refused after the cap', async () => {
      const { staff, deviceId } = await agent();
      const s = await signInWithCode(staff.code, deviceId);
      await http().post('/attendance/login').set('Authorization', `Bearer ${s.accessToken}`).send({}).expect(201);
      const renew = (refreshToken: string) =>
        http().post('/auth/session/refresh').set('X-Forwarded-For', freshIp()).send({ sessionId: s.sessionId, refreshToken, deviceId });
      now = plus(200);
      const ok = await renew(s.refreshToken);
      expect(ok.status).toBe(200);
      now = new Date('2026-11-24T15:01:00.000Z');
      const late = await renew(ok.body.refreshToken);
      expect(late.status).toBe(401);
      expect(late.body.reason ?? late.body.details?.reason).toBe('max_length');
    });

    it('the live stream follows the day rule too', async () => {
      const { staff, deviceId } = await agent();
      const s = await signInWithCode(staff.code, deviceId);
      await http().post('/attendance/login').set('Authorization', `Bearer ${s.accessToken}`).send({}).expect(201);
      const live = app.get(LiveController) as unknown as { sessionIsLive(staffId: string, sid?: string): Promise<boolean> };
      now = plus(200);
      expect(await live.sessionIsLive(staff.id, s.sessionId)).toBe(true);
      await prisma.attendanceDay.updateMany({ where: { staffId: staff.id }, data: { logoutAt: plus(199), dayType: 'full' } });
      expect(await live.sessionIsLive(staff.id, s.sessionId)).toBe(false);
    });

    it('background polls do not keep the idle clock alive: outside an open day the 1-hour idle sign-out works', async () => {
      const { staff, deviceId } = await agent();
      const s = await signInWithCode(staff.code, deviceId);
      const poll = (background: boolean) => {
        const req = http().get('/attendance/today').set('Authorization', `Bearer ${s.accessToken}`);
        return background ? req.set('X-Laboura-Background', '1') : req;
      };
      // Background polls and the token renewal every 14 minutes are not activity.
      for (const minute of [14, 28, 30, 42, 56]) {
        now = plus(minute);
        await poll(true).expect(200);
        if (minute % 14 === 0) await http().post('/auth/refresh').set('Authorization', `Bearer ${s.accessToken}`).expect(200);
      }
      expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } })).lastActivityAt.toISOString()).toBe(start.toISOString());
      now = plus(61);
      expect((await poll(true)).status).toBe(401);
      expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } })).endedReason).toBe('idle');

      // A request the person made (no background header) still counts.
      const t = (await signIn(staff.code, deviceId)).body as { accessToken: string };
      now = plus(91);
      await http().get('/attendance/today').set('Authorization', `Bearer ${t.accessToken}`).expect(200);
      now = plus(140);
      await http().get('/attendance/today').set('Authorization', `Bearer ${t.accessToken}`).expect(200);
    });
  });
});

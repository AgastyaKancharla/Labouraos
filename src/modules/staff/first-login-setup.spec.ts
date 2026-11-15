import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { AUTHENTICATOR_NOT_SET_UP, TEMP_PASSWORD_EXPIRED } from '../../common/auth/auth.service';
import { freshTotpWindow } from '../../test-support/enrolled-login-spec';
import { takeSetupSelfie } from '../../test-support/setup-selfie';
import { SETUP_REQUESTS_PER_IP_PER_MINUTE } from './staff-setup.controller';

function reasonOf(body: { reason?: string; details?: { reason?: string } }): string | undefined {
  return body.details?.reason ?? body.reason;
}
function messageOf(body: { message?: unknown }): string {
  return Array.isArray(body.message) ? body.message.join(' ') : String(body.message ?? '');
}

const TEMP_FORMAT = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 2, 3, 0xff, 0xd9]);

/**
 * Staff accounts and the first login (Master Guide rev 174–175, rules 1–5):
 * creating an account gives a temporary password shown once; signing in with
 * it gives no session, only a set-up ticket for that device (selfie, new
 * password twice, authenticator for CEO/Manager/Finance/Team Lead); the
 * temporary password works once, for 24 hours; a password alone never opens a
 * session for an authenticator role without an authenticator.
 */
describe('First login with a temporary password', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const ts = Date.now();
  const ids: string[] = [];
  let ip = 0;
  const freshIp = () => `10.63.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
  const tokens: Record<string, string> = {};
  const staffIds: Record<string, string> = {};
  const ceoSecret = authenticator.generateSecret();

  const post = (path: string, body: Record<string, unknown>, token?: string) => {
    const r = request(app.getHttpServer()).post(path).set('X-Forwarded-For', freshIp());
    return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
  };
  const create = async (by: string, body: Record<string, unknown>) => {
    const res = await post('/staff', body, tokens[by]);
    if (res.body?.staff?.id) ids.push(res.body.staff.id);
    return res;
  };
  const login = (code: string, password: string, deviceId: string, extra: Record<string, unknown> = {}) =>
    post('/auth/login', { staffCode: code, password, deviceId, ...extra });

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: { code: `FLS-${key}-${ts}`, name: `Setup ${key}`, role, passwordHash: await bcrypt.hash('Known-Password-1', 4), status: 'active', ...extra },
    });
    ids.push(staff.id);
    staffIds[key] = staff.id;
    const session = await prisma.staffSession.create({
      data: { staffId: staff.id, expiresAt: new Date(Date.now() + 900_000), absoluteExpiresAt: new Date(Date.now() + 7_200_000), lastActivityAt: new Date() },
    });
    const payload: JwtPayload = { sub: staff.id, role, email: null, code: staff.code, teamLeadId: staff.teamLeadId, sid: session.id };
    tokens[key] = jwt.sign(payload, { expiresIn: '15m' });
    return staff;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    const ceo = await mk('ceo', 'ceo', { totpEnabled: true, totpSecret: ceoSecret });
    const mgr = await mk('mgr', 'manager', { reportsToId: ceo.id });
    await mk('tl', 'team_lead', { reportsToId: mgr.id });
    // An existing Team Lead from before rev 174–175: a password but no authenticator.
    await mk('oldTl', 'team_lead', { reportsToId: mgr.id });
  });

  afterAll(async () => {
    const codes = (await prisma.staff.findMany({ where: { id: { in: ids } }, select: { code: true } })).map((s) => s.code);
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'staff', subjectId: { in: ids } } });
    await prisma.staffPasswordReset.deleteMany({ where: { OR: [{ staffId: { in: ids } }, { issuedByStaffId: { in: ids } }] } });
    await prisma.staffAwayPeriod.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityType: 'staff', entityCode: { in: codes } }] } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null, reportsToId: null, tempPasswordIssuedByStaffId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('creating an account (email optional) gives the staff code and a temporary password, shown once and never cached', async () => {
    const res = await create('mgr', { name: 'Kiran Agent', role: 'call_agent', reportsToId: staffIds.tl });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.staff).toMatchObject({ status: 'pending_invite', email: null, role: 'call_agent' });
    expect(res.body.tempPassword).toMatch(TEMP_FORMAT);
    expect(res.body.inviteToken).toBeUndefined();
    expect(res.body.inviteUrl).toBeUndefined();
    const audits = await prisma.auditLog.findMany({ where: { entityCode: res.body.staff.code } });
    expect(JSON.stringify(audits)).not.toContain(res.body.tempPassword);
    // A CEO, Manager or Finance account no longer needs an email either.
    const fin = await create('ceo', { name: 'Fin No Email', role: 'finance', reportsToId: staffIds.ceo });
    expect(fin.status).toBe(201);
    expect(fin.body.staff.email).toBeNull();
  });

  it('the temporary password (any case, with or without the dash) gives a set-up ticket — no session — that only works on that device and is no bearer token', async () => {
    const made = await create('mgr', { name: 'Ticket Agent', role: 'call_agent', reportsToId: staffIds.tl });
    const temp = made.body.tempPassword as string;
    const sessionsBefore = await prisma.staffSession.count({ where: { staffId: made.body.staff.id } });
    const res = await login(made.body.staff.code, temp.toLowerCase().replace('-', ''), `dev-t-${ts}`).expect(200);
    expect(res.body).toMatchObject({ status: 'setup_required', photoRequired: true, authenticatorSetupRequired: false, signInAt: 'web', passwordRules: { minLength: 8 } });
    expect(res.body.accessToken).toBeUndefined();
    expect(await prisma.staffSession.count({ where: { staffId: made.body.staff.id } })).toBe(sessionsBefore);
    // Not a session: the ticket opens no staff route.
    const asBearer = await request(app.getHttpServer()).get('/staff/me/photo').set('Authorization', `Bearer ${res.body.setupTicket}`);
    expect(asBearer.status).toBe(401);
    // Only on the device it was given to.
    const elsewhere = await post('/auth/setup/complete', { setupTicket: res.body.setupTicket, deviceId: `other-${ts}`, newPassword: 'Brand-New-1' });
    expect(elsewhere.status).toBe(401);
    expect(reasonOf(elsewhere.body)).toBe('other_device');
    // The live selfie comes first: no new password before it.
    const noSelfie = await post('/auth/setup/complete', { setupTicket: res.body.setupTicket, deviceId: `dev-t-${ts}`, newPassword: 'Brand-New-1' });
    expect(noSelfie.status).toBe(400);
    expect(reasonOf(noSelfie.body)).toBe('photo_required');
    // The selfie needs the ticket too (checked before the photo is read).
    await request(app.getHttpServer()).post('/auth/setup/photo').set('X-Forwarded-For', freshIp()).field('captureSource', 'live_camera').attach('photo', JPEG, 'me.jpg').expect(401);
    await request(app.getHttpServer())
      .post('/auth/setup/photo')
      .set('X-Forwarded-For', freshIp())
      .set('x-setup-ticket', res.body.setupTicket)
      .set('x-device-id', `dev-t-${ts}`)
      .field('captureSource', 'live_camera')
      .attach('photo', JPEG, 'me.jpg')
      .expect(200);
    // The new password must differ from the temporary one.
    const same = await post('/auth/setup/complete', { setupTicket: res.body.setupTicket, deviceId: `dev-t-${ts}`, newPassword: temp.replace('-', '').toLowerCase() });
    expect(same.status).toBe(400);
    expect(reasonOf(same.body)).toBe('same_as_temporary');
    const short = await post('/auth/setup/complete', { setupTicket: res.body.setupTicket, deviceId: `dev-t-${ts}`, newPassword: 'short7!' });
    expect(messageOf(short.body)).toContain('at least 8 characters');
    const done = await post('/auth/setup/complete', { setupTicket: res.body.setupTicket, deviceId: `dev-t-${ts}`, newPassword: 'Brand-New-1', confirmPassword: 'Brand-New-1' }).expect(200);
    expect(done.body).toMatchObject({ success: true, code: made.body.staff.code });
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } });
    expect(row).toMatchObject({ status: 'active', tempPasswordHash: null, setupTicketHash: null });
    expect(row.photoStoragePath).toBeTruthy();
    // Single use: the temporary password and the ticket are gone.
    expect((await login(made.body.staff.code, temp, `dev-t-${ts}`)).status).toBe(401);
    expect((await post('/auth/setup/complete', { setupTicket: res.body.setupTicket, deviceId: `dev-t-${ts}`, newPassword: 'Again-New-2' })).status).toBe(401);
    // Then a normal sign-in: a new phone waits for the Team Lead's approval.
    const next = await login(made.body.staff.code, 'Brand-New-1', `dev-t-${ts}`);
    expect(next.status).toBe(401);
    expect(messageOf(next.body)).toContain('waiting for approval by your Team Lead');
  });

  it('a temporary password works for 24 hours only; wrong ones lock the account like wrong passwords', async () => {
    const made = await create('mgr', { name: 'Expiry Agent', role: 'call_agent', reportsToId: staffIds.tl });
    await prisma.staff.update({ where: { id: made.body.staff.id }, data: { tempPasswordExpiresAt: new Date(Date.now() - 1000) } });
    const expired = await login(made.body.staff.code, made.body.tempPassword, `dev-e-${ts}`);
    expect(expired.status).toBe(401);
    expect(messageOf(expired.body)).toBe(TEMP_PASSWORD_EXPIRED);
    const other = await create('mgr', { name: 'Lockout Agent', role: 'call_agent', reportsToId: staffIds.tl });
    for (let i = 0; i < 5; i += 1) {
      expect((await login(other.body.staff.code, 'ZZZZ-ZZZZ', `dev-l-${ts}`)).status).toBe(401);
    }
    const locked = await login(other.body.staff.code, other.body.tempPassword, `dev-l-${ts}`);
    expect(locked.status).toBe(401);
    expect(messageOf(locked.body)).toContain('locked');
  });

  it('a set-up ticket ends after 15 minutes', async () => {
    const made = await create('mgr', { name: 'Slow Agent', role: 'call_agent', reportsToId: staffIds.tl });
    const res = await login(made.body.staff.code, made.body.tempPassword, `dev-s-${ts}`).expect(200);
    await prisma.staff.update({ where: { id: made.body.staff.id }, data: { setupTicketExpiresAt: new Date(Date.now() - 1000) } });
    const late = await post('/auth/setup/complete', { setupTicket: res.body.setupTicket, deviceId: `dev-s-${ts}`, newPassword: 'Brand-New-1' });
    expect(late.status).toBe(401);
    expect(reasonOf(late.body)).toBe('setup_expired');
  });

  it('a field agent signs up in Laboura Field: the office app refuses the temporary password before any ticket', async () => {
    const made = await create('mgr', { name: 'Field Newbie', role: 'field_agent', reportsToId: staffIds.tl });
    const office = await login(made.body.staff.code, made.body.tempPassword, `dev-f-${ts}`, { app: 'office' });
    expect(office.status).toBe(401);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } })).setupTicketHash).toBeNull();
    const field = await login(made.body.staff.code, made.body.tempPassword, `dev-f-${ts}`, { app: 'field' }).expect(200);
    expect(field.body).toMatchObject({ status: 'setup_required', signInAt: 'field_app' });
  });

  it('a Team Lead sets up their authenticator inside set-up (QR + first code); password and authenticator switch on together; then they sign in with it, no login code', async () => {
    const made = await create('mgr', { name: 'New Lead', role: 'team_lead', reportsToId: staffIds.mgr });
    const res = await login(made.body.staff.code, made.body.tempPassword, `dev-tl-${ts}`).expect(200);
    expect(res.body).toMatchObject({ authenticatorSetupRequired: true, authenticatorCodeRequired: false });
    const ticket = { setupTicket: res.body.setupTicket, deviceId: `dev-tl-${ts}` };
    await takeSetupSelfie(app, res.body, `dev-tl-${ts}`);
    const notStarted = await post('/auth/setup/complete', { ...ticket, newPassword: 'Lead-Pass-1' });
    expect(reasonOf(notStarted.body)).toBe('authenticator_not_started');
    const qr = await post('/auth/setup/authenticator', ticket).expect(200);
    expect(qr.body.otpauthUrl).toContain('otpauth://');
    const wrong = await post('/auth/setup/complete', { ...ticket, newPassword: 'Lead-Pass-1', totpCode: '000000' });
    expect(reasonOf(wrong.body)).toBe('totp_invalid');
    let row = await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } });
    expect(row).toMatchObject({ status: 'pending_invite', totpEnabled: false, failedLoginCount: 1 });
    await freshTotpWindow(qr.body.secret);
    await post('/auth/setup/complete', { ...ticket, newPassword: 'Lead-Pass-1', totpCode: authenticator.generate(qr.body.secret) }).expect(200);
    row = await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } });
    expect(row).toMatchObject({ status: 'active', totpEnabled: true, totpSecret: qr.body.secret, tempPasswordHash: null });
    const history = await prisma.statusHistory.findMany({ where: { subjectType: 'staff', subjectId: made.body.staff.id }, orderBy: { changedAt: 'asc' } });
    expect(history.map((h) => h.reason)).toEqual(['staff_created', 'first_login_setup']);
    // Normal sign-in: password, then their own authenticator (device waits for a Manager or the CEO).
    const needCode = await login(made.body.staff.code, 'Lead-Pass-1', `dev-tl-${ts}`);
    expect(messageOf(needCode.body)).toBe('TOTP 2FA code is required');
    await freshTotpWindow(qr.body.secret);
    const device = await login(made.body.staff.code, 'Lead-Pass-1', `dev-tl-${ts}`, { totpCode: authenticator.generate(qr.body.secret) });
    expect(messageOf(device.body)).toBe('This device is waiting for approval by a Manager or the CEO');
    expect(await prisma.loginCodeRequest.count({ where: { staffId: made.body.staff.id } })).toBe(0);
  });

  it('authenticator guessing in set-up: 5 wrong codes end the ticket (counted on the ticket), even the right code is refused after it', async () => {
    const made = await create('mgr', { name: 'Guess Lead', role: 'team_lead', reportsToId: staffIds.mgr });
    const device = `dev-g-${ts}`;
    const res = await login(made.body.staff.code, made.body.tempPassword, device).expect(200);
    const ticket = { setupTicket: res.body.setupTicket, deviceId: device };
    await takeSetupSelfie(app, res.body, device);
    const qr = await post('/auth/setup/authenticator', ticket).expect(200);
    const reasons: (string | undefined)[] = [];
    for (let i = 0; i < 6; i += 1) {
      const wrong = await post('/auth/setup/complete', { ...ticket, newPassword: 'Guess-Pass-1', totpCode: '000000' });
      reasons.push(reasonOf(wrong.body));
    }
    expect(reasons).toEqual(['totp_invalid', 'totp_invalid', 'totp_invalid', 'totp_invalid', 'too_many_wrong_codes', 'setup_unknown']);
    let row = await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } });
    expect(row).toMatchObject({ setupTicketHash: null, setupTicketDeviceId: null, setupTicketWrongCodes: 0, status: 'pending_invite', totpEnabled: false });
    await freshTotpWindow(qr.body.secret);
    const after = await post('/auth/setup/complete', { ...ticket, newPassword: 'Guess-Pass-1', totpCode: authenticator.generate(qr.body.secret) });
    expect(after.status).toBe(401);
    expect(reasonOf(after.body)).toBe('setup_unknown');
    // The wrong codes also counted on the account like wrong passwords: no new ticket until that lock ends.
    expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    const again = await login(made.body.staff.code, made.body.tempPassword, device);
    expect(again.status).toBe(401);
    expect(messageOf(again.body)).toContain('locked');
    row = await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } });
    expect(row.setupTicketHash).toBeNull();
  });

  it('a wrong-password lock from the login page does not stop a set-up already under way; a senior\'s lock does, and ends the ticket', async () => {
    const made = await create('mgr', { name: 'Locked Agent', role: 'call_agent', reportsToId: staffIds.tl });
    const device = `dev-k-${ts}`;
    const res = await login(made.body.staff.code, made.body.tempPassword, device).expect(200);
    // A stranger who knows the staff code types 5 wrong passwords.
    for (let i = 0; i < 5; i += 1) {
      expect((await login(made.body.staff.code, 'Wrong-Pass-99', `stranger-${ts}`)).status).toBe(401);
    }
    const locked = await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } });
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    const photo = (ticketValue: string) =>
      request(app.getHttpServer())
        .post('/auth/setup/photo')
        .set('X-Forwarded-For', freshIp())
        .set('x-setup-ticket', ticketValue)
        .set('x-device-id', device)
        .field('captureSource', 'live_camera')
        .attach('photo', JPEG, 'me.jpg');
    expect((await photo(res.body.setupTicket)).status).toBe(200);
    await post('/auth/setup/complete', { setupTicket: res.body.setupTicket, deviceId: device, newPassword: 'Mine-Pass-77' }).expect(200);
    // Set-up done: the wrong tries and the lock are cleared with it.
    expect(await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } })).toMatchObject({ status: 'active', lockedUntil: null, failedLoginCount: 0 });

    // A senior's lock stops a set-up and ends the ticket.
    const other = await create('mgr', { name: 'Senior Locked', role: 'call_agent', reportsToId: staffIds.tl });
    const start = await login(other.body.staff.code, other.body.tempPassword, device).expect(200);
    await prisma.staff.update({ where: { id: other.body.staff.id }, data: { lockedByStaffId: staffIds.mgr, lockedReason: 'check' } });
    const refused = await photo(start.body.setupTicket);
    expect(refused.status).toBe(401);
    expect(messageOf(refused.body)).toContain('locked');
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: other.body.staff.id } })).setupTicketHash).toBeNull();
    await prisma.staff.update({ where: { id: other.body.staff.id }, data: { lockedByStaffId: null, lockedReason: null } });
  });

  it('signing in with the temporary password does not wipe earlier wrong passwords: only a finished set-up does', async () => {
    const made = await create('mgr', { name: 'Count Agent', role: 'call_agent', reportsToId: staffIds.tl });
    for (let i = 0; i < 3; i += 1) {
      expect((await login(made.body.staff.code, 'Wrong-Pass-99', `dev-c-${ts}`)).status).toBe(401);
    }
    const res = await login(made.body.staff.code, made.body.tempPassword, `dev-c-${ts}`).expect(200);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } })).failedLoginCount).toBe(3);
    await takeSetupSelfie(app, res.body, `dev-c-${ts}`);
    await post('/auth/setup/complete', { setupTicket: res.body.setupTicket, deviceId: `dev-c-${ts}`, newPassword: 'Count-Pass-1' }).expect(200);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: made.body.staff.id } })).failedLoginCount).toBe(0);
  });

  it('set-up routes are limited per connection only: a different staff code in the body never opens a fresh bucket', async () => {
    const ip = `10.64.${ts % 200}.9`;
    const statuses: number[] = [];
    for (let i = 0; i < SETUP_REQUESTS_PER_IP_PER_MINUTE + 2; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/auth/setup/complete')
        .set('X-Forwarded-For', ip)
        .send({ staffCode: `RAND-${i}-${ts}`, resetRequestId: `r-${i}`, setupTicket: `${i}`.repeat(64), deviceId: `d-${i}`, newPassword: 'Whatever-123' });
      statuses.push(res.status);
    }
    expect(SETUP_REQUESTS_PER_IP_PER_MINUTE).toBe(20);
    expect(statuses.slice(0, 20).every((st) => st === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  it('an existing Team Lead without an authenticator gets no session from a password alone; a fresh temporary password from a senior is the safe way in', async () => {
    const refused = await login(`FLS-oldTl-${ts}`, 'Known-Password-1', `dev-old-${ts}`);
    expect(refused.status).toBe(401);
    expect(messageOf(refused.body)).toBe(AUTHENTICATOR_NOT_SET_UP);
    expect(refused.body.accessToken).toBeUndefined();
    expect(await prisma.staffSession.count({ where: { staffId: staffIds.oldTl, revokedAt: null } })).toBe(1); // only the spec's own
    expect(await prisma.loginCodeRequest.count({ where: { staffId: staffIds.oldTl } })).toBe(0);
    const temp = await post(`/staff/${staffIds.oldTl}/temp-password`, {}, tokens.mgr).expect(200);
    const res = await login(`FLS-oldTl-${ts}`, temp.body.tempPassword, `dev-old-${ts}`).expect(200);
    expect(res.body).toMatchObject({ status: 'setup_required', authenticatorSetupRequired: true });
  });

  it('reactivation gives a temporary password and the account is "Not signed in yet" until set-up', async () => {
    const made = await create('mgr', { name: 'Comeback Agent', role: 'call_agent', reportsToId: staffIds.tl });
    await post(`/staff/${made.body.staff.id}/deactivate`, {}, tokens.mgr).expect(200);
    const back = await post(`/staff/${made.body.staff.id}/reactivate`, {}, tokens.mgr).expect(200);
    expect(back.headers['cache-control']).toContain('no-store');
    expect(back.body.tempPassword).toMatch(TEMP_FORMAT);
    expect(back.body.staff.status).toBe('pending_invite');
    const res = await login(made.body.staff.code, back.body.tempPassword, `dev-r-${ts}`).expect(200);
    expect(res.body.status).toBe('setup_required');
  });

  it('old invite routes are gone (no public invite page left)', async () => {
    expect((await post('/staff/accept-invite', { token: 'x', password: 'whatever-123' })).status).toBe(404);
    expect((await post('/staff/accept-invite/preview', { token: 'x' })).status).toBe(404);
    expect((await post('/staff/forgot-password', { email: 'a@b.c' })).status).toBe(404);
    expect((await post(`/staff/${staffIds.tl}/reissue-invite`, {}, tokens.mgr)).status).toBe(404);
    expect((await post(`/staff/${staffIds.tl}/reset-password`, {}, tokens.mgr)).status).toBe(404);
  });
});

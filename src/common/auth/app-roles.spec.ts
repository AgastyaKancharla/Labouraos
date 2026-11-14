import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';
import { stableTotpCode } from '../../test-support/enrolled-login-spec';
import { FIELD_HOST_ENV } from '../../modules/web-app/site-hosts';
import { FIELD_APP_ONLY_MESSAGE } from './staff-app';
import { WRONG_APP_TOKEN } from './jwt.strategy';

/**
 * Owner decision 14 Nov: each app accepts only its own roles, enforced on the
 * server. Laboura Field (app 'field', and the FIELD_HOST address) is for field
 * agents only; the office app (app 'office') refuses field agents. A refused
 * sign-in creates no device request, no login code request and no session.
 * A session belongs to its app and its token works only there.
 */
describe('Each app accepts only its own roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const password = 'App-Roles-Password-1';
  const ids: string[] = [];
  const FIELD = 'field.laboura.test';
  const savedFieldHost = process.env[FIELD_HOST_ENV];
  let n = 0;

  async function makeStaff(role: string, extra: Record<string, unknown> = {}) {
    n += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `AR-${role.slice(0, 2).toUpperCase()}-${Date.now()}-${n}`,
        name: `App roles ${role} ${n}`,
        email: ['ceo', 'manager', 'finance'].includes(role) ? `ar-${role}-${Date.now()}-${n}@laboura.local` : null,
        passwordHash: await bcrypt.hash(password, 4),
        role,
        status: 'active',
        teamLeadId: (extra.teamLeadId as string) ?? null,
        reportsToId: (extra.teamLeadId as string) ?? null,
        totpSecret: (extra.totpSecret as string) ?? null,
        totpEnabled: Boolean(extra.totpSecret),
      },
    });
    ids.push(staff.id);
    return staff;
  }

  async function approvedDevice(staffId: string, deviceId: string) {
    await prisma.staffDevice.create({ data: { staffId, deviceId, label: 'Phone', platform: 'web', status: 'approved', approvedAt: new Date() } });
  }

  const server = () => app.getHttpServer();
  const counts = async (staffId: string) => ({
    devices: await prisma.staffDevice.count({ where: { staffId } }),
    codes: await prisma.loginCodeRequest.count({ where: { staffId } }),
    sessions: await prisma.staffSession.count({ where: { staffId } }),
  });

  /** Field agent signs in to Laboura Field and returns the session. */
  async function fieldSignIn(agent: { id: string; code: string }, deviceId: string, host?: string) {
    const start = request(server()).post('/auth/login');
    if (host) start.set('Host', host);
    const waiting = await start.send({ staffCode: agent.code, password, deviceId, app: 'field' }).expect(200);
    expect(waiting.body.status).toBe('awaiting_code');
    const verify = request(server()).post('/auth/login/verify-code');
    if (host) verify.set('Host', host);
    const done = await verify
      .send({ loginRequestId: waiting.body.loginRequestId, code: loginCodeFor(waiting.body.loginRequestId), deviceId, loginRequestProof: waiting.body.loginRequestProof, app: 'field' })
      .expect(200);
    return done.body as { accessToken: string; sessionId: string; refreshToken?: string };
  }

  beforeAll(async () => {
    process.env[FIELD_HOST_ENV] = FIELD;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (savedFieldHost === undefined) delete process.env[FIELD_HOST_ENV];
    else process.env[FIELD_HOST_ENV] = savedFieldHost;
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('a field agent signs in to Laboura Field: the device request, the code request and the session say "field"', async () => {
    const lead = await makeStaff('team_lead');
    const agent = await makeStaff('field_agent', { teamLeadId: lead.id });
    // First sign-in on a new phone: a device request labelled Laboura Field for the Team Lead.
    const pending = await request(server()).post('/auth/login').send({ staffCode: agent.code, password, deviceId: 'fa-phone', app: 'field' }).expect(401);
    expect(pending.body.message).toBe('This device is waiting for approval by your Team Lead');
    const device = await prisma.staffDevice.findUniqueOrThrow({ where: { staffId_deviceId: { staffId: agent.id, deviceId: 'fa-phone' } } });
    expect(device).toMatchObject({ app: 'field', label: 'Laboura Field', status: 'pending' });
    await prisma.staffDevice.update({ where: { id: device.id }, data: { status: 'approved', approvedAt: new Date() } });

    const session = await fieldSignIn(agent, 'fa-phone');
    expect(session.refreshToken).toBeTruthy();
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(row.app).toBe('field');
    const code = await prisma.loginCodeRequest.findFirstOrThrow({ where: { staffId: agent.id } });
    expect(code.app).toBe('field');
    // The token works in Laboura Field, also on its own address.
    await request(server()).get('/attendance/today').set('Host', FIELD).set('Authorization', `Bearer ${session.accessToken}`).expect(200);
  });

  it.each(['call_agent', 'team_lead', 'ceo', 'manager', 'finance'])(
    'Laboura Field refuses a %s with the field-agents message, before any device, code or session',
    async (role) => {
      const lead = role === 'call_agent' ? await makeStaff('team_lead') : null;
      const person = await makeStaff(role, { teamLeadId: lead?.id, totpSecret: ['ceo', 'manager', 'finance'].includes(role) ? authenticator.generateSecret() : undefined });
      const res = await request(server()).post('/auth/login').send({ staffCode: person.code, password, deviceId: `${role}-phone`, app: 'field' });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe(FIELD_APP_ONLY_MESSAGE);
      expect(res.body.accessToken).toBeUndefined();
      expect(await counts(person.id)).toEqual({ devices: 0, codes: 0, sessions: 0 });
      // The same on the Laboura Field address, even when the body names no app (an older build).
      const byHost = await request(server()).post('/auth/login').set('Host', FIELD).send({ staffCode: person.code, password, deviceId: `${role}-phone` });
      expect(byHost.status).toBe(401);
      expect(byHost.body.message).toBe(FIELD_APP_ONLY_MESSAGE);
      expect(await counts(person.id)).toEqual({ devices: 0, codes: 0, sessions: 0 });
    },
  );

  it('the office app refuses a field agent at the first step, pointing to Laboura Field, and leaves the phone session alone', async () => {
    const lead = await makeStaff('team_lead');
    const agent = await makeStaff('field_agent', { teamLeadId: lead.id });
    await approvedDevice(agent.id, 'fa-phone-2');
    const phone = await fieldSignIn(agent, 'fa-phone-2');
    const before = await counts(agent.id);

    const res = await request(server()).post('/auth/login').send({ staffCode: agent.code, password, deviceId: 'office-browser', app: 'office' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(`Field agents use Laboura Field: https://${FIELD}/`);
    // No device request, no code request, no session; the phone stays signed in.
    expect(await counts(agent.id)).toEqual(before);
    expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: phone.sessionId } })).revokedAt).toBeNull();
    await request(server()).get('/attendance/today').set('Authorization', `Bearer ${phone.accessToken}`).expect(200);
  });

  it('the office app still signs in the CEO with the authenticator and a call agent with a login code', async () => {
    const ceo = await makeStaff('ceo', { totpSecret: authenticator.generateSecret() });
    await approvedDevice(ceo.id, 'ceo-laptop');
    const asked = await request(server()).post('/auth/login').send({ staffCode: ceo.code, password, deviceId: 'ceo-laptop', app: 'office' });
    expect(asked.status).toBe(401);
    expect(asked.body.message).toBe('TOTP 2FA code is required');
    const totpCode = await stableTotpCode((await prisma.staff.findUniqueOrThrow({ where: { id: ceo.id } })).totpSecret!);
    const ok = await request(server()).post('/auth/login').send({ staffCode: ceo.code, password, deviceId: 'ceo-laptop', app: 'office', totpCode }).expect(200);
    expect(ok.body.refreshToken).toBeUndefined();
    expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: ok.body.sessionId } })).app).toBe('office');

    const lead = await makeStaff('team_lead');
    const agent = await makeStaff('call_agent', { teamLeadId: lead.id });
    await approvedDevice(agent.id, 'ca-desk');
    const waiting = await request(server()).post('/auth/login').send({ staffCode: agent.code, password, deviceId: 'ca-desk', app: 'office' }).expect(200);
    const done = await request(server())
      .post('/auth/login/verify-code')
      .send({ loginRequestId: waiting.body.loginRequestId, code: loginCodeFor(waiting.body.loginRequestId), deviceId: 'ca-desk', loginRequestProof: waiting.body.loginRequestProof, app: 'office' })
      .expect(200);
    expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: done.body.sessionId } })).app).toBe('office');
    // An office token is refused on the Laboura Field address.
    const refused = await request(server()).get('/attendance/today').set('Host', FIELD).set('Authorization', `Bearer ${done.body.accessToken}`);
    expect(refused.status).toBe(401);
    expect(refused.body.message).toBe(WRONG_APP_TOKEN);
    await request(server()).get('/attendance/today').set('Authorization', `Bearer ${done.body.accessToken}`).expect(200);
  });

  it('refuses an unknown app, and an office sign-in on the Laboura Field address', async () => {
    const lead = await makeStaff('team_lead');
    const agent = await makeStaff('field_agent', { teamLeadId: lead.id });
    const unknown = await request(server()).post('/auth/login').send({ staffCode: agent.code, password, deviceId: 'x', app: 'admin' });
    expect(unknown.status).toBe(400);
    const officeOnField = await request(server()).post('/auth/login').set('Host', FIELD).send({ staffCode: agent.code, password, deviceId: 'x', app: 'office' });
    expect(officeOnField.status).toBe(401);
    expect(officeOnField.body.message).toBe(FIELD_APP_ONLY_MESSAGE);
    expect(await counts(agent.id)).toEqual({ devices: 0, codes: 0, sessions: 0 });
  });

  it('a login code is used only from the app that asked for it, and only while the device is approved', async () => {
    const lead = await makeStaff('team_lead');
    const agent = await makeStaff('field_agent', { teamLeadId: lead.id });
    await approvedDevice(agent.id, 'fa-phone-3');
    const waiting = await request(server()).post('/auth/login').send({ staffCode: agent.code, password, deviceId: 'fa-phone-3', app: 'field' }).expect(200);
    const body = { loginRequestId: waiting.body.loginRequestId, code: loginCodeFor(waiting.body.loginRequestId), deviceId: 'fa-phone-3', loginRequestProof: waiting.body.loginRequestProof };
    const otherApp = await request(server()).post('/auth/login/verify-code').send({ ...body, app: 'office' });
    expect(otherApp.status).toBe(401);
    expect(otherApp.body.message).toBe('This login code can only be used in the app that asked for it');

    // The Team Lead revokes the phone while the code is being read out.
    await prisma.staffDevice.update({ where: { staffId_deviceId: { staffId: agent.id, deviceId: 'fa-phone-3' } }, data: { status: 'revoked', revokedAt: new Date() } });
    const revoked = await request(server()).post('/auth/login/verify-code').send({ ...body, app: 'field' });
    expect(revoked.status).toBe(401);
    expect(revoked.body.message).toMatch(/no longer approved/);
    expect(await prisma.staffSession.count({ where: { staffId: agent.id } })).toBe(0);
    // The code was not used up by either refusal.
    expect((await prisma.loginCodeRequest.findUniqueOrThrow({ where: { id: body.loginRequestId } })).status).toBe('pending');
  });

  it('revoking a device refuses the login codes asked for on it', async () => {
    const lead = await makeStaff('team_lead');
    await approvedDevice(lead.id, 'tl-desk');
    const agent = await makeStaff('field_agent', { teamLeadId: lead.id });
    await approvedDevice(agent.id, 'fa-phone-4');
    const waiting = await request(server()).post('/auth/login').send({ staffCode: agent.code, password, deviceId: 'fa-phone-4', app: 'field' }).expect(200);
    const device = await prisma.staffDevice.findUniqueOrThrow({ where: { staffId_deviceId: { staffId: agent.id, deviceId: 'fa-phone-4' } } });
    const { StaffDeviceService } = await import('../../modules/staff/staff-device.service');
    await app.get(StaffDeviceService).revoke(device.id, { id: lead.id, role: 'team_lead' });
    const row = await prisma.loginCodeRequest.findUniqueOrThrow({ where: { id: waiting.body.loginRequestId } });
    expect(row).toMatchObject({ status: 'refused', refusedReason: 'device_revoked' });
  });

  it('selling in the shop is for field agents only', async () => {
    const lead = await makeStaff('team_lead');
    const ceo = await makeStaff('ceo');
    const jwt = app.get((await import('@nestjs/jwt')).JwtService);
    for (const who of [lead, ceo]) {
      const token = jwt.sign({ sub: who.id, role: who.role, code: who.code, email: who.email });
      await request(server()).get('/screens/field-selling/settings').set('Authorization', `Bearer ${token}`).expect(403);
      await request(server()).get('/screens/field-selling/businesses').set('Authorization', `Bearer ${token}`).expect(403);
      await request(server()).get('/field-work/businesses/BZ-NONE').set('Authorization', `Bearer ${token}`).expect(403);
    }
  });

  it('GET /auth/apps gives Laboura Field\'s real address', async () => {
    const res = await request(server()).get('/auth/apps').expect(200);
    expect(res.body).toEqual({ fieldAppUrl: `https://${FIELD}/` });
  });
});

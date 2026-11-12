import { stableTotpCode } from '../../test-support/enrolled-login-spec';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthClock } from './auth.service';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';
import { JwtService } from '@nestjs/jwt';

describe('Phase 10 Task 4: staff-code login', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let now = new Date('2026-06-15T05:30:00.000Z');
  const clock = { now: () => now };
  const password = 'Login-Flow-Password-1';
  const createdIds: string[] = [];
  let counter = 0;

  async function makeStaff(
    role: string,
    extra: Record<string, unknown> = {},
  ) {
    counter += 1;
    const code = extra.code as string | undefined;
    const staff = await prisma.staff.create({
      data: {
        code: code ?? `LF-${role.slice(0, 3).toUpperCase()}-${Date.now()}-${counter}`,
        name: `Login ${role} ${counter}`,
        email: extra.email === null ? null : ((extra.email as string) ?? `lf-${role}-${counter}@laboura.local`),
        passwordHash: await bcrypt.hash(password, 4),
        role,
        status: 'active',
        teamLeadId: (extra.teamLeadId as string) ?? null,
        worksFromOffice: (extra.worksFromOffice as boolean) ?? false,
        totpSecret: (extra.totpSecret as string) ?? null,
        totpEnabled: (extra.totpEnabled as boolean) ?? false,
      },
    });
    createdIds.push(staff.id);
    return staff;
  }

  function tokenFor(staff: { id: string; role: string; code: string; email: string | null }) {
    return jwt.sign({
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      code: staff.code,
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: createdIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await app.close();
  });

  it('accepts a staff code in any case and refuses an email login', async () => {
    const manager = await makeStaff('manager', {
      code: `LF-Case-${Date.now()}`,
      totpSecret: authenticator.generateSecret(),
      totpEnabled: true,
    });
    const totpCode = await stableTotpCode(manager.totpSecret!);
    // A Manager's device is approved by the CEO before the Manager logs in on it.
    await prisma.staffDevice.create({
      data: {
        staffId: manager.id,
        deviceId: 'case-device',
        label: 'Case',
        platform: 'web',
        status: 'approved',
        approvedAt: new Date(),
      },
    });

    const loggedIn = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        staffCode: manager.code.toLowerCase(),
        password,
        deviceId: 'case-device',
        totpCode,
      });
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.accessToken).toBeDefined();

    const byEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: manager.email, password, deviceId: 'case-device' });
    expect(byEmail.status).toBe(401);
    expect(byEmail.body.message).toBe('Email is not a login identifier');
    expect(byEmail.body.accessToken).toBeUndefined();
  });

  it('refuses an unapproved agent device and shows the pending request to their Team Lead', async () => {
    const lead = await makeStaff('team_lead');
    await prisma.staffDevice.create({
      data: {
        staffId: lead.id,
        deviceId: 'lead-device',
        label: 'Lead',
        platform: 'web',
        status: 'approved',
        approvedAt: new Date(),
      },
    });
    const agent = await makeStaff('call_agent', { teamLeadId: lead.id });

    const refused = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ staffCode: agent.code, password, deviceId: 'agent-phone' });
    expect(refused.status).toBe(401);
    expect(refused.body.message).toBe(
      'This device is waiting for approval by your Team Lead',
    );
    expect(refused.body.accessToken).toBeUndefined();

    const pending = await prisma.staffDevice.findUniqueOrThrow({
      where: { staffId_deviceId: { staffId: agent.id, deviceId: 'agent-phone' } },
    });
    expect(pending.status).toBe('pending');

    const leadLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ staffCode: lead.code, password, deviceId: 'lead-device' });
    expect(leadLogin.body.status).toBe('awaiting_code');
    const revealed = await request(app.getHttpServer())
      .post(`/login-codes/${leadLogin.body.loginRequestId}/reveal`)
      .set('Authorization', `Bearer ${tokenFor(lead)}`);
    // The Team Lead cannot reveal their own code. A manager reveals it.
    expect(revealed.status).toBe(403);
    const manager = await makeStaff('manager', {
      totpSecret: authenticator.generateSecret(),
      totpEnabled: true,
    });
    await prisma.staff.update({ where: { id: lead.id }, data: { reportsToId: manager.id } });
    const managerToken = tokenFor(manager);
    const shown = await request(app.getHttpServer())
      .post(`/login-codes/${leadLogin.body.loginRequestId}/reveal`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    const leadToken = await request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .send({ loginRequestId: leadLogin.body.loginRequestId, code: shown.body.code, deviceId: 'lead-device', loginRequestProof: leadLogin.body.loginRequestProof });
    expect(leadToken.status).toBe(200);

    const queue = await request(app.getHttpServer())
      .get('/staff/devices/pending')
      .set('Authorization', `Bearer ${leadToken.body.accessToken}`)
      .expect(200);
    expect(queue.body.map((row: { id: string }) => row.id)).toContain(pending.id);
  });

  it('issues a token only when the revealed code matches', async () => {
    const lead = await makeStaff('team_lead');
    const agent = await makeStaff('field_agent', { teamLeadId: lead.id });
    await prisma.staffDevice.create({
      data: {
        staffId: agent.id,
        deviceId: 'approved-handset',
        label: 'Handset',
        platform: 'android',
        status: 'approved',
        approvedAt: new Date(),
      },
    });
    const manager = await makeStaff('manager', {
      totpSecret: authenticator.generateSecret(),
      totpEnabled: true,
    });
    await prisma.staff.update({
      where: { id: lead.id },
      data: { reportsToId: manager.id },
    });
    await prisma.staff.update({
      where: { id: agent.id },
      data: { reportsToId: lead.id },
    });

    const waiting = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ staffCode: agent.code, password, deviceId: 'approved-handset' });
    expect(waiting.status).toBe(200);
    expect(waiting.body).toEqual(
      expect.objectContaining({ status: 'awaiting_code', loginRequestId: expect.any(String) }),
    );
    expect(waiting.body.accessToken).toBeUndefined();
    expect(waiting.body.expiresAt).toBeDefined();

    const wrong = await request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .send({ loginRequestId: waiting.body.loginRequestId, code: '000000', deviceId: 'approved-handset', loginRequestProof: waiting.body.loginRequestProof });
    expect(wrong.status).toBe(401);
    expect(wrong.body.accessToken).toBeUndefined();

    const shown = await request(app.getHttpServer())
      .post(`/login-codes/${waiting.body.loginRequestId}/reveal`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .expect(200);
    expect(shown.body.code).toBe(loginCodeFor(waiting.body.loginRequestId));

    const verified = await request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .send({ loginRequestId: waiting.body.loginRequestId, code: shown.body.code, deviceId: 'approved-handset', loginRequestProof: waiting.body.loginRequestProof });
    expect(verified.status).toBe(200);
    expect(verified.body.accessToken).toBeDefined();
    expect(verified.body.sessionId).toBeDefined();
  });

  it('lets the CEO approve his own new device with his authenticator code', async () => {
    const secret = authenticator.generateSecret();
    const ceo = await makeStaff('ceo', { totpSecret: secret, totpEnabled: true });

    const loggedIn = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        staffCode: ceo.code,
        password,
        deviceId: 'ceo-laptop',
        totpCode: await stableTotpCode(secret),
      });
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.totpEnrollmentRequired).toBeUndefined();

    const device = await prisma.staffDevice.findUniqueOrThrow({
      where: { staffId_deviceId: { staffId: ceo.id, deviceId: 'ceo-laptop' } },
    });
    expect(device.status).toBe('approved');
    expect(device.approvedByStaffId).toBe(ceo.id);
    const audit = await prisma.auditLog.findFirst({
      where: { entityCode: device.id, action: 'staff_device.self_approved_totp' },
    });
    expect(audit).not.toBeNull();
  });

  // Decided 11 Nov (guide, Other controls → Devices): a Manager's or
  // Finance's new device is approved by the CEO, not by their own TOTP code.
  // This replaces the earlier test that let a Manager self-approve.
  it.each(['manager', 'finance'])(
    "keeps a %s's new device waiting until the CEO approves it",
    async (role) => {
      const secret = authenticator.generateSecret();
      const person = await makeStaff(role, { totpSecret: secret, totpEnabled: true });
      const ceo = await makeStaff('ceo');
      const otherManager = await makeStaff('manager');
      await prisma.staff.update({ where: { id: person.id }, data: { reportsToId: ceo.id } });
      const deviceId = `${role}-laptop`;

      const refused = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: person.code,
          password,
          deviceId,
          totpCode: await stableTotpCode(secret),
        });
      expect(refused.status).toBe(401);
      expect(refused.body.message).toBe('This device is waiting for approval by the CEO');
      expect(refused.body.accessToken).toBeUndefined();

      const pending = await prisma.staffDevice.findUniqueOrThrow({
        where: { staffId_deviceId: { staffId: person.id, deviceId } },
      });
      expect(pending.status).toBe('pending');
      expect(
        await prisma.auditLog.count({
          where: { entityCode: pending.id, action: 'staff_device.self_approved_totp' },
        }),
      ).toBe(0);

      // Nobody but the CEO decides it: not another Manager, not the person.
      await request(app.getHttpServer())
        .post(`/staff/devices/${pending.id}/approve`)
        .set('Authorization', `Bearer ${tokenFor(otherManager)}`)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/staff/devices/${pending.id}/approve`)
        .set('Authorization', `Bearer ${tokenFor(person)}`)
        .expect(403);

      const queue = await request(app.getHttpServer())
        .get('/staff/devices/pending')
        .set('Authorization', `Bearer ${tokenFor(ceo)}`)
        .expect(200);
      expect(queue.body.map((row: { id: string }) => row.id)).toContain(pending.id);

      const approved = await request(app.getHttpServer())
        .post(`/staff/devices/${pending.id}/approve`)
        .set('Authorization', `Bearer ${tokenFor(ceo)}`);
      expect([200, 201]).toContain(approved.status);
      expect(approved.body.status).toBe('approved');
      expect(approved.body.approvedByStaffId).toBe(ceo.id);

      const loggedIn = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: person.code,
          password,
          deviceId,
          totpCode: await stableTotpCode(secret),
        });
      expect(loggedIn.status).toBe(200);
      expect(loggedIn.body.accessToken).toBeDefined();
    },
  );

  it('lets a CEO who has not enrolled TOTP enrol and then log in', async () => {
    const ceo = await makeStaff('ceo');
    const deviceId = 'ceo-first-device';

    const setupLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ staffCode: ceo.code, password, deviceId });
    expect(setupLogin.status).toBe(200);
    expect(setupLogin.body.totpEnrollmentRequired).toBe(true);
    const setupToken = setupLogin.body.accessToken as string;

    const blocked = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${setupToken}`);
    expect(blocked.status).toBe(403);

    const setup = await request(app.getHttpServer())
      .post('/staff/2fa/setup')
      .set('Authorization', `Bearer ${setupToken}`)
      .expect(200);
    const enable = await request(app.getHttpServer())
      .post('/staff/2fa/enable')
      .set('Authorization', `Bearer ${setupToken}`)
      .send({ totpCode: await stableTotpCode(setup.body.secret) });
    expect(enable.status).toBe(200);

    const device = await prisma.staffDevice.findUniqueOrThrow({
      where: { staffId_deviceId: { staffId: ceo.id, deviceId } },
    });
    expect(device.status).toBe('approved');
    expect(device.approvedByStaffId).toBe(ceo.id);

    const full = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        staffCode: ceo.code,
        password,
        deviceId,
        totpCode: await stableTotpCode(setup.body.secret),
      });
    expect(full.status).toBe(200);
    expect(full.body.totpEnrollmentRequired).toBeUndefined();
    expect(full.body.accessToken).toBeDefined();
  });

  it('refuses an office-only agent whose address is outside every active range', async () => {
    const agent = await makeStaff('call_agent', { worksFromOffice: true });
    await prisma.staffDevice.create({
      data: {
        staffId: agent.id,
        deviceId: 'office-handset',
        label: 'Handset',
        platform: 'web',
        status: 'approved',
        approvedAt: new Date(),
      },
    });
    const range = await prisma.officeNetwork.create({
      data: { label: 'login-flow-office', cidr: '203.0.113.0/24', active: true },
    });

    const outside = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ staffCode: agent.code, password, deviceId: 'office-handset' });
    expect(outside.status).toBe(401);
    expect(outside.body.message).toBe('Login is only allowed from the office network');

    const local = await prisma.officeNetwork.create({
      data: { label: 'login-flow-loopback', cidr: '127.0.0.1/32', active: true },
    });
    const inside = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ staffCode: agent.code, password, deviceId: 'office-handset' });
    expect(inside.status).toBe(200);
    expect(inside.body.status).toBe('awaiting_code');

    await prisma.officeNetwork.update({ where: { id: range.id }, data: { active: false } });
    await prisma.officeNetwork.update({ where: { id: local.id }, data: { active: false } });
  });

  it('raises an odd-hour flag at 23:00 IST and not at 11:00 IST', async () => {
    const secret = authenticator.generateSecret();
    const manager = await makeStaff('manager', { totpSecret: secret, totpEnabled: true });
    // A Manager's device is approved by the CEO before the Manager logs in on it.
    await prisma.staffDevice.create({
      data: {
        staffId: manager.id,
        deviceId: 'odd-hour-device',
        label: 'Odd hour',
        platform: 'web',
        status: 'approved',
        approvedAt: new Date(),
      },
    });

    now = new Date('2026-01-01T05:30:00.000Z');
    const daytime = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        staffCode: manager.code,
        password,
        deviceId: 'odd-hour-device',
        totpCode: await stableTotpCode(secret),
      });
    expect(daytime.status).toBe(200);
    const dayFlags = await prisma.reviewFlag.count({
      where: { raisedForStaffId: manager.id, kind: 'odd_hour_login' },
    });
    expect(dayFlags).toBe(0);

    now = new Date('2026-01-01T17:30:00.000Z');
    const night = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        staffCode: manager.code,
        password,
        deviceId: 'odd-hour-device',
        totpCode: await stableTotpCode(secret),
      });
    expect(night.status).toBe(200);
    const nightFlags = await prisma.reviewFlag.count({
      where: { raisedForStaffId: manager.id, kind: 'odd_hour_login' },
    });
    expect(nightFlags).toBe(1);
  });

  it('requires an email for Finance and allows a call agent to have none', async () => {
    const ceo = await makeStaff('ceo', {
      totpSecret: authenticator.generateSecret(),
      totpEnabled: true,
    });
    const ceoToken = tokenFor(ceo);
    const missing = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ name: 'No Email Finance', role: 'finance' });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain('email');

    const managerForLead = await makeStaff('manager');
    await prisma.staff.update({
      where: { id: managerForLead.id },
      data: { reportsToId: ceo.id },
    });
    const lead = await makeStaff('team_lead');
    await prisma.staff.update({
      where: { id: lead.id },
      data: { reportsToId: managerForLead.id },
    });
    const agent = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ name: 'No Email Agent', role: 'call_agent', teamLeadId: lead.id });
    expect(agent.status).toBe(201);
    expect(agent.body.staff.email).toBeNull();
    createdIds.push(agent.body.staff.id);
  });
});

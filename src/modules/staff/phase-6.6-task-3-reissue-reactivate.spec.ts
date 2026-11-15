import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { TEMP_PASSWORD_TTL_MS } from '../../common/auth/temporary-password';
import { loginCodeFor } from '../login-code/login-code.crypto';

const TEMP_FORMAT = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

type Actor = { id: string; code: string; email: string; role: string };

describe('Phase 6.6 Task 3 (rev 174–175): Reset sign-in completely and reactivate, with a temporary password', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const ts = Date.now();
  const goodPassword = 'Correct-Horse-Battery-3';
  const cleanStaffIds: string[] = [];
  let ipCounter = 0;

  let ceo: Actor;
  let manager: Actor;
  let teamLead: Actor;
  let callAgent: Actor;
  let fieldAgent: Actor;
  let finance: Actor;

  let ceoToken: string;
  let managerToken: string;
  let teamLeadToken: string;
  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;

  // Each call gets its own simulated client IP (via the trusted proxy) so the
  // per-IP throttle (5 req/min) does not couple unrelated tests together.
  const freshIp = () => `10.66.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  async function mkStaff(
    role: string,
    extra: Partial<{
      teamLeadId: string;
      reportsToId: string;
      status: string;
      totpEnabled: boolean;
      totpSecret: string | null;
    }> = {},
  ): Promise<Actor> {
    const email = `p66_t3_${role}_${ts}_${cleanStaffIds.length}@laboura.local`;
    // A Manager acts only inside their own tree: agents sit under the shared
    // Team Lead, who reports to the shared Manager.
    const line =
      (role === 'call_agent' || role === 'field_agent') && teamLead
        ? { teamLeadId: teamLead.id, reportsToId: teamLead.id }
        : role === 'team_lead' && manager
          ? { reportsToId: manager.id }
          : {};
    const staff = await prisma.staff.create({
      data: {
        code: `T3-${role.toUpperCase()}-${ts}-${cleanStaffIds.length}`,
        name: `T3 ${role}`,
        email,
        role,
        passwordHash: await bcrypt.hash(goodPassword, 4),
        ...line,
        ...extra,
      },
    });
    cleanStaffIds.push(staff.id);
    return { id: staff.id, code: staff.code, email, role };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    ceo = await mkStaff('ceo');
    manager = await mkStaff('manager');
    teamLead = await mkStaff('team_lead');
    callAgent = await mkStaff('call_agent');
    fieldAgent = await mkStaff('field_agent');
    finance = await mkStaff('finance');

    const server = app.getHttpServer();
    const login = async (actor: Actor) => {
      const res = await enrolledLogin(server, { email: actor.email, password: goodPassword });
      expect(res.status).toBe(200);
      return res.body.accessToken as string;
    };

    ceoToken = await login(ceo);
    managerToken = await login(manager);
    teamLeadToken = await login(teamLead);
    callAgentToken = await login(callAgent);
    fieldAgentToken = await login(fieldAgent);
    financeToken = await login(finance);
  });

  afterAll(async () => {
    if (cleanStaffIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: cleanStaffIds } },
      });
      await prisma.staffSession.deleteMany({
        where: { staffId: { in: cleanStaffIds } },
      });
      await prisma.statusHistory.deleteMany({ where: { subjectType: 'staff', subjectId: { in: cleanStaffIds } } });
      await prisma.staffPasswordReset.deleteMany({ where: { staffId: { in: cleanStaffIds } } });
      await prisma.staffAwayPeriod.deleteMany({ where: { staffId: { in: cleanStaffIds } } });
      await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: cleanStaffIds } } });
      await prisma.staffDevice.deleteMany({ where: { staffId: { in: cleanStaffIds } } });
      await prisma.staff.updateMany({ where: { id: { in: cleanStaffIds } }, data: { teamLeadId: null, reportsToId: null, tempPasswordIssuedByStaffId: null } });
      await prisma.staff.deleteMany({
        where: { id: { in: cleanStaffIds } },
      });
    }
    await app.close();
  });

  describe('POST /staff/:id/reset-sign-in', () => {
    it('after the reset, the old password fails and the old TOTP code is gone', async () => {
      // 1. Create a hire and enrol in 2FA
      const hire = await mkStaff('call_agent');
      const enrollRes = await enrolledLogin(app.getHttpServer(), {
        email: hire.email,
        password: goodPassword,
      });
      expect(enrollRes.status).toBe(200);
      const activeSessionToken = enrollRes.body.accessToken as string;

      // Re-issue still clears any TOTP the account happened to have. Call agents
      // no longer enrol, so the row is given a secret here to prove the clear.
      await prisma.staff.update({
        where: { id: hire.id },
        data: { totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP' },
      });
      const rowBefore = await prisma.staff.findUniqueOrThrow({ where: { id: hire.id } });
      expect(rowBefore.totpEnabled).toBe(true);
      expect(rowBefore.totpSecret).toBeTruthy();

      const preCheck = await enrolledLogin(app.getHttpServer(), {
        email: hire.email,
        password: goodPassword,
      });
      expect(preCheck.status).toBe(200);

      // 2. Re-issue invite via CEO
      const reissueRes = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/reset-sign-in`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();

      expect(reissueRes.status).toBe(200);
      expect(reissueRes.body.staff.status).toBe('pending_invite');
      expect(reissueRes.body.tempPassword).toMatch(TEMP_FORMAT);
      expect(reissueRes.body.inviteToken).toBeUndefined();
      const expiresAtMs = new Date(reissueRes.body.tempPasswordExpiresAt).getTime();
      expect(expiresAtMs - Date.now()).toBeLessThanOrEqual(TEMP_PASSWORD_TTL_MS);
      expect(expiresAtMs - Date.now()).toBeGreaterThan(TEMP_PASSWORD_TTL_MS - 60_000);

      // 3. Verify in DB that TOTP is cleared, passwordHash is scrambled, and status is pending_invite
      const rowAfter = await prisma.staff.findUniqueOrThrow({ where: { id: hire.id } });
      expect(rowAfter.status).toBe('pending_invite');
      expect(rowAfter.totpEnabled).toBe(false);
      expect(rowAfter.totpSecret).toBeNull();
      expect(rowAfter.passwordHash).not.toBe(rowBefore.passwordHash);

      // 4. Verify old password fails at login (401 Unauthorized)
      const oldPassLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({
          staffCode: hire.code,
          password: goodPassword,
          deviceId: `test-device-${hire.id}`,
        });
      expect(oldPassLogin.status).toBe(401);
      expect(oldPassLogin.body.message).toBe('Invalid staff code or password');

      // 5. Verify old session token was revoked
      const sessionCheck = await request(app.getHttpServer())
        .get('/staff/sessions')
        .set('Authorization', `Bearer ${activeSessionToken}`);
      expect(sessionCheck.status).toBe(401);
      expect(sessionCheck.body.message).toContain('Session has been revoked');

      // 6. Verify audit log entry
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: 'staff.sign_in_reset',
          entityCode: hire.code,
        },
      });
      expect(auditLog).toBeTruthy();
      expect(auditLog!.actorId).toBe(ceo.id);
      expect(auditLog!.before).toMatchObject({
        status: 'active',
        totpEnabled: true,
      });
      expect(auditLog!.after).toMatchObject({
        status: 'pending_invite',
        totpEnabled: false,
      });
    });

    it('after the reset, the temporary password opens set-up; the new password then reaches the login code step', async () => {
      const hire = await mkStaff('call_agent');
      await enrolledLogin(app.getHttpServer(), { email: hire.email, password: goodPassword });
      const reissueRes = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/reset-sign-in`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();
      expect(reissueRes.status).toBe(200);
      const setup = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: hire.code, password: reissueRes.body.tempPassword, deviceId: `test-device-${hire.id}` });
      expect(setup.status).toBe(200);
      expect(setup.body.status).toBe('setup_required');
      const newPassword = 'New-Secret-Password-123';
      const done = await request(app.getHttpServer())
        .post('/auth/setup/complete')
        .set('X-Forwarded-For', freshIp())
        .send({ setupTicket: setup.body.setupTicket, deviceId: `test-device-${hire.id}`, newPassword });
      expect(done.status).toBe(200);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: hire.id } });
      expect(row.status).toBe('active');
      expect(row.tempPasswordHash).toBeNull();
      // A reset: their boss and the CEO get a bell, and the notice waits for the next sign-in.
      expect(row.passwordResetNotice).toMatchObject({ how: 'full_reset' });

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: hire.code, password: newPassword, deviceId: `test-device-${hire.id}` });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.status).toBe('awaiting_code');
      const fullLoginRes = await request(app.getHttpServer())
        .post('/auth/login/verify-code')
        .set('X-Forwarded-For', freshIp())
        .send({
          loginRequestId: loginRes.body.loginRequestId,
          code: loginCodeFor(loginRes.body.loginRequestId),
          deviceId: `test-device-${hire.id}`,
          loginRequestProof: loginRes.body.loginRequestProof,
        });
      expect(fullLoginRes.status).toBe(200);
      expect(fullLoginRes.body.passwordResetNotice).toMatchObject({ how: 'full_reset' });
      const fullProbeRes = await request(app.getHttpServer()).get('/staff/sessions').set('Authorization', `Bearer ${fullLoginRes.body.accessToken}`);
      expect(fullProbeRes.status).toBe(200);
    });

    it('a Manager is refused resetting a CEO', async () => {
      const res = await request(app.getHttpServer())
        .post(`/staff/${ceo.id}/reset-sign-in`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("A Manager cannot do this for a 'ceo' account; only the CEO can");
    });

    it('a Manager is refused resetting another Manager', async () => {
      const otherManager = await mkStaff('manager');
      const res = await request(app.getHttpServer())
        .post(`/staff/${otherManager.id}/reset-sign-in`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("A Manager cannot do this for a 'manager' account; only the CEO can");
    });

    it('refuses resetting a deactivated account', async () => {
      const hire = await mkStaff('call_agent');
      await request(app.getHttpServer())
        .post(`/staff/${hire.id}/deactivate`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send();

      const res = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/reset-sign-in`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('This account is deactivated. Reactivate it first.');
    });

    it('a Team Lead resets the sign-in of an agent in their own team', async () => {
      // Master Guide, Passwords and email: an agent's forgotten password is
      // reset by their Team Lead, a Manager or the CEO.
      const target = await mkStaff('call_agent');
      const res = await request(app.getHttpServer())
        .post(`/staff/${target.id}/reset-sign-in`)
        .set('Authorization', `Bearer ${teamLeadToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();
      expect(res.status).toBe(200);
      expect(res.body.tempPassword).toMatch(TEMP_FORMAT);
    });

    it('non-executive roles are refused resetting outside their own team', async () => {
      const otherLead = await mkStaff('team_lead');
      const target = await mkStaff('call_agent', {
        teamLeadId: otherLead.id,
        reportsToId: otherLead.id,
      });

      for (const token of [teamLeadToken, callAgentToken, fieldAgentToken, financeToken]) {
        const res = await request(app.getHttpServer())
          .post(`/staff/${target.id}/reset-sign-in`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Forwarded-For', freshIp())
          .send();
        expect(res.status).toBe(403);
      }
    });

    it('reset sign-in is throttled via AuthThrottlerGuard (5 req/min)', async () => {
      const target = await mkStaff('call_agent');
      const ip = freshIp();
      const statuses: number[] = [];

      for (let i = 0; i < 8; i++) {
        const res = await request(app.getHttpServer())
          .post(`/staff/${target.id}/reset-sign-in`)
          .set('Authorization', `Bearer ${ceoToken}`)
          .set('X-Forwarded-For', ip)
          .send();
        statuses.push(res.status);
      }

      expect(statuses[0]).toBe(200);
      expect(statuses).toContain(429);
    });
  });

  describe('POST /staff/:id/reactivate', () => {
    it('a reactivated account gets a temporary password and is "Not signed in yet" until it sets up (the old password never works)', async () => {
      const hire = await mkStaff('call_agent');
      await enrolledLogin(app.getHttpServer(), { email: hire.email, password: goodPassword });
      const deactRes = await request(app.getHttpServer()).post(`/staff/${hire.id}/deactivate`).set('Authorization', `Bearer ${ceoToken}`).send();
      expect(deactRes.status).toBe(200);
      const deactLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: hire.code, password: goodPassword, deviceId: `test-device-${hire.id}` });
      expect(deactLogin.status).toBe(401);

      const reactivateRes = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/reactivate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();
      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.headers['cache-control']).toContain('no-store');
      expect(reactivateRes.body.staff.status).toBe('pending_invite');
      expect(reactivateRes.body.staff.deactivatedAt).toBeNull();
      expect(reactivateRes.body.tempPassword).toMatch(TEMP_FORMAT);

      const reactivatedRow = await prisma.staff.findUniqueOrThrow({ where: { id: hire.id } });
      expect(reactivatedRow.status).toBe('pending_invite');
      expect(reactivatedRow.totpEnabled).toBe(false);
      expect(reactivatedRow.totpSecret).toBeNull();
      expect(reactivatedRow.tempPasswordHash).toBeTruthy();

      const oldPassLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: hire.code, password: goodPassword, deviceId: `test-device-${hire.id}` });
      expect(oldPassLogin.status).toBe(401);
      expect(oldPassLogin.body.message).toBe('Invalid staff code or password');

      const auditLog = await prisma.auditLog.findFirst({ where: { action: 'staff.reactivated', entityCode: hire.code } });
      expect(auditLog).toBeTruthy();
      expect(auditLog!.actorId).toBe(manager.id);
      expect(auditLog!.before).toMatchObject({ status: 'deactivated' });
      expect(auditLog!.after).toMatchObject({ status: 'pending_invite', deactivatedAt: null });
      expect(JSON.stringify(auditLog)).not.toContain(reactivateRes.body.tempPassword);

      const setup = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: hire.code, password: reactivateRes.body.tempPassword, deviceId: `test-device-${hire.id}` });
      expect(setup.body.status).toBe('setup_required');
      const freshPassword = 'Fresh-Password-After-Reactivation-456';
      await request(app.getHttpServer())
        .post('/auth/setup/complete')
        .set('X-Forwarded-For', freshIp())
        .send({ setupTicket: setup.body.setupTicket, deviceId: `test-device-${hire.id}`, newPassword: freshPassword })
        .expect(200);
      const freshLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: hire.code, password: freshPassword, deviceId: `test-device-${hire.id}` });
      expect(freshLogin.status).toBe(200);
      expect(freshLogin.body.status).toBe('awaiting_code');
      expect(freshLogin.body.accessToken).toBeUndefined();
    });

    it('a Manager is refused reactivating a CEO', async () => {
      // Temporarily mark CEO as deactivated directly in DB to test reactivate authorization
      await prisma.staff.update({
        where: { id: ceo.id },
        data: { status: 'deactivated' },
      });

      const res = await request(app.getHttpServer())
        .post(`/staff/${ceo.id}/reactivate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Only a CEO can reactivate 'ceo' accounts");

      // Restore CEO status
      await prisma.staff.update({
        where: { id: ceo.id },
        data: { status: 'active' },
      });
    });

    it('refuses reactivating an account that is not deactivated', async () => {
      const activeStaff = await mkStaff('call_agent');
      const res = await request(app.getHttpServer())
        .post(`/staff/${activeStaff.id}/reactivate`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Staff account is not deactivated');
    });

    it('non-executive roles (team_lead, call_agent, field_agent, finance) are refused reactivating', async () => {
      const target = await mkStaff('call_agent', { status: 'deactivated' });

      for (const token of [teamLeadToken, callAgentToken, fieldAgentToken, financeToken]) {
        const res = await request(app.getHttpServer())
          .post(`/staff/${target.id}/reactivate`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Forwarded-For', freshIp())
          .send();
        expect(res.status).toBe(403);
      }
    });

    it('reactivate is throttled via AuthThrottlerGuard (5 req/min)', async () => {
      const target = await mkStaff('call_agent', { status: 'deactivated' });
      const ip = freshIp();
      const statuses: number[] = [];

      for (let i = 0; i < 8; i++) {
        const res = await request(app.getHttpServer())
          .post(`/staff/${target.id}/reactivate`)
          .set('Authorization', `Bearer ${ceoToken}`)
          .set('X-Forwarded-For', ip)
          .send();
        statuses.push(res.status);
      }

      expect(statuses[0]).toBe(200);
      expect(statuses).toContain(429);
    });
  });
});

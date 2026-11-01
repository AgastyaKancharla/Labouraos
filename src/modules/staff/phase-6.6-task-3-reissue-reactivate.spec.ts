import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { enrolledLogin, stableTotpCode } from '../../test-support/enrolled-login-spec';
import { INVITE_TTL_MS } from './staff.service';

type Actor = { id: string; code: string; email: string; role: string };

describe('Phase 6.6 Task 3: Re-issue invite and reactivate', () => {
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

  const freshIp = () => `10.66.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  async function mkStaff(
    role: string,
    extra: Partial<{ area: string; teamLeadId: string; status: string; totpEnabled: boolean; totpSecret: string | null }> = {},
  ): Promise<Actor> {
    const email = `p66_t3_${role}_${ts}_${cleanStaffIds.length}@laboura.local`;
    const staff = await prisma.staff.create({
      data: {
        code: `T3-${role.toUpperCase()}-${ts}-${cleanStaffIds.length}`,
        name: `T3 ${role}`,
        email,
        role,
        passwordHash: await bcrypt.hash(goodPassword, 4),
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
    fieldAgent = await mkStaff('field_agent', { area: `Area-T3-${ts}` });
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
      await prisma.staff.deleteMany({
        where: { id: { in: cleanStaffIds } },
      });
    }
    await app.close();
  });

  describe('POST /staff/:id/reissue-invite', () => {
    it('after re-issue, the old password fails and the old TOTP code fails', async () => {
      // 1. Create a hire and enrol in 2FA
      const hire = await mkStaff('call_agent');
      const enrollRes = await enrolledLogin(app.getHttpServer(), {
        email: hire.email,
        password: goodPassword,
      });
      expect(enrollRes.status).toBe(200);
      const activeSessionToken = enrollRes.body.accessToken as string;

      // Ensure TOTP is enabled in database
      const rowBefore = await prisma.staff.findUniqueOrThrow({ where: { id: hire.id } });
      expect(rowBefore.totpEnabled).toBe(true);
      expect(rowBefore.totpSecret).toBeTruthy();
      const oldSecret = rowBefore.totpSecret!;
      const oldTotp = await stableTotpCode(oldSecret);

      // Verify that valid login with old credentials works before reissue
      const preCheck = await request(app.getHttpServer())
        .post('/staff/login')
        .send({
          email: hire.email,
          password: goodPassword,
          totpCode: oldTotp,
        });
      expect(preCheck.status).toBe(200);

      // 2. Re-issue invite via CEO
      const reissueRes = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/reissue-invite`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send();

      expect(reissueRes.status).toBe(200);
      expect(reissueRes.body.staff.status).toBe('pending_invite');
      expect(typeof reissueRes.body.inviteToken).toBe('string');
      expect(reissueRes.body.inviteToken.length).toBe(64);
      expect(reissueRes.body.inviteExpiresAt).toBeTruthy();
      const expiresAtMs = new Date(reissueRes.body.inviteExpiresAt).getTime();
      expect(expiresAtMs - Date.now()).toBeLessThanOrEqual(INVITE_TTL_MS);
      expect(expiresAtMs - Date.now()).toBeGreaterThan(INVITE_TTL_MS - 60_000);

      // 3. Verify in DB that TOTP is cleared, passwordHash is scrambled, and status is pending_invite
      const rowAfter = await prisma.staff.findUniqueOrThrow({ where: { id: hire.id } });
      expect(rowAfter.status).toBe('pending_invite');
      expect(rowAfter.totpEnabled).toBe(false);
      expect(rowAfter.totpSecret).toBeNull();
      expect(rowAfter.registeredDeviceId).toBeNull();
      expect(rowAfter.passwordHash).not.toBe(rowBefore.passwordHash);

      // 4. Verify old password fails at login (401 Unauthorized)
      const freshOldTotp = await stableTotpCode(oldSecret);
      const oldPassLogin = await request(app.getHttpServer())
        .post('/staff/login')
        .send({
          email: hire.email,
          password: goodPassword,
          totpCode: freshOldTotp,
        });
      expect(oldPassLogin.status).toBe(401);
      expect(oldPassLogin.body.message).toBe('Invalid email or password');

      // 5. Verify old session token was revoked
      const sessionCheck = await request(app.getHttpServer())
        .get('/staff/sessions')
        .set('Authorization', `Bearer ${activeSessionToken}`);
      expect(sessionCheck.status).toBe(401);
      expect(sessionCheck.body.message).toContain('Session has been revoked');

      // 6. Verify audit log entry
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: 'staff.invite_reissued',
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

    it('after re-issue, the new token activates the account and forces 2FA enrolment', async () => {
      // 1. Create a hire and enrol in 2FA
      const hire = await mkStaff('call_agent');
      await enrolledLogin(app.getHttpServer(), {
        email: hire.email,
        password: goodPassword,
      });

      // 2. Re-issue invite
      const reissueRes = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/reissue-invite`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send();
      expect(reissueRes.status).toBe(200);
      const newInviteToken = reissueRes.body.inviteToken as string;

      // 3. Accept invite with new password
      const newPassword = 'New-Secret-Password-123';
      const acceptRes = await request(app.getHttpServer())
        .post('/staff/accept-invite')
        .send({
          token: newInviteToken,
          password: newPassword,
        });
      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.success).toBe(true);

      // Verify row is activated
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: hire.id } });
      expect(row.status).toBe('active');
      expect(row.inviteTokenHash).toBeNull();

      // 4. First login with new password: forces 2FA enrolment
      const loginRes = await request(app.getHttpServer())
        .post('/staff/login')
        .send({
          email: hire.email,
          password: newPassword,
        });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.totpEnrollmentRequired).toBe(true);
      const setupToken = loginRes.body.accessToken as string;

      // Normal endpoints rejected with totp_setup scope
      const probeRes = await request(app.getHttpServer())
        .get('/staff')
        .set('Authorization', `Bearer ${setupToken}`);
      expect(probeRes.status).toBe(403);
      expect(probeRes.body.message).toContain('2FA enrolment');

      // 5. Complete 2FA enrolment
      const setup2faRes = await request(app.getHttpServer())
        .post('/staff/2fa/setup')
        .set('Authorization', `Bearer ${setupToken}`)
        .send();
      expect(setup2faRes.status).toBe(200);
      const secret = setup2faRes.body.secret as string;

      const totpCode = authenticator.generate(secret);
      const enable2faRes = await request(app.getHttpServer())
        .post('/staff/2fa/enable')
        .set('Authorization', `Bearer ${setupToken}`)
        .send({ code: totpCode });
      expect(enable2faRes.status).toBe(200);
      expect(enable2faRes.body.success).toBe(true);

      // 6. Next login with password + TOTP provides full token
      const stableCode = await stableTotpCode(secret);
      const fullLoginRes = await request(app.getHttpServer())
        .post('/staff/login')
        .send({
          email: hire.email,
          password: newPassword,
          totpCode: stableCode,
        });
      expect(fullLoginRes.status).toBe(200);
      expect(fullLoginRes.body.totpEnrollmentRequired).toBeUndefined();
      const fullToken = fullLoginRes.body.accessToken as string;

      // Can now access ordinary endpoints
      const fullProbeRes = await request(app.getHttpServer())
        .get(`/staff/${hire.id}`)
        .set('Authorization', `Bearer ${fullToken}`);
      expect(fullProbeRes.status).toBe(200);
      expect(fullProbeRes.body.id).toBe(hire.id);
    });

    it('a Manager is refused re-issuing an invite to a CEO', async () => {
      const res = await request(app.getHttpServer())
        .post(`/staff/${ceo.id}/reissue-invite`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Only a CEO can re-issue invites for 'ceo' accounts");
    });

    it('a Manager is refused re-issuing an invite to another Manager', async () => {
      const otherManager = await mkStaff('manager');
      const res = await request(app.getHttpServer())
        .post(`/staff/${otherManager.id}/reissue-invite`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Only a CEO can re-issue invites for 'manager' accounts");
    });

    it('refuses re-issuing an invite for a deactivated account', async () => {
      const hire = await mkStaff('call_agent');
      await request(app.getHttpServer())
        .post(`/staff/${hire.id}/deactivate`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send();

      const res = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/reissue-invite`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        'Cannot re-issue invite for a deactivated account. Reactivate the account first.',
      );
    });

    it('non-executive roles (team_lead, call_agent, field_agent, finance) are refused re-issuing invites', async () => {
      const target = await mkStaff('call_agent');

      for (const token of [teamLeadToken, callAgentToken, fieldAgentToken, financeToken]) {
        const res = await request(app.getHttpServer())
          .post(`/staff/${target.id}/reissue-invite`)
          .set('Authorization', `Bearer ${token}`)
          .send();
        expect(res.status).toBe(403);
      }
    });

    it('re-issue invite is throttled via AuthThrottlerGuard (5 req/min)', async () => {
      const target = await mkStaff('call_agent');
      const ip = freshIp();
      const statuses: number[] = [];

      for (let i = 0; i < 8; i++) {
        const res = await request(app.getHttpServer())
          .post(`/staff/${target.id}/reissue-invite`)
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
    it('a reactivated account cannot log in until a fresh invite is accepted', async () => {
      // 1. Active hire
      const hire = await mkStaff('call_agent');
      await enrolledLogin(app.getHttpServer(), {
        email: hire.email,
        password: goodPassword,
      });

      // 2. Deactivate the hire
      const deactRes = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/deactivate`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send();
      expect(deactRes.status).toBe(200);

      // Verify login fails while deactivated
      const deactLogin = await request(app.getHttpServer())
        .post('/staff/login')
        .send({ email: hire.email, password: goodPassword });
      expect(deactLogin.status).toBe(401);

      // 3. Reactivate the hire via Manager (or CEO)
      const reactivateRes = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/reactivate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send();

      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.staff.status).toBe('active');
      expect(reactivateRes.body.staff.deactivatedAt).toBeNull();

      // 4. Verify DB state: password is unguessable random hash, TOTP cleared, no invite token
      const reactivatedRow = await prisma.staff.findUniqueOrThrow({ where: { id: hire.id } });
      expect(reactivatedRow.status).toBe('active');
      expect(reactivatedRow.deactivatedAt).toBeNull();
      expect(reactivatedRow.totpEnabled).toBe(false);
      expect(reactivatedRow.totpSecret).toBeNull();
      expect(reactivatedRow.inviteTokenHash).toBeNull();

      // 5. Verify the reactivated account CANNOT log in with old password
      const oldPassLogin = await request(app.getHttpServer())
        .post('/staff/login')
        .send({ email: hire.email, password: goodPassword });
      expect(oldPassLogin.status).toBe(401);
      expect(oldPassLogin.body.message).toBe('Invalid email or password');

      // 6. Verify audit log entry
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: 'staff.reactivated',
          entityCode: hire.code,
        },
      });
      expect(auditLog).toBeTruthy();
      expect(auditLog!.actorId).toBe(manager.id);
      expect(auditLog!.before).toMatchObject({ status: 'deactivated' });
      expect(auditLog!.after).toMatchObject({ status: 'active', deactivatedAt: null });

      // 7. Compose with reissue-invite to make the account usable again
      const reissueRes = await request(app.getHttpServer())
        .post(`/staff/${hire.id}/reissue-invite`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send();
      expect(reissueRes.status).toBe(200);
      const freshToken = reissueRes.body.inviteToken as string;

      // 8. Accept fresh invite
      const freshPassword = 'Fresh-Password-After-Reactivation-456';
      const acceptRes = await request(app.getHttpServer())
        .post('/staff/accept-invite')
        .send({
          token: freshToken,
          password: freshPassword,
        });
      expect(acceptRes.status).toBe(200);

      // 9. Login now succeeds, requiring 2FA enrolment
      const freshLogin = await request(app.getHttpServer())
        .post('/staff/login')
        .send({
          email: hire.email,
          password: freshPassword,
        });
      expect(freshLogin.status).toBe(200);
      expect(freshLogin.body.totpEnrollmentRequired).toBe(true);
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

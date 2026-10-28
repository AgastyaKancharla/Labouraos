import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { TotpService } from './totp.service';
import {
  AccessKeypair,
  jwksBody,
  makeAccessKeypair,
  mockJwksEndpoint,
  signAccessJwt,
  TEST_AUD,
  TEST_TEAM_DOMAIN,
  unsignedAccessJwt,
} from '../../test-support/cloudflare-access-test-keys';

describe('Phase 8 Task 6: Security Hardening & Access Control Hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let totpService: TotpService;

  const timestamp = Date.now();
  const testPassword = 'SecurePassword123!';

  // TOTP codes are only valid for their 30s step and login does a bcrypt
  // compare between generation and verification. A code minted in the last
  // moments of a step can expire mid-request, so wait for a fresh step first.
  const TOTP_STEP_MS = 30_000;
  const TOTP_SAFE_MARGIN_MS = 5_000;
  const stableTotp = async (secret: string): Promise<string> => {
    const remaining = TOTP_STEP_MS - (Date.now() % TOTP_STEP_MS);
    if (remaining < TOTP_SAFE_MARGIN_MS) {
      await new Promise((resolve) => setTimeout(resolve, remaining + 50));
    }
    return totpService.generateToken(secret);
  };

  let ceoStaff: { id: string; email: string; totpSecret: string; code: string };
  let managerStaff: { id: string; email: string; totpSecret: string; code: string };
  let callAgentStaff: { id: string; email: string; totpSecret: string; code: string };
  let fieldAgentStaff: { id: string; email: string; totpSecret: string; code: string };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    totpService = app.get<TotpService>(TotpService);

    const passwordHash = await bcrypt.hash(testPassword, 10);

    // 1. Create staff across all 4 key roles with active TOTP secrets
    const roles = ['ceo', 'manager', 'call_agent', 'field_agent'] as const;
    const staffAccounts: Record<string, { id: string; email: string; totpSecret: string; code: string }> = {};

    for (const role of roles) {
      const secret = totpService.generateSecret();
      const code = `STF-SEC-${role.substring(0, 2).toUpperCase()}-${timestamp.toString().slice(-4)}`;
      const staff = await prisma.staff.create({
        data: {
          code,
          name: `Test ${role}`,
          email: `${role}_sec_${timestamp}@laboura.local`,
          passwordHash,
          role,
          city: 'Bengaluru',
          totpSecret: secret,
          totpEnabled: true,
        },
      });
      staffAccounts[role] = { id: staff.id, email: staff.email, totpSecret: secret, code };
    }

    ceoStaff = staffAccounts['ceo'];
    managerStaff = staffAccounts['manager'];
    callAgentStaff = staffAccounts['call_agent'];
    fieldAgentStaff = staffAccounts['field_agent'];
  });

  afterAll(async () => {
    const staffIds = [
      ceoStaff?.id,
      managerStaff?.id,
      callAgentStaff?.id,
      fieldAgentStaff?.id,
    ].filter(Boolean);

    await prisma.staffSession.deleteMany({
      where: { staffId: { in: staffIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: staffIds } },
    });
    await prisma.staff.deleteMany({
      where: { id: { in: staffIds } },
    });
    await app.close();
  });

  describe('1. Mandatory 2FA via TOTP (RFC 6238) across All Roles', () => {
    it('correct password with missing TOTP code does NOT issue a token (401 Unauthorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: ceoStaff.email,
          password: testPassword,
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('TOTP 2FA code is required');
    });

    it('correct password with incorrect TOTP code does NOT issue a token (401 Unauthorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: ceoStaff.email,
          password: testPassword,
          totpCode: '000000',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid TOTP code');
    });

    it('enforces TOTP for all 4 roles (CEO, Manager, Call Agent, Field Agent)', async () => {
      const testCases = [ceoStaff, managerStaff, callAgentStaff, fieldAgentStaff];

      for (const account of testCases) {
        const validCode = await stableTotp(account.totpSecret);
        const res = await request(app.getHttpServer())
          .post('/auth/login')
          .send({
            email: account.email,
            password: testPassword,
            totpCode: validCode,
          });

        expect(res.status).toBe(200);
        expect(res.body.accessToken).toBeDefined();
        expect(res.body.sessionId).toBeDefined();
      }
    });
  });

  describe('2. Device Binding and Step-Up TOTP for Field Agent App', () => {
    it('first login registers the primary deviceId for the field agent', async () => {
      const validCode = await stableTotp(fieldAgentStaff.totpSecret);
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: fieldAgentStaff.email,
          password: testPassword,
          totpCode: validCode,
          deviceId: 'primary-phone-device-001',
        });

      expect(res.status).toBe(200);

      const updated = await prisma.staff.findUnique({
        where: { id: fieldAgentStaff.id },
      });
      expect(updated?.registeredDeviceId).toBe('primary-phone-device-001');
    });

    it('login with recognized registered device succeeds without step-up code', async () => {
      const validCode = await stableTotp(fieldAgentStaff.totpSecret);
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: fieldAgentStaff.email,
          password: testPassword,
          totpCode: validCode,
          deviceId: 'primary-phone-device-001',
        });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    });

    it('login from a new, unrecognized device on a Field Agent account REQUIRES step-up TOTP code', async () => {
      const validCode = await stableTotp(fieldAgentStaff.totpSecret);
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: fieldAgentStaff.email,
          password: testPassword,
          totpCode: validCode,
          deviceId: 'unrecognized-rogue-device-999',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Unrecognized device requires step-up TOTP verification');
    });

    it('login from unrecognized device SUCCEEDS when valid step-up TOTP code is provided', async () => {
      const validCode = await stableTotp(fieldAgentStaff.totpSecret);
      const validStepUpCode = await stableTotp(fieldAgentStaff.totpSecret);

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: fieldAgentStaff.email,
          password: testPassword,
          totpCode: validCode,
          deviceId: 'unrecognized-rogue-device-999',
          stepUpTotpCode: validStepUpCode,
        });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    });
  });

  describe('3. Short-Lived Access Tokens & Revocable Session Control', () => {
    it('creates active session record on login and lists sessions via GET /staff/sessions', async () => {
      const validCode = await stableTotp(ceoStaff.totpSecret);
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: ceoStaff.email,
          password: testPassword,
          totpCode: validCode,
        });

      const token = loginRes.body.accessToken;
      const sessionId = loginRes.body.sessionId;

      const sessionsRes = await request(app.getHttpServer())
        .get('/staff/sessions')
        .set('Authorization', `Bearer ${token}`);

      expect(sessionsRes.status).toBe(200);
      expect(Array.isArray(sessionsRes.body)).toBe(true);

      const found = sessionsRes.body.find((s: { id: string }) => s.id === sessionId);
      expect(found).toBeDefined();
      expect(found.isCurrent).toBe(true);
    });

    it('revoking a session via POST /staff/sessions/:id/revoke immediately invalidates token on next request', async () => {
      const validCode = await stableTotp(callAgentStaff.totpSecret);
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: callAgentStaff.email,
          password: testPassword,
          totpCode: validCode,
        });

      expect(loginRes.status).toBe(200);
      const token = loginRes.body.accessToken;
      const sessionId = loginRes.body.sessionId;

      // 1. Verify token works before revocation
      const probe1 = await request(app.getHttpServer())
        .get('/staff/sessions')
        .set('Authorization', `Bearer ${token}`);
      expect(probe1.status).toBe(200);

      // 2. Revoke the session
      const revokeRes = await request(app.getHttpServer())
        .post(`/staff/sessions/${sessionId}/revoke`)
        .set('Authorization', `Bearer ${token}`);
      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.success).toBe(true);

      // 3. Immediately verify the very next request with this token fails with 401 Unauthorized
      const probe2 = await request(app.getHttpServer())
        .get('/staff/sessions')
        .set('Authorization', `Bearer ${token}`);
      expect(probe2.status).toBe(401);
      expect(probe2.body.message).toContain('Session has been revoked');
    });

    it('prevents non-manager staff from revoking sessions of other staff members (403 Forbidden)', async () => {
      // Create session for CEO
      const ceoSession = await prisma.staffSession.create({
        data: {
          staffId: ceoStaff.id,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      // Call Agent tries to revoke CEO's session
      const validCode = await stableTotp(callAgentStaff.totpSecret);
      const caLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: callAgentStaff.email,
          password: testPassword,
          totpCode: validCode,
        });

      const caToken = caLogin.body.accessToken;

      const forbiddenRes = await request(app.getHttpServer())
        .post(`/staff/sessions/${ceoSession.id}/revoke`)
        .set('Authorization', `Bearer ${caToken}`);

      expect(forbiddenRes.status).toBe(403);
    });
  });

  describe('4. Cloudflare Access Gating on Consoles (verified JWT, not header presence)', () => {
    const savedEnv = {
      enforced: process.env.CLOUDFLARE_ACCESS_ENFORCED,
      team: process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
      aud: process.env.CLOUDFLARE_ACCESS_AUD,
    };
    const restoreEnv = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    let real: AccessKeypair;
    let attacker: AccessKeypair;

    beforeAll(() => {
      real = makeAccessKeypair('kid-console');
      attacker = makeAccessKeypair('kid-console');
    });

    beforeEach(() => {
      process.env.CLOUDFLARE_ACCESS_ENFORCED = 'true';
      process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = TEST_TEAM_DOMAIN;
      process.env.CLOUDFLARE_ACCESS_AUD = TEST_AUD;
      mockJwksEndpoint(() => ({ body: jwksBody(real) }));
    });

    afterEach(() => {
      jest.restoreAllMocks();
      restoreEnv('CLOUDFLARE_ACCESS_ENFORCED', savedEnv.enforced ?? 'false');
      restoreEnv('CLOUDFLARE_ACCESS_TEAM_DOMAIN', savedEnv.team);
      restoreEnv('CLOUDFLARE_ACCESS_AUD', savedEnv.aud);
    });

    it.each(['/admin', '/call-agent'])('serves %s only with a genuinely signed Cloudflare Access JWT', async (route) => {
      const denied = await request(app.getHttpServer()).get(route);
      expect(denied.status).toBe(403);
      expect(denied.body.message).toContain('Cloudflare Access identity verification required');

      const allowed = await request(app.getHttpServer())
        .get(route)
        .set('cf-access-jwt-assertion', signAccessJwt(real));
      expect(allowed.status).toBe(200);
    });

    it.each(['/admin', '/call-agent'])('rejects forged, unsigned and header-only identities on %s', async (route) => {
      const forged = signAccessJwt(attacker); // right kid, wrong private key
      const unsigned = unsignedAccessJwt('kid-console');
      const wrongAudience = signAccessJwt(real, { aud: ['another-application'] });

      for (const assertion of [forged, unsigned, wrongAudience, 'garbage']) {
        const res = await request(app.getHttpServer()).get(route).set('cf-access-jwt-assertion', assertion);
        expect(res.status).toBe(403);
      }

      // The old bypass: presence of these headers used to be enough.
      const emailOnly = await request(app.getHttpServer())
        .get(route)
        .set('cf-access-authenticated-user-email', 'admin@laboura.local');
      expect(emailOnly.status).toBe(403);

      const junkAssertion = await request(app.getHttpServer())
        .get(route)
        .set('cf-access-jwt-assertion', 'x')
        .set('cf-access-authenticated-user-email', 'admin@laboura.local');
      expect(junkAssertion.status).toBe(403);
    });

    it('fails closed (403) when enforcement is on but Cloudflare config is missing', async () => {
      delete process.env.CLOUDFLARE_ACCESS_AUD;

      const res = await request(app.getHttpServer())
        .get('/admin')
        .set('cf-access-jwt-assertion', signAccessJwt(real));
      expect(res.status).toBe(403);
    });

    it('does nothing when enforcement is off (local dev and tests)', async () => {
      process.env.CLOUDFLARE_ACCESS_ENFORCED = 'false';

      expect((await request(app.getHttpServer()).get('/admin')).status).toBe(200);
      expect((await request(app.getHttpServer()).get('/call-agent')).status).toBe(200);
    });

    it('leaves the Field Agent app and the API reachable without Cloudflare credentials', async () => {
      const fieldApp = await request(app.getHttpServer()).get('/field-agent');
      expect(fieldApp.status).toBe(200);

      // API routes are never behind Cloudflare Access: an unauthenticated API
      // call must fail on its own auth (401), not on the Cloudflare gate (403).
      const api = await request(app.getHttpServer()).get('/staff/sessions');
      expect(api.status).toBe(401);
    });
  });

  describe('5. Rate Limiting on Auth & OTP Endpoints', () => {
    it('exceeding rate limit on login returns HTTP 429 Too Many Requests', async () => {
      const attempts: number[] = [];

      // Burst 7 requests (limit configured to 5)
      for (let i = 0; i < 7; i++) {
        const res = await request(app.getHttpServer())
          .post('/auth/login')
          .send({
            email: 'nonexistent@laboura.local',
            password: 'WrongPassword!',
          });
        attempts.push(res.status);
      }

      // At least one attempt should be throttled with HTTP 429
      expect(attempts).toContain(429);
    });
  });
});

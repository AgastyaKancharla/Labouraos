import { freshTotpWindow } from '../../test-support/enrolled-login-spec';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { TotpService } from './totp.service';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';
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
    // A code is accepted once per step: open a fresh step for this person first.
    await freshTotpWindow(secret);
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
      staffAccounts[role] = { id: staff.id, email: staff.email ?? '', totpSecret: secret, code };
    }

    ceoStaff = staffAccounts['ceo'];
    managerStaff = staffAccounts['manager'];
    // A Manager's device is approved by the CEO before the Manager logs in on it
    // (decided 11 Nov); the CEO approves his own with his authenticator code.
    await prisma.staffDevice.create({
      data: {
        staffId: managerStaff.id,
        deviceId: `sec-${managerStaff.code}`,
        label: 'Manager laptop',
        platform: 'web',
        status: 'approved',
        approvedAt: new Date(),
      },
    });
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

  describe('1. Mandatory 2FA via TOTP for management', () => {
    it('correct password with missing TOTP code does NOT issue a token (401 Unauthorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: ceoStaff.code,
          password: testPassword,
          deviceId: 'ceo-sec-device',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('TOTP 2FA code is required');
    });

    it('correct password with incorrect TOTP code does NOT issue a token (401 Unauthorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: ceoStaff.code,
          password: testPassword,
          deviceId: 'ceo-sec-device',
          totpCode: '000000',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid TOTP code');
    });

    it('issues a token for CEO and Manager with a valid TOTP code, and does not for agents', async () => {
      for (const account of [ceoStaff, managerStaff]) {
        const res = await request(app.getHttpServer())
          .post('/auth/login')
          .send({
            staffCode: account.code,
            password: testPassword,
            deviceId: `sec-${account.code}`,
            totpCode: await stableTotp(account.totpSecret),
          });
        expect(res.status).toBe(200);
        expect(res.body.accessToken).toBeDefined();
        expect(res.body.sessionId).toBeDefined();
      }

      for (const account of [callAgentStaff, fieldAgentStaff]) {
        const res = await request(app.getHttpServer())
          .post('/auth/login')
          .send({
            staffCode: account.code,
            password: testPassword,
            deviceId: `sec-${account.code}`,
            totpCode: await stableTotp(account.totpSecret),
          });
        expect(res.status).toBe(401);
        expect(res.body.accessToken).toBeUndefined();
        expect(res.body.message).toContain('waiting for approval');
      }
    });
  });

  describe('2. Every role needs an approved device', () => {
    it('an unapproved field-agent device is pending and does not issue a token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: fieldAgentStaff.code,
          password: testPassword,
          deviceId: 'primary-phone-device-001',
        });

      expect(res.status).toBe(401);
      expect(res.body.accessToken).toBeUndefined();
      const device = await prisma.staffDevice.findUniqueOrThrow({
        where: {
          staffId_deviceId: { staffId: fieldAgentStaff.id, deviceId: 'primary-phone-device-001' },
        },
      });
      expect(device.status).toBe('pending');
    });

    it('a second device is also pending; a TOTP code does not approve it', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: fieldAgentStaff.code,
          password: testPassword,
          deviceId: 'unrecognized-rogue-device-999',
          totpCode: await stableTotp(fieldAgentStaff.totpSecret),
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('waiting for approval');
      const device = await prisma.staffDevice.findUniqueOrThrow({
        where: {
          staffId_deviceId: {
            staffId: fieldAgentStaff.id,
            deviceId: 'unrecognized-rogue-device-999',
          },
        },
      });
      expect(device.status).toBe('pending');
    });

    it('an approved device returns a login code rather than a token', async () => {
      await prisma.staffDevice.update({
        where: {
          staffId_deviceId: { staffId: fieldAgentStaff.id, deviceId: 'primary-phone-device-001' },
        },
        data: { status: 'approved', approvedAt: new Date() },
      });
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: fieldAgentStaff.code,
          password: testPassword,
          deviceId: 'primary-phone-device-001',
        });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('awaiting_code');
      expect(res.body.accessToken).toBeUndefined();
    });
  });

  describe('3. Short-Lived Access Tokens & Revocable Session Control', () => {
    it('creates active session record on login and lists sessions via GET /staff/sessions', async () => {
      const validCode = await stableTotp(ceoStaff.totpSecret);
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: ceoStaff.code,
          password: testPassword,
          deviceId: 'ceo-session-device',
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
      await prisma.staffDevice.upsert({
        where: {
          staffId_deviceId: { staffId: callAgentStaff.id, deviceId: 'ca-session-device' },
        },
        create: {
          staffId: callAgentStaff.id,
          deviceId: 'ca-session-device',
          label: 'Session',
          platform: 'web',
          status: 'approved',
          approvedAt: new Date(),
        },
        update: { status: 'approved' },
      });
      const waiting = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: callAgentStaff.code,
          password: testPassword,
          deviceId: 'ca-session-device',
        });
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login/verify-code')
        .send({
          loginRequestId: waiting.body.loginRequestId,
          code: loginCodeFor(waiting.body.loginRequestId),
          deviceId: 'ca-session-device',
          loginRequestProof: waiting.body.loginRequestProof,
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
          absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          lastActivityAt: new Date(),
        },
      });

      // Call Agent tries to revoke CEO's session
      const caWaiting = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          staffCode: callAgentStaff.code,
          password: testPassword,
          deviceId: 'ca-session-device',
        });
      const caLogin = await request(app.getHttpServer())
        .post('/auth/login/verify-code')
        .send({
          loginRequestId: caWaiting.body.loginRequestId,
          code: loginCodeFor(caWaiting.body.loginRequestId),
          deviceId: 'ca-session-device',
          loginRequestProof: caWaiting.body.loginRequestProof,
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

    const savedWebDist = process.env.WEB_DIST_DIR;
    let webDist: string;

    beforeAll(() => {
      webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'laboura-web-'));
      fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><div id="root"></div>');
    });

    afterAll(() => {
      restoreEnv('WEB_DIST_DIR', savedWebDist);
      fs.rmSync(webDist, { recursive: true, force: true });
    });

    beforeEach(() => {
      process.env.WEB_DIST_DIR = webDist;
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

    // The office web app's staff pages are the gated pages now (the old
    // Admin Dashboard at /console/admin is gone). A stand-in web build is
    // served so the check runs end to end with a genuinely signed token.
    const page = (route: string) => request(app.getHttpServer()).get(route).set('Accept', 'text/html');

    it.each(['/login', '/ceo', '/finance/money-in'])('serves %s only with a genuinely signed Cloudflare Access JWT', async (route) => {
      const denied = await page(route);
      expect(denied.status).toBe(403);
      expect(denied.body.message).toContain('Cloudflare Access identity verification required');

      const allowed = await page(route).set('cf-access-jwt-assertion', signAccessJwt(real));
      expect(allowed.status).toBe(200);
    });

    it.each(['/login', '/ceo'])('rejects forged, unsigned and header-only identities on %s', async (route) => {
      const forged = signAccessJwt(attacker); // right kid, wrong private key
      const unsigned = unsignedAccessJwt('kid-console');
      const wrongAudience = signAccessJwt(real, { aud: ['another-application'] });

      for (const assertion of [forged, unsigned, wrongAudience, 'garbage']) {
        const res = await page(route).set('cf-access-jwt-assertion', assertion);
        expect(res.status).toBe(403);
      }

      // The old bypass: presence of these headers used to be enough.
      const emailOnly = await page(route).set('cf-access-authenticated-user-email', 'admin@laboura.local');
      expect(emailOnly.status).toBe(403);

      const junkAssertion = await page(route)
        .set('cf-access-jwt-assertion', 'x')
        .set('cf-access-authenticated-user-email', 'admin@laboura.local');
      expect(junkAssertion.status).toBe(403);
    });

    it('fails closed (403) when enforcement is on but Cloudflare config is missing', async () => {
      delete process.env.CLOUDFLARE_ACCESS_AUD;

      const res = await page('/ceo').set('cf-access-jwt-assertion', signAccessJwt(real));
      expect(res.status).toBe(403);
    });

    it('does nothing when enforcement is off (local dev and tests)', async () => {
      process.env.CLOUDFLARE_ACCESS_ENFORCED = 'false';

      expect((await page('/ceo')).status).toBe(200);
    });

    it('sends browsers on from the retired console addresses without a Cloudflare check (the target page has its own)', async () => {
      for (const route of ['/admin', '/console/admin', '/console/call-agent', '/field-agent', '/map']) {
        const res = await request(app.getHttpServer()).get(route).set('Accept', 'text/html');
        expect([route, res.status]).toEqual([route, 301]);
      }
    });

    it('leaves the API reachable without Cloudflare credentials', async () => {

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

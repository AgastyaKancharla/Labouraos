import { stableTotpCode } from '../../test-support/enrolled-login-spec';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { seed } from '../../../prisma/seed';

describe('Phase 8 Task 10: First-admin bootstrap and 2FA login UI', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const BOOTSTRAP_SECRET = 'ci_bootstrap_secret_testing_only_32_characters';
  let ipCounter = 1;
  const freshIp = () => `10.98.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  async function clearAllStaff() {
    await prisma.staffSession.deleteMany({});
    await prisma.businessVisit.deleteMany({});
    await prisma.contactAttempt.deleteMany({});
    await prisma.callbackTask.deleteMany({});
    await prisma.target.deleteMany({});
    await prisma.jobSeeker.updateMany({ data: { registeredByStaffId: null } });
    await prisma.placement.updateMany({ data: { createdByStaffId: null } });
    await prisma.vacancy.updateMany({ data: { capturedByStaffId: null } });
    await prisma.staff.updateMany({ data: { teamLeadId: null } });
    await prisma.auditLog.deleteMany({});
    await prisma.staff.deleteMany({});
  }

  beforeAll(async () => {
    process.env.STAFF_BOOTSTRAP_SECRET = BOOTSTRAP_SECRET;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Restore clean seeded database state for any subsequent test suites
    await clearAllStaff();
    await seed(prisma);
    if (app) {
      await app.close();
    }
  });

  describe('POST /staff/bootstrap validation', () => {
    beforeEach(async () => {
      await clearAllStaff();
    });

    it('rejects missing or empty name with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: '  ',
          email: 'ceo@laboura.local',
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('name is required');
    });

    it('rejects invalid email with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: 'First CEO',
          email: 'not-an-email',
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('A valid email is required');
    });

    it('rejects password shorter than 12 characters with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: 'First CEO',
          email: 'ceo@laboura.local',
          password: 'Short123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('at least 12 characters');
    });
  });

  describe('POST /staff/bootstrap lifecycle and state enforcement', () => {
    beforeEach(async () => {
      await clearAllStaff();
    });

    it('succeeds on an empty database with secret, creates CEO with totpEnabled: false, and writes audit log with "bootstrap" sentinel', async () => {
      const payload = {
        name: 'First CEO',
        email: 'founder@laboura.local',
        password: 'SuperSecurePassword2026!',
      };

      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.staff).toBeDefined();
      expect(res.body.staff.role).toBe('ceo');
      expect(res.body.staff.status).toBe('active');
      expect(res.body.staff.email).toBe('founder@laboura.local');
      expect(res.body.staff.name).toBe('First CEO');
      expect(res.body.staff.code).toMatch(/^CEO-\d{5}$/);

      // Bootstrap NO LONGER reveals a TOTP secret
      expect(res.body.totpSecret).toBeUndefined();
      expect(res.body.secret).toBeUndefined();
      expect(res.body.otpauthUrl).toBeUndefined();

      // Verify DB row
      const staffRow = await prisma.staff.findUnique({
        where: { id: res.body.staff.id },
      });
      expect(staffRow).toBeDefined();
      expect(staffRow?.totpEnabled).toBe(false);
      expect(staffRow?.totpSecret).toBeNull();

      // Verify audit log has actorId = 'bootstrap'
      const audit = await prisma.auditLog.findFirst({
        where: { entityCode: res.body.staff.code, action: 'staff.created' },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorId).toBe('bootstrap');
      expect(audit?.entityType).toBe('staff');

      // Calling again immediately after returns 403 and creates nothing
      const secondCall = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: 'Imposter CEO',
          email: 'imposter@laboura.local',
          password: 'AnotherValidPassword123!',
        });

      expect(secondCall.status).toBe(403);
      expect(secondCall.body.message).toContain('Staff bootstrap is only allowed when no staff accounts exist');

      const totalStaff = await prisma.staff.count();
      expect(totalStaff).toBe(1);
    });

    it('allows bootstrapped CEO to log in with password and complete 2FA enrolment on first login', async () => {
      const bootstrapRes = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: 'First CEO',
          email: 'ceo.login.test@laboura.local',
          password: 'SuperSecurePassword2026!',
        });
      expect(bootstrapRes.status).toBe(201);

      // 1. Password only -> 200 with totp_setup scope
      const passwordLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({
          staffCode: bootstrapRes.body.staff.code,
          password: 'SuperSecurePassword2026!',
          deviceId: 'bootstrap-ceo-device',
        });
      expect(passwordLogin.status).toBe(200);
      expect(passwordLogin.body.totpEnrollmentRequired).toBe(true);
      const setupToken = passwordLogin.body.accessToken as string;

      // 2. Setup and enable 2FA
      const setupRes = await request(app.getHttpServer())
        .post('/staff/2fa/setup')
        .set('Authorization', `Bearer ${setupToken}`)
        .set('X-Forwarded-For', freshIp())
        .send();
      expect(setupRes.status).toBe(200);
      const secret = setupRes.body.secret as string;
      const validTotpCode = await stableTotpCode(secret);

      const enableRes = await request(app.getHttpServer())
        .post('/staff/2fa/enable')
        .set('Authorization', `Bearer ${setupToken}`)
        .set('X-Forwarded-For', freshIp())
        .send({ totpCode: validTotpCode });
      expect(enableRes.status).toBe(200);

      // 3. Password + valid TOTP -> 200 and issues full token
      const successLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({
          staffCode: bootstrapRes.body.staff.code,
          password: 'SuperSecurePassword2026!',
          deviceId: 'bootstrap-ceo-device',
          totpCode: validTotpCode,
        });
      expect(successLogin.status).toBe(200);
      expect(successLogin.body.accessToken).toBeDefined();
      expect(successLogin.body.totpEnrollmentRequired).toBeUndefined();
    });

    it('handles concurrent calls on an empty table: exactly one succeeds, the other gets 403', async () => {
      const clientIp1 = freshIp();
      const clientIp2 = freshIp();

      const req1 = request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', clientIp1)
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: 'CEO Racer 1',
          email: 'racer1@laboura.local',
          password: 'PasswordRace123456!',
        });

      const req2 = request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', clientIp2)
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: 'CEO Racer 2',
          email: 'racer2@laboura.local',
          password: 'PasswordRace123456!',
        });

      const [res1, res2] = await Promise.all([req1, req2]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 403]);

      const count = await prisma.staff.count();
      expect(count).toBe(1);
    });

    it('enforces rate limiting on repeated requests from same client', async () => {
      const fixedIp = '10.99.99.1';
      const fixedEmail = 'throttle@laboura.local';

      // 5 requests allowed
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/staff/bootstrap')
          .set('X-Forwarded-For', fixedIp)
          .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
          .send({
            name: 'Throttle Test',
            email: fixedEmail,
            password: 'short', // 400 validation error, still hits throttle guard
          });
      }

      // 6th request within 1 min should be throttled (429)
      const throttled = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', fixedIp)
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: 'Throttle Test',
          email: fixedEmail,
          password: 'short',
        });

      expect(throttled.status).toBe(429);
    });
  });

  describe('Part B: Console login UI templates contain TOTP 2FA elements', () => {
    it('Admin Dashboard template contains TOTP field and inline 2FA enrollment elements', async () => {
      const res = await request(app.getHttpServer()).get('/admin').expect(200);
      const html = res.text;

      expect(html).toContain('id="login-totp"');
      expect(html).toContain('id="totp-enroll-section"');
      expect(html).toContain('id="totp-setup-secret"');
      expect(html).toContain('id="totp-enroll-code"');
      expect(html).toContain('id="btn-enable-totp"');
      expect(html).toContain('/staff/2fa/setup');
      expect(html).toContain('/staff/2fa/enable');
      expect(html).toContain('totpEnrollmentRequired');
    });

    it('Call Agent Console template contains TOTP field and inline 2FA enrollment elements', async () => {
      const res = await request(app.getHttpServer()).get('/call-agent').expect(200);
      const html = res.text;

      expect(html).toContain('id="login-totp"');
      expect(html).toContain('id="totp-enroll-section"');
      expect(html).toContain('id="totp-setup-secret"');
      expect(html).toContain('id="totp-enroll-code"');
      expect(html).toContain('id="btn-enable-totp"');
      expect(html).toContain('/staff/2fa/setup');
      expect(html).toContain('/staff/2fa/enable');
      expect(html).toContain('totpEnrollmentRequired');
    });

    it('Field Agent App template contains TOTP field and inline 2FA enrollment elements', async () => {
      const res = await request(app.getHttpServer()).get('/field-agent').expect(200);
      const html = res.text;

      expect(html).toContain('id="login-totp"');
      expect(html).toContain('id="totp-enroll-section"');
      expect(html).toContain('id="totp-setup-secret"');
      expect(html).toContain('id="totp-enroll-code"');
      expect(html).toContain('id="btn-enable-totp"');
      expect(html).toContain('/staff/2fa/setup');
      expect(html).toContain('/staff/2fa/enable');
      expect(html).toContain('totpEnrollmentRequired');
    });
  });
});

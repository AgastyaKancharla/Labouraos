import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TotpService } from '../../common/auth/totp.service';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { seed } from '../../../prisma/seed';

describe('Phase 8 Task 10: First-admin bootstrap and 2FA login UI', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let totpService: TotpService;

  let ipCounter = 1;
  const freshIp = () => `10.98.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  async function clearAllStaff() {
    await prisma.staffSession.deleteMany({});
    await prisma.businessVisit.deleteMany({});
    await prisma.contactAttempt.deleteMany({});
    await prisma.callbackTask.deleteMany({});
    await prisma.vacancy.updateMany({ data: { capturedByStaffId: null } });
    await prisma.staff.updateMany({ data: { teamLeadId: null } });
    await prisma.auditLog.deleteMany({});
    await prisma.staff.deleteMany({});
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();

    prisma = app.get(PrismaService);
    totpService = app.get(TotpService);
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

    it('succeeds on an empty database, returns TOTP secret and URI, creates CEO, and writes audit log with "bootstrap" sentinel', async () => {
      const payload = {
        name: 'First CEO',
        email: 'founder@laboura.local',
        password: 'SuperSecurePassword2026!',
      };

      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.staff).toBeDefined();
      expect(res.body.staff.role).toBe('ceo');
      expect(res.body.staff.status).toBe('active');
      expect(res.body.staff.email).toBe('founder@laboura.local');
      expect(res.body.staff.name).toBe('First CEO');
      expect(res.body.staff.code).toMatch(/^CEO-\d{5}$/);

      // TOTP secret revealed once
      expect(res.body.totpSecret).toBeDefined();
      expect(typeof res.body.totpSecret).toBe('string');
      expect(res.body.totpSecret.length).toBeGreaterThanOrEqual(16);
      expect(res.body.otpauthUrl).toContain('otpauth://totp/');

      // Verify DB row
      const staffRow = await prisma.staff.findUnique({
        where: { id: res.body.staff.id },
      });
      expect(staffRow).toBeDefined();
      expect(staffRow?.totpEnabled).toBe(true);
      expect(staffRow?.totpSecret).toBe(res.body.totpSecret);

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

    it('allows bootstrapped CEO to log in with password and TOTP code', async () => {
      const bootstrapRes = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .send({
          name: 'First CEO',
          email: 'ceo.login.test@laboura.local',
          password: 'SuperSecurePassword2026!',
        });
      expect(bootstrapRes.status).toBe(201);

      const secret = bootstrapRes.body.totpSecret;
      const validTotpCode = totpService.generateToken(secret);

      // 1. Password only -> rejected (401)
      const noTotp = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({
          email: 'ceo.login.test@laboura.local',
          password: 'SuperSecurePassword2026!',
        });
      expect(noTotp.status).toBe(401);
      expect(noTotp.body.message).toContain('TOTP 2FA code is required');

      // 2. Password + valid TOTP -> 200 and issues full token
      const successLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({
          email: 'ceo.login.test@laboura.local',
          password: 'SuperSecurePassword2026!',
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
        .send({
          name: 'CEO Racer 1',
          email: 'racer1@laboura.local',
          password: 'PasswordRace123456!',
        });

      const req2 = request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', clientIp2)
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

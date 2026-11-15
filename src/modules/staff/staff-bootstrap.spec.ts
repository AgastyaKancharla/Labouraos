import { stableTotpCode } from '../../test-support/enrolled-login-spec';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { seed } from '../../../prisma/seed';

describe('Phase 8 Task 10 (rev 174–175): First-admin bootstrap with a temporary password', () => {
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
    await prisma.staff.updateMany({ data: { teamLeadId: null, reportsToId: null, tempPasswordIssuedByStaffId: null } });
    await prisma.passwordResetRequest.deleteMany({});
    await prisma.staffPasswordReset.deleteMany({});
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

    it('takes no password and no email is needed: the CEO gets a temporary password instead', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({ name: 'First CEO', password: 'ignored-anyway' });
      expect(res.status).toBe(201);
      expect(res.body.staff.email).toBeNull();
      expect(res.body.tempPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: res.body.staff.id } });
      // The password typed in the request was never stored.
      const bcrypt = await import('bcrypt');
      expect(await bcrypt.compare('ignored-anyway', row.passwordHash)).toBe(false);
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
      expect(res.body.staff.status).toBe('pending_invite');
      expect(res.body.tempPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
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

    it('the bootstrapped CEO signs in with the temporary password, sets the password and authenticator in set-up, then logs in fully', async () => {
      const bootstrapRes = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({ name: 'First CEO', email: 'ceo.login.test@laboura.local' });
      expect(bootstrapRes.status).toBe(201);

      const first = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: bootstrapRes.body.staff.code, password: bootstrapRes.body.tempPassword, deviceId: 'bootstrap-ceo-device' });
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('setup_required');
      const ticket = { setupTicket: first.body.setupTicket, deviceId: 'bootstrap-ceo-device' };
      const setupRes = await request(app.getHttpServer()).post('/auth/setup/authenticator').set('X-Forwarded-For', freshIp()).send(ticket);
      expect(setupRes.status).toBe(200);
      const secret = setupRes.body.secret as string;
      await request(app.getHttpServer())
        .post('/auth/setup/complete')
        .set('X-Forwarded-For', freshIp())
        .send({ ...ticket, newPassword: 'SuperSecurePassword2026!', totpCode: await stableTotpCode(secret) })
        .expect(200);

      const successLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: bootstrapRes.body.staff.code, password: 'SuperSecurePassword2026!', deviceId: 'bootstrap-ceo-device', totpCode: await stableTotpCode(secret) });
      expect(successLogin.status).toBe(200);
      expect(successLogin.body.accessToken).toBeDefined();
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
            name2: 'x', // the throttle guard counts every call, whatever the answer
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
        });

      expect(throttled.status).toBe(429);
    });
  });
});

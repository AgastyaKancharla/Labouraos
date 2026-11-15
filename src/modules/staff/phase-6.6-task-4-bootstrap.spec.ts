import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { stableTotpCode } from '../../test-support/enrolled-login-spec';
import { seed } from '../../../prisma/seed';

describe('Phase 6.6 Task 4: Harden the CEO bootstrap', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const BOOTSTRAP_SECRET = 'test_bootstrap_secret_for_task_4_testing_32_chars';
  let ipCounter = 1;
  const freshIp = () => `10.64.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

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
    process.env.STAFF_BOOTSTRAP_SECRET = BOOTSTRAP_SECRET;
    await clearAllStaff();
    await seed(prisma);
    await app.close();
  });

  describe('Full E2E Lifecycle: Bootstrap → temporary password → first-login set-up (password + authenticator) → Full Access', () => {
    beforeEach(async () => {
      process.env.STAFF_BOOTSTRAP_SECRET = BOOTSTRAP_SECRET;
      await clearAllStaff();
    });

    it('creates the CEO "Not signed in yet" with a temporary password (shown once), no authenticator secret; set-up switches password and authenticator on together; then full access', async () => {
      // 1. Bootstrap with secret header; email is optional.
      const bootstrapRes = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({ name: 'First CEO' });

      expect(bootstrapRes.status).toBe(201);
      expect(bootstrapRes.headers['cache-control']).toContain('no-store');
      expect(bootstrapRes.body.staff).toMatchObject({ role: 'ceo', status: 'pending_invite', email: null, name: 'First CEO' });
      expect(bootstrapRes.body.staff.code).toMatch(/^CEO-\d{5}$/);
      expect(bootstrapRes.body.tempPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(bootstrapRes.body.totpSecret).toBeUndefined();
      expect(bootstrapRes.body.secret).toBeUndefined();
      expect(bootstrapRes.body.otpauthUrl).toBeUndefined();

      const staffRow = await prisma.staff.findUniqueOrThrow({ where: { id: bootstrapRes.body.staff.id } });
      expect(staffRow.totpEnabled).toBe(false);
      expect(staffRow.totpSecret).toBeNull();
      const audit = await prisma.auditLog.findFirst({ where: { entityCode: staffRow.code, action: 'staff.created' } });
      expect(audit?.actorId).toBe('bootstrap');
      expect(JSON.stringify(audit)).not.toContain(bootstrapRes.body.tempPassword);

      // 2. The temporary password gives a set-up ticket, never a session.
      const firstLoginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: staffRow.code, password: bootstrapRes.body.tempPassword, deviceId: 'phase66-ceo-device' });
      expect(firstLoginRes.status).toBe(200);
      expect(firstLoginRes.body).toMatchObject({ status: 'setup_required', authenticatorSetupRequired: true });
      expect(firstLoginRes.body.accessToken).toBeUndefined();
      const ticket = { setupTicket: firstLoginRes.body.setupTicket, deviceId: 'phase66-ceo-device' };

      // 3. Authenticator QR inside the set-up, then the new password and first code together.
      const setupRes = await request(app.getHttpServer()).post('/auth/setup/authenticator').set('X-Forwarded-For', freshIp()).send(ticket);
      expect(setupRes.status).toBe(200);
      expect(setupRes.body.otpauthUrl).toContain('otpauth://totp/');
      const totpSecret = setupRes.body.secret as string;
      const password = 'SuperSecurePassword2026!';
      const done = await request(app.getHttpServer())
        .post('/auth/setup/complete')
        .set('X-Forwarded-For', freshIp())
        .send({ ...ticket, newPassword: password, totpCode: await stableTotpCode(totpSecret) });
      expect(done.status).toBe(200);
      const staffAfterEnrol = await prisma.staff.findUniqueOrThrow({ where: { id: staffRow.id } });
      expect(staffAfterEnrol).toMatchObject({ status: 'active', totpEnabled: true, totpSecret, tempPasswordHash: null });

      // 4. Password + authenticator code: full token (the CEO approves his own device with it).
      const fullLoginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ staffCode: staffRow.code, password, deviceId: 'phase66-ceo-device', totpCode: await stableTotpCode(totpSecret) });
      expect(fullLoginRes.status).toBe(200);
      const fullProbeRes = await request(app.getHttpServer())
        .get('/staff')
        .set('Authorization', `Bearer ${fullLoginRes.body.accessToken}`)
        .set('X-Forwarded-For', freshIp());
      expect(fullProbeRes.status).toBe(200);
      expect(Array.isArray(fullProbeRes.body)).toBe(true);
    });

    it('accepts the secret from body field "secret"', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .send({
          name: 'CEO Body Secret',
          email: 'ceo.body.secret@laboura.local',
          password: 'SuperSecurePassword2026!',
          secret: BOOTSTRAP_SECRET,
        });

      expect(res.status).toBe(201);
      expect(res.body.staff.email).toBe('ceo.body.secret@laboura.local');
    });

    it('accepts the secret from body field "bootstrapSecret"', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .send({
          name: 'CEO Body BootstrapSecret',
          email: 'ceo.body.bsecret@laboura.local',
          password: 'SuperSecurePassword2026!',
          bootstrapSecret: BOOTSTRAP_SECRET,
        });

      expect(res.status).toBe(201);
      expect(res.body.staff.email).toBe('ceo.body.bsecret@laboura.local');
    });
  });

  describe('Refusal Semantics & Protection', () => {
    beforeEach(async () => {
      process.env.STAFF_BOOTSTRAP_SECRET = BOOTSTRAP_SECRET;
      await clearAllStaff();
    });

    it('refuses with generic message when no secret is supplied', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .send({
          name: 'Attacker CEO',
          email: 'attacker@laboura.local',
          password: 'AttackerPassword123!',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        'Staff bootstrap is only allowed when no staff accounts exist',
      );
    });

    it('refuses with the same generic message when wrong secret is supplied', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', 'completely_wrong_secret_value')
        .send({
          name: 'Attacker CEO',
          email: 'attacker@laboura.local',
          password: 'AttackerPassword123!',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        'Staff bootstrap is only allowed when no staff accounts exist',
      );
    });

    it('refuses with a distinctly different error when STAFF_BOOTSTRAP_SECRET is unset in environment', async () => {
      const savedSecret = process.env.STAFF_BOOTSTRAP_SECRET;
      try {
        delete process.env.STAFF_BOOTSTRAP_SECRET;

        const res = await request(app.getHttpServer())
          .post('/staff/bootstrap')
          .set('X-Forwarded-For', freshIp())
          .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
          .send({
            name: 'First CEO',
            email: 'founder@laboura.local',
            password: 'SuperSecurePassword2026!',
          });

        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Server not configured for bootstrap');
      } finally {
        process.env.STAFF_BOOTSTRAP_SECRET = savedSecret;
      }
    });

    it('refuses with a distinctly different error when STAFF_BOOTSTRAP_SECRET is empty string in environment', async () => {
      const savedSecret = process.env.STAFF_BOOTSTRAP_SECRET;
      try {
        process.env.STAFF_BOOTSTRAP_SECRET = '   ';

        const res = await request(app.getHttpServer())
          .post('/staff/bootstrap')
          .set('X-Forwarded-For', freshIp())
          .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
          .send({
            name: 'First CEO',
            email: 'founder@laboura.local',
            password: 'SuperSecurePassword2026!',
          });

        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Server not configured for bootstrap');
      } finally {
        process.env.STAFF_BOOTSTRAP_SECRET = savedSecret;
      }
    });

    it('returns the same generic message when the database is already bootstrapped (even with correct secret)', async () => {
      // 1. Initial bootstrap succeeds
      const first = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: 'First CEO',
          email: 'founder@laboura.local',
          password: 'SuperSecurePassword2026!',
        });
      expect(first.status).toBe(201);

      // 2. Second call with correct secret returns exact same generic refusal as wrong secret
      const second = await request(app.getHttpServer())
        .post('/staff/bootstrap')
        .set('X-Forwarded-For', freshIp())
        .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
        .send({
          name: 'Second CEO',
          email: 'second@laboura.local',
          password: 'SuperSecurePassword2026!',
        });

      expect(second.status).toBe(403);
      expect(second.body.message).toBe(
        'Staff bootstrap is only allowed when no staff accounts exist',
      );
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
  });
});

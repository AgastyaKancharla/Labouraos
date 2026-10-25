import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { TotpService } from './totp.service';
import { JwtPayload } from './jwt-payload.interface';
import { stableTotpCode } from '../../test-support/enrolled-login-spec';

describe('Phase 8: 2FA is mandatory — password-only tokens are scope-limited to TOTP enrolment', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let totp: TotpService;

  const ts = Date.now();
  const password = 'Enrol-Me-Please-123';
  const createdIds: string[] = [];
  let counter = 0;

  const roles = ['ceo', 'manager', 'call_agent', 'field_agent', 'finance'];

  async function mkStaff(
    role: string,
    extra: Partial<{ totpEnabled: boolean; totpSecret: string | null }> = {},
  ) {
    const email = `tfa_${role}_${ts}_${counter++}@laboura.local`;
    const staff = await prisma.staff.create({
      data: {
        code: `TFA-${role.toUpperCase()}-${ts}-${counter}`,
        name: `TFA ${role}`,
        email,
        role,
        area: role === 'field_agent' ? 'Koramangala' : null,
        passwordHash: await bcrypt.hash(password, 4),
        ...extra,
      },
    });
    createdIds.push(staff.id);
    return { id: staff.id, email };
  }

  const passwordOnlyLogin = (email: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  const get = (path: string, token: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);

  const post = (path: string, token: string, body: object = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    totp = app.get(TotpService);
  });

  afterAll(async () => {
    await prisma.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await app.close();
  });

  describe('an account that has not enrolled yet', () => {
    it('can log in with just the password, but is told it must enrol and gets a scope-limited token', async () => {
      const { email } = await mkStaff('ceo');

      const res = await passwordOnlyLogin(email);

      expect(res.status).toBe(200);
      expect(res.body.totpEnrollmentRequired).toBe(true);
      const claims = jwt.decode(res.body.accessToken) as JwtPayload;
      expect(claims.scope).toBe('totp_setup');
    });

    it('is refused (403) on an ordinary endpoint such as GET /staff, even for a CEO', async () => {
      const { email } = await mkStaff('ceo');
      const { body } = await passwordOnlyLogin(email);

      const res = await get('/staff', body.accessToken);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Two-factor enrolment required');
    });

    it.each(roles)(
      'a password-only %s token is rejected on authenticated endpoints across the API',
      async (role) => {
        const { email } = await mkStaff(role);
        const { body } = await passwordOnlyLogin(email);

        for (const path of ['/staff/sessions', '/staff', '/pricing', '/job-seekers']) {
          const res = await get(path, body.accessToken);
          expect({ path, status: res.status }).toEqual({ path, status: 403 });
        }
        const write = await post('/staff', body.accessToken, { name: 'x' });
        expect(write.status).toBe(403);
        const otp = await post('/otp/send', body.accessToken, { phone: '9876543210' });
        expect(otp.status).toBe(403);
      },
    );

    it('succeeds on the TOTP setup endpoint and the enable endpoint', async () => {
      const { id, email } = await mkStaff('call_agent');
      const { body } = await passwordOnlyLogin(email);

      const setup = await post('/staff/2fa/setup', body.accessToken);
      expect(setup.status).toBe(200);
      expect(setup.body.secret).toBeDefined();
      expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

      const enable = await post('/staff/2fa/enable', body.accessToken, {
        totpCode: await stableTotpCode(setup.body.secret),
      });
      expect(enable.status).toBe(200);

      const row = await prisma.staff.findUniqueOrThrow({ where: { id } });
      expect(row.totpEnabled).toBe(true);
    });

    it('enabling with a wrong code fails and the account stays unenrolled', async () => {
      const { id, email } = await mkStaff('call_agent');
      const { body } = await passwordOnlyLogin(email);
      await post('/staff/2fa/setup', body.accessToken);

      const enable = await post('/staff/2fa/enable', body.accessToken, {
        totpCode: '000000',
      });

      expect(enable.status).toBe(401);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id } });
      expect(row.totpEnabled).toBe(false);
    });

    it('an account flagged enabled but missing its secret is treated as unenrolled (fails closed)', async () => {
      const { email } = await mkStaff('manager', { totpEnabled: true, totpSecret: null });

      const { body } = await passwordOnlyLogin(email);

      expect(body.totpEnrollmentRequired).toBe(true);
      expect((await get('/staff', body.accessToken)).status).toBe(403);
    });
  });

  describe('once enrolled', () => {
    async function enrolledAccount(role = 'manager') {
      const { id, email } = await mkStaff(role);
      const { body: limited } = await passwordOnlyLogin(email);
      const setup = await post('/staff/2fa/setup', limited.accessToken);
      await post('/staff/2fa/enable', limited.accessToken, {
        totpCode: await stableTotpCode(setup.body.secret),
      });
      return { id, email, secret: setup.body.secret as string, limitedToken: limited.accessToken as string };
    }

    it('a plain password-only login is rejected outright — no token at all', async () => {
      const { email } = await enrolledAccount();

      const res = await passwordOnlyLogin(email);

      expect(res.status).toBe(401);
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.message).toContain('TOTP 2FA code is required');
    });

    it('a wrong code is rejected, a correct code yields a full-scope token that reaches GET /staff', async () => {
      const { email, secret } = await enrolledAccount();

      const wrong = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password, totpCode: '000000' });
      expect(wrong.status).toBe(401);

      const right = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password, totpCode: await stableTotpCode(secret) });
      expect(right.status).toBe(200);
      expect(right.body.totpEnrollmentRequired).toBeUndefined();
      expect((jwt.decode(right.body.accessToken) as JwtPayload).scope).toBeUndefined();
      expect((await get('/staff', right.body.accessToken)).status).toBe(200);
    });

    it('the pre-enrolment token stays limited after enrolment — it does not upgrade itself', async () => {
      const { limitedToken } = await enrolledAccount();

      expect((await get('/staff', limitedToken)).status).toBe(403);
    });

    it('setup cannot be re-run on an enrolled account, so 2FA cannot be silently switched off', async () => {
      const { id, email, secret } = await enrolledAccount();
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password, totpCode: await stableTotpCode(secret) });

      const rerun = await post('/staff/2fa/setup', login.body.accessToken);

      expect(rerun.status).toBe(409);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id } });
      expect(row.totpEnabled).toBe(true);
      expect(row.totpSecret).toBe(secret);
      expect(totp.verify(await stableTotpCode(secret), row.totpSecret!)).toBe(true);
    });
  });
});

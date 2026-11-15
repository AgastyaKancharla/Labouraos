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

describe('2FA is mandatory: a password alone never opens a session for an authenticator role (rev 174–175)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let totp: TotpService;

  const ts = Date.now();
  const password = 'Enrol-Me-Please-123';
  const createdIds: string[] = [];
  let counter = 0;

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
        passwordHash: await bcrypt.hash(password, 4),
        ...extra,
      },
    });
    createdIds.push(staff.id);
    return { id: staff.id, email, code: staff.code };
  }

  const passwordOnlyLogin = async (email: string) => {
    const staff = await prisma.staff.findUniqueOrThrow({ where: { email } });
    return request(app.getHttpServer()).post('/auth/login').send({
      staffCode: staff.code,
      password,
      deviceId: 'tfa-test-device',
    });
  };

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
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'staff', subjectId: { in: createdIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await app.close();
  });

  describe('an account that has not enrolled yet', () => {
    it.each(['ceo', 'manager', 'finance', 'team_lead'])(
      'a %s with a password but no authenticator gets no token at all and is told to ask for a temporary password',
      async (role) => {
        const { id, email } = await mkStaff(role);
        const res = await passwordOnlyLogin(email);
        expect(res.status).toBe(401);
        expect(res.body.accessToken).toBeUndefined();
        expect(res.body.message).toContain('Ask a senior for a temporary password');
        expect(await prisma.staffSession.count({ where: { staffId: id } })).toBe(0);
      },
    );

    it.each(['call_agent', 'field_agent'])(
      'a %s is not given a TOTP enrolment token',
      async (role) => {
        const { email } = await mkStaff(role);
        const res = await passwordOnlyLogin(email);
        expect(res.status).toBe(401);
        expect(res.body.accessToken).toBeUndefined();
        expect(res.body.message).toContain('waiting for approval');
      },
    );

    it('an account flagged enabled but missing its secret is treated as unenrolled (fails closed)', async () => {
      const { email } = await mkStaff('manager', { totpEnabled: true, totpSecret: null });
      const res = await passwordOnlyLogin(email);
      expect(res.status).toBe(401);
      expect(res.body.accessToken).toBeUndefined();
    });

    it('a token that still carries the old totp_setup scope is refused on ordinary endpoints', async () => {
      const { id, code } = await mkStaff('ceo');
      const session = await prisma.staffSession.create({
        data: { staffId: id, expiresAt: new Date(Date.now() + 900_000), absoluteExpiresAt: new Date(Date.now() + 7_200_000), lastActivityAt: new Date() },
      });
      const limited = jwt.sign({ sub: id, role: 'ceo', email: null, code, sid: session.id, scope: 'totp_setup' } as JwtPayload);
      for (const path of ['/staff/sessions', '/staff', '/pricing', '/job-seekers']) {
        const res = await get(path, limited);
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
      }
      expect((await post('/staff', limited, { name: 'x' })).status).toBe(403);
    });

    it('enrolment happens only inside the first-login set-up, with a temporary password: the old 2FA endpoints are gone', async () => {
      const { id, code } = await mkStaff('manager', { totpEnabled: false });
      const session = await prisma.staffSession.create({
        data: { staffId: id, expiresAt: new Date(Date.now() + 900_000), absoluteExpiresAt: new Date(Date.now() + 7_200_000), lastActivityAt: new Date() },
      });
      const token = jwt.sign({ sub: id, role: 'manager', email: null, code, sid: session.id } as JwtPayload);
      expect((await post('/staff/2fa/setup', token)).status).toBe(404);
      expect((await post('/staff/2fa/enable', token, { totpCode: '123456' })).status).toBe(404);
    });
  });

  describe('once enrolled', () => {
    async function enrolledAccount(role = 'manager') {
      const secret = totp.generateSecret();
      const { id, email } = await mkStaff(role, { totpEnabled: true, totpSecret: secret });
      if (role !== 'ceo') {
        await prisma.staffDevice.create({
          data: { staffId: id, deviceId: 'tfa-test-device', label: 'x', platform: 'web', status: 'approved', approvedAt: new Date() },
        });
      }
      return { id, email, secret };
    }

    it('a plain password-only login is rejected outright — no token at all', async () => {
      const { email } = await enrolledAccount();
      const res = await passwordOnlyLogin(email);
      expect(res.status).toBe(401);
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.message).toContain('TOTP 2FA code is required');
    });

    it.each(['manager', 'team_lead'])('a wrong code is rejected, a correct code yields a full-scope token (%s)', async (role) => {
      const { email, secret } = await enrolledAccount(role);
      const staff = await prisma.staff.findUniqueOrThrow({ where: { email } });
      const wrong = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ staffCode: staff.code, password, deviceId: 'tfa-test-device', totpCode: '000000' });
      expect(wrong.status).toBe(401);
      const right = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ staffCode: staff.code, password, deviceId: 'tfa-test-device', totpCode: await stableTotpCode(secret) });
      expect(right.status).toBe(200);
      expect(right.body.status).toBeUndefined();
      expect((jwt.decode(right.body.accessToken) as JwtPayload).scope).toBeUndefined();
      expect((await get('/staff', right.body.accessToken)).status).toBe(200);
    });
  });
});

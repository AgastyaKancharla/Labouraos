import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthClock } from './auth.service';
import { applyTrustProxy } from '../http/trust-proxy';
import { stableTotpCode } from '../../test-support/enrolled-login-spec';

/**
 * M1: a wrong authenticator code counts on the account like a wrong password.
 * Before, the right password reset the count to 0 just before the code was
 * checked, so someone who knew a Manager's password could try codes forever.
 */
describe('M1: wrong authenticator codes lock the account like wrong passwords', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let now = new Date('2026-06-20T05:30:00.000Z');
  const clock = { now: () => now };
  const password = 'Totp-Lockout-Password-1';
  const createdIds: string[] = [];
  let counter = 0;
  let ip = 0;
  // A different address each time, so the 5-a-minute throttle per address never answers first.
  const freshIp = () => `198.51.100.${(ip = (ip % 250) + 1)}`;

  async function makeManager() {
    counter += 1;
    const secret = authenticator.generateSecret();
    const staff = await prisma.staff.create({
      data: {
        code: `TL-LOCK-${Date.now()}-${counter}`,
        name: `Totp lock ${counter}`,
        email: `totp-lock-${counter}-${Date.now()}@laboura.local`,
        passwordHash: await bcrypt.hash(password, 4),
        role: 'manager',
        status: 'active',
        totpSecret: secret,
        totpEnabled: true,
      },
    });
    createdIds.push(staff.id);
    const deviceId = `totp-lock-${staff.id}`;
    await prisma.staffDevice.create({
      data: { staffId: staff.id, deviceId, label: 'Handset', platform: 'android', status: 'approved', approvedAt: now },
    });
    return { staff, secret, deviceId };
  }

  async function wrongCodeFor(secret: string): Promise<string> {
    const right = await stableTotpCode(secret);
    return right === '000000' ? '111111' : '000000';
  }

  function login(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/auth/login').set('X-Forwarded-For', freshIp()).send(body);
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await app.close();
  });

  it('locks after failedLoginLimit wrong codes (right password), refuses the right code while locked, and lets it in after the lock ends', async () => {
    const rules = await prisma.pricingPolicy.findFirstOrThrow({ orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const { staff, secret, deviceId } = await makeManager();
    const wrong = await wrongCodeFor(secret);

    for (let i = 1; i < rules.failedLoginLimit; i += 1) {
      const res = await login({ staffCode: staff.code, password, deviceId, totpCode: wrong });
      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid TOTP code');
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLoginCount).toBe(i);
    }
    const last = await login({ staffCode: staff.code, password, deviceId, totpCode: wrong });
    expect(last.status).toBe(401);
    expect(last.body.message).toMatch(/Account is locked until/);
    const locked = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(locked.lockedUntil).toBeTruthy();

    // The right password and the right code are refused while locked.
    const refused = await login({ staffCode: staff.code, password, deviceId, totpCode: await stableTotpCode(secret) });
    expect(refused.status).toBe(401);
    expect(refused.body.message).toMatch(/Account is locked/);
    expect(refused.body.accessToken).toBeUndefined();

    const lockRow = await prisma.auditLog.findFirst({
      where: { actorId: staff.id, action: 'auth.login.refused', entityCode: staff.code },
      orderBy: { createdAt: 'desc' },
    });
    expect(lockRow).toBeTruthy();

    // After the lock ends, the right code gets in and the count starts again.
    now = new Date(now.getTime() + rules.lockoutMinutes * 60 * 1000 + 1000);
    const ok = await login({ staffCode: staff.code, password, deviceId, totpCode: await stableTotpCode(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeDefined();
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLoginCount).toBe(0);
  });

  it('the right password alone (code still to come) is not counted as a wrong try', async () => {
    const rules = await prisma.pricingPolicy.findFirstOrThrow({ orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const { staff, secret, deviceId } = await makeManager();
    for (let i = 0; i < rules.failedLoginLimit + 1; i += 1) {
      const res = await login({ staffCode: staff.code, password, deviceId });
      expect(res.status).toBe(401);
      expect(res.body.message).toContain('TOTP 2FA code is required');
    }
    const ok = await login({ staffCode: staff.code, password, deviceId, totpCode: await stableTotpCode(secret) });
    expect(ok.status).toBe(200);
  });

  it('wrong passwords and wrong codes add up on the same count', async () => {
    const rules = await prisma.pricingPolicy.findFirstOrThrow({ orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const { staff, secret, deviceId } = await makeManager();
    const wrong = await wrongCodeFor(secret);
    await login({ staffCode: staff.code, password: 'not-the-password-1', deviceId });
    for (let i = 2; i <= rules.failedLoginLimit; i += 1) {
      await login({ staffCode: staff.code, password, deviceId, totpCode: wrong });
    }
    const after = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(after.failedLoginCount).toBe(rules.failedLoginLimit);
    expect(after.lockedUntil).toBeTruthy();
  });
});

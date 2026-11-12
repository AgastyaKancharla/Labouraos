import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { applyTrustProxy } from '../http/trust-proxy';
import { TotpService, TOTP_STEP_SECONDS, claimTotpStep } from './totp.service';
import { TOTP_REUSED } from './auth.service';

/**
 * Security check L9: an authenticator code works once. The same code inside its 30
 * seconds is refused, at login and after it was used to switch the authenticator on.
 */
describe('L9: an authenticator code is accepted only once', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const password = 'Totp-Reuse-Password-1';
  const createdIds: string[] = [];
  let counter = 0;
  let ip = 0;
  const freshIp = () => `198.51.100.${(ip = (ip % 250) + 1)}`;

  /** The current code, taken early enough in its step that it is still valid for both requests. */
  async function codeWithTimeLeft(secret: string): Promise<string> {
    const stepMs = TOTP_STEP_SECONDS * 1000;
    const remaining = stepMs - (Date.now() % stepMs);
    if (remaining < 10_000) await new Promise((resolve) => setTimeout(resolve, remaining + 50));
    return authenticator.generate(secret);
  }

  async function makeManager(enrolled: boolean) {
    counter += 1;
    const secret = authenticator.generateSecret();
    const staff = await prisma.staff.create({
      data: {
        code: `TRU-${Date.now()}-${counter}`,
        name: `Totp reuse ${counter}`,
        email: `totp-reuse-${counter}-${Date.now()}@laboura.local`,
        passwordHash: await bcrypt.hash(password, 4),
        role: 'manager',
        status: 'active',
        totpSecret: secret,
        totpEnabled: enrolled,
      },
    });
    createdIds.push(staff.id);
    const deviceId = `totp-reuse-${staff.id}`;
    await prisma.staffDevice.create({
      data: { staffId: staff.id, deviceId, label: 'Handset', platform: 'web', status: 'approved', approvedAt: new Date() },
    });
    return { staff, secret, deviceId };
  }

  const login = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/login').set('X-Forwarded-For', freshIp()).send(body);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
  }, 60000);

  it('refuses the same code for a second login within its 30 seconds, and counts it like a wrong code', async () => {
    const { staff, secret, deviceId } = await makeManager(true);
    const code = await codeWithTimeLeft(secret);
    const first = await login({ staffCode: staff.code, password, deviceId, totpCode: code });
    expect(first.status).toBe(200);
    const again = await login({ staffCode: staff.code, password, deviceId, totpCode: code });
    expect(again.status).toBe(401);
    expect(again.body.message).toBe(TOTP_REUSED);
    expect(again.body.accessToken).toBeUndefined();
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(row.failedLoginCount).toBe(1);
    expect(row.totpLastStep).toBe(Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS));
  }, 60000);

  it('refuses a login with the code that just switched the authenticator on', async () => {
    const { staff, secret, deviceId } = await makeManager(false);
    const setupLogin = await login({ staffCode: staff.code, password, deviceId });
    expect(setupLogin.status).toBe(200);
    const code = await codeWithTimeLeft(secret);
    await request(app.getHttpServer())
      .post('/staff/2fa/enable')
      .set('Authorization', `Bearer ${setupLogin.body.accessToken}`)
      .send({ totpCode: code })
      .expect(200);
    const reused = await login({ staffCode: staff.code, password, deviceId, totpCode: code });
    expect(reused.status).toBe(401);
    expect(reused.body.message).toBe(TOTP_REUSED);
  }, 60000);

  it('claims each step once, a later step after it, never an earlier one', async () => {
    const { staff } = await makeManager(true);
    expect(await claimTotpStep(prisma, staff.id, 1000)).toBe(true);
    expect(await claimTotpStep(prisma, staff.id, 1000)).toBe(false);
    expect(await claimTotpStep(prisma, staff.id, 999)).toBe(false);
    expect(await claimTotpStep(prisma, staff.id, 1001)).toBe(true);
    // Two claims of the same step at the same moment: exactly one wins.
    const both = await Promise.all([claimTotpStep(prisma, staff.id, 1002), claimTotpStep(prisma, staff.id, 1002)]);
    expect(both.filter(Boolean)).toHaveLength(1);
  });

  it('works out the step of a valid code, and none for a wrong one', () => {
    const totp = new TotpService();
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    const step = totp.verifyStep(code, secret);
    expect([Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS), Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) - 1]).toContain(step);
    expect(totp.verifyStep(code === '000000' ? '111111' : '000000', secret)).toBeNull();
    expect(totp.verifyStep('12345', secret)).toBeNull();
  });
});

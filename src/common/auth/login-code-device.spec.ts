import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { applyTrustProxy } from '../http/trust-proxy';
import { loginCodeFor, loginRequestProofFor } from '../../modules/login-code/login-code.crypto';

/**
 * A login code works only for the device and sign-in that asked for it
 * (auth.service.ts verifyLoginCode). The 6-digit code is read out by a Team
 * Lead and can be overheard; on its own it is no longer enough.
 */
describe('Login code tied to the device and sign-in that asked for it', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const password = 'Login-Device-Password-1';
  const createdIds: string[] = [];
  let counter = 0;
  let ip = 0;
  const freshIp = () => `10.77.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;

  async function makeAgent() {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `LD-CA-${Date.now()}-${counter}`,
        name: `Login device ${counter}`,
        passwordHash: await bcrypt.hash(password, 4),
        role: 'call_agent',
        status: 'active',
      },
    });
    createdIds.push(staff.id);
    const deviceId = `ld-phone-${staff.id}`;
    const otherDeviceId = `ld-other-${staff.id}`;
    for (const id of [deviceId, otherDeviceId]) {
      await prisma.staffDevice.create({
        data: { staffId: staff.id, deviceId: id, label: 'Phone', platform: 'android', status: 'approved', approvedAt: new Date() },
      });
    }
    return { staff, deviceId, otherDeviceId };
  }

  async function startLogin(staffCode: string, deviceId: string) {
    const res = await request(app.getHttpServer()).post('/auth/login').set('X-Forwarded-For', freshIp()).send({ staffCode, password, deviceId });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('awaiting_code');
    expect(typeof res.body.loginRequestProof).toBe('string');
    return res.body as { loginRequestId: string; loginRequestProof: string };
  }

  function verify(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/auth/login/verify-code').set('X-Forwarded-For', freshIp()).send(body);
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await app.close();
  });

  it('refuses the right code from another device, or without this sign-in\'s proof, and does not use up a try', async () => {
    const { staff, deviceId, otherDeviceId } = await makeAgent();
    const waiting = await startLogin(staff.code, deviceId);
    const code = loginCodeFor(waiting.loginRequestId);

    const elsewhere = await verify({ loginRequestId: waiting.loginRequestId, code, deviceId: otherDeviceId, loginRequestProof: waiting.loginRequestProof });
    expect(elsewhere.status).toBe(401);
    expect(elsewhere.body.message).toBe('This login code can only be used on the device that asked for it');

    const noProof = await verify({ loginRequestId: waiting.loginRequestId, code, deviceId });
    expect(noProof.status).toBe(401);
    const wrongProof = await verify({ loginRequestId: waiting.loginRequestId, code, deviceId, loginRequestProof: 'x'.repeat(43) });
    expect(wrongProof.status).toBe(401);
    // A proof computed for the other device does not work on this request either.
    const swapped = await verify({
      loginRequestId: waiting.loginRequestId,
      code,
      deviceId: otherDeviceId,
      loginRequestProof: loginRequestProofFor(waiting.loginRequestId, otherDeviceId),
    });
    expect(swapped.status).toBe(401);
    const bare = await verify({ loginRequestId: waiting.loginRequestId, code });
    expect(bare.status).toBe(401);

    // None of these counted as a wrong code or used the code up.
    const row = await prisma.loginCodeRequest.findUniqueOrThrow({ where: { id: waiting.loginRequestId } });
    expect(row.status).not.toBe('used');
    expect(row.status).not.toBe('refused');
    expect(await prisma.auditLog.count({ where: { entityCode: waiting.loginRequestId, action: 'login_code.wrong_code' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityCode: waiting.loginRequestId, action: 'auth.login.refused' } })).toBeGreaterThanOrEqual(4);

    // The device and sign-in that asked get in.
    const ok = await verify({ loginRequestId: waiting.loginRequestId, code, deviceId, loginRequestProof: waiting.loginRequestProof });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeDefined();
    const session = await prisma.staffSession.findUniqueOrThrow({ where: { id: ok.body.sessionId } });
    expect(session.deviceId).toBe(deviceId);
  });

  it('a proof from one sign-in does not open another sign-in\'s code', async () => {
    const { staff, deviceId } = await makeAgent();
    const first = await startLogin(staff.code, deviceId);
    const second = await startLogin(staff.code, deviceId);
    const res = await verify({
      loginRequestId: second.loginRequestId,
      code: loginCodeFor(second.loginRequestId),
      deviceId,
      loginRequestProof: first.loginRequestProof,
    });
    expect(res.status).toBe(401);
  });

  it('L9: two verify calls at the same instant turn one code into one session only', async () => {
    const { staff, deviceId } = await makeAgent();
    const waiting = await startLogin(staff.code, deviceId);
    const body = { loginRequestId: waiting.loginRequestId, code: loginCodeFor(waiting.loginRequestId), deviceId, loginRequestProof: waiting.loginRequestProof };
    const [a, b] = await Promise.all([verify(body), verify(body)]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    expect(await prisma.staffSession.count({ where: { staffId: staff.id, loginCodeRequestId: waiting.loginRequestId } })).toBe(1);
  });
});

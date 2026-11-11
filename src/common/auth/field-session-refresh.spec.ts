import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthClock, hashRefreshToken } from './auth.service';
import { applyTrustProxy } from '../http/trust-proxy';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';
import { PricingService } from '../../modules/pricing/pricing.service';


/** The reason a refusal gives: in `details` behind main.ts's GlobalExceptionFilter, at the top level in tests. */
function reasonOf(body: { reason?: string; details?: { reason?: string } }): string | undefined {
  return body.details?.reason ?? body.reason;
}

/**
 * Laboura Field session restore (guide decision): closing the field app does
 * not log the agent out, but the 1-hour idle limit and the 2-hour limit still
 * apply. POST /auth/field/refresh issues a new access token while the session
 * is inside both limits — also after the 15-minute token has run out — and
 * refuses with the reason once either has passed.
 */
describe('Laboura Field: session restore with a refresh token', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const start = new Date('2026-06-16T04:30:00.000Z');
  let now = start;
  const clock = { now: () => now };
  const password = 'Field-Restore-Password-1';
  const createdIds: string[] = [];
  let counter = 0;
  let ip = 0;
  const freshIp = () => `10.42.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
  const minutes = (m: number) => new Date(start.getTime() + m * 60 * 1000);
  // The limits come from Settings (60 and 120 minutes in the guide).
  let idle = 60;
  let max = 120;

  async function makeStaff(role: string) {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `FR-${role.slice(0, 3).toUpperCase()}-${Date.now()}-${counter}`,
        name: `Restore ${role} ${counter}`,
        passwordHash: await bcrypt.hash(password, 4),
        role,
        status: 'active',
      },
    });
    createdIds.push(staff.id);
    const deviceId = `fr-phone-${staff.id}`;
    await prisma.staffDevice.create({
      data: { staffId: staff.id, deviceId, label: 'Phone', platform: 'android', status: 'approved', approvedAt: now },
    });
    return { staff, deviceId };
  }

  async function signIn(role = 'field_agent') {
    const { staff, deviceId } = await makeStaff(role);
    const waiting = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: staff.code, password, deviceId });
    expect(waiting.body.status).toBe('awaiting_code');
    const res = await request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .set('X-Forwarded-For', freshIp())
      .send({ loginRequestId: waiting.body.loginRequestId, code: loginCodeFor(waiting.body.loginRequestId) });
    expect(res.status).toBe(200);
    return {
      staff,
      deviceId,
      accessToken: res.body.accessToken as string,
      sessionId: res.body.sessionId as string,
      refreshToken: res.body.refreshToken as string | undefined,
    };
  }

  const refresh = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/field/refresh').set('X-Forwarded-For', freshIp()).send(body);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    const policy = await app.get(PricingService).current();
    idle = policy.idleLogoutMinutes;
    max = policy.maxSessionMinutes;
  });

  beforeEach(() => {
    now = start;
  });

  afterAll(async () => {
    await prisma.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await app.close();
  });

  it('a field agent login carries a refresh token; only its hash is stored', async () => {
    const s = await signIn();
    expect(s.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(row.tokenHash).toBe(hashRefreshToken(s.refreshToken!));
    expect(row.tokenHash).not.toBe(s.refreshToken);
  });

  it('office staff get no refresh token (their session still ends when the browser closes)', async () => {
    const s = await signIn('call_agent');
    expect(s.refreshToken).toBeUndefined();
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(row.tokenHash).toBeNull();
    const res = await refresh({ sessionId: s.sessionId, refreshToken: 'a'.repeat(64), deviceId: s.deviceId });
    expect(res.status).toBe(401);
  });

  it('inside both limits (app reopened 50 minutes later, token long expired): a new access token that works, and the next refresh token', async () => {
    const s = await signIn();
    now = minutes(idle - 10);
    const res = await refresh({ sessionId: s.sessionId, refreshToken: s.refreshToken, deviceId: s.deviceId });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(s.sessionId);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.refreshToken).not.toBe(s.refreshToken);

    // A refresh is not activity: the idle clock did not move.
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(row.lastActivityAt.toISOString()).toBe(start.toISOString());
    expect(row.revokedAt).toBeNull();

    const me = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);

    // The refresh token is single use.
    const reused = await refresh({ sessionId: s.sessionId, refreshToken: s.refreshToken, deviceId: s.deviceId });
    expect(reused.status).toBe(401);
    const chained = await refresh({ sessionId: s.sessionId, refreshToken: res.body.refreshToken, deviceId: s.deviceId });
    expect(chained.status).toBe(200);
  });

  it('after 1 hour without activity: refused with the idle reason, and the session ends', async () => {
    const s = await signIn();
    now = minutes(idle + 1);
    const res = await refresh({ sessionId: s.sessionId, refreshToken: s.refreshToken, deviceId: s.deviceId });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Session ended after being idle');
    expect(reasonOf(res.body)).toBe('idle');
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(row.endedReason).toBe('idle');
    expect(row.revokedAt).not.toBeNull();
  });

  it('after 2 hours in total, even while in use: refused with the maximum-length reason', async () => {
    const s = await signIn();
    // Activity right up to the end: the idle limit never passes.
    await prisma.staffSession.update({ where: { id: s.sessionId }, data: { lastActivityAt: minutes(max - 1) } });
    now = minutes(max + 1);
    const res = await refresh({ sessionId: s.sessionId, refreshToken: s.refreshToken, deviceId: s.deviceId });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Session has reached its maximum length');
    expect(reasonOf(res.body)).toBe('max_length');
    expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: s.sessionId } })).endedReason).toBe('max_length');
  });

  it('refuses another phone, a wrong token, and a session that was ended (logout or a newer login)', async () => {
    const s = await signIn();
    now = minutes(5);
    expect((await refresh({ sessionId: s.sessionId, refreshToken: s.refreshToken, deviceId: 'other-phone' })).status).toBe(401);
    expect((await refresh({ sessionId: s.sessionId, refreshToken: 'b'.repeat(64), deviceId: s.deviceId })).status).toBe(401);
    expect((await refresh({})).status).toBe(401);

    await request(app.getHttpServer()).post('/auth/logout').set('Authorization', `Bearer ${s.accessToken}`).expect(200);
    const res = await refresh({ sessionId: s.sessionId, refreshToken: s.refreshToken, deviceId: s.deviceId });
    expect(res.status).toBe(401);
    expect(reasonOf(res.body)).toBe('revoked');
  });

  it('refuses a locked account', async () => {
    const s = await signIn();
    await prisma.staff.update({ where: { id: s.staff.id }, data: { lockedUntil: minutes(30) } });
    now = minutes(5);
    const res = await refresh({ sessionId: s.sessionId, refreshToken: s.refreshToken, deviceId: s.deviceId });
    expect(res.status).toBe(401);
    expect(reasonOf(res.body)).toBe('locked');
  });
});

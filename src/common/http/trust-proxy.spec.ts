import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { applyTrustProxy, resolveTrustProxyHops } from './trust-proxy';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 8: rate limiting does not trust a client-spoofable X-Forwarded-For', () => {
  const ts = Date.now();
  const password = 'Throttle-Me-Not-123';
  const createdIds: string[] = [];
  let prisma: PrismaService;
  let counter = 0;

  async function bootApp(trustProxy: string | undefined): Promise<INestApplication> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    applyTrustProxy(app, trustProxy);
    await app.init();
    prisma = app.get(PrismaService);
    return app;
  }

  async function mkStaff(role = 'call_agent') {
    const email = `tp_${role}_${ts}_${counter++}@laboura.local`;
    const staff = await prisma.staff.create({
      data: {
        code: `TP-${ts}-${counter}`,
        name: 'Trust Proxy',
        email,
        role,
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
    createdIds.push(staff.id);
    return email;
  }

  /** Fires `statuses.length` wrong-password logins for one email, one forwarded-for value each. */
  async function loginBurst(app: INestApplication, email: string, forwardedFor: string[]) {
    const statuses: number[] = [];
    for (const xff of forwardedFor) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', xff)
        .send({ email, password: 'wrong-password' });
      statuses.push(res.status);
    }
    return statuses;
  }

  afterAll(async () => {
    const p = new (await import('@prisma/client')).PrismaClient();
    await p.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await p.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await p.staff.deleteMany({ where: { id: { in: createdIds } } });
    await p.$disconnect();
  });

  describe('no trusted proxy (default, TRUST_PROXY_HOPS unset)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootApp(undefined);
    });
    afterAll(async () => app.close());

    it('rotating a fake X-Forwarded-For does NOT give a fresh login bucket', async () => {
      const email = await mkStaff();
      const spoofed = Array.from({ length: 8 }, (_, i) => `198.51.100.${i + 1}`);

      const statuses = await loginBurst(app, email, spoofed);

      // limit is 5/min: the first five are real attempts (401), the rest are throttled
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toEqual([429, 429, 429]);
    });

    it('the same holds on the OTP endpoint (authenticated, throttled per phone + client)', async () => {
      const email = await mkStaff();
      const login = await enrolledLogin(app.getHttpServer(), { email, password });
      expect(login.status).toBe(200);

      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await request(app.getHttpServer())
          .post('/otp/send')
          .set('Authorization', `Bearer ${login.body.accessToken}`)
          .set('X-Forwarded-For', `203.0.113.${i + 1}`)
          .send({ phone: '9876543210' });
        statuses.push(res.status);
      }

      expect(statuses.slice(0, 5)).not.toContain(429);
      expect(statuses.slice(5)).toEqual([429, 429, 429]);
    });

    it('records the socket address on the session, not the spoofed header', async () => {
      const email = await mkStaff();
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '6.6.6.6')
        .send({ email, password });
      expect(res.status).toBe(200);

      const session = await prisma.staffSession.findUniqueOrThrow({
        where: { id: res.body.sessionId },
      });
      expect(session.ipAddress).not.toContain('6.6.6.6');
    });
  });

  describe('one trusted proxy in front (TRUST_PROXY_HOPS=1)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootApp('1');
    });
    afterAll(async () => app.close());

    it('only the entry our proxy appended counts: junk the client prepends does not rotate the bucket', async () => {
      const email = await mkStaff();
      // The client sends a different fake value each time; our proxy then appends
      // the address it actually saw (203.0.113.50) as the right-most entry.
      const viaProxy = Array.from(
        { length: 8 },
        (_, i) => `1.1.1.${i + 1}, 9.9.9.${i + 1}, 203.0.113.50`,
      );

      const statuses = await loginBurst(app, email, viaProxy);

      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toEqual([429, 429, 429]);
    });

    it('a genuinely different client (different proxy-observed address) still gets its own bucket', async () => {
      const email = await mkStaff();
      await loginBurst(app, email, Array(6).fill('spoof, 203.0.113.60'));

      const other = await loginBurst(app, email, ['spoof, 203.0.113.61']);

      expect(other).toEqual([401]);
    });

    it('records the proxy-observed client address on the session', async () => {
      const email = await mkStaff();
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '6.6.6.6, 203.0.113.70')
        .send({ email, password });

      const session = await prisma.staffSession.findUniqueOrThrow({
        where: { id: res.body.sessionId },
      });
      expect(session.ipAddress).toBe('203.0.113.70');
    });
  });

  describe('TRUST_PROXY_HOPS parsing', () => {
    it.each([
      [undefined, 0],
      ['', 0],
      ['0', 0],
      ['1', 1],
      ['2', 2],
    ])('%p resolves to %p hops', (raw, expected) => {
      expect(resolveTrustProxyHops(raw)).toBe(expected);
    });

    it.each(['abc', '-1', '1.5', '6', 'true'])(
      'rejects %p so a typo cannot silently trust everything',
      (raw) => {
        expect(() => resolveTrustProxyHops(raw)).toThrow('TRUST_PROXY_HOPS');
      },
    );
  });
});

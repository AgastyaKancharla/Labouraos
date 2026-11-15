import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { applyTrustProxy } from '../common/http/trust-proxy';
import { isPrivateOrProxyAddress, proxyCheckFor } from '../common/http/proxy-check';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtPayload } from '../common/auth/jwt-payload.interface';

describe('isPrivateOrProxyAddress / proxyCheckFor', () => {
  it('tells private, loopback, link-local and carrier NAT addresses from public ones', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '', 'nonsense']) {
      expect([ip, isPrivateOrProxyAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of ['203.0.113.9', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:4860::8888', '::ffff:49.204.1.2']) {
      expect([ip, isPrivateOrProxyAddress(ip)]).toEqual([ip, false]);
    }
  });

  it('counts the X-Forwarded-For entries and reads the hops from Express, else the environment', () => {
    expect(proxyCheckFor('1.2.3.4, 10.0.0.1 ,10.0.0.2', '10.0.0.2', 2)).toEqual({ forwardedForEntries: 3, trustProxyHops: 2, clientAddress: 'private_or_proxy' });
    expect(proxyCheckFor(undefined, '49.204.1.2', undefined, { TRUST_PROXY_HOPS: '3' })).toEqual({ forwardedForEntries: 0, trustProxyHops: 3, clientAddress: 'public' });
    expect(proxyCheckFor(['1.2.3.4', '5.6.7.8'], '5.6.7.8', undefined, { TRUST_PROXY_HOPS: 'bad' })).toEqual({ forwardedForEntries: 2, trustProxyHops: 0, clientAddress: 'public' });
  });
});

/** GET /health/proxy-check (DEPLOY.md F11): CEO only, never cached, never an address. */
describe('GET /health/proxy-check', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const ids: string[] = [];
  const tokens: Record<string, string> = {};
  const ts = Date.now();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    for (const role of ['ceo', 'manager']) {
      const staff = await prisma.staff.create({
        data: { code: `PXC-${role}-${ts}`, name: `Proxy ${role}`, role, status: 'active', passwordHash: await bcrypt.hash('x-password-1', 4) },
      });
      ids.push(staff.id);
      const session = await prisma.staffSession.create({
        data: { staffId: staff.id, expiresAt: new Date(Date.now() + 900_000), absoluteExpiresAt: new Date(Date.now() + 7_200_000), lastActivityAt: new Date() },
      });
      const payload: JwtPayload = { sub: staff.id, role, email: null, code: staff.code, sid: session.id };
      tokens[role] = jwt.sign(payload, { expiresIn: '15m' });
    }
  });

  afterAll(async () => {
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('answers the CEO with the entry count, the hops and public/private only — never an address — and is never cached', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/proxy-check')
      .set('Authorization', `Bearer ${tokens.ceo}`)
      .set('X-Forwarded-For', '198.51.100.7, 49.204.11.12')
      .expect(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body).toEqual({ forwardedForEntries: 2, trustProxyHops: 1, clientAddress: 'public' });
    expect(JSON.stringify(res.body)).not.toMatch(/198\.51|49\.204/);
    const behindProxy = await request(app.getHttpServer())
      .get('/health/proxy-check')
      .set('Authorization', `Bearer ${tokens.ceo}`)
      .set('X-Forwarded-For', '49.204.11.12, 10.0.0.7')
      .expect(200);
    expect(behindProxy.body).toEqual({ forwardedForEntries: 2, trustProxyHops: 1, clientAddress: 'private_or_proxy' });
  });

  it('refuses everyone else', async () => {
    expect((await request(app.getHttpServer()).get('/health/proxy-check')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/health/proxy-check').set('Authorization', `Bearer ${tokens.manager}`)).status).toBe(403);
  });
});

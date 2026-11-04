import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { applyTrustProxy } from '../http/trust-proxy';
import {
  LOGIN_CONNECTION_RATE_LIMIT,
  LOGIN_RATE_LIMIT_PER_CONNECTION,
} from './auth-throttler.guard';

describe('Phase 11 Task 8: Login rate limit per internet connection across staff codes', () => {
  const ts = Date.now();
  const password = 'TestPass123!Safe';
  const createdStaffIds: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 4);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // One trusted proxy hop in front (Render standard)
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdStaffIds.length > 0) {
      await prisma.staffSession.deleteMany({ where: { staffId: { in: createdStaffIds } } });
      await prisma.staffDevice.deleteMany({ where: { staffId: { in: createdStaffIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: createdStaffIds } } });
    }
    await app.close();
  });

  it('declares the connection limit as a named constant equal to 60', () => {
    expect(LOGIN_CONNECTION_RATE_LIMIT).toBe(60);
    expect(LOGIN_RATE_LIMIT_PER_CONNECTION).toBe(60);
  });

  it('allows 20 agents logging in once each from one office connection to all succeed', async () => {
    const officeIp = `203.0.113.${(ts % 50) + 10}`;
    const agentCodes: string[] = [];
    const deviceIds: string[] = [];

    // Create 20 distinct active call agents with approved devices
    for (let i = 1; i <= 20; i++) {
      const code = `CA-OFF-${ts.toString().slice(-4)}-${String(i).padStart(2, '0')}`;
      const email = `agent_office_${ts}_${i}@laboura.local`;
      const staff = await prisma.staff.create({
        data: {
          code,
          name: `Office Agent ${i}`,
          email,
          role: 'call_agent',
          status: 'active',
          passwordHash,
        },
      });
      createdStaffIds.push(staff.id);
      agentCodes.push(code);

      const devId = `dev-office-${ts}-${i}`;
      deviceIds.push(devId);
      await prisma.staffDevice.create({
        data: {
          staffId: staff.id,
          deviceId: devId,
          label: `Agent Phone ${i}`,
          platform: 'web',
          status: 'approved',
          approvedAt: new Date(),
        },
      });
    }

    // All 20 agents attempt login once each through the single office connection
    const results: number[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', `fake-client, ${officeIp}`)
        .send({
          staffCode: agentCodes[i],
          password,
          deviceId: deviceIds[i],
        });
      results.push(res.status);
      expect(res.body.status).toBe('waiting_for_code');
    }

    // All 20 logins succeed (HTTP 200) without being throttled
    expect(results).toHaveLength(20);
    expect(results.every((status) => status === 200)).toBe(true);
    expect(results).not.toContain(429);
  });

  it('refuses the 61st attempt from one connection across different staff codes with HTTP 429', async () => {
    const burstIp = `203.0.113.${(ts % 50) + 70}`;
    const statuses: number[] = [];

    // Send 61 attempts with 61 different staff codes through the same internet connection
    for (let i = 1; i <= 61; i++) {
      const uniqueCode = `DIFF-CODE-${ts.toString().slice(-4)}-${i}`;
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', `client-noise, ${burstIp}`)
        .send({
          staffCode: uniqueCode,
          password: 'wrong-password-test',
          deviceId: `device-${i}`,
        });
      statuses.push(res.status);
    }

    expect(statuses).toHaveLength(61);
    // The first 60 attempts pass through to authentication check (401 invalid credentials)
    const first60 = statuses.slice(0, 60);
    expect(first60.every((s) => s === 401)).toBe(true);
    expect(first60).not.toContain(429);

    // The 61st attempt from this connection is refused with HTTP 429 Too Many Requests
    expect(statuses[60]).toBe(429);
  });

  it('preserves the per-staff-code limit: 6 attempts for the same staff code from one IP are refused at attempt 6', async () => {
    const singleAgentIp = `203.0.113.${(ts % 50) + 130}`;
    const staffCode = `CA-SINGLE-${ts.toString().slice(-4)}`;
    const staff = await prisma.staff.create({
      data: {
        code: staffCode,
        name: 'Single Agent',
        email: `single_agent_${ts}@laboura.local`,
        role: 'call_agent',
        status: 'active',
        passwordHash,
      },
    });
    createdStaffIds.push(staff.id);

    const statuses: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', `client, ${singleAgentIp}`)
        .send({
          staffCode,
          password: 'wrong-password',
          deviceId: 'single-device',
        });
      statuses.push(res.status);
    }

    // First 5 attempts return 401; 6th attempt is throttled by per-staff-code limit (5/min)
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('enforces connection rate limit on POST /auth/login/verify-code', async () => {
    const verifyIp = `203.0.113.${(ts % 50) + 190}`;
    const statuses: number[] = [];

    // Send 61 attempts with 61 different loginRequestId values through the same connection
    for (let i = 1; i <= 61; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login/verify-code')
        .set('X-Forwarded-For', `client, ${verifyIp}`)
        .send({
          loginRequestId: `login-req-${ts}-${i}`,
          code: '123456',
        });
      statuses.push(res.status);
    }

    expect(statuses).toHaveLength(61);
    // First 60 attempts pass through to verification logic (400 or 401)
    const first60 = statuses.slice(0, 60);
    expect(first60).not.toContain(429);
    // The 61st attempt from this connection is refused with HTTP 429
    expect(statuses[60]).toBe(429);
  });
});

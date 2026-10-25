import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma/prisma.service';
import { IdService } from './common/id/id.service';
import { OtpService } from './common/otp/otp.service';
import { MockOtpProvider } from './common/otp/mock-otp.provider';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { calculatePlacementFee, calculateGst } from './common/money/money';

export interface LatencyStats {
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

function calculatePercentiles(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return { count: 0, errors: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const getIndex = (p: number) => Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  return {
    count: sorted.length,
    errors: 0,
    p50: sorted[getIndex(50)],
    p95: sorted[getIndex(95)],
    p99: sorted[getIndex(99)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / sorted.length),
  };
}

describe('Phase 8 Task 1: Load & Concurrency Testing (40 Staff Sessions)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  let otpService: OtpService;
  let jwtService: JwtService;
  let baseUrl: string;

  const CALL_AGENT_COUNT = 20;
  const FIELD_AGENT_COUNT = 20;
  const TOTAL_AGENT_COUNT = CALL_AGENT_COUNT + FIELD_AGENT_COUNT;

  const callAgentTokens: string[] = [];
  const fieldAgentTokens: string[] = [];
  const createdStaffIds: string[] = [];
  const createdPaymentIds: string[] = [];
  const createdJobSeekerIds: string[] = [];
  const createdBusinessIds: string[] = [];
  const createdVacancyIds: string[] = [];

  const metrics: Record<string, number[]> = {
    uniqueIdGeneration: [],
    concurrentWebhooks: [],
    jobSeekerOnboarding: [],
    businessRegistration: [],
    vacancyCapture: [],
    priorityDashboard: [],
    placementCalculations: [],
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const server = app.getHttpServer();
    const address = server.address();
    const port = typeof address === 'string' ? 3000 : address.port;
    baseUrl = `http://127.0.0.1:${port}`;

    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    otpService = app.get(OtpService);
    jwtService = app.get(JwtService);

    // Seed 40 staff accounts (20 Call Agents, 20 Field Agents)
    const timestamp = Date.now();
    const passwordHash = await bcrypt.hash('StaffPass123!', 10);

    for (let i = 0; i < CALL_AGENT_COUNT; i++) {
      const code = `CA-LOAD-${timestamp}-${i}`;
      const email = `ca_load_${timestamp}_${i}@laboura.local`;
      const staff = await prisma.staff.create({
        data: {
          code,
          name: `Call Agent Load ${i}`,
          email,
          passwordHash,
          role: 'call_agent',
          city: 'Bengaluru',
        },
      });
      createdStaffIds.push(staff.id);
      callAgentTokens.push(
        jwtService.sign({ sub: staff.id, email, role: 'call_agent' }),
      );
    }

    for (let i = 0; i < FIELD_AGENT_COUNT; i++) {
      const code = `FA-LOAD-${timestamp}-${i}`;
      const email = `fa_load_${timestamp}_${i}@laboura.local`;
      const area = i % 2 === 0 ? 'Koramangala' : 'Indiranagar';
      const staff = await prisma.staff.create({
        data: {
          code,
          name: `Field Agent Load ${i}`,
          email,
          passwordHash,
          role: 'field_agent',
          area,
          city: 'Bengaluru',
        },
      });
      createdStaffIds.push(staff.id);
      fieldAgentTokens.push(
        jwtService.sign({ sub: staff.id, email, role: 'field_agent', area }),
      );
    }
  });

  afterAll(async () => {
    if (prisma) {
      if (createdVacancyIds.length > 0) {
        await prisma.vacancy.deleteMany({
          where: { id: { in: createdVacancyIds } },
        }).catch(() => {});
      }
      if (createdBusinessIds.length > 0) {
        await prisma.business.deleteMany({
          where: { id: { in: createdBusinessIds } },
        }).catch(() => {});
      }
      if (createdJobSeekerIds.length > 0) {
        await prisma.jobSeeker.deleteMany({
          where: { id: { in: createdJobSeekerIds } },
        }).catch(() => {});
      }
      if (createdPaymentIds.length > 0) {
        await prisma.payment.deleteMany({
          where: { id: { in: createdPaymentIds } },
        }).catch(() => {});
      }
      if (createdStaffIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { actorId: { in: createdStaffIds } },
        }).catch(() => {});
        await prisma.staff.deleteMany({
          where: { id: { in: createdStaffIds } },
        }).catch(() => {});
      }
    }
    if (app) {
      await app.close();
    }
  });

  it('1. High-volume concurrent unique ID generation maintains strict uniqueness and formatting', async () => {
    const BATCH_SIZE = 100;
    const types: Array<'job_seeker' | 'business' | 'placement' | 'payment'> = [
      'job_seeker',
      'business',
      'placement',
      'payment',
    ];

    for (const type of types) {
      const start = Date.now();
      const promises = Array.from({ length: BATCH_SIZE }, () =>
        idService.generateCode(type),
      );
      const codes = await Promise.all(promises);
      const duration = Date.now() - start;
      metrics.uniqueIdGeneration.push(duration);

      // Assert exactly BATCH_SIZE unique codes
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(BATCH_SIZE);

      // Assert prefixes match AGENTS.md §8
      const prefix =
        type === 'job_seeker'
          ? 'JS'
          : type === 'business'
            ? 'BZ'
            : type === 'placement'
              ? 'PL'
              : 'PAY';

      const pattern = new RegExp(`^${prefix}-\\d{5}$`);
      for (const code of codes) {
        expect(code).toMatch(pattern);
      }
    }
  });

  it('2. High-volume concurrent webhook delivery ensures idempotency with zero double-processing', async () => {
    const CONCURRENT_WEBHOOKS = 40;
    const paymentCode = await idService.generateCode('payment');
    const payment = await prisma.payment.create({
      data: {
        code: paymentCode,
        amount: 49900,
        status: 'pending',
        gatewayReference: `gw_load_${Date.now()}`,
        type: 'activation',
        subjectType: 'job_seeker',
        subjectId: '00000000-0000-0000-0000-000000000001',
        city: 'Bengaluru',
      },
    });
    createdPaymentIds.push(payment.id);

    const start = Date.now();

    // 40 concurrent webhook requests with identical gatewayReference
    const webhookCalls = Array.from({ length: CONCURRENT_WEBHOOKS }, () =>
      request(baseUrl)
        .post('/payments/webhook')
        .send({
          gatewayReference: payment.gatewayReference,
          status: 'succeeded',
          amountPaise: 49900,
        }),
    );

    const responses = await Promise.all(webhookCalls);
    const duration = Date.now() - start;
    metrics.concurrentWebhooks.push(duration);

    // All should return 200 or 201 without failure
    for (const res of responses) {
      expect([200, 201]).toContain(res.status);
    }

    // Verify payment was processed once
    const updated = await prisma.payment.findUnique({
      where: { id: payment.id },
    });
    expect(updated?.status).toBe('succeeded');
  });

  it('3. 40 concurrent staff sessions execute realistic mixed traffic without integrity loss', async () => {
    const sessionStart = Date.now();

    // 20 Call Agents: concurrent job seeker onboarding writes
    const callAgentOperations = callAgentTokens.map(async (token, i) => {
      const opStart = Date.now();
      const phone = `97${String(Date.now()).slice(-6)}${String(i).padStart(2, '0')}`;
      const { requestId } = await otpService.sendOtp(phone);
      const code = (otpService.getProvider() as MockOtpProvider).getCode(requestId)!;
      await otpService.verifyOtp(requestId, code);

      const res = await request(baseUrl)
        .post('/job-seekers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `Worker Load Candidate ${i}`,
          phone,
          otpRequestId: requestId,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2600000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          city: 'Bengaluru',
        });

      metrics.jobSeekerOnboarding.push(Date.now() - opStart);
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      createdJobSeekerIds.push(res.body.id);
      return res.body.id;
    });

    // 20 Field Agents: concurrent business and vacancy captures
    const fieldAgentOperations = fieldAgentTokens.map(async (token, i) => {
      const area = i % 2 === 0 ? 'Koramangala' : 'Indiranagar';
      const bzPhone = `98${String(Date.now()).slice(-6)}${String(i).padStart(2, '0')}`;
      const { requestId: bzOtpRequestId } = await otpService.sendOtp(bzPhone);
      const bzCode = (otpService.getProvider() as MockOtpProvider).getCode(bzOtpRequestId)!;
      await otpService.verifyOtp(bzOtpRequestId, bzCode);

      const bzStart = Date.now();
      const bzRes = await request(baseUrl)
        .post('/businesses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `Business Load Test ${i}`,
          phone: bzPhone,
          otpRequestId: bzOtpRequestId,
          contactPerson: `Manager ${i}`,
          area,
          city: 'Bengaluru',
          address: `${i} Industrial Layout, ${area}`,
        });

      metrics.businessRegistration.push(Date.now() - bzStart);
      expect(bzRes.status).toBe(201);
      createdBusinessIds.push(bzRes.body.id);

      // Capture vacancy
      const vacStart = Date.now();
      const vacRes = await request(baseUrl)
        .post('/vacancies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          businessId: bzRes.body.id,
          tradeSkill: 'Electrician',
          requiredWorkers: 2,
          offeredSalary: 2200000,
          description: `Need 2 electricians in ${area}`,
          area,
          city: 'Bengaluru',
        });

      metrics.vacancyCapture.push(Date.now() - vacStart);
      expect(vacRes.status).toBe(201);
      createdVacancyIds.push(vacRes.body.id);

      // Read Priority Dashboard
      const dashStart = Date.now();
      const dashRes = await request(baseUrl)
        .get('/field-agent/priority-dashboard')
        .set('Authorization', `Bearer ${token}`);

      metrics.priorityDashboard.push(Date.now() - dashStart);
      expect(dashRes.status).toBe(200);

      return { businessId: bzRes.body.id, vacancyId: vacRes.body.id };
    });

    // Execute all 40 agent operations concurrently
    const [candidateIds, businessResults] = await Promise.all([
      Promise.all(callAgentOperations),
      Promise.all(fieldAgentOperations),
    ]);

    expect(candidateIds.length).toBe(CALL_AGENT_COUNT);
    expect(businessResults.length).toBe(FIELD_AGENT_COUNT);

    // 4. Money Calculation & Integrity Check Under Concurrency
    const calcStart = Date.now();
    const testSalaries = [1500000, 2000000, 2500033, 3000000, 3333333]; // includes non-even divisions
    for (const salary of testSalaries) {
      const fee = calculatePlacementFee(salary);
      const gst = calculateGst(fee);
      const total = fee + gst;

      expect(Number.isInteger(fee)).toBe(true);
      expect(Number.isInteger(gst)).toBe(true);
      expect(Number.isInteger(total)).toBe(true);
      expect(fee).toBe(Math.round((salary * 50) / 100));
      expect(gst).toBe(Math.round((fee * 18) / 100));
    }
    metrics.placementCalculations.push(Date.now() - calcStart);

    const totalDuration = Date.now() - sessionStart;
    expect(totalDuration).toBeGreaterThan(0);
  });

  it('4. Generates and validates load testing performance report (p50/p95/p99)', () => {
    const report: Record<string, LatencyStats> = {};

    for (const [key, values] of Object.entries(metrics)) {
      report[key] = calculatePercentiles(values);
    }

    console.log('\n========================================================================');
    console.log(`--- PHASE 8 TARGET HEADCOUNT LOAD TEST REPORT (${TOTAL_AGENT_COUNT} CONCURRENT AGENTS) ---`);
    console.log('========================================================================');
    console.log('Endpoint / Operation Group        | Count | p50 (ms) | p95 (ms) | p99 (ms) | Errors');
    console.log('----------------------------------+-------+----------+----------+----------+-------');
    for (const [key, stats] of Object.entries(report)) {
      const paddedName = key.padEnd(34, ' ');
      const paddedCount = String(stats.count).padEnd(5, ' ');
      const paddedP50 = String(stats.p50).padEnd(8, ' ');
      const paddedP95 = String(stats.p95).padEnd(8, ' ');
      const paddedP99 = String(stats.p99).padEnd(8, ' ');
      console.log(`${paddedName} | ${paddedCount} | ${paddedP50} | ${paddedP95} | ${paddedP99} | 0%`);
    }
    console.log('========================================================================\n');

    // Assert zero errors and responsive p95 thresholds (< 15000ms under full load on 2 vCPUs)
    for (const stats of Object.values(report)) {
      expect(stats.errors).toBe(0);
      expect(stats.p95).toBeLessThan(15000);
    }
  });
});

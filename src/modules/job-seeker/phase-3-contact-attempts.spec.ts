import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 3 Task 1: Contact-Attempt Logging', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let callAgentToken: string;
  let callAgentId: string;
  let managerToken: string;
  let managerId: string;
  let ceoToken: string;
  let ceoId: string;
  let fieldAgentToken: string;
  let fieldAgentId: string;
  let financeToken: string;
  let financeId: string;

  let testJobSeekerId: string;
  let testJobSeekerCode: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

  beforeAll(async () => {
    process.env.CALL_ROUTING_KEY = 'click_to_call_routing_key_32_characters';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-CA-${timestamp}`,
        name: 'Call Agent CA',
        email: `ca_ca_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;

    const manager = await prisma.staff.create({
      data: {
        code: `MG-CA-${timestamp}`,
        name: 'Manager CA',
        email: `mg_ca_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    managerId = manager.id;

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-CA-${timestamp}`,
        name: 'CEO CA',
        email: `ceo_ca_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    ceoId = ceo.id;

    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-CA-${timestamp}`,
        name: 'Field Agent CA',
        email: `fa_ca_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });
    fieldAgentId = fieldAgent.id;

    const finance = await prisma.staff.create({
      data: {
        code: `FI-CA-${timestamp}`,
        name: 'Finance CA',
        email: `fi_ca_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    financeId = finance.id;

    const server = app.getHttpServer();
    const login = async (email: string | null) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    callAgentToken = await login(callAgent.email);
    managerToken = await login(manager.email);
    ceoToken = await login(ceo.email);
    fieldAgentToken = await login(fieldAgent.email);
    financeToken = await login(finance.email);

    testJobSeekerCode = `JS-CA-${timestamp}`;
    const jobSeeker = await prisma.jobSeeker.create({
      data: {
        code: testJobSeekerCode,
        name: 'Contact Attempt Worker',
        phone: `93${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Plumber',
        minSalary: 1500000,
        maxSalary: 2200000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    testJobSeekerId = jobSeeker.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.contactAttempt.deleteMany({
        where: { jobSeekerId: testJobSeekerId },
      });
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: [callAgentId, managerId, ceoId, fieldAgentId, financeId] },
        },
      });
      if (testJobSeekerId) {
        await prisma.jobSeeker.deleteMany({ where: { id: testJobSeekerId } });
      }
      await prisma.staff.deleteMany({
        where: { id: { in: [callAgentId, managerId, ceoId, fieldAgentId, financeId] } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('the hand-entry contact attempts endpoint is gone (404) for all roles', async () => {
    for (const token of [callAgentToken, managerToken, ceoToken, fieldAgentToken, financeToken]) {
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'am',
        });
      expect(res.status).toBe(404);
    }
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

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
    const login = async (email: string) => {
      const res = await request(server).post('/auth/login').send({ email, password });
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

  it('call_agent can log contact attempts (call, whatsapp, sms)', async () => {
    const attemptedAt = new Date('2026-10-18T10:30:00.000Z');

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        channel: 'call',
        outcome: 'no_pickup',
        attemptedAt: attemptedAt.toISOString(),
        timeOfDay: 'am',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.jobSeekerId).toBe(testJobSeekerId);
    expect(res.body.channel).toBe('call');
    expect(res.body.outcome).toBe('no_pickup');
    expect(res.body.timeOfDay).toBe('am');
    expect(new Date(res.body.attemptedAt).toISOString()).toBe(attemptedAt.toISOString());

    // Check database
    const dbRecord = await prisma.contactAttempt.findUnique({
      where: { id: res.body.id },
    });
    expect(dbRecord).toBeDefined();
    expect(dbRecord?.channel).toBe('call');
    expect(dbRecord?.outcome).toBe('no_pickup');
    expect(dbRecord?.timeOfDay).toBe('am');
    expect(dbRecord?.staffId).toBe(callAgentId);

    // Check audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        actorId: callAgentId,
        action: 'job_seeker.contact_attempt',
        entityCode: testJobSeekerCode,
      },
    });
    expect(audit).toBeDefined();
    expect(audit?.entityType).toBe('job_seeker');
  });

  it('manager and ceo can also log contact attempts', async () => {
    const mgrRes = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        channel: 'whatsapp',
        outcome: 'picked_up',
        timeOfDay: 'pm',
      });
    expect(mgrRes.status).toBe(201);
    expect(mgrRes.body.channel).toBe('whatsapp');
    expect(mgrRes.body.outcome).toBe('picked_up');

    const ceoRes = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        channel: 'sms',
        outcome: 'no_pickup',
        timeOfDay: 'pm',
      });
    expect(ceoRes.status).toBe(201);
    expect(ceoRes.body.channel).toBe('sms');
  });

  it('rejects invalid channels, outcomes, timeOfDay, and malformed dates', async () => {
    const badChannel = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        channel: 'email',
        outcome: 'no_pickup',
        timeOfDay: 'am',
      });
    expect(badChannel.status).toBe(400);

    const badOutcome = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        channel: 'call',
        outcome: 'busy',
        timeOfDay: 'am',
      });
    expect(badOutcome.status).toBe(400);

    const badTime = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        channel: 'call',
        outcome: 'no_pickup',
        timeOfDay: 'evening',
      });
    expect(badTime.status).toBe(400);

    const badDate = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        channel: 'call',
        outcome: 'no_pickup',
        timeOfDay: 'am',
        attemptedAt: 'not-a-date',
      });
    expect(badDate.status).toBe(400);
  });

  it('returns 404 for unknown job seeker', async () => {
    const res = await request(app.getHttpServer())
      .post('/job-seekers/00000000-0000-0000-0000-000000000000/contact-attempts')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        channel: 'call',
        outcome: 'no_pickup',
        timeOfDay: 'am',
      });
    expect(res.status).toBe(404);
  });

  it('field_agent and finance are denied POST /job-seekers/:id/contact-attempts (403)', async () => {
    const faRes = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({
        channel: 'call',
        outcome: 'no_pickup',
        timeOfDay: 'am',
      });
    expect(faRes.status).toBe(403);

    const fiRes = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        channel: 'call',
        outcome: 'no_pickup',
        timeOfDay: 'am',
      });
    expect(fiRes.status).toBe(403);
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobSeekerService } from './job-seeker.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 3 Task 2: Hit Recording', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobSeekerService: JobSeekerService;

  let callAgentToken: string;
  let callAgentId: string;
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
    jobSeekerService = app.get<JobSeekerService>(JobSeekerService);
    const passwordHash = await bcrypt.hash(password, 10);

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-HIT-${timestamp}`,
        name: 'Call Agent Hit',
        email: `ca_hit_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;

    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-HIT-${timestamp}`,
        name: 'Field Agent Hit',
        email: `fa_hit_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });
    fieldAgentId = fieldAgent.id;

    const finance = await prisma.staff.create({
      data: {
        code: `FI-HIT-${timestamp}`,
        name: 'Finance Hit',
        email: `fi_hit_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    financeId = finance.id;

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    callAgentToken = await login(callAgent.email);
    fieldAgentToken = await login(fieldAgent.email);
    financeToken = await login(finance.email);

    testJobSeekerCode = `JS-HIT-${timestamp}`;
    const jobSeeker = await prisma.jobSeeker.create({
      data: {
        code: testJobSeekerCode,
        name: 'Hit Test Worker',
        phone: `94${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Carpenter',
        minSalary: 1600000,
        maxSalary: 2400000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
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
      await prisma.jobSeekerHit.deleteMany({
        where: { jobSeekerId: testJobSeekerId },
      });
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: [callAgentId, fieldAgentId, financeId] },
        },
      });
      if (testJobSeekerId) {
        await prisma.jobSeeker.deleteMany({ where: { id: testJobSeekerId } });
      }
      await prisma.staff.deleteMany({
        where: { id: { in: [callAgentId, fieldAgentId, financeId] } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('rejects a no_pickup hit without the required logged attempts', async () => {
    await expect(
      jobSeekerService.recordHit(testJobSeekerId, 'no_pickup', 'No pickup test', callAgentId),
    ).rejects.toThrow('Cannot record no_pickup hit');

    const jobSeeker = await prisma.jobSeeker.findUnique({
      where: { id: testJobSeekerId },
    });
    expect(jobSeeker?.hitCount).toBe(0);
  });

  it('rejects no_pickup hit when attempts are incomplete (e.g. only AM call + WhatsApp, missing PM call)', async () => {
    const today = new Date();

    // Log AM no_pickup call
    await prisma.contactAttempt.create({
      data: {
        jobSeekerId: testJobSeekerId,
        channel: 'call',
        outcome: 'no_pickup',
        timeOfDay: 'am',
        attemptedAt: today,
        staffId: callAgentId,
      },
    });

    // Log WhatsApp attempt
    await prisma.contactAttempt.create({
      data: {
        jobSeekerId: testJobSeekerId,
        channel: 'whatsapp',
        outcome: 'no_pickup',
        timeOfDay: 'am',
        attemptedAt: today,
        staffId: callAgentId,
      },
    });

    // Should still fail because PM no_pickup call is missing
    await expect(
      jobSeekerService.recordHit(testJobSeekerId, 'no_pickup', 'Incomplete attempts', callAgentId),
    ).rejects.toThrow('Cannot record no_pickup hit');
  });

  it('succeeds recording a no_pickup hit when AM call + PM call + WhatsApp/SMS exist for the same day', async () => {
    const today = new Date();

    // Complete the requirement by adding the PM no_pickup call
    await prisma.contactAttempt.create({
      data: {
        jobSeekerId: testJobSeekerId,
        channel: 'call',
        outcome: 'no_pickup',
        timeOfDay: 'pm',
        attemptedAt: today,
        staffId: callAgentId,
      },
    });

    const result = await jobSeekerService.recordHit(
      testJobSeekerId,
      'no_pickup',
      'All 3 attempts verified',
      callAgentId,
    );

    expect(result.id).toBeDefined();
    expect(result.reason).toBe('no_pickup');
    expect(result.note).toBe('All 3 attempts verified');
    expect(result.recordedBy).toBe(callAgentId);
    expect(result.hitCount).toBe(1);

    const updatedJobSeeker = await prisma.jobSeeker.findUnique({
      where: { id: testJobSeekerId },
    });
    expect(updatedJobSeeker?.hitCount).toBe(1);

    // Assert that the qualifying contact attempts are now linked to this hit
    const linkedAttempts = await prisma.contactAttempt.findMany({
      where: { hitId: result.id },
    });
    expect(linkedAttempts.length).toBe(3);

    // Audit log was created
    const audit = await prisma.auditLog.findFirst({
      where: {
        actorId: callAgentId,
        action: 'job_seeker.hit',
        entityCode: testJobSeekerCode,
      },
    });
    expect(audit).toBeDefined();
  });

  it('offer_rejected can be recorded directly by an agent without the attempt prerequisite', async () => {
    const result = await jobSeekerService.recordHit(
      testJobSeekerId,
      'offer_rejected',
      'Candidate rejected offer within salary range',
      fieldAgentId,
    );

    expect(result.reason).toBe('offer_rejected');
    expect(result.recordedBy).toBe(fieldAgentId);
    expect(result.hitCount).toBe(2);

    const jobSeeker = await prisma.jobSeeker.findUnique({
      where: { id: testJobSeekerId },
    });
    expect(jobSeeker?.hitCount).toBe(2);
  });

  it('interview_no_show can be recorded directly via POST /job-seekers/:id/hits endpoint', async () => {
    // Note: this will be the 3rd hit, so it transitions to deactivated
    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/hits`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        reason: 'interview_no_show',
        note: 'Candidate failed to show up for interview',
      });

    expect(res.status).toBe(201);
    expect(res.body.reason).toBe('interview_no_show');
    expect(res.body.hitCount).toBe(3);
    expect(res.body.status).toBe('deactivated');

    const jobSeeker = await prisma.jobSeeker.findUnique({
      where: { id: testJobSeekerId },
    });
    expect(jobSeeker?.hitCount).toBe(3);
    expect(jobSeeker?.status).toBe('deactivated');
  });

  it('rejects invalid hit reasons', async () => {
    await expect(
      jobSeekerService.recordHit(testJobSeekerId, 'invalid_reason', 'note', callAgentId),
    ).rejects.toThrow('Invalid hit reason');
  });

  it('field_agent and finance are denied POST /job-seekers/:id/hits (403)', async () => {
    const faRes = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/hits`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({
        reason: 'offer_rejected',
      });
    expect(faRes.status).toBe(403);

    const fiRes = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/hits`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        reason: 'offer_rejected',
      });
    expect(fiRes.status).toBe(403);
  });
});

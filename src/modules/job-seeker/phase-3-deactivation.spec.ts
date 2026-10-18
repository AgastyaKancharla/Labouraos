import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobSeekerService } from './job-seeker.service';

describe('Phase 3 Task 4: 3-Hit Deactivation and Refund Entitlement', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobSeekerService: JobSeekerService;

  let callAgentToken: string;
  let callAgentId: string;
  let jobSeekerId: string;
  let jobSeekerCode: string;

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
        code: `CA-DEACT-${timestamp}`,
        name: 'Call Agent Deact',
        email: `ca_deact_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;

    const server = app.getHttpServer();
    const loginRes = await request(server)
      .post('/auth/login')
      .send({ email: callAgent.email, password });
    callAgentToken = loginRes.body.accessToken;

    // Create active job seeker who paid 5 days ago (well within 30-day guarantee)
    jobSeekerCode = `JS-DEACT-${timestamp}`;
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    const js = await prisma.jobSeeker.create({
      data: {
        code: jobSeekerCode,
        name: 'Deactivation Candidate',
        phone: `95${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Painter',
        minSalary: 1400000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
        paymentReceivedAt: fiveDaysAgo,
        city: 'Bengaluru',
      },
    });
    jobSeekerId = js.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.contactAttempt.deleteMany({
        where: { jobSeekerId },
      });
      await prisma.jobSeekerHit.deleteMany({
        where: { jobSeekerId },
      });
      await prisma.auditLog.deleteMany({
        where: { entityCode: jobSeekerCode },
      });
      if (jobSeekerId) {
        await prisma.jobSeeker.deleteMany({ where: { id: jobSeekerId } });
      }
      await prisma.staff.deleteMany({
        where: { id: callAgentId },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('initially has 0 hits, status active, and is refund-guarantee eligible', async () => {
    const res = await request(app.getHttpServer())
      .get(`/job-seekers/${jobSeekerId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hitCount).toBe(0);
    expect(res.body.status).toBe('active');
    expect(res.body.isWithinRefundGuarantee).toBe(true);
  });

  it('1st hit increments hit count to 1 and keeps status active and refund eligible', async () => {
    const hit1 = await jobSeekerService.recordHit(
      jobSeekerId,
      'offer_rejected',
      'Candidate rejected 1st suitable offer',
      callAgentId,
    );

    expect(hit1.hitCount).toBe(1);
    expect(hit1.status).toBe('active');

    const res = await request(app.getHttpServer())
      .get(`/job-seekers/${jobSeekerId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hitCount).toBe(1);
    expect(res.body.status).toBe('active');
    expect(res.body.isWithinRefundGuarantee).toBe(true);
  });

  it('2nd hit increments hit count to 2, does NOT deactivate, and retains refund eligibility', async () => {
    const hit2 = await jobSeekerService.recordHit(
      jobSeekerId,
      'interview_no_show',
      'Candidate did not show up for 1st interview',
      callAgentId,
    );

    expect(hit2.hitCount).toBe(2);
    expect(hit2.status).toBe('active');

    const res = await request(app.getHttpServer())
      .get(`/job-seekers/${jobSeekerId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hitCount).toBe(2);
    expect(res.body.status).toBe('active');
    expect(res.body.isWithinRefundGuarantee).toBe(true);
  });

  it('3rd hit deactivates the profile and zeroes out refund eligibility immediately in the same transaction', async () => {
    const hit3 = await jobSeekerService.recordHit(
      jobSeekerId,
      'offer_rejected',
      'Candidate rejected 2nd suitable offer (3rd hit total)',
      callAgentId,
    );

    expect(hit3.hitCount).toBe(3);
    expect(hit3.status).toBe('deactivated');

    // Profile in DB is updated
    const jsInDb = await prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    expect(jsInDb?.hitCount).toBe(3);
    expect(jsInDb?.status).toBe('deactivated');

    // Immediately reflected in GET /job-seekers/:id
    const res = await request(app.getHttpServer())
      .get(`/job-seekers/${jobSeekerId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hitCount).toBe(3);
    expect(res.body.status).toBe('deactivated');
    // Refund entitlement must be completely eliminated
    expect(res.body.isWithinRefundGuarantee).toBe(false);

    // Assert audit log captures deactivation status change with before/after
    const deactivationAudit = await prisma.auditLog.findFirst({
      where: {
        entityCode: jobSeekerCode,
        action: 'job_seeker.deactivated',
      },
    });
    expect(deactivationAudit).toBeDefined();
    expect((deactivationAudit?.before as Record<string, unknown>)?.status).toBe('active');
    expect((deactivationAudit?.after as Record<string, unknown>)?.status).toBe('deactivated');
  });

  it('subsequent hit attempts on a deactivated candidate are rejected', async () => {
    await expect(
      jobSeekerService.recordHit(
        jobSeekerId,
        'offer_rejected',
        'Should fail',
        callAgentId,
      ),
    ).rejects.toThrow('Job seeker is already deactivated');
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { QueueEvents } from 'bullmq';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  NoPickupEvaluationJob,
  NO_PICKUP_EVALUATION_QUEUE,
  NO_PICKUP_EVALUATION_JOB,
} from './no-pickup-evaluation.job';

describe('Phase 3 Task 3: Scheduled No-Pickup Evaluation Job', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobService: NoPickupEvaluationJob;

  let callAgentId: string;
  let jobSeeker1Id: string;
  let jobSeeker1Code: string;
  let jobSeeker2Id: string;
  let jobSeeker2Code: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jobService = app.get<NoPickupEvaluationJob>(NoPickupEvaluationJob);

    const passwordHash = await bcrypt.hash(password, 10);
    const agent = await prisma.staff.create({
      data: {
        code: `CA-JOB-${timestamp}`,
        name: 'Call Agent Job',
        email: `ca_job_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = agent.id;

    // Job Seeker 1: Will have qualifying attempts
    jobSeeker1Code = `JS-QUAL-${timestamp}`;
    const js1 = await prisma.jobSeeker.create({
      data: {
        code: jobSeeker1Code,
        name: 'Qualifying Worker',
        phone: `91${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
        city: 'Bengaluru',
      },
    });
    jobSeeker1Id = js1.id;

    // Job Seeker 2: Will have incomplete attempts (missing PM call)
    jobSeeker2Code = `JS-INCOMP-${timestamp}`;
    const js2 = await prisma.jobSeeker.create({
      data: {
        code: jobSeeker2Code,
        name: 'Incomplete Worker',
        phone: `92${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Plumber',
        minSalary: 1500000,
        maxSalary: 2200000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
        city: 'Bengaluru',
      },
    });
    jobSeeker2Id = js2.id;
  });

  afterAll(async () => {
    if (jobService) {
      await jobService.close();
    }
    if (prisma) {
      await prisma.contactAttempt.deleteMany({
        where: { jobSeekerId: { in: [jobSeeker1Id, jobSeeker2Id] } },
      });
      await prisma.jobSeekerHit.deleteMany({
        where: { jobSeekerId: { in: [jobSeeker1Id, jobSeeker2Id] } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          entityCode: { in: [jobSeeker1Code, jobSeeker2Code] },
        },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: [jobSeeker1Id, jobSeeker2Id] } },
      });
      await prisma.staff.deleteMany({
        where: { id: callAgentId },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('scans active job seekers, converts qualifying attempts to a hit, and is idempotent on repeat runs', async () => {
    const today = new Date();

    // Seed qualifying attempts for Job Seeker 1: AM call (no_pickup), PM call (no_pickup), and SMS attempt
    await prisma.contactAttempt.createMany({
      data: [
        {
          jobSeekerId: jobSeeker1Id,
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'am',
          attemptedAt: today,
          staffId: callAgentId,
        },
        {
          jobSeekerId: jobSeeker1Id,
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'pm',
          attemptedAt: today,
          staffId: callAgentId,
        },
        {
          jobSeekerId: jobSeeker1Id,
          channel: 'sms',
          outcome: 'no_pickup',
          timeOfDay: 'am',
          attemptedAt: today,
          staffId: callAgentId,
        },
      ],
    });

    // Seed incomplete attempts for Job Seeker 2: only AM call + SMS (no PM call)
    await prisma.contactAttempt.createMany({
      data: [
        {
          jobSeekerId: jobSeeker2Id,
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'am',
          attemptedAt: today,
          staffId: callAgentId,
        },
        {
          jobSeekerId: jobSeeker2Id,
          channel: 'sms',
          outcome: 'no_pickup',
          timeOfDay: 'am',
          attemptedAt: today,
          staffId: callAgentId,
        },
      ],
    });

    // Run 1: Should evaluate and record exactly one hit for JS 1, none for JS 2
    const firstRun = await jobService.evaluateNoPickups();
    expect(firstRun.hitsRecorded).toBe(1);
    expect(firstRun.hitJobSeekerIds).toContain(jobSeeker1Id);
    expect(firstRun.hitJobSeekerIds).not.toContain(jobSeeker2Id);

    const js1AfterFirstRun = await prisma.jobSeeker.findUnique({
      where: { id: jobSeeker1Id },
    });
    expect(js1AfterFirstRun?.hitCount).toBe(1);

    const js2AfterFirstRun = await prisma.jobSeeker.findUnique({
      where: { id: jobSeeker2Id },
    });
    expect(js2AfterFirstRun?.hitCount).toBe(0);

    const hitsJs1 = await prisma.jobSeekerHit.findMany({
      where: { jobSeekerId: jobSeeker1Id },
    });
    expect(hitsJs1.length).toBe(1);
    expect(hitsJs1[0].reason).toBe('no_pickup');
    expect(hitsJs1[0].recordedBy).toBe('system');

    // Run 2: Immediately run again on the same day's data
    const secondRun = await jobService.evaluateNoPickups();
    expect(secondRun.hitsRecorded).toBe(0);
    expect(secondRun.hitJobSeekerIds.length).toBe(0);

    // Assert still exactly one hit recorded for JS 1
    const hitsAfterSecondRun = await prisma.jobSeekerHit.findMany({
      where: { jobSeekerId: jobSeeker1Id },
    });
    expect(hitsAfterSecondRun.length).toBe(1);

    const js1AfterSecondRun = await prisma.jobSeeker.findUnique({
      where: { id: jobSeeker1Id },
    });
    expect(js1AfterSecondRun?.hitCount).toBe(1);
  });

  it('executes the scheduled job through BullMQ queue and worker', async () => {
    const prevRole = process.env.PROCESS_ROLE;
    process.env.PROCESS_ROLE = 'worker';
    try {
      const queueEvents = new QueueEvents(NO_PICKUP_EVALUATION_QUEUE, {
        connection: jobService.redisConnection,
      });
      await queueEvents.waitUntilReady();

      const queue = jobService.getQueue();
      const worker = jobService.getWorker();
      expect(worker).toBeDefined();

      const job = await queue.add(NO_PICKUP_EVALUATION_JOB, {});
      const result = await job.waitUntilFinished(queueEvents, 10000);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('evaluated');
      expect(result).toHaveProperty('hitsRecorded');
      expect(typeof result.hitsRecorded).toBe('number');

      await queueEvents.close();
    } finally {
      if (prevRole === undefined) {
        delete process.env.PROCESS_ROLE;
      } else {
        process.env.PROCESS_ROLE = prevRole;
      }
    }
  });
});


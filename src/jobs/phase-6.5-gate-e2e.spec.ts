import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { QueueEvents, Queue } from 'bullmq';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdService } from '../common/id/id.service';
import { enrolledLogin } from '../test-support/enrolled-login-spec';
import {
  NoPickupEvaluationJob,
  NO_PICKUP_EVALUATION_QUEUE,
} from './no-pickup-evaluation.job';
import { evaluateJobSeekerRefundEligibility } from '../modules/job-seeker/job-seeker-refund-eligibility';

describe('Phase 6.5 Gate: End-to-End Proof for Daily No-Pickup Sweep', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  let jobService: NoPickupEvaluationJob;
  let queueEvents: QueueEvents;
  let queue: Queue;

  let ceoId: string;
  let ceoEmail: string;
  let ceoToken: string;
  let callAgentId: string;
  let callAgentEmail: string;

  let jobSeekerId: string;
  let jobSeekerCode: string;
  let paymentCode: string;

  const timestamp = Date.now();
  const plainPassword = 'Password123!Secure';
  const originalProcessRole = process.env.PROCESS_ROLE;

  beforeAll(async () => {
    // Process role must be worker so BullMQ Worker is constructed to process jobs from queue
    process.env.PROCESS_ROLE = 'worker';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    idService = app.get<IdService>(IdService);
    jobService = app.get<NoPickupEvaluationJob>(NoPickupEvaluationJob);

    // Ensure queue and worker are initialized
    queue = jobService.getQueue();
    jobService.getWorker();

    queueEvents = new QueueEvents(NO_PICKUP_EVALUATION_QUEUE, {
      connection: jobService.redisConnection,
    });
    await queueEvents.waitUntilReady();

    const passwordHash = await bcrypt.hash(plainPassword, 10);

    // 1. Seed CEO staff member
    ceoEmail = `ceo_gate_e2e_${timestamp}@laboura.local`;
    const ceo = await prisma.staff.create({
      data: {
        code: `STF-CE-${timestamp.toString().slice(-5)}`,
        name: 'CEO Gate Verifier',
        email: ceoEmail,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    ceoId = ceo.id;

    // 2. Seed Call Agent staff member
    callAgentEmail = `ca_gate_e2e_${timestamp}@laboura.local`;
    const ca = await prisma.staff.create({
      data: {
        code: `CA-E2E-${timestamp.toString().slice(-5)}`,
        name: 'Call Agent Gate Verifier',
        email: callAgentEmail,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = ca.id;

    // 3. Log in CEO via enrolledLogin to obtain authenticated token
    const server = app.getHttpServer();
    const ceoLogin = await enrolledLogin(server, {
      email: ceoEmail,
      password: plainPassword,
    });
    ceoToken = ceoLogin.body.accessToken;
    expect(ceoToken).toBeDefined();
  });

  afterAll(async () => {
    if (originalProcessRole === undefined) {
      delete process.env.PROCESS_ROLE;
    } else {
      process.env.PROCESS_ROLE = originalProcessRole;
    }

    if (queueEvents) {
      await queueEvents.close();
    }
    if (jobService) {
      await jobService.close(true);
    }

    if (prisma) {
      if (jobSeekerId) {
        await prisma.contactAttempt.deleteMany({ where: { jobSeekerId } });
        await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId } });
        await prisma.payment.deleteMany({ where: { jobSeekerId } });
        await prisma.jobSeeker.deleteMany({ where: { id: jobSeekerId } });
      }
      if (ceoId || callAgentId) {
        const staffIds = [ceoId, callAgentId].filter(Boolean);
        await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    }

    if (app) {
      await app.close();
    }
  });

  it('runs complete 8-step end-to-end proof: 3 hits via manual trigger, idempotency, automatic deactivation, and refund exclusion', async () => {
    const server = app.getHttpServer();

    // =========================================================================
    // STEP 1: Take a job seeker with the ₹499 recorded.
    // =========================================================================
    jobSeekerCode = await idService.generateCode('job_seeker');
    paymentCode = await idService.generateCode('payment');

    // Payment was received 35 days ago (past the 30-day guarantee period)
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    const js = await prisma.jobSeeker.create({
      data: {
        code: jobSeekerCode,
        name: 'Gate Proof Worker',
        phone: `91${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
        paymentReceivedAt: thirtyFiveDaysAgo,
        city: 'Bengaluru',
      },
    });
    jobSeekerId = js.id;

    // Record the ₹499 activation payment in the database
    const payment = await prisma.payment.create({
      data: {
        code: paymentCode,
        amount: 49900, // ₹499 in integer paise
        type: 'activation',
        status: 'completed',
        gatewayReference: `gw_gate_${timestamp}`,
        subjectType: 'job_seeker',
        subjectId: js.id,
        jobSeekerId: js.id,
        city: 'Bengaluru',
      },
    });

    console.log('\n[E2E STEP 1 OUTPUT] Job Seeker Created & ₹499 Recorded:');
    console.log(JSON.stringify({
      jobSeekerId: js.id,
      code: js.code,
      status: js.status,
      hitCount: js.hitCount,
      paymentAmountPaise: payment.amount,
      paymentReceivedAt: js.paymentReceivedAt?.toISOString(),
    }, null, 2));

    expect(js.status).toBe('active');
    expect(js.hitCount).toBe(0);
    expect(payment.amount).toBe(49900);

    // =========================================================================
    // STEP 2: Log qualifying no-pickup contact attempts plus WhatsApp/SMS attempt for Day 1.
    // =========================================================================
    // Using fixed times 3 days ago: AM call, PM call, and SMS attempt
    const day1Base = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const day1Am = new Date(day1Base);
    day1Am.setUTCHours(4, 0, 0, 0); // 09:30 IST
    const day1Pm = new Date(day1Base);
    day1Pm.setUTCHours(12, 30, 0, 0); // 18:00 IST

    await prisma.contactAttempt.createMany({
      data: [
        {
          jobSeekerId: js.id,
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'am',
          attemptedAt: day1Am,
          staffId: callAgentId,
        },
        {
          jobSeekerId: js.id,
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'pm',
          attemptedAt: day1Pm,
          staffId: callAgentId,
        },
        {
          jobSeekerId: js.id,
          channel: 'sms',
          outcome: 'no_pickup',
          timeOfDay: 'pm',
          attemptedAt: day1Pm,
          staffId: callAgentId,
        },
      ],
    });

    const day1Attempts = await prisma.contactAttempt.findMany({
      where: { jobSeekerId: js.id },
      orderBy: { attemptedAt: 'asc' },
    });
    console.log('\n[E2E STEP 2 OUTPUT] Day 1 Qualifying Contact Attempts Logged:');
    console.log(JSON.stringify(
      day1Attempts.map((a) => ({
        id: a.id,
        channel: a.channel,
        outcome: a.outcome,
        timeOfDay: a.timeOfDay,
        attemptedAt: a.attemptedAt.toISOString(),
        hitId: a.hitId,
      })),
      null,
      2,
    ));

    expect(day1Attempts).toHaveLength(3);
    expect(day1Attempts.every((a) => a.hitId === null)).toBe(true);

    // =========================================================================
    // STEP 3: Trigger the sweep using ONLY manual endpoint — POST /jobs/no-pickup-evaluation/run
    // =========================================================================
    const sweep1Response = await request(server)
      .post('/jobs/no-pickup-evaluation/run')
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(201);

    const jobId1 = sweep1Response.body.jobId;
    expect(jobId1).toBeDefined();

    // Await background BullMQ worker execution
    const job1 = await queue.getJob(jobId1);
    expect(job1).toBeDefined();
    const sweep1Result = await job1!.waitUntilFinished(queueEvents, 10000);
    console.log('\n[E2E STEP 3 OUTPUT] POST /jobs/no-pickup-evaluation/run Sweep 1 Completed:');
    console.log(JSON.stringify({
      httpStatus: sweep1Response.status,
      jobId: jobId1,
      workerResult: sweep1Result,
    }, null, 2));

    expect(sweep1Result.hitsRecorded).toBeGreaterThanOrEqual(1);

    // =========================================================================
    // STEP 4: Confirm exactly one hit was recorded.
    // =========================================================================
    const jsAfterSweep1 = await prisma.jobSeeker.findUnique({
      where: { id: js.id },
    });
    const hitsAfterSweep1 = await prisma.jobSeekerHit.findMany({
      where: { jobSeekerId: js.id },
    });
    const day1AttemptsAfterSweep1 = await prisma.contactAttempt.findMany({
      where: { jobSeekerId: js.id },
    });
    console.log('\n[E2E STEP 4 OUTPUT] Confirm Exactly 1 Hit Recorded:');
    console.log(JSON.stringify({
      jobSeekerStatus: jsAfterSweep1?.status,
      hitCount: jsAfterSweep1?.hitCount,
      totalHitsInDb: hitsAfterSweep1.length,
      firstHitReason: hitsAfterSweep1[0]?.reason,
      firstHitRecordedBy: hitsAfterSweep1[0]?.recordedBy,
      attemptsLinkedToHit: day1AttemptsAfterSweep1.filter((a) => a.hitId === hitsAfterSweep1[0]?.id).length,
    }, null, 2));

    expect(jsAfterSweep1?.hitCount).toBe(1);
    expect(jsAfterSweep1?.status).toBe('active');
    expect(hitsAfterSweep1).toHaveLength(1);
    expect(hitsAfterSweep1[0].reason).toBe('no_pickup');
    expect(hitsAfterSweep1[0].recordedBy).toBe('system');
    expect(day1AttemptsAfterSweep1.every((a) => a.hitId === hitsAfterSweep1[0].id)).toBe(true);

    // =========================================================================
    // STEP 5: Trigger the sweep AGAIN on the same day's data. Confirm NO second hit.
    // =========================================================================
    const sweep2Response = await request(server)
      .post('/jobs/no-pickup-evaluation/run')
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(201);

    const jobId2 = sweep2Response.body.jobId;
    const job2 = await queue.getJob(jobId2);
    const sweep2Result = await job2!.waitUntilFinished(queueEvents, 10000);

    const jsAfterSweep2 = await prisma.jobSeeker.findUnique({
      where: { id: js.id },
    });
    const hitsAfterSweep2 = await prisma.jobSeekerHit.findMany({
      where: { jobSeekerId: js.id },
    });
    console.log('\n[E2E STEP 5 OUTPUT] Repeat Sweep on Same Day Data (Idempotency Guard):');
    console.log(JSON.stringify({
      httpStatus: sweep2Response.status,
      jobId: jobId2,
      workerHitsRecorded: sweep2Result.hitsRecorded,
      jobSeekerHitCount: jsAfterSweep2?.hitCount,
      totalHitsInDb: hitsAfterSweep2.length,
      duplicateHitRecorded: hitsAfterSweep2.length > 1,
    }, null, 2));

    // CRITICAL IDEMPOTENCY ASSERTION: Still exactly 1 hit
    expect(sweep2Result.hitJobSeekerIds).not.toContain(js.id);
    expect(jsAfterSweep2?.hitCount).toBe(1);
    expect(hitsAfterSweep2).toHaveLength(1);

    // =========================================================================
    // STEP 6: Drive candidate to three hits. Confirm automatic deactivation.
    // =========================================================================
    // Day 2 Contact Attempts (2 days ago)
    const day2Base = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const day2Am = new Date(day2Base);
    day2Am.setUTCHours(4, 0, 0, 0);
    const day2Pm = new Date(day2Base);
    day2Pm.setUTCHours(12, 30, 0, 0);

    await prisma.contactAttempt.createMany({
      data: [
        { jobSeekerId: js.id, channel: 'call', outcome: 'no_pickup', timeOfDay: 'am', attemptedAt: day2Am, staffId: callAgentId },
        { jobSeekerId: js.id, channel: 'call', outcome: 'no_pickup', timeOfDay: 'pm', attemptedAt: day2Pm, staffId: callAgentId },
        { jobSeekerId: js.id, channel: 'whatsapp', outcome: 'no_pickup', timeOfDay: 'pm', attemptedAt: day2Pm, staffId: callAgentId },
      ],
    });

    // Sweep 3 -> Records Hit 2
    const sweep3Response = await request(server)
      .post('/jobs/no-pickup-evaluation/run')
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(201);
    const job3 = await queue.getJob(sweep3Response.body.jobId);
    await job3!.waitUntilFinished(queueEvents, 10000);

    const jsAfterSweep3 = await prisma.jobSeeker.findUnique({ where: { id: js.id } });
    expect(jsAfterSweep3?.hitCount).toBe(2);
    expect(jsAfterSweep3?.status).toBe('active');

    // Day 3 Contact Attempts (1 day ago)
    const day3Base = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const day3Am = new Date(day3Base);
    day3Am.setUTCHours(4, 0, 0, 0);
    const day3Pm = new Date(day3Base);
    day3Pm.setUTCHours(12, 30, 0, 0);

    await prisma.contactAttempt.createMany({
      data: [
        { jobSeekerId: js.id, channel: 'call', outcome: 'no_pickup', timeOfDay: 'am', attemptedAt: day3Am, staffId: callAgentId },
        { jobSeekerId: js.id, channel: 'call', outcome: 'no_pickup', timeOfDay: 'pm', attemptedAt: day3Pm, staffId: callAgentId },
        { jobSeekerId: js.id, channel: 'sms', outcome: 'no_pickup', timeOfDay: 'pm', attemptedAt: day3Pm, staffId: callAgentId },
      ],
    });

    // Sweep 4 -> Records Hit 3 & Triggers Automatic Deactivation
    const sweep4Response = await request(server)
      .post('/jobs/no-pickup-evaluation/run')
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(201);
    const job4 = await queue.getJob(sweep4Response.body.jobId);
    await job4!.waitUntilFinished(queueEvents, 10000);

    const jsAfterSweep4 = await prisma.jobSeeker.findUnique({ where: { id: js.id } });
    const hitsAfterSweep4 = await prisma.jobSeekerHit.findMany({ where: { jobSeekerId: js.id } });
    console.log('\n[E2E STEP 6 OUTPUT] Driven to 3 Hits & Automatic Deactivation:');
    console.log(JSON.stringify({
      hitCount: jsAfterSweep4?.hitCount,
      status: jsAfterSweep4?.status,
      totalHitsRecorded: hitsAfterSweep4.length,
      allHitReasons: hitsAfterSweep4.map((h) => h.reason),
    }, null, 2));

    expect(jsAfterSweep4?.hitCount).toBe(3);
    expect(jsAfterSweep4?.status).toBe('deactivated');
    expect(hitsAfterSweep4).toHaveLength(3);

    // =========================================================================
    // STEP 7: Confirm deactivated candidate carries NO refund entitlement,
    // and does NOT appear on GET /refunds/due.
    // =========================================================================
    // 1. GET /job-seekers/:id reflects isWithinRefundGuarantee: false
    const jsDetailRes = await request(server)
      .get(`/job-seekers/${js.id}`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(200);

    // 2. Pure domain evaluator confirms refund eligibility is eliminated
    const evalResult = evaluateJobSeekerRefundEligibility(
      {
        code: js.code,
        paymentReceivedAt: js.paymentReceivedAt,
        status: jsAfterSweep4!.status,
        hasOfferRejectedHit: false,
        hasExistingRefund: false,
      },
      new Date(),
    );

    // 3. GET /refunds/due excludes the deactivated candidate completely
    const refundsDueRes = await request(server)
      .get('/refunds/due')
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(200);

    const matchInRefundsDue = (refundsDueRes.body as Array<{ code: string }>).filter(
      (item) => item.code === js.code,
    );
    console.log('\n[E2E STEP 7 OUTPUT] Refund Entitlement Eliminated & Excluded from /refunds/due:');
    console.log(JSON.stringify({
      jobSeekerApiRefundGuaranteeFlag: jsDetailRes.body.isWithinRefundGuarantee,
      domainEvaluatorEligible: evalResult.eligible,
      domainIneligibleReason: evalResult.ineligibleReason,
      foundOnRefundsDueListing: matchInRefundsDue.length > 0,
      totalDueRefundsListed: refundsDueRes.body.length,
    }, null, 2));

    expect(jsDetailRes.body.isWithinRefundGuarantee).toBe(false);
    expect(evalResult.eligible).toBe(false);
    expect(evalResult.ineligibleReason).toContain('is deactivated and carries no refund entitlement');
    expect(matchInRefundsDue).toHaveLength(0);

    // =========================================================================
    // STEP 8: Confirm a JobRun row was written for each sweep.
    // =========================================================================
    const jobRuns = await prisma.jobRun.findMany({
      where: { jobName: 'daily-no-pickup-evaluation' },
      orderBy: { startedAt: 'desc' },
      take: 4,
    });
    console.log('\n[E2E STEP 8 OUTPUT] JobRun Rows Written For Each Sweep:');
    console.log(JSON.stringify(
      jobRuns.map((r) => ({
        id: r.id,
        jobName: r.jobName,
        outcome: r.outcome,
        evaluated: r.evaluated,
        hitsRecorded: r.hitsRecorded,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString(),
      })),
      null,
      2,
    ));

    expect(jobRuns.length).toBeGreaterThanOrEqual(4);
    expect(jobRuns.every((r) => r.outcome === 'success')).toBe(true);
    expect(jobRuns.every((r) => r.finishedAt !== null)).toBe(true);

    // The most recent 4 runs correspond to our 4 sweeps:
    // Run 4: hit 3 recorded
    // Run 3: hit 2 recorded
    // Run 2: 0 hits recorded (idempotent repeat)
    // Run 1: hit 1 recorded
    const [run4, run3, run2, run1] = jobRuns;
    expect(run1.hitsRecorded).toBeGreaterThanOrEqual(1);
    expect(run2.hitsRecorded).toBe(0);
    expect(run3.hitsRecorded).toBeGreaterThanOrEqual(1);
    expect(run4.hitsRecorded).toBeGreaterThanOrEqual(1);
  });
});

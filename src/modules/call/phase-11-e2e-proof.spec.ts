import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CallClock } from './call-clock';
import { TELEPHONY_PROVIDER } from '../telephony/telephony.interface';
import { RECORDING_STORAGE, MemoryRecordingStorage } from './recording-storage';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';
import { NoPickupEvaluationJob } from '../../jobs/no-pickup-evaluation.job';
import { signCallStatusBody } from './call-signature';

class ControllableClock extends CallClock {
  current = new Date('2026-11-04T05:00:00.000Z'); // 10:30 IST

  override now(): Date {
    return this.current;
  }
}

describe('Phase 11 Gate End-to-End Proof', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let sweepJob: NoPickupEvaluationJob;
  const clock = new ControllableClock();

  const createdStaffIds: string[] = [];
  const createdSeekerIds: string[] = [];
  const createdCallIds: string[] = [];
  const createdMessageIds: string[] = [];

  let caToken: string;
  let tlToken: string;
  let tlStaffId: string;
  let testSeekerId: string;
  let testSeekerCode: string;
  const testRawPhone = '+919876543210';
  const testPhoneDigits = '9876543210';
  const WEBHOOK_SECRET = 'e2e_proof_telephony_secret_32bytes!';

  beforeAll(async () => {
    process.env.CALL_ROUTING_KEY = 'click_to_call_routing_key_32_characters';
    process.env.TELEPHONY_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CallClock)
      .useValue(clock)
      .overrideProvider(TELEPHONY_PROVIDER)
      .useValue({
        getCapacity: () => ({ vendor: 'mock', maxConcurrentCalls: 100 }),
        initiateOutboundCall: async () => ({
          callId: `call-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          status: 'initiated',
        }),
      })
      .overrideProvider(RECORDING_STORAGE)
      .useClass(MemoryRecordingStorage)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    sweepJob = app.get(NoPickupEvaluationJob);

    const passwordHash = await bcrypt.hash('GatePassword123!', 4);
    const stamp = Date.now();

    // 1. Team Lead
    const tl = await prisma.staff.create({
      data: {
        code: `TL-GATE-${stamp}`,
        name: 'Gate Team Lead',
        email: `tl_gate_${stamp}@laboura.local`,
        passwordHash,
        role: 'team_lead',
        status: 'active',
      },
    });
    createdStaffIds.push(tl.id);
    tlStaffId = tl.id;
    tlToken = jwt.sign({ sub: tl.id, role: tl.role, code: tl.code, email: tl.email });

    // 2. Call Agent with routing phone set
    const ca = await prisma.staff.create({
      data: {
        code: `CA-GATE-${stamp}`,
        name: 'Gate Call Agent',
        email: `ca_gate_${stamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        status: 'active',
        teamLeadId: tl.id,
        callRoutingPhone: encryptCallRoutingPhone('+919899988877'),
      },
    });
    createdStaffIds.push(ca.id);
    caToken = jwt.sign({ sub: ca.id, role: ca.role, code: ca.code, email: ca.email });

    // 3. Job Seeker
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-GATE-${stamp}`,
        name: 'Sunil Candidate',
        phone: testRawPhone,
        tradeSkill: 'Plumber',
        minSalary: 1200000,
        maxSalary: 2200000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '20:00',
        status: 'active',
      },
    });
    createdSeekerIds.push(seeker.id);
    testSeekerId = seeker.id;
    testSeekerCode = seeker.code;
  });

  afterAll(async () => {
    if (createdCallIds.length > 0) {
      await prisma.contactAttempt.deleteMany({ where: { callRecordId: { in: createdCallIds } } });
      await prisma.callRecord.deleteMany({ where: { id: { in: createdCallIds } } });
    }
    if (createdMessageIds.length > 0) {
      await prisma.contactAttempt.deleteMany({ where: { messageLogId: { in: createdMessageIds } } });
      await prisma.messageLog.deleteMany({ where: { id: { in: createdMessageIds } } });
    }
    if (createdSeekerIds.length > 0) {
      await prisma.contactAttempt.deleteMany({ where: { jobSeekerId: { in: createdSeekerIds } } });
      await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: { in: createdSeekerIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: createdSeekerIds } } });
    }
    if (createdStaffIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: createdStaffIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: createdStaffIds } } });
    }
    await app.close();
  });

  function postCallWebhook(payload: Record<string, unknown>, signature?: string) {
    const raw = JSON.stringify(payload);
    const signed = signature === undefined ? signCallStatusBody(raw, WEBHOOK_SECRET) : signature;
    return request(app.getHttpServer())
      .post('/telephony/webhook/call-status')
      .set('Content-Type', 'application/json')
      .set('x-telephony-signature', signed)
      .send(raw);
  }

  it('proves the full end-to-end scenario: morning+evening no-answer -> sweep hit -> 3rd call answered+outcome -> TL listen audited -> privacy floor maintained', async () => {
    const kolkataDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // =========================================================================
    // STEP 1: Morning Call Placed by Call Agent from Profile (no phone in request)
    // =========================================================================
    clock.current = new Date(`${kolkataDateStr}T04:30:00.000Z`); // 10:00 AM IST

    const morningCallRes = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        subjectType: 'job_seeker',
        subjectId: testSeekerCode, // Supports human readable code
        purpose: 'follow_up',
      })
      .expect(201);

    const morningCallId = morningCallRes.body.callRecordId;
    expect(morningCallId).toBeDefined();
    createdCallIds.push(morningCallId);

    // Assert agent response never contains full phone number
    expect(JSON.stringify(morningCallRes.body)).not.toContain(testPhoneDigits);

    // Provider webhook delivers "no_answer" for the morning call
    const morningCall = await prisma.callRecord.findUniqueOrThrow({ where: { id: morningCallId } });
    const amEventPayload = {
      provider: morningCall.provider,
      providerCallId: morningCall.providerCallId,
      status: 'no_answer',
      answered: false,
      startedAt: clock.current.toISOString(),
      endedAt: new Date(clock.current.getTime() + 30000).toISOString(),
      durationSec: 30,
      direction: 'outbound',
    };
    const amRes = await postCallWebhook(amEventPayload);
    expect(amRes.status).toBe(201);

    // Verify system created AM no_pickup contact attempt
    const amAttempt = await prisma.contactAttempt.findUnique({
      where: { callRecordId: morningCallId },
    });
    expect(amAttempt).toBeDefined();
    expect(amAttempt?.outcome).toBe('no_pickup');
    expect(amAttempt?.timeOfDay).toBe('am');

    // =========================================================================
    // STEP 2: Evening Call Placed by Call Agent (no phone in request)
    // =========================================================================
    clock.current = new Date(`${kolkataDateStr}T11:30:00.000Z`); // 17:00 PM IST

    const eveningCallRes = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        subjectType: 'job_seeker',
        subjectId: testSeekerId,
        purpose: 'follow_up',
      })
      .expect(201);

    const eveningCallId = eveningCallRes.body.callRecordId;
    expect(eveningCallId).toBeDefined();
    createdCallIds.push(eveningCallId);

    expect(JSON.stringify(eveningCallRes.body)).not.toContain(testPhoneDigits);

    // Provider webhook delivers "no_answer" for the evening call
    const eveningCall = await prisma.callRecord.findUniqueOrThrow({ where: { id: eveningCallId } });
    const pmEventPayload = {
      provider: eveningCall.provider,
      providerCallId: eveningCall.providerCallId,
      status: 'no_answer',
      answered: false,
      startedAt: clock.current.toISOString(),
      endedAt: new Date(clock.current.getTime() + 30000).toISOString(),
      durationSec: 30,
      direction: 'outbound',
    };
    const pmRes = await postCallWebhook(pmEventPayload);
    expect(pmRes.status).toBe(201);

    // Verify system created PM no_pickup contact attempt
    const pmAttempt = await prisma.contactAttempt.findUnique({
      where: { callRecordId: eveningCallId },
    });
    expect(pmAttempt).toBeDefined();
    expect(pmAttempt?.outcome).toBe('no_pickup');
    expect(pmAttempt?.timeOfDay).toBe('pm');

    // =========================================================================
    // STEP 3: Automated WhatsApp Dispatched via Sweep & 1 Hit Recorded
    // =========================================================================
    // Clock at midnight
    clock.current = new Date(`${kolkataDateStr}T18:30:00.000Z`); // 00:00 IST next day

    const sweepResult = await sweepJob.evaluateNoPickups();
    expect(sweepResult.hitsRecorded).toBeGreaterThanOrEqual(1);

    // Verify 1 hit recorded on candidate with reason 'no_pickup'
    const seekerAfterSweep = await prisma.jobSeeker.findUniqueOrThrow({
      where: { id: testSeekerId },
      include: { hits: true, contactAttempts: true },
    });
    expect(seekerAfterSweep.hitCount).toBe(1);
    expect(seekerAfterSweep.hits).toHaveLength(1);
    expect(seekerAfterSweep.hits[0].reason).toBe('no_pickup');

    // Verify 3 contact attempts linked to this hit: AM call, PM call, WhatsApp message
    expect(seekerAfterSweep.contactAttempts).toHaveLength(3);
    const channels = seekerAfterSweep.contactAttempts.map((a) => a.channel);
    expect(channels.filter((c) => c === 'call')).toHaveLength(2);
    expect(channels.filter((c) => c === 'whatsapp')).toHaveLength(1);

    // Keep track of the created WhatsApp message for teardown
    const waAttempt = seekerAfterSweep.contactAttempts.find((a) => a.channel === 'whatsapp');
    if (waAttempt?.messageLogId) {
      createdMessageIds.push(waAttempt.messageLogId);
    }

    // =========================================================================
    // STEP 4: A Third Call Placed, Answered, and Agent Records "interested"
    // =========================================================================
    clock.current = new Date(`${kolkataDateStr}T06:00:00.000Z`); // 11:30 AM IST next day

    const thirdCallRes = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        subjectType: 'job_seeker',
        subjectId: testSeekerId,
        purpose: 'offer',
      })
      .expect(201);

    const thirdCallId = thirdCallRes.body.callRecordId;
    expect(thirdCallId).toBeDefined();
    createdCallIds.push(thirdCallId);

    expect(JSON.stringify(thirdCallRes.body)).not.toContain(testPhoneDigits);

    // Provider webhook reports call answered and completed with recording
    const thirdCall = await prisma.callRecord.findUniqueOrThrow({ where: { id: thirdCallId } });
    const thirdEventPayload = {
      provider: thirdCall.provider,
      providerCallId: thirdCall.providerCallId,
      status: 'completed',
      answered: true,
      startedAt: clock.current.toISOString(),
      answeredAt: new Date(clock.current.getTime() + 10000).toISOString(),
      endedAt: new Date(clock.current.getTime() + 120000).toISOString(),
      durationSec: 110,
      recordingUrl: 'https://telephony-mock.local/recordings/e2e-rec-01.mp3',
      direction: 'outbound',
    };
    const thirdRes = await postCallWebhook(thirdEventPayload);
    expect(thirdRes.status).toBe(201);

    // Verify system created picked_up contact attempt for the answered call
    const thirdAttempt = await prisma.contactAttempt.findUnique({
      where: { callRecordId: thirdCallId },
    });
    expect(thirdAttempt).toBeDefined();
    expect(thirdAttempt?.outcome).toBe('picked_up');

    // Agent records outcome "interested" via closed outcome form
    const outcomeRes = await request(app.getHttpServer())
      .post(`/calls/${thirdCallId}/outcome`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        agentOutcome: 'interested',
        reason: 'Candidate expressed strong interest in plumber vacancy',
      })
      .expect(201);

    expect(outcomeRes.body.agentOutcome).toBe('interested');
    expect(JSON.stringify(outcomeRes.body)).not.toContain(testPhoneDigits);

    // Verify call record updated in database
    const updatedThirdCall = await prisma.callRecord.findUniqueOrThrow({
      where: { id: thirdCallId },
    });
    expect(updatedThirdCall.agentOutcome).toBe('interested');
    expect(updatedThirdCall.answered).toBe(true);

    // =========================================================================
    // STEP 5: Team Lead Listens to the Recording & Listen is Audited
    // =========================================================================
    // Pre-populate storage path so signed download URL can be produced
    await prisma.callRecord.update({
      where: { id: thirdCallId },
      data: { recordingStoragePath: 'recordings/e2e-rec-01.mp3' },
    });

    // Call Agent is forbidden from listening
    await request(app.getHttpServer())
      .get(`/calls/${thirdCallId}/recording`)
      .set('Authorization', `Bearer ${caToken}`)
      .expect(403);

    // Team Lead requests recording URL
    const recordingRes = await request(app.getHttpServer())
      .get(`/calls/${thirdCallId}/recording`)
      .set('Authorization', `Bearer ${tlToken}`)
      .expect(200);

    expect(recordingRes.body.url).toBeDefined();

    // Verify audit log entry was written for the listen action
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityCode: thirdCall.code,
        action: 'call.recording.listened',
        actorId: tlStaffId,
      },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].entityType).toBe('call_record');

    // =========================================================================
    // STEP 6: Privacy Floor Check Across All Agent Queries
    // =========================================================================
    // Agent fetches candidate profile
    const seekerProfileRes = await request(app.getHttpServer())
      .get(`/job-seekers/${testSeekerId}`)
      .set('Authorization', `Bearer ${caToken}`)
      .expect(200);

    expect(seekerProfileRes.body.phone).toMatch(/^\*{6}\d{4}$/);
    expect(JSON.stringify(seekerProfileRes.body)).not.toContain(testPhoneDigits);

    // Agent fetches call history for subject
    const callHistoryRes = await request(app.getHttpServer())
      .get('/calls')
      .query({ subjectType: 'job_seeker', subjectId: testSeekerId })
      .set('Authorization', `Bearer ${caToken}`)
      .expect(200);

    expect(Array.isArray(callHistoryRes.body)).toBe(true);
    expect(callHistoryRes.body.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(callHistoryRes.body)).not.toContain(testPhoneDigits);
  });
});

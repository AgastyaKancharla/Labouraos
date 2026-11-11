import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CallService } from './call.service';
import { MessagingService } from '../message/messaging.service';
import { NoPickupEvaluationJob } from '../../jobs/no-pickup-evaluation.job';
import { CallClock } from './call-clock';
import { CallStatusEvent } from './call-status.event';
import { CallStatus } from './call-status';

class FrozenCallClock extends CallClock {
  at = new Date('2026-11-04T08:00:00.000Z');

  now(): Date {
    return this.at;
  }
}

describe('Phase 11 Task 5: system contact attempts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let callService: CallService;
  let messagingService: MessagingService;
  let sweepJob: NoPickupEvaluationJob;
  const clock = new FrozenCallClock();

  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const callIds: string[] = [];
  const messageIds: string[] = [];

  function tokenFor(staff: { id: string; role: string; code: string; email: string | null }) {
    return jwt.sign({
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      code: staff.code,
    });
  }

  function makeEvent(
    providerCallId: string,
    status: CallStatus,
    answered: boolean,
    overrides?: {
      startedAt?: Date | null;
      answeredAt?: Date | null;
      endedAt?: Date | null;
      durationSec?: number | null;
      direction?: 'inbound' | 'outbound' | null;
    },
  ): CallStatusEvent {
    return {
      provider: 'exotel',
      providerCallId,
      status,
      answered,
      startedAt: overrides?.startedAt ?? null,
      answeredAt: overrides?.answeredAt ?? null,
      endedAt: overrides?.endedAt ?? null,
      durationSec: overrides?.durationSec ?? null,
      recordingUrl: null,
      direction: overrides?.direction ?? 'outbound',
    };
  }

  async function makeStaff(role: string, extra?: { teamLeadId?: string }) {
    const stamp = `${Date.now()}-${staffIds.length}`;
    const staff = await prisma.staff.create({
      data: {
        code: `SCA-${role.slice(0, 3).toUpperCase()}-${stamp}`,
        name: `Attempt ${role}`,
        email: `sca-${role}-${stamp}@laboura.local`,
        passwordHash: await bcrypt.hash('Attempt-Password-1', 4),
        role,
        teamLeadId: extra?.teamLeadId ?? null,
        status: 'active',
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  beforeAll(async () => {
    process.env.CALL_ROUTING_KEY = 'click_to_call_routing_key_32_characters';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CallClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    callService = app.get(CallService);
    messagingService = app.get(MessagingService);
    sweepJob = app.get(NoPickupEvaluationJob);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.contactAttempt.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
    await prisma.messageLog.deleteMany({ where: { id: { in: messageIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('the hand-entry contact attempts endpoint is gone (404) for every role', async () => {
    const roles = ['call_agent', 'field_agent', 'team_lead', 'manager', 'ceo', 'finance'] as const;
    const stamp = Date.now();
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-ATT-${stamp}`,
        name: 'Hand Entry Seeker',
        phone: '+919811100011',
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    seekerIds.push(seeker.id);

    for (const role of roles) {
      const staff = await makeStaff(role);
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${seeker.id}/contact-attempts`)
        .set('Authorization', `Bearer ${tokenFor(staff)}`)
        .send({
          channel: 'call',
          outcome: 'picked_up',
          timeOfDay: 'am',
        });
      expect(res.status).toBe(404);
    }
  });

  it('call webhook creates contact attempt only on final state, sets timeOfDay from IST start time, and is idempotent', async () => {
    const caller = await makeStaff('call_agent');
    const stamp = Date.now();
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-CALL-${stamp}`,
        name: 'Call Attempt Seeker',
        phone: '+919811100022',
        trades: { create: { trade: 'Plumber', isPrimary: true } },
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    seekerIds.push(seeker.id);

    // Call 1: Unanswered call started at 10:30 AM IST (05:00 UTC)
    const amStartUtc = new Date('2026-11-04T05:00:00.000Z');
    const call1 = await prisma.callRecord.create({
      data: {
        code: `CALL-T1-${stamp}`,
        provider: 'exotel',
        providerCallId: `call_unans_${stamp}`,
        direction: 'outbound',
        staffId: caller.id,
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose: 'follow_up',
        providerStatus: 'initiated',
        answered: false,
        startedAt: amStartUtc,
      },
    });
    callIds.push(call1.id);

    // Non-final event (ringing) should NOT create contact attempt
    await callService.applyStatus(
      makeEvent(call1.providerCallId, 'ringing', false, { startedAt: amStartUtc }),
    );
    let attempt = await prisma.contactAttempt.findUnique({
      where: { callRecordId: call1.id },
    });
    expect(attempt).toBeNull();

    // Final event (no_answer) creates no_pickup attempt
    await callService.applyStatus(
      makeEvent(call1.providerCallId, 'no_answer', false, {
        startedAt: amStartUtc,
        endedAt: new Date('2026-11-04T05:00:30.000Z'),
        durationSec: 30,
      }),
    );
    attempt = await prisma.contactAttempt.findUnique({
      where: { callRecordId: call1.id },
    });
    expect(attempt).toBeDefined();
    expect(attempt?.jobSeekerId).toBe(seeker.id);
    expect(attempt?.channel).toBe('call');
    expect(attempt?.outcome).toBe('no_pickup');
    expect(attempt?.timeOfDay).toBe('am'); // 10:30 IST is AM
    expect(attempt?.staffId).toBe(caller.id);

    // Repeated webhook changes nothing (idempotent)
    await callService.applyStatus(
      makeEvent(call1.providerCallId, 'no_answer', false, {
        startedAt: amStartUtc,
        endedAt: new Date('2026-11-04T05:00:30.000Z'),
        durationSec: 30,
      }),
    );
    const attemptCount = await prisma.contactAttempt.count({
      where: { callRecordId: call1.id },
    });
    expect(attemptCount).toBe(1);

    // Call 2: Answered call started at 15:30 PM IST (10:00 UTC)
    const pmStartUtc = new Date('2026-11-04T10:00:00.000Z');
    const call2 = await prisma.callRecord.create({
      data: {
        code: `CALL-T2-${stamp}`,
        provider: 'exotel',
        providerCallId: `call_ans_${stamp}`,
        direction: 'outbound',
        staffId: caller.id,
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose: 'offer',
        providerStatus: 'initiated',
        answered: false,
        startedAt: pmStartUtc,
      },
    });
    callIds.push(call2.id);

    await callService.applyStatus(
      makeEvent(call2.providerCallId, 'completed', true, {
        startedAt: pmStartUtc,
        answeredAt: new Date('2026-11-04T10:00:05.000Z'),
        endedAt: new Date('2026-11-04T10:03:00.000Z'),
        durationSec: 175,
      }),
    );

    const call2Attempt = await prisma.contactAttempt.findUnique({
      where: { callRecordId: call2.id },
    });
    expect(call2Attempt).toBeDefined();
    expect(call2Attempt?.jobSeekerId).toBe(seeker.id);
    expect(call2Attempt?.channel).toBe('call');
    expect(call2Attempt?.outcome).toBe('picked_up');
    expect(call2Attempt?.timeOfDay).toBe('pm'); // 15:30 IST is PM
  });

  it('WhatsApp / SMS send via MessagingService writes a contactAttempt', async () => {
    const stamp = Date.now();
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-MSG-${stamp}`,
        name: 'Message Attempt Seeker',
        phone: '+919811100033',
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    seekerIds.push(seeker.id);
    await prisma.jobSeekerTrade.create({
      data: { jobSeekerId: seeker.id, trade: 'Welder', isPrimary: true },
    });

    const sent = await messagingService.send({
      channel: 'whatsapp',
      template: 'call_attempt_notice',
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      variables: {
        candidateName: seeker.name,
        trade: 'Welder',
      },
    });
    messageIds.push(sent.id);
    expect(sent.status).toBe('sent');

    const attempt = await prisma.contactAttempt.findUnique({
      where: { messageLogId: sent.id },
    });
    expect(attempt).toBeDefined();
    expect(attempt?.jobSeekerId).toBe(seeker.id);
    expect(attempt?.channel).toBe('whatsapp');
    expect(attempt?.outcome).toBe('no_pickup');
  });

  it('morning + evening unanswered call + WhatsApp on same day produce one hit via sweep', async () => {
    const caller = await makeStaff('call_agent');
    const stamp = Date.now();
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-SWEEP-${stamp}`,
        name: 'Sweep Candidate',
        phone: '+919811100044',
        trades: { create: { trade: 'Carpenter', isPrimary: true } },
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    seekerIds.push(seeker.id);

    // Call 1: AM unanswered call (10:00 IST today)
    const kolkataDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const amDate = new Date(`${kolkataDateStr}T04:30:00.000Z`);
    const pmDate = new Date(`${kolkataDateStr}T11:30:00.000Z`); // 17:00 IST today

    const amCall = await prisma.callRecord.create({
      data: {
        code: `CALL-SW1-${stamp}`,
        provider: 'exotel',
        providerCallId: `call_sw1_${stamp}`,
        direction: 'outbound',
        staffId: caller.id,
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose: 'follow_up',
        providerStatus: 'initiated',
        answered: false,
        startedAt: amDate,
      },
    });
    callIds.push(amCall.id);
    await callService.applyStatus(
      makeEvent(amCall.providerCallId, 'no_answer', false, {
        startedAt: amDate,
        endedAt: new Date(amDate.getTime() + 30000),
        durationSec: 30,
      }),
    );

    // Call 2: PM unanswered call (17:00 IST today)
    const pmCall = await prisma.callRecord.create({
      data: {
        code: `CALL-SW2-${stamp}`,
        provider: 'exotel',
        providerCallId: `call_sw2_${stamp}`,
        direction: 'outbound',
        staffId: caller.id,
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose: 'follow_up',
        providerStatus: 'initiated',
        answered: false,
        startedAt: pmDate,
      },
    });
    callIds.push(pmCall.id);
    await callService.applyStatus(
      makeEvent(pmCall.providerCallId, 'no_answer', false, {
        startedAt: pmDate,
        endedAt: new Date(pmDate.getTime() + 30000),
        durationSec: 30,
      }),
    );

    // Master Guide ("What happens when things don't go to plan"): an unanswered
    // call is logged by the calling system and a WhatsApp goes out straight away
    // (once a day). So before the sweep there are 3 attempts: AM call, the
    // WhatsApp sent after it, and the PM call. (This test used to expect the
    // WhatsApp only from the nightly sweep.)
    const preSweepAttempts = await prisma.contactAttempt.findMany({
      where: { jobSeekerId: seeker.id },
    });
    expect(preSweepAttempts).toHaveLength(3);
    expect(preSweepAttempts.filter((a) => a.channel === 'whatsapp')).toHaveLength(1);

    // Run sweep: AM + PM unanswered plus the WhatsApp on the same day record the hit.
    const sweepResult = await sweepJob.evaluateNoPickups();
    expect(sweepResult.hitsRecorded).toBeGreaterThanOrEqual(1);

    // Check that job seeker received the hit
    const updatedSeeker = await prisma.jobSeeker.findUniqueOrThrow({
      where: { id: seeker.id },
      include: { hits: true, contactAttempts: true },
    });
    expect(updatedSeeker.hitCount).toBe(1);
    expect(updatedSeeker.hits).toHaveLength(1);
    expect(updatedSeeker.hits[0].reason).toBe('no_pickup');

    // Check all 3 attempts (AM call, PM call, WhatsApp) are linked to the hit
    expect(updatedSeeker.contactAttempts).toHaveLength(3);
    for (const att of updatedSeeker.contactAttempts) {
      expect(att.hitId).toBe(updatedSeeker.hits[0].id);
    }
  });
});

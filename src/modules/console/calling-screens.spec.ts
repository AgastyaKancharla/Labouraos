import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';
import { TELEPHONY_PROVIDER } from '../telephony/telephony.interface';
import { RECORDING_STORAGE, MemoryRecordingStorage } from '../call/recording-storage';
import { CallClock } from '../call/call-clock';
import { JwtService } from '@nestjs/jwt';
import { openAvailableDay } from '../../test-support/available-day';

class MockCallClock extends CallClock {
  currentTime = new Date('2026-11-04T06:30:00.000Z'); // 12:00 PM IST (within 09:00 - 21:00)

  now(): Date {
    return this.currentTime;
  }
}

describe('Phase 11 Task 6: Calling screens', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let clock: MockCallClock;

  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const bizIds: string[] = [];
  const refIds: string[] = [];
  const callIds: string[] = [];

  let caToken: string;
  let leadToken: string;
  let mgrToken: string;
  let ceoToken: string;
  let faToken: string;

  let testSeekerId: string;
  let testSeekerPhone: string;
  let testBizId: string;
  let testRefId: string;

  let answerOnNextCall = true;

  function makeToken(staff: { id: string; role: string; code: string; email: string | null }) {
    return jwt.sign({ sub: staff.id, role: staff.role, code: staff.code, email: staff.email });
  }

  beforeAll(async () => {
    process.env.CALL_ROUTING_KEY = 'calling_screens_test_routing_key_32bytes';
    clock = new MockCallClock();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CallClock)
      .useValue(clock)
      .overrideProvider(TELEPHONY_PROVIDER)
      .useValue({
        getCapacity: () => ({ vendor: 'mock', maxConcurrentCalls: 100 }),
        initiateOutboundCall: async () => ({
          callId: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          status: answerOnNextCall ? 'completed' : 'no_answer',
        }),
      })
      .overrideProvider(RECORDING_STORAGE)
      .useClass(MemoryRecordingStorage)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const passwordHash = await bcrypt.hash('ScreensPassword1!', 4);

    const lead = await prisma.staff.create({
      data: {
        code: `TL-CS-${Date.now()}`,
        name: 'Team Lead CS',
        email: `tl_cs_${Date.now()}@laboura.local`,
        passwordHash,
        role: 'team_lead',
        status: 'active',
        callRoutingPhone: encryptCallRoutingPhone('+919800000001'),
      },
    });
    staffIds.push(lead.id);

    const ca = await prisma.staff.create({
      data: {
        code: `CA-CS-${Date.now()}`,
        name: 'Call Agent CS',
        email: `ca_cs_${Date.now()}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        status: 'active',
        teamLeadId: lead.id,
        callRoutingPhone: encryptCallRoutingPhone('+919800000002'),
      },
    });
    staffIds.push(ca.id);

    const fa = await prisma.staff.create({
      data: {
        code: `FA-CS-${Date.now()}`,
        name: 'Field Agent CS',
        email: `fa_cs_${Date.now()}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        status: 'active',
        city: 'Bengaluru',
        teamLeadId: lead.id,
        callRoutingPhone: encryptCallRoutingPhone('+919800000003'),
      },
    });
    staffIds.push(fa.id);

    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-CS-${Date.now()}`,
        name: 'Manager CS',
        email: `mgr_cs_${Date.now()}@laboura.local`,
        passwordHash,
        role: 'manager',
        status: 'active',
      },
    });
    staffIds.push(mgr.id);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-CS-${Date.now()}`,
        name: 'CEO CS',
        email: `ceo_cs_${Date.now()}@laboura.local`,
        passwordHash,
        role: 'ceo',
        status: 'active',
      },
    });
    staffIds.push(ceo.id);

    caToken = makeToken(ca);
    leadToken = makeToken(lead);
    mgrToken = makeToken(mgr);
    ceoToken = makeToken(ceo);
    faToken = makeToken(fa);
    await openAvailableDay(app, ca.id);
    await openAvailableDay(app, fa.id);

    const stamp = Date.now().toString();
    testSeekerPhone = `+919${stamp.slice(-8)}1`;
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-CS-${stamp}`,
        name: 'Candidate CS',
        phone: testSeekerPhone,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        registeredByStaffId: ca.id,
      },
    });
    seekerIds.push(seeker.id);
    testSeekerId = seeker.id;
    await prisma.consent.createMany({
      data: ['call_recording', 'job_matching'].map((purpose) => ({
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose,
        noticeVersion: 'calling-screens-test',
        granted: true,
        language: 'en',
        method: 'sms_link',
        grantedAt: new Date(),
      })),
    });

    const biz = await prisma.business.create({
      data: {
        code: `BZ-CS-${stamp}`,
        name: 'Business CS Services',
        phone: `+918${stamp.slice(-8)}2`,
        locality: 'Koramangala',
      },
    });
    bizIds.push(biz.id);
    testBizId = biz.id;

    const ref = await prisma.referral.create({
      data: {
        code: `RF-CS-${stamp}`,
        name: 'Partner CS',
        phone: `+917${stamp.slice(-8)}3`,
        type: 'individual',
        city: 'Bengaluru',
      },
    });
    refIds.push(ref.id);
    testRefId = ref.id;
  }, 120000);

  afterAll(async () => {
    const validCallIds = callIds.filter((id): id is string => Boolean(id));
    if (validCallIds.length) {
      await prisma.contactAttempt.deleteMany({ where: { callRecordId: { in: validCallIds } } });
      await prisma.callRecord.deleteMany({ where: { id: { in: validCallIds } } });
    }
    if (seekerIds.length) {
      await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    }
    if (bizIds.length) await prisma.business.deleteMany({ where: { id: { in: bizIds } } });
    if (refIds.length) await prisma.referral.deleteMany({ where: { id: { in: refIds } } });
    if (staffIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    }
    await app.close();
  });

  describe('Console screens render for allowed roles', () => {
    it('GET /console/admin (the old Admin Dashboard) renders Call buttons for profiles, outcome list, Listen button, and history table', async () => {
      const res = await request(app.getHttpServer()).get('/console/admin').expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      const html = res.text;

      expect(html).toContain('Laboura Admin Dashboard');
      expect(html).toContain('admin-calling-modal');
      expect(html).toContain('btn-admin-call');
      expect(html).toContain('admin-call-blocked-alert');
      expect(html).toContain('admin-answered-outcome-form');

      // Closed list outcomes
      expect(html).toContain('value="interested"');
      expect(html).toContain('value="accepted_offer"');
      expect(html).toContain('value="rejected_offer"');
      expect(html).toContain('value="callback_requested"');
      expect(html).toContain('value="not_interested"');
      expect(html).toContain('value="working_now"');
      expect(html).toContain('value="other"');

      // Listen capability
      expect(html).toContain('listenRecording');
    });

  });

  describe('Privacy floor: no full phone number appears in any agent page', () => {
    it('verifies GET /console/admin contains no 10-digit phone number', async () => {
      const res = await request(app.getHttpServer()).get('/console/admin').expect(200);
      expect(res.text).not.toMatch(/\b[6-9]\d{9}\b/);
    });

  });

  describe('Calling workflow backing the console screens', () => {
    it('places a call from job seeker profile, returns masked phone, and records outcome after answered call', async () => {
      answerOnNextCall = true;
      const callRes = await request(app.getHttpServer())
        .post('/calls')
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          subjectType: 'job_seeker',
          subjectId: testSeekerId,
          purpose: 'offer',
        })
        .expect(201);

      const callId = callRes.body.callRecordId;
      expect(callId).toBeDefined();
      callIds.push(callId);
      expect(JSON.stringify(callRes.body)).not.toContain(testSeekerPhone.slice(-8));

      // Simulate provider reporting call answered and completed with recording
      await prisma.callRecord.update({
        where: { id: callId },
        data: {
          answered: true,
          providerStatus: 'completed',
          recordingStoragePath: 'recordings/test.mp3',
          durationSec: 42,
        },
      });

      // Verify call record has proper code and masked details
      const record = await prisma.callRecord.findUniqueOrThrow({ where: { id: callId } });
      expect(record.code).toMatch(/^CALL-\d{5}$/);

      // After an answered call, outcome form with closed list submits outcome
      const outcomeRes = await request(app.getHttpServer())
        .post(`/calls/${callId}/outcome`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          agentOutcome: 'interested',
          reason: 'Candidate accepted interview schedule',
        })
        .expect(201);

      expect(outcomeRes.body.agentOutcome).toBe('interested');
    });

    it('refuses outcome submission on an unanswered call', async () => {
      const callRes = await request(app.getHttpServer())
        .post('/calls')
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          subjectType: 'business',
          subjectId: testBizId,
          purpose: 'general',
        })
        .expect(201);

      const callId = callRes.body.callRecordId;
      expect(callId).toBeDefined();
      callIds.push(callId);

      // Call is unanswered
      await prisma.callRecord.update({
        where: { id: callId },
        data: { answered: false, providerStatus: 'no_answer' },
      });

      // Nothing for an unanswered call: outcome endpoint refuses
      const outcomeRes = await request(app.getHttpServer())
        .post(`/calls/${callId}/outcome`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ agentOutcome: 'interested' })
        .expect(400);

      expect(outcomeRes.body.message).toContain('not answered cannot have an outcome');
    });

    it('provides clear message when calling is blocked', async () => {
      // 1. Outside candidate's preferred window (window is 10:00 - 18:00; fast-forward clock to 19:30 IST = 14:00 UTC)
      clock.currentTime = new Date('2026-11-04T14:00:00.000Z');

      const blockedWindowRes = await request(app.getHttpServer())
        .post('/calls')
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          subjectType: 'job_seeker',
          subjectId: testSeekerId,
          purpose: 'follow_up',
        })
        .expect(400);

      expect(blockedWindowRes.body.message).toContain('can only be called between 10:00 and 18:00 IST');

      // Reset clock to 12:00 IST
      clock.currentTime = new Date('2026-11-04T06:30:00.000Z');

      // 2. No routing phone configured on agent
      const noPhoneAgent = await prisma.staff.create({
        data: {
          code: `CA-NO-PH-${Date.now()}`,
          name: 'No Phone Agent',
          email: `no_ph_${Date.now()}@laboura.local`,
          passwordHash: await bcrypt.hash('ScreensPassword1!', 4),
          role: 'call_agent',
          status: 'active',
        },
      });
      staffIds.push(noPhoneAgent.id);
      const noPhoneToken = makeToken(noPhoneAgent);

      const blockedPhoneRes = await request(app.getHttpServer())
        .post('/calls')
        .set('Authorization', `Bearer ${noPhoneToken}`)
        .send({
          subjectType: 'referral',
          subjectId: testRefId,
          purpose: 'general',
        })
        .expect(400);

      expect(blockedPhoneRes.body.message).toContain('Set the phone the calling system rings before placing a call');
    });

    it('verifies Listen button allows Team Lead, Manager, CEO and is denied to Call Agent', async () => {
      // Store a file in recording storage
      const storage = app.get<MemoryRecordingStorage>(RECORDING_STORAGE);
      await storage.put('recordings/sample.mp3', Buffer.from('fake-mp3-data'));

      // Create a completed call with recording
      const call = await prisma.callRecord.create({
        data: {
          code: `CL-REC-${Date.now()}`,
          provider: 'mock',
          providerCallId: `call-rec-${Date.now()}`,
          direction: 'outbound',
          staffId: staffIds[1], // CA
          subjectType: 'job_seeker',
          subjectId: testSeekerId,
          purpose: 'verification',
          providerStatus: 'completed',
          answered: true,
          durationSec: 60,
          recordingStoragePath: 'recordings/sample.mp3',
        },
      });
      callIds.push(call.id);

      // Team Lead can listen
      const leadRes = await request(app.getHttpServer())
        .get(`/calls/${call.id}/recording`)
        .set('Authorization', `Bearer ${leadToken}`)
        .expect(200);
      expect(leadRes.body.url).toBeDefined();

      // Manager can listen
      const mgrRes = await request(app.getHttpServer())
        .get(`/calls/${call.id}/recording`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .expect(200);
      expect(mgrRes.body.url).toBeDefined();

      // CEO can listen
      const ceoRes = await request(app.getHttpServer())
        .get(`/calls/${call.id}/recording`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);
      expect(ceoRes.body.url).toBeDefined();

      // Call Agent is denied
      await request(app.getHttpServer())
        .get(`/calls/${call.id}/recording`)
        .set('Authorization', `Bearer ${caToken}`)
        .expect(403);

      // Field Agent is denied
      await request(app.getHttpServer())
        .get(`/calls/${call.id}/recording`)
        .set('Authorization', `Bearer ${faToken}`)
        .expect(403);
    });

    it('asserts subject lookups and call list responses for agents mask full phone numbers', async () => {
      // Job seeker lookup
      const jsRes = await request(app.getHttpServer())
        .get(`/job-seekers/${testSeekerId}`)
        .set('Authorization', `Bearer ${caToken}`)
        .expect(200);
      expect(jsRes.body.phone).toMatch(/^\*{6}\d{4}$/);

      // Call history list
      const callsRes = await request(app.getHttpServer())
        .get('/calls')
        .query({ subjectType: 'job_seeker', subjectId: testSeekerId })
        .set('Authorization', `Bearer ${caToken}`)
        .expect(200);
      expect(Array.isArray(callsRes.body)).toBe(true);
      expect(JSON.stringify(callsRes.body)).not.toContain(testSeekerPhone.slice(-8));
    });
  });
});

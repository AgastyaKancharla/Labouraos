import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TELEPHONY_PROVIDER } from '../telephony/telephony.interface';
import { MockTelephonyProvider } from '../telephony/mock-telephony.provider';
import { CALL_ANNOUNCEMENT } from './call-announcement';
import { CallClock } from './call-clock';

const KEY = 'click_to_call_routing_key_32_characters';
const ROUTING = '+919812345678';
const SEEKER_PHONE = '+919800066611';
const OTHER_SEEKER_PHONE = '+919800066622';
const BUSINESS_PHONE = '+919800066633';
const OUTSIDE_BUSINESS_PHONE = '+919800066644';

class FrozenCallClock extends CallClock {
  at = new Date('2026-11-04T08:00:00.000Z');

  now(): Date {
    return this.at;
  }
}

describe('Phase 11 Task 4: click to call', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let provider: MockTelephonyProvider;
  const clock = new FrozenCallClock();
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const callIds: string[] = [];

  function tokenFor(staff: { id: string; role: string; code: string; email: string | null }) {
    return jwt.sign({
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      code: staff.code,
    });
  }

  beforeAll(async () => {
    process.env.CALL_ROUTING_KEY = KEY;
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
    provider = app.get(TELEPHONY_PROVIDER);
  }, 120000);

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  async function makeStaff(role: string, extra?: { teamLeadId?: string }) {
    const stamp = `${Date.now()}-${staffIds.length}`;
    const staff = await prisma.staff.create({
      data: {
        code: `CTC-${role.slice(0, 3).toUpperCase()}-${stamp}`,
        name: `Caller ${role}`,
        email: `ctc-${role}-${stamp}@laboura.local`,
        passwordHash: await bcrypt.hash('Caller-Password-1', 4),
        role,
        teamLeadId: extra?.teamLeadId ?? null,
        status: 'active',
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  it('places a recorded call with no numbers, and refuses the cases the spec names', async () => {
    expect(CALL_ANNOUNCEMENT).toBe('This call is recorded for quality and service.');

    const callAgent = await makeStaff('call_agent');
    const otherAgent = await makeStaff('call_agent');
    const fieldAgent = await makeStaff('field_agent');
    const stamp = Date.now();
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-CTC-${stamp}`,
        name: 'Click Candidate',
        phone: SEEKER_PHONE,
        tradeSkill: 'Electrician',
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    seekerIds.push(seeker.id);
    await prisma.consent.create({
      data: {
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose: 'call_recording',
        noticeVersion: 'click-to-call-test',
        granted: true,
        language: 'en',
        method: 'sms_link',
        grantedAt: new Date(),
      },
    });
    const earlySeeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-CT2-${stamp}`,
        name: 'Window Candidate',
        phone: OTHER_SEEKER_PHONE,
        tradeSkill: 'Plumber',
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    seekerIds.push(earlySeeker.id);
    const business = await prisma.business.create({
      data: {
        code: `BZ-CTC-${stamp}`,
        name: 'Click Cafe',
        phone: BUSINESS_PHONE,
        accountAgentId: fieldAgent.id,
      },
    });
    businessIds.push(business.id);
    const outside = await prisma.business.create({
      data: {
        code: `BZ-CT2-${stamp}`,
        name: 'Other Cafe',
        phone: OUTSIDE_BUSINESS_PHONE,
      },
    });
    businessIds.push(outside.id);

    clock.at = new Date('2026-11-04T08:00:00.000Z');
    const missingPhone = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send({ subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'general' });
    expect(missingPhone.status).toBe(400);
    expect(missingPhone.body.message).toContain('Set the phone the calling system rings');

    await request(app.getHttpServer())
      .put(`/staff/${callAgent.id}/call-routing-phone`)
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send({ phone: ROUTING })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/staff/${fieldAgent.id}/call-routing-phone`)
      .set('Authorization', `Bearer ${tokenFor(fieldAgent)}`)
      .send({ phone: '+919800077700' })
      .expect(200);

    const matchingCallWithoutConsent = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send({ subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'offer' });
    expect(matchingCallWithoutConsent.status).toBe(403);
    expect(matchingCallWithoutConsent.body.message).toContain('job_matching');

    await prisma.consent.create({
      data: {
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose: 'job_matching',
        noticeVersion: 'click-to-call-test',
        granted: true,
        language: 'en',
        method: 'sms_link',
        grantedAt: new Date(),
      },
    });
    await prisma.consent.createMany({
      data: ['call_recording', 'job_matching'].map((purpose) => ({
        subjectType: 'job_seeker',
        subjectId: earlySeeker.id,
        purpose,
        noticeVersion: 'click-to-call-test',
        granted: true,
        language: 'en',
        method: 'sms_link',
        grantedAt: new Date(),
      })),
    });

    const requestBody = { subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'general' };
    expect(JSON.stringify(requestBody)).not.toContain(SEEKER_PHONE);
    expect(JSON.stringify(requestBody)).not.toContain(ROUTING);
    const placed = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send(requestBody);
    expect(placed.status).toBe(201);
    expect(Object.keys(placed.body)).toEqual(['callRecordId']);
    expect(JSON.stringify(placed.body)).not.toContain(SEEKER_PHONE);
    expect(JSON.stringify(placed.body)).not.toContain(ROUTING);
    callIds.push(placed.body.callRecordId);

    const stored = await prisma.callRecord.findUniqueOrThrow({ where: { id: placed.body.callRecordId } });
    expect(stored.providerStatus).toBe('initiated');
    expect(stored.announcementPlayed).toBe(true);
    expect(stored.staffId).toBe(callAgent.id);
    expect(provider.lastOutbound?.ringAgentFirst).toBe(true);
    expect(provider.lastOutbound?.recordCall).toBe(true);
    expect(provider.lastOutbound?.announcement).toBe(CALL_ANNOUNCEMENT);
    expect(provider.lastOutbound?.agentPhone).toBe(ROUTING);
    expect(provider.lastOutbound?.customerPhone).toBe(SEEKER_PHONE);

    const policy = await prisma.pricingPolicy.findFirstOrThrow({
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    clock.at = new Date('2026-11-04T16:00:00.000Z');
    const late = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send(requestBody);
    expect(late.status).toBe(400);
    expect(late.body.message).toContain(policy.callingHoursStart);
    expect(late.body.message).toContain(policy.callingHoursEnd);

    clock.at = new Date('2026-11-04T13:30:00.000Z');
    const outsideWindow = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send({ subjectType: 'job_seeker', subjectId: earlySeeker.id, purpose: 'follow_up' });
    expect(outsideWindow.status).toBe(400);
    expect(outsideWindow.body.message).toContain(earlySeeker.preferredCallWindowStart);
    expect(outsideWindow.body.message).toContain(earlySeeker.preferredCallWindowEnd);

    clock.at = new Date('2026-11-04T08:00:00.000Z');
    const fieldCall = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${tokenFor(fieldAgent)}`)
      .send({ subjectType: 'business', subjectId: business.id, purpose: 'verification' });
    expect(fieldCall.status).toBe(201);
    callIds.push(fieldCall.body.callRecordId);
    expect(provider.lastOutbound?.customerPhone).toBe(BUSINESS_PHONE);

    const fieldDenied = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${tokenFor(fieldAgent)}`)
      .send({ subjectType: 'business', subjectId: outside.id, purpose: 'verification' });
    expect(fieldDenied.status).toBe(403);

    const gone = await request(app.getHttpServer())
      .post('/telephony/outbound/click-to-call')
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send({ agentPhone: ROUTING, customerPhone: SEEKER_PHONE });
    expect(gone.status).toBe(404);

    const unanswered = await request(app.getHttpServer())
      .post(`/calls/${placed.body.callRecordId}/outcome`)
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send({ agentOutcome: 'interested' });
    expect(unanswered.status).toBe(400);

    await prisma.callRecord.update({
      where: { id: placed.body.callRecordId },
      data: { answered: true },
    });
    const other = await request(app.getHttpServer())
      .post(`/calls/${placed.body.callRecordId}/outcome`)
      .set('Authorization', `Bearer ${tokenFor(otherAgent)}`)
      .send({ agentOutcome: 'interested' });
    expect(other.status).toBe(403);

    const recorded = await request(app.getHttpServer())
      .post(`/calls/${placed.body.callRecordId}/outcome`)
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send({ agentOutcome: 'interested', reason: 'Wants a day shift' });
    expect(recorded.status).toBe(201);
    expect(recorded.body).toEqual({ callRecordId: placed.body.callRecordId, agentOutcome: 'interested' });
  }, 120000);
});

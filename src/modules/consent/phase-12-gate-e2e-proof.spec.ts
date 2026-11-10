import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { OtpService } from '../../common/otp/otp.service';
import { CallClock } from '../call/call-clock';
import { ConsentClock } from './consent-clock';
import { ConsentService } from './consent.service';
import { JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from './consent.constants';
import { completeJobSeekerRegistration } from '../../test-support/job-seeker-registration';

class GateClock extends CallClock {
  override now(): Date {
    return new Date('2026-11-05T04:30:00.000Z');
  }
}

class GateConsentClock extends ConsentClock {
  override now(): Date {
    return new Date('2026-11-05T04:30:00.000Z');
  }
}

describe('Phase 12 gate end-to-end proof', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otpService: OtpService;
  let consentService: ConsentService;
  let fieldAgent: { id: string; code: string; email: string; role: string };
  let fieldAgentToken: string;

  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const createdJobSeekerIds: string[] = [];
  const createdBusinessIds: string[] = [];
  const createdVacancyIds: string[] = [];
  const createdCallIds: string[] = [];
  const createdPaymentIds: string[] = [];
  const createdStaffIds: string[] = [];
  const originalCallRoutingKey = process.env.CALL_ROUTING_KEY;

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    process.env.CALL_ROUTING_KEY = 'phase_12_gate_call_routing_key_32_chars';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CallClock)
      .useValue(new GateClock())
      .overrideProvider(ConsentClock)
      .useValue(new GateConsentClock())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otpService = app.get(OtpService);
    consentService = app.get(ConsentService);

    const fieldAgentRecord = await prisma.staff.create({
      data: {
        code: `FA-P12G-${suffix}`,
        name: 'Phase 12 Gate Field Agent',
        email: `fa_p12_gate_${suffix}@laboura.local`,
        passwordHash: await bcrypt.hash('Gate-Agent-Password-1', 4),
        role: 'field_agent',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    fieldAgent = {
      id: fieldAgentRecord.id,
      code: fieldAgentRecord.code,
      email: fieldAgentRecord.email!,
      role: fieldAgentRecord.role,
    };
    createdStaffIds.push(fieldAgent.id);
    fieldAgentToken = jwt.sign({
      sub: fieldAgent.id,
      email: fieldAgent.email,
      role: fieldAgent.role,
      code: fieldAgent.code,
      area: 'Koramangala',
    });

    await request(app.getHttpServer())
      .put(`/staff/${fieldAgent.id}/call-routing-phone`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ phone: '+919800077701' })
      .expect(200);
  }, 120000);

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: createdStaffIds } } });
      await prisma.identityVerification.deleteMany({
        where: { jobSeekerId: { in: createdJobSeekerIds } },
      });
      await prisma.consent.deleteMany({
        where: { subjectType: 'job_seeker', subjectId: { in: createdJobSeekerIds } },
      });
      await prisma.messageLog.deleteMany({ where: { subjectId: { in: createdJobSeekerIds } } });
      await prisma.contactAttempt.deleteMany({
        where: { jobSeekerId: { in: createdJobSeekerIds } },
      });
      await prisma.statusHistory.deleteMany({
        where: { subjectId: { in: [...createdJobSeekerIds, ...createdPaymentIds] } },
      });
      await prisma.payment.deleteMany({ where: { jobSeekerId: { in: createdJobSeekerIds } } });
      await prisma.callRecord.deleteMany({ where: { id: { in: createdCallIds } } });
      await prisma.vacancy.deleteMany({ where: { id: { in: createdVacancyIds } } });
      await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
      await prisma.jobSeekerTrade.deleteMany({
        where: { jobSeekerId: { in: createdJobSeekerIds } },
      });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: createdJobSeekerIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: createdStaffIds } } });
      await app.close();
    }

    if (originalCallRoutingKey === undefined) {
      delete process.env.CALL_ROUTING_KEY;
    } else {
      process.env.CALL_ROUTING_KEY = originalCallRoutingKey;
    }
  });

  it('registers a lead, obtains consent by the seeker OTP flow, verifies identity, and pauses on withdrawal', async () => {
    const phone = `+9197${Math.floor(10000000 + Math.random() * 90000000)}`;
    const registrationOtp = await otpService.sendOtp(phone);
    const mockOtp = otpService.getProvider() as MockOtpProvider;
    const registrationCode = mockOtp.getCode(registrationOtp.requestId);
    expect(registrationCode).toBeDefined();
    expect(await otpService.verifyOtp(registrationOtp.requestId, registrationCode!)).toBe(true);

    const registration = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send(completeJobSeekerRegistration({
        name: `Gate Candidate ${suffix}`,
        phone,
        otpRequestId: registrationOtp.requestId,
        dateOfBirth: '1990-05-15',
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        city: 'Bengaluru',
      }));
    expect(registration.status).toBe(201);
    expect(registration.body.status).toBe('lead');
    expect(registration.body.tradeSkill).toBe('Housekeeping');
    const jobSeekerId = registration.body.id as string;
    createdJobSeekerIds.push(jobSeekerId);

    const beforeConsentMatchingCall = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ subjectType: 'job_seeker', subjectId: jobSeekerId, purpose: 'offer' });
    expect(beforeConsentMatchingCall.status).toBe(403);
    expect(beforeConsentMatchingCall.body.message).toContain('call_recording');

    const explanatoryCall = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ subjectType: 'job_seeker', subjectId: jobSeekerId, purpose: 'consent_explain' })
      .expect(201);
    createdCallIds.push(explanatoryCall.body.callRecordId);
    const callRecord = await prisma.callRecord.findUniqueOrThrow({
      where: { id: explanatoryCall.body.callRecordId },
    });
    expect(callRecord.purpose).toBe('consent_explain');
    expect(callRecord.subjectId).toBe(jobSeekerId);

    const consentLink = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ jobSeekerId })
      .expect(201);
    expect(JSON.stringify(consentLink.body)).not.toContain(phone);

    const sms = await prisma.messageLog.findFirstOrThrow({
      where: { subjectId: jobSeekerId, template: 'consent_link' },
    });
    expect(sms.channel).toBe('sms');

    const openedPage = await request(app.getHttpServer())
      .get(`/consent/${consentLink.body.token}`)
      .set('Accept', 'text/html')
      .expect(200);
    expect(openedPage.text).toContain('Verify via OTP on your registered mobile');
    for (const purpose of JOB_SEEKER_REQUIRED_CONSENT_PURPOSES) {
      expect(openedPage.text).toContain(`id="chk-${purpose}"`);
    }

    const seekerOtp = await request(app.getHttpServer())
      .post('/consent/send-otp')
      .send({ token: consentLink.body.token })
      .expect(201);
    const consentCode = mockOtp.getCode(seekerOtp.body.requestId);
    expect(consentCode).toBeDefined();

    const requiredPurposes = [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES];
    expect(requiredPurposes).toHaveLength(5);
    const submitted = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({
        token: consentLink.body.token,
        otpRequestId: seekerOtp.body.requestId,
        otpCode: consentCode,
        purposes: requiredPurposes,
        language: 'en',
      })
      .expect(201);
    expect(submitted.body.status).toBe('consented');
    expect(await prisma.jobSeeker.findUniqueOrThrow({ where: { id: jobSeekerId } })).toMatchObject({
      status: 'consented',
    });

    const consentRows = await prisma.consent.findMany({
      where: { subjectType: 'job_seeker', subjectId: jobSeekerId },
    });
    expect(consentRows.map((row) => row.purpose).sort()).toEqual([...requiredPurposes].sort());
    expect(
      consentRows.every(
        (row) =>
          row.granted &&
          row.method === 'sms_link' &&
          row.otpRequestId === seekerOtp.body.requestId,
      ),
    ).toBe(true);

    const identityRequest = {
      method: 'digilocker',
      vendor: 'digilocker',
      vendorReference: `gate-proof-${suffix}`,
      last4: '4242',
      nameMatches: true,
      isAdult: true,
    };
    const identityResponse = await request(app.getHttpServer())
      .post(`/job-seekers/${jobSeekerId}/identity-verification`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send(identityRequest)
      .expect(201);
    expect(identityResponse.body.status).toBe('verified');
    expect(identityResponse.body.last4).toBe('4242');
    expect(identityResponse.body.nameMatches).toBe(true);
    expect(identityResponse.body.isAdult).toBe(true);
    const verification = await prisma.identityVerification.findUniqueOrThrow({
      where: { id: identityResponse.body.id },
    });
    expect(verification).toMatchObject({
      last4: '4242',
      nameMatches: true,
      isAdult: true,
      status: 'verified',
    });
    expect(identityResponse.body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(verification.id).toBe(identityResponse.body.id);
    expect(verification.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(verification.id).toBe(identityResponse.body.id);
    const serialized = JSON.stringify({ identityRequest, identityResponse: identityResponse.body, verification });
    const withoutUuids = serialized.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '',
    );
    expect(withoutUuids).not.toMatch(/\b\d{12}\b/);

    await request(app.getHttpServer())
      .post(`/job-seekers/${jobSeekerId}/trades`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ trade: 'Electrician', yearsExperience: 3, isPrimary: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/job-seekers/${jobSeekerId}/status`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ status: 'pending_activation' })
      .expect(201);

    const activation = await request(app.getHttpServer())
      .post(`/job-seekers/${jobSeekerId}/activation-payment`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .expect(201);
    createdPaymentIds.push(activation.body.paymentId);
    let gatewayReference = activation.body.gatewayReference;
    if (!gatewayReference && activation.body.upiReference) {
      await request(app.getHttpServer()).post(`/payments/request/${encodeURIComponent(activation.body.upiReference)}/card`).expect(200);
      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: activation.body.paymentId } });
      gatewayReference = updated.gatewayReference;
    }
    const paymentResult = await request(app.getHttpServer())
      .post('/payments/mock/simulate-webhook')
      .send({ gatewayReference, status: 'succeeded' });
    expect([200, 201]).toContain(paymentResult.status);
    expect(await prisma.jobSeeker.findUniqueOrThrow({ where: { id: jobSeekerId } })).toMatchObject({
      status: 'active',
    });

    expect(
      await consentService.withdraw({
        subjectType: 'job_seeker',
        subjectId: jobSeekerId,
        purpose: 'call_recording',
      }),
    ).toMatchObject({ withdrawn: true });
    const pausedSeeker = await prisma.jobSeeker.findUniqueOrThrow({
      where: { id: jobSeekerId },
    });
    expect(pausedSeeker.status).toBe('paused');
    expect(pausedSeeker.pausedAt).toEqual(new Date('2026-11-05T04:30:00.000Z'));

    const withdrawnConsent = await prisma.consent.findFirstOrThrow({
      where: {
        subjectType: 'job_seeker',
        subjectId: jobSeekerId,
        purpose: 'call_recording',
      },
    });
    expect(withdrawnConsent.granted).toBe(false);
    expect(withdrawnConsent.withdrawnAt).toEqual(new Date('2026-11-05T04:30:00.000Z'));
    expect(
      await prisma.statusHistory.findFirst({
        where: { subjectType: 'job_seeker', subjectId: jobSeekerId, toStatus: 'paused' },
      }),
    ).toMatchObject({ fromStatus: 'active', toStatus: 'paused' });
  }, 120000);

  it('does not match or make matching-purpose calls to an active seeker without job_matching consent', async () => {
    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-P12G-${suffix}`,
        name: `No Consent Candidate ${suffix}`,
        phone: `+9196${Math.floor(10000000 + Math.random() * 90000000)}`,
        phoneVerified: true,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    createdJobSeekerIds.push(candidate.id);

    await prisma.consent.create({
      data: {
        subjectType: 'job_seeker',
        subjectId: candidate.id,
        purpose: 'call_recording',
        noticeVersion: 'gate-no-matching-consent',
        granted: true,
        language: 'en',
        method: 'sms_link',
        grantedAt: new Date('2026-11-05T04:30:00.000Z'),
      },
    });

    const business = await prisma.business.create({
      data: {
        code: `BZ-P12G-${suffix}`,
        name: `Gate Proof Business ${suffix}`,
        city: 'Bengaluru',
        locality: 'Koramangala',
        phone: `+9188${Math.floor(10000000 + Math.random() * 90000000)}`,
        verificationStatus: 'verified',
      },
    });
    createdBusinessIds.push(business.id);
    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-P12G-${suffix}`,
        city: 'Bengaluru',
        businessId: business.id,
        capturedByStaffId: fieldAgent.id,
        tradeSkill: 'Electrician',
        salaryMinPaise: 2500000,
        headcount: 1,
        status: 'open',
      },
    });
    createdVacancyIds.push(vacancy.id);

    const shortlist = await request(app.getHttpServer())
      .get(`/vacancies/${vacancy.id}/candidates`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .expect(200);
    expect(shortlist.body.map((row: { id: string }) => row.id)).not.toContain(candidate.id);

    const matchingCall = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ subjectType: 'job_seeker', subjectId: candidate.id, purpose: 'offer' });
    expect(matchingCall.status).toBe(403);
    expect(matchingCall.body.message).toContain('job_matching');
  }, 120000);

  it('has no staff route for granting consent on a job seeker’s behalf', async () => {
    const roles = ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance'];

    for (const role of roles) {
      const token = jwt.sign({ sub: `gate-agent-${role}`, role, code: `GATE-${role}` });
      await request(app.getHttpServer())
        .post('/consent/grant')
        .set('Authorization', `Bearer ${token}`)
        .send({ subjectType: 'job_seeker', subjectId: 'not-a-real-seeker', purpose: 'job_matching' })
        .expect(404);
    }
  });
});

import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { BusinessClock } from './business-clock';
import { ConsentClock } from '../consent/consent-clock';
import { JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from '../consent/consent.constants';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { confirmVacancyForTest } from '../../test-support/confirm-vacancy';

class Phase13GateClock extends BusinessClock {
  nowValue = new Date();
  override now() { return new Date(this.nowValue); }
}

class Phase13ConsentGateClock extends ConsentClock {
  nowValue = new Date();
  override now() { return new Date(this.nowValue); }
}

describe('Phase 13 gate — complete verification and consent journeys', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: OtpService;
  const businessClock = new Phase13GateClock();
  const consentClock = new Phase13ConsentGateClock();
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const seekerIds: string[] = [];
  const callIds: string[] = [];
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const gateNow = new Date();

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    businessClock.nowValue = gateNow;
    consentClock.nowValue = gateNow;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BusinessClock).useValue(businessClock)
      .overrideProvider(ConsentClock).useValue(consentClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OtpService);
  }, 120000);

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
      await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
      await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: [...businessIds, ...seekerIds] } } });
      await prisma.messageLog.deleteMany({ where: { subjectId: { in: [...businessIds, ...seekerIds] } } });
      await prisma.consent.deleteMany({ where: { subjectId: { in: [...businessIds, ...seekerIds] } } });
      await prisma.statusHistory.deleteMany({ where: { subjectId: { in: [...businessIds, ...seekerIds] } } });
      await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
      await prisma.visitAssignment.deleteMany({ where: { businessId: { in: businessIds } } });
      await prisma.businessVisit.deleteMany({ where: { businessId: { in: businessIds } } });
      await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
      await prisma.fieldCheckIn.deleteMany({ where: { staffId: { in: staffIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      await app.close();
    }
  }, 120000);

  it('proves the whole no-documents business verification flow and agent consent withdrawal/re-grant flow', async () => {
    const passwordHash = await bcrypt.hash('Phase13-Gate-Password-1', 4);
    const createStaff = async (tag: string, role: string, teamLeadId?: string) => {
      const staff = await prisma.staff.create({
        data: {
          code: `P13-${tag}-${suffix}`,
          name: `Phase 13 ${tag}`,
          email: `p13-${tag.toLowerCase()}-${suffix.toLowerCase()}@laboura.local`,
          passwordHash,
          role,
          status: 'active',
          city: 'Bengaluru',
          teamLeadId: teamLeadId ?? null,
        },
      });
      staffIds.push(staff.id);
      return { staff, token: jwt.sign({ sub: staff.id, role: staff.role, code: staff.code, email: staff.email }) };
    };

    const lead = await createStaff('TL', 'team_lead');
    const callAgent = await createStaff('CA', 'call_agent', lead.staff.id);
    const farAgent = await createStaff('FA-FAR', 'field_agent', lead.staff.id);
    const visitingAgent = await createStaff('FA-NEAR', 'field_agent', lead.staff.id);
    const server = app.getHttpServer();
    const provider = otp.getProvider() as MockOtpProvider;

    const businessPhone = `9${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    const businessOtp = await request(server).post('/otp/send')
      .set('Authorization', `Bearer ${callAgent.token}`).send({ phone: businessPhone, purpose: 'business_contact' }).expect(201);
    const businessOtpCode = provider.getCode(businessOtp.body.requestId)!;
    await request(server).post('/otp/verify').set('Authorization', `Bearer ${callAgent.token}`)
      .send({ requestId: businessOtp.body.requestId, code: businessOtpCode }).expect(201);

    const businessResponse = await request(server).post('/businesses')
      .set('Authorization', `Bearer ${callAgent.token}`)
      .send({
        name: `Gate Household ${suffix}`,
        phone: businessPhone,
        businessType: 'household',
        familyName: 'Household Family',
        contactPersonName: 'Household Owner',
        contactPersonRole: 'owner', heardFrom: 'field_visit',
        ownerName: 'Household Owner',
        address: 'Test address',
        locality: 'Test locality',
        latitude: 12.9716,
        longitude: 77.5946,
        otpRequestId: businessOtp.body.requestId,
      }).expect(201);
    const businessId = businessResponse.body.id as string;
    businessIds.push(businessId);
    expect(businessResponse.body.documentsStatus).toBe('no_documents');
    expect(businessResponse.body.verificationStatus).toBe('lead');

    await request(server).post('/field-agent/check-in').set('Authorization', `Bearer ${farAgent.token}`)
      .send({ latitude: 13.2, longitude: 77.8, accuracyMeters: 10 }).expect(201);
    await request(server).post('/field-agent/check-in').set('Authorization', `Bearer ${visitingAgent.token}`)
      .send({ latitude: 12.97161, longitude: 77.59461, accuracyMeters: 5 }).expect(201);
    const assignmentResponse = await request(server).post(`/businesses/${businessId}/visit-assignments`)
      .set('Authorization', `Bearer ${lead.token}`).send({ purpose: 'verification' }).expect(201);
    expect(assignmentResponse.body.suggestedStaffId).toBe(visitingAgent.staff.id);
    await request(server).post(`/businesses/${businessId}/visit-assignments/${assignmentResponse.body.id}/assign`)
      .set('Authorization', `Bearer ${lead.token}`).send({ assignedStaffId: visitingAgent.staff.id }).expect(201);

    const ownerPresenceOtp = await request(server)
      .post(`/businesses/${businessId}/visit-assignments/${assignmentResponse.body.id}/owner-otp`)
      .set('Authorization', `Bearer ${visitingAgent.token}`).send({}).expect(201);
    const ownerPresenceCode = provider.getCode(ownerPresenceOtp.body.requestId)!;
    const visitResponse = await request(server).post(`/businesses/${businessId}/visits`)
      .set('Authorization', `Bearer ${visitingAgent.token}`)
      .send({
        assignmentId: assignmentResponse.body.id,
        latitude: 12.9716,
        longitude: 77.5946,
        selfieUrl: `data:image/jpeg;base64,${Buffer.from('gate visit photo').toString('base64')}`,
        selfieHash: randomUUID().replace(/-/g, '').padEnd(64, 'a'),
        ownerOtpRequestId: ownerPresenceOtp.body.requestId,
        ownerOtpCode: ownerPresenceCode,
        purpose: 'verification',
      }).expect(201);
    expect(visitResponse.body.ownerOtpRequestId).toBe(ownerPresenceOtp.body.requestId);
    expect(visitResponse.body.photoLive).toBe(false);

    const agreementLink = await request(server).post(`/businesses/${businessId}/agreement-links`)
      .set('Authorization', `Bearer ${lead.token}`).send({ language: 'en' }).expect(201);
    const signingOtp = await request(server).post('/consent/send-otp')
      .send({ token: agreementLink.body.token }).expect(201);
    const signingCode = provider.getCode(signingOtp.body.requestId)!;
    await request(server).post('/consent/submit').send({
      token: agreementLink.body.token,
      otpRequestId: signingOtp.body.requestId,
      otpCode: signingCode,
      signedName: 'Household Owner',
      purposes: ['agreement_terms', 'call_recording'],
      language: 'en',
    }).expect(201);
    const signedAgreement = await prisma.businessAgreement.findFirstOrThrow({ where: { businessId } });
    const businessConsents = await prisma.consent.findMany({
      where: { subjectType: 'business', subjectId: businessId, purpose: { in: ['agreement_terms', 'call_recording'] } },
    });
    expect(businessConsents).toHaveLength(2);
    expect(new Set(businessConsents.map(row => row.otpRequestId))).toEqual(new Set([signingOtp.body.requestId]));
    expect(signedAgreement.otpRequestId).toBe(signingOtp.body.requestId);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).verificationStatus).toBe('pending_tl_check');
    expect(await prisma.reviewFlag.count({
      where: { subjectType: 'business', subjectId: businessId, kind: 'no_documents_check', status: 'open' },
    })).toBe(1);

    const candidatePhone = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-P13-${suffix}`,
        name: `Gate Candidate ${suffix}`,
        phone: candidatePhone,
        phoneVerified: true,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 1500000,
        maxSalary: 2500000,
        dateOfBirth: new Date('1995-01-01T00:00:00.000Z'),
        latitude: 12.9717,
        longitude: 77.5947,
        travelDistanceKm: 20,
        shiftPreference: 'any',
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: 'active',
      },
    });
    seekerIds.push(candidate.id);
    await prisma.consent.createMany({ data: JOB_SEEKER_REQUIRED_CONSENT_PURPOSES.map(purpose => ({
      subjectType: 'job_seeker', subjectId: candidate.id, purpose, noticeVersion: '1.0',
      granted: true, language: 'en', method: 'sms_link', grantedAt: gateNow,
    })) });
    const vacancyResponse = await request(server).post(`/businesses/${businessId}/vacancies`)
      .set('Authorization', `Bearer ${lead.token}`)
      .send({
        tradeSkill: 'Electrician', salaryMinPaise: 2000000, salaryMaxPaise: 2500000,
        headcount: 1, interviewType: 'walk_in', walkInDate: '2026-11-06', ownerToldMinimumWage: true,
      }).expect(201);
    const vacancyId = vacancyResponse.body.id as string;
    await confirmVacancyForTest(app, vacancyResponse.body);
    vacancyIds.push(vacancyId);
    await request(server).get(`/vacancies/${vacancyId}/shortlist`)
      .set('Authorization', `Bearer ${visitingAgent.token}`)
      .expect(403);

    const policy = await prisma.pricingPolicy.findFirstOrThrow({ orderBy: { effectiveFrom: 'desc' } });
    const walkInSlot = await prisma.vacancyInterviewSlot.findFirstOrThrow({ where: { vacancyId } });
    const walkInStart = getCalendarPartsInTimezone(walkInSlot.startsAt, 'Asia/Kolkata');
    const walkInEnd = getCalendarPartsInTimezone(walkInSlot.endsAt, 'Asia/Kolkata');
    expect(`${String(walkInStart.hour).padStart(2, '0')}:${String(walkInStart.minute).padStart(2, '0')}`).toBe(policy.walkInStart);
    expect(`${String(walkInEnd.hour).padStart(2, '0')}:${String(walkInEnd.minute).padStart(2, '0')}`).toBe(policy.walkInEnd);
    expect(walkInSlot.endsAt.getTime()).toBeGreaterThan(walkInSlot.startsAt.getTime());

    await request(server).post(`/businesses/${businessId}/verification/approve`)
      .set('Authorization', `Bearer ${lead.token}`).send({}).expect(400);
    const approvalCall = await prisma.callRecord.create({
      data: {
        code: `CR-P13-VERIFY-${suffix}`,
        provider: 'mock', providerCallId: `p13-verify-${suffix}`,
        direction: 'outbound', staffId: lead.staff.id, subjectType: 'business', subjectId: businessId,
        purpose: 'verification', providerStatus: 'completed', answered: true,
        startedAt: new Date(gateNow.getTime() + 1000), answeredAt: new Date(gateNow.getTime() + 1000),
      },
    });
    callIds.push(approvalCall.id);
    const approved = await request(server).post(`/businesses/${businessId}/verification/approve`)
      .set('Authorization', `Bearer ${lead.token}`).send({}).expect(201);
    expect(approved.body.verificationStatus).toBe('verified');
    expect(approved.body.accountAgentId).toBe(visitingAgent.staff.id);
    expect(await prisma.reviewFlag.count({
      where: { subjectType: 'business', subjectId: businessId, kind: 'no_documents_check', status: 'open' },
    })).toBe(0);
    const shortlist = await request(server).get(`/vacancies/${vacancyId}/shortlist`)
      .set('Authorization', `Bearer ${visitingAgent.token}`).expect(200);
    expect(shortlist.body.matches.map((row: { jobSeekerId: string }) => row.jobSeekerId)).toContain(candidate.id);

    const withdrawalPhone = `7${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    const withdrawalCandidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-P13-W-${suffix}`, name: `Withdrawal Candidate ${suffix}`, phone: withdrawalPhone,
        phoneVerified: true, trades: { create: { trade: 'Electrician', isPrimary: true } }, minSalary: 1000000, maxSalary: 3000000,
        preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00', status: 'active',
      },
    });
    seekerIds.push(withdrawalCandidate.id);
    await prisma.consent.createMany({ data: JOB_SEEKER_REQUIRED_CONSENT_PURPOSES.map(purpose => ({
      subjectType: 'job_seeker', subjectId: withdrawalCandidate.id, purpose, noticeVersion: '1.0',
      granted: true, language: 'en', method: 'sms_link', grantedAt: gateNow,
    })) });
    const inboundCall = await prisma.callRecord.create({
      data: {
        code: `CR-P13-W-${suffix}`, provider: 'mock', providerCallId: `p13-withdraw-${suffix}`,
        direction: 'inbound', staffId: callAgent.staff.id, subjectType: 'job_seeker', subjectId: withdrawalCandidate.id,
        purpose: 'consent_withdraw', providerStatus: 'completed', answered: true,
        startedAt: new Date(gateNow.getTime() - 60000), answeredAt: new Date(gateNow.getTime() - 55000),
        endedAt: new Date(gateNow.getTime() - 30000),
      },
    });
    callIds.push(inboundCall.id);
    const eligibility = await request(server).get(`/consent/withdrawal-eligibility?jobSeekerId=${withdrawalCandidate.id}`)
      .set('Authorization', `Bearer ${callAgent.token}`).expect(200);
    expect(eligibility.body).toEqual({ eligible: true, callRecordId: inboundCall.id });
    await request(server).post('/consent/withdraw').set('Authorization', `Bearer ${callAgent.token}`)
      .send({ jobSeekerId: withdrawalCandidate.id, purposes: ['call_recording'], callRecordId: inboundCall.id }).expect(201);
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: withdrawalCandidate.id } })).status).toBe('paused');
    expect(await prisma.messageLog.count({ where: { subjectId: withdrawalCandidate.id, template: 'consent_withdrawn' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId: callAgent.staff.id, entityCode: withdrawalCandidate.code, action: 'consent_withdrawn_by_agent_call' } })).toBe(1);

    const regrantLink = await request(server).post('/consent/links').set('Authorization', `Bearer ${callAgent.token}`)
      .send({ jobSeekerId: withdrawalCandidate.id }).expect(201);
    const regrantOtp = await request(server).post('/consent/send-otp').send({ token: regrantLink.body.token }).expect(201);
    const regrantCode = provider.getCode(regrantOtp.body.requestId)!;
    const regrant = await request(server).post('/consent/submit').send({
      token: regrantLink.body.token, otpRequestId: regrantOtp.body.requestId, otpCode: regrantCode,
      purposes: [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES], language: 'en',
    }).expect(201);
    expect(regrant.body.status).toBe('active');
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: withdrawalCandidate.id } })).status).toBe('active');
  }, 120000);
});

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
import { ConsentLinkService } from '../consent/consent-link.service';
import { BusinessClock } from './business-clock';

class VerificationTestClock extends BusinessClock {
  current = new Date('2026-11-05T10:00:00.000Z');

  override now(): Date {
    return new Date(this.current.getTime());
  }
}

describe('Phase 13 Task 5 — verification visits and verified gate', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otpService: OtpService;
  let consentLinkService: ConsentLinkService;
  let teamLeadId: string;
  let teamLeadToken: string;
  let farAgentToken: string;
  let nearestAgentId: string;
  let nearestAgentToken: string;
  let lockedAgentId: string;
  let uncheckedAgentId: string;
  let businessId: string;
  let businessPhone: string;
  let vacancyId: string;
  let candidateId: string;
  const callIds: string[] = [];
  const staffIds: string[] = [];
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BusinessClock)
      .useValue(new VerificationTestClock())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otpService = app.get(OtpService);
    consentLinkService = app.get(ConsentLinkService);

    const passwordHash = await bcrypt.hash('Verification-Password-1', 4);
    const lead = await prisma.staff.create({
      data: {
        code: `TL-VF-${suffix}`,
        name: 'Verification Team Lead',
        email: `verification_tl_${suffix.toLowerCase()}@laboura.local`,
        passwordHash,
        role: 'team_lead',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    teamLeadId = lead.id;
    staffIds.push(lead.id);
    teamLeadToken = jwt.sign({ sub: lead.id, role: lead.role, code: lead.code, email: lead.email });

    const createAgent = async (tag: string, emailPrefix: string) => {
      const agent = await prisma.staff.create({
        data: {
          code: `FA-VF-${tag}-${suffix}`,
          name: `Verification Agent ${tag}`,
          email: `verification_${emailPrefix}_${suffix.toLowerCase()}@laboura.local`,
          passwordHash,
          role: 'field_agent',
          status: 'active',
          city: 'Bengaluru',
          teamLeadId,
        },
      });
      staffIds.push(agent.id);
      return agent;
    };
    const farAgent = await createAgent('FAR', 'far');
    const nearestAgent = await createAgent('NEAR', 'near');
    const lockedAgent = await createAgent('LOCK', 'lock');
    const uncheckedAgent = await createAgent('OUT', 'unchecked');
    nearestAgentId = nearestAgent.id;
    lockedAgentId = lockedAgent.id;
    uncheckedAgentId = uncheckedAgent.id;
    farAgentToken = jwt.sign({ sub: farAgent.id, role: farAgent.role, code: farAgent.code, email: farAgent.email });
    nearestAgentToken = jwt.sign({ sub: nearestAgent.id, role: nearestAgent.role, code: nearestAgent.code, email: nearestAgent.email });

    businessPhone = `+9197${suffix.slice(0, 8)}`;
    const business = await prisma.business.create({
      data: {
        code: `BZ-VF-${suffix}`,
        name: `Verification Business ${suffix}`,
        phone: businessPhone,
        phoneVerified: true,
        city: 'Bengaluru',
        latitude: 12.9716,
        longitude: 77.5946,
        documentsStatus: 'no_documents',
        verificationStatus: 'lead',
        leadCreatedByStaffId: nearestAgent.id,
        leadChannel: 'phone_call',
      },
    });
    businessId = business.id;

    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-VF-${suffix}`,
        name: `Verified Gate Candidate ${suffix}`,
        phone: `+9196${suffix.slice(0, 8)}`,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 2000000,
        maxSalary: 3000000,
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
    candidateId = candidate.id;
    await prisma.consent.create({
      data: {
        subjectType: 'job_seeker',
        subjectId: candidate.id,
        purpose: 'job_matching',
        noticeVersion: `verification-${suffix}`,
        granted: true,
        language: 'en',
        method: 'sms_link',
        grantedAt: new Date(),
      },
    });
    await prisma.consent.create({
      data: {
        subjectType: 'job_seeker',
        subjectId: candidate.id,
        purpose: 'profile_sharing',
        noticeVersion: `verification-sharing-${suffix}`,
        granted: true,
        language: 'en',
        method: 'sms_link',
        grantedAt: new Date(),
      },
    });
    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-VF-${suffix}`,
        city: 'Bengaluru',
        businessId: business.id,
        tradeSkill: 'Electrician',
        salaryMinPaise: 2500000,
        latitude: 12.9716,
        longitude: 77.5946,
        shift: 'day',
        headcount: 1,
        status: 'open',
      },
    });
    vacancyId = vacancy.id;
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectType: 'business', subjectId: businessId } });
    await prisma.messageLog.deleteMany({ where: { subjectType: 'business', subjectId: businessId } });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'business', subjectId: businessId } });
    await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
    await prisma.visitAssignment.deleteMany({ where: { businessId } });
    await prisma.businessVisit.deleteMany({ where: { businessId } });
    await prisma.fieldCheckIn.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.consent.deleteMany({ where: { subjectType: 'business', subjectId: businessId } });
    await prisma.businessAgreement.deleteMany({ where: { businessId } });
    await prisma.consent.deleteMany({ where: { subjectType: 'job_seeker', subjectId: candidateId } });
    await prisma.vacancy.deleteMany({ where: { id: vacancyId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.jobSeeker.deleteMany({ where: { id: candidateId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('suggests the nearest checked-in, unlocked agent and requires assignment OTP, photo and signed agreement', async () => {
    await request(app.getHttpServer())
      .post('/field-agent/check-in')
      .set('Authorization', `Bearer ${farAgentToken}`)
      .send({ latitude: 12.9, longitude: 77.5, accuracyMeters: 10 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/field-agent/check-in')
      .set('Authorization', `Bearer ${nearestAgentToken}`)
      .send({ latitude: 12.9717, longitude: 77.5947, accuracyMeters: 5 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/field-agent/check-in')
      .set('Authorization', `Bearer ${jwt.sign({ sub: lockedAgentId, role: 'field_agent' })}`)
      .send({ latitude: 12.97161, longitude: 77.59461, accuracyMeters: 2 })
      .expect(201);
    await prisma.staff.update({
      where: { id: lockedAgentId },
      data: { lockedUntil: new Date('2026-11-06T00:00:00.000Z') },
    });

    const assignment = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/visit-assignments`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ purpose: 'verification' })
      .expect(201);
    expect(assignment.body.suggestedStaffId).toBe(nearestAgentId);
    expect(assignment.body.suggestedStaffId).not.toBe(lockedAgentId);
    expect(assignment.body.suggestedStaffId).not.toBe(uncheckedAgentId);
    expect(assignment.body.status).toBe('pending');
    const teamLeadQueue = await request(app.getHttpServer())
      .get('/businesses/visit-assignments')
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .expect(200);
    expect(teamLeadQueue.body.some((row: { id: string }) => row.id === assignment.body.id)).toBe(true);
    expect(teamLeadQueue.body.find((row: { id: string }) => row.id === assignment.body.id).business.phone).toBeUndefined();
    const unassignedAgentQueue = await request(app.getHttpServer())
      .get('/businesses/visit-assignments')
      .set('Authorization', `Bearer ${nearestAgentToken}`)
      .expect(200);
    expect(unassignedAgentQueue.body.some((row: { id: string }) => row.id === assignment.body.id)).toBe(false);

    await request(app.getHttpServer())
      .post(`/businesses/${businessId}/visit-assignments/${assignment.body.id}/assign`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ assignedStaffId: nearestAgentId })
      .expect(201);
    const assignedAgentQueue = await request(app.getHttpServer())
      .get('/businesses/visit-assignments')
      .set('Authorization', `Bearer ${nearestAgentToken}`)
      .expect(200);
    expect(assignedAgentQueue.body.some((row: { id: string }) => row.id === assignment.body.id)).toBe(true);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).verificationStatus).toBe('pending_visit');

    const visitBody = {
      assignmentId: assignment.body.id,
      latitude: 12.9716,
      longitude: 77.5946,
      selfieUrl: `private/business-visits/${suffix}.jpg`,
      selfieHash: suffix.toLowerCase().padEnd(64, 'a'),
    };
    await request(app.getHttpServer())
      .post(`/businesses/${businessId}/visits`)
      .set('Authorization', `Bearer ${nearestAgentToken}`)
      .send(visitBody)
      .expect(400);
    const ownerOtp = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/visit-assignments/${assignment.body.id}/owner-otp`)
      .set('Authorization', `Bearer ${nearestAgentToken}`)
      .send({})
      .expect(201);
    expect(ownerOtp.body.phone).toBe(`******${businessPhone.replace(/\D/g, '').slice(-4)}`);
    const provider = otpService.getProvider() as MockOtpProvider;
    const ownerOtpCode = provider.getCode(ownerOtp.body.requestId)!;
    const visit = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/visits`)
      .set('Authorization', `Bearer ${nearestAgentToken}`)
      .send({
        ...visitBody,
        ownerOtpRequestId: ownerOtp.body.requestId,
        ownerOtpCode,
      })
      .expect(201);
    expect(visit.body.photoLive).toBe(false);
    expect(visit.body.ownerOtpRequestId).toBe(ownerOtp.body.requestId);
    expect((await prisma.visitAssignment.findUniqueOrThrow({ where: { id: assignment.body.id } })).status).toBe('done');
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).verificationStatus).toBe('pending_visit');

    const link = await consentLinkService.createAgreementLink(businessId, nearestAgentId, 'en');
    const signingOtp = await consentLinkService.sendOtp(link.token);
    const signingCode = provider.getCode(signingOtp.requestId)!;
    await consentLinkService.submitConsent({
      token: link.token,
      otpRequestId: signingOtp.requestId,
      otpCode: signingCode,
      signedName: 'Verification Owner',
      purposes: ['agreement_terms', 'call_recording'],
    });
    const signedDocument = await request(app.getHttpServer())
      .get(`/businesses/${businessId}/agreement`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .expect(200);
    expect(signedDocument.headers['content-type']).toContain('text/html');
    expect(signedDocument.headers['x-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/agreement`)
      .set('Authorization', `Bearer ${nearestAgentToken}`)
      .expect(403);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).verificationStatus).toBe('pending_tl_check');
    expect(await prisma.reviewFlag.count({
      where: { subjectType: 'business', subjectId: businessId, kind: 'no_documents_check', status: 'open' },
    })).toBe(1);

    await request(app.getHttpServer())
      .get(`/vacancies/${vacancyId}/shortlist`)
      .set('Authorization', `Bearer ${nearestAgentToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/businesses/${businessId}/verification/approve`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({})
      .expect(400);

    const call = await prisma.callRecord.create({
      data: {
        code: `CA-VF-${suffix}`,
        provider: 'mock',
        providerCallId: `verification-call-${suffix}`,
        direction: 'outbound',
        staffId: teamLeadId,
        subjectType: 'business',
        subjectId: businessId,
        purpose: 'verification',
        providerStatus: 'completed',
        answered: true,
        startedAt: new Date('2026-11-05T10:01:00.000Z'),
        answeredAt: new Date('2026-11-05T10:01:01.000Z'),
      },
    });
    callIds.push(call.id);
    const approved = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/verification/approve`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({})
      .expect(201);
    expect(approved.body.verificationStatus).toBe('verified');
    expect(approved.body.accountAgentId).toBe(nearestAgentId);
    expect(approved.body.verifiedByStaffId).toBe(teamLeadId);
    expect(await prisma.reviewFlag.count({
      where: { subjectType: 'business', subjectId: businessId, kind: 'no_documents_check', status: 'open' },
    })).toBe(0);
    const shortlist = await request(app.getHttpServer())
      .get(`/vacancies/${vacancyId}/shortlist`)
      .set('Authorization', `Bearer ${nearestAgentToken}`)
      .expect(200);
    expect(shortlist.body.matches.map((row: { jobSeekerId: string }) => row.jobSeekerId)).toContain(candidateId);

    const farAgent = await prisma.staff.findFirstOrThrow({ where: { code: `FA-VF-FAR-${suffix}` } });
    const reassigned = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/account-agent`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ accountAgentId: farAgent.id })
      .expect(201);
    expect(reassigned.body.accountAgentId).toBe(farAgent.id);
    expect(await prisma.auditLog.count({
      where: {
        actorId: teamLeadId,
        entityType: 'business',
        entityCode: `BZ-VF-${suffix}`,
        action: 'business.account_agent_reassigned',
      },
    })).toBe(1);
  }, 120000);
});

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
import { InterviewService } from '../vacancy/interview.service';
import { BUSINESS_PHOTO_STORAGE, MemoryBusinessPhotoStorage } from './storefront-photo.storage';
import { businessCandidateAccess } from './business-candidate-access';

/**
 * Master Guide, "A new business that calls in" (decided 9 Nov): a business a field agent
 * onboards in person can be shown candidates and have interviews booked in the same visit;
 * the Team Lead reviews it the same day and can pause it. Also: who may edit a business.
 */
describe('Same-visit selling, Team Lead pause and business edit rights', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: OtpService;
  let consentLinks: ConsentLinkService;
  const photoStorage = new MemoryBusinessPhotoStorage();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const digits = String(Date.now()).slice(-7);
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  let teamLeadId: string;
  let fieldAgentId: string;
  let callAgentId: string;
  let tokens: Record<'teamLead' | 'otherTeamLead' | 'fieldAgent' | 'callAgent' | 'manager', string>;
  let candidateId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function verifiedOtp(phone: string) {
    const sent = await otp.sendOtp(phone);
    const code = (otp.getProvider() as MockOtpProvider).getCode(sent.requestId)!;
    await otp.verifyOtp(sent.requestId, code);
    return sent.requestId;
  }

  async function signAgreement(businessId: string, staffId: string) {
    const link = await consentLinks.createAgreementLink(businessId, staffId, 'en');
    const signingOtp = await consentLinks.sendOtp(link.token);
    const code = (otp.getProvider() as MockOtpProvider).getCode(signingOtp.requestId)!;
    await consentLinks.submitConsent({
      token: link.token,
      otpRequestId: signingOtp.requestId,
      otpCode: code,
      signedName: 'Shop Owner',
      purposes: ['agreement_terms', 'call_recording'],
    });
  }

  async function openVacancy(businessId: string) {
    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-SV-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        city: 'Bengaluru',
        businessId,
        tradeSkill: 'Electrician',
        salaryMinPaise: 2500000,
        latitude: 12.9716,
        longitude: 77.5946,
        shift: 'day',
        headcount: 1,
        status: 'open',
      },
    });
    vacancyIds.push(vacancy.id);
    return vacancy.id;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BUSINESS_PHOTO_STORAGE)
      .useValue(photoStorage)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OtpService);
    consentLinks = app.get(ConsentLinkService);

    const passwordHash = await bcrypt.hash('Same-Visit-Password-1', 4);
    const createStaff = async (role: string, tag: string, teamLead?: string) => {
      const staff = await prisma.staff.create({
        data: {
          code: `SV-${tag}-${suffix}`,
          name: `Same visit ${tag}`,
          email: `sv_${tag.toLowerCase()}_${suffix.toLowerCase()}@laboura.local`,
          passwordHash,
          role,
          status: 'active',
          city: 'Bengaluru',
          teamLeadId: teamLead ?? null,
        },
      });
      staffIds.push(staff.id);
      return { id: staff.id, token: jwt.sign({ sub: staff.id, role: staff.role, code: staff.code, email: staff.email }) };
    };
    const teamLead = await createStaff('team_lead', 'TL');
    const otherTeamLead = await createStaff('team_lead', 'TL2');
    const manager = await createStaff('manager', 'MGR');
    const fieldAgent = await createStaff('field_agent', 'FA', teamLead.id);
    const callAgent = await createStaff('call_agent', 'CA', teamLead.id);
    teamLeadId = teamLead.id;
    fieldAgentId = fieldAgent.id;
    callAgentId = callAgent.id;
    tokens = {
      teamLead: teamLead.token,
      otherTeamLead: otherTeamLead.token,
      fieldAgent: fieldAgent.token,
      callAgent: callAgent.token,
      manager: manager.token,
    };

    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-SV-${suffix}`,
        name: `Same Visit Candidate ${suffix}`,
        phone: `+9196${digits}1`,
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
    for (const purpose of ['job_matching', 'profile_sharing']) {
      await prisma.consent.create({
        data: {
          subjectType: 'job_seeker',
          subjectId: candidate.id,
          purpose,
          noticeVersion: `same-visit-${suffix}`,
          granted: true,
          language: 'en',
          method: 'sms_link',
          grantedAt: new Date(),
        },
      });
    }
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectType: 'business', subjectId: { in: businessIds } } });
    await prisma.messageLog.deleteMany({ where: { subjectType: 'business', subjectId: { in: businessIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'business', subjectId: { in: businessIds } } });
    await prisma.candidateIntroduction.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.businessVisit.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.consent.deleteMany({ where: { subjectType: 'business', subjectId: { in: businessIds } } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.consent.deleteMany({ where: { subjectType: 'job_seeker', subjectId: candidateId } });
    await prisma.jobSeeker.deleteMany({ where: { id: candidateId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  describe('businessCandidateAccess', () => {
    it('allows verified businesses and in-person onboarded ones waiting for the Team Lead, never paused ones', () => {
      expect(businessCandidateAccess({ verificationStatus: 'verified' })).toEqual({ allowed: true, basis: 'verified' });
      expect(businessCandidateAccess({ verificationStatus: 'pending_tl_check', inPersonOnboardedAt: new Date() }))
        .toEqual({ allowed: true, basis: 'in_person_onboarding' });
      expect(businessCandidateAccess({ verificationStatus: 'pending_tl_check', inPersonOnboardedAt: null }))
        .toEqual({ allowed: false, reason: 'not_verified' });
      expect(businessCandidateAccess({ verificationStatus: 'lead', inPersonOnboardedAt: new Date() }))
        .toEqual({ allowed: false, reason: 'not_verified' });
      expect(businessCandidateAccess({ verificationStatus: 'verified', pausedAt: new Date() }))
        .toEqual({ allowed: false, reason: 'paused' });
      expect(businessCandidateAccess({ verificationStatus: 'rejected', inPersonOnboardedAt: new Date() }))
        .toEqual({ allowed: false, reason: 'not_verified' });
    });
  });

  it('shows candidates in the same visit once the field agent onboards in person; the Team Lead can pause, unpause and approve', async () => {
    const phone = `+9197${digits}1`;
    const created = await request(app.getHttpServer())
      .post('/businesses')
      .set(auth(tokens.fieldAgent))
      .send({
        name: `Same Visit Bakery ${suffix}`,
        phone,
        otpRequestId: await verifiedOtp(phone),
        contactPersonName: 'Owner',
        contactPersonRole: 'owner',
        gstNumber: `29SV${suffix}`,
        businessLatitude: 12.9716,
        businessLongitude: 77.5946,
        visit: {
          latitude: 12.9716,
          longitude: 77.5946,
          selfieUrl: `private/visits/${suffix}.jpg`,
          selfieHash: `sv${suffix.toLowerCase()}`.padEnd(64, 'b'),
        },
      })
      .expect(201);
    const businessId = created.body.id as string;
    businessIds.push(businessId);
    expect(created.body).toMatchObject({ verificationStatus: 'lead', accountAgentId: fieldAgentId, leadChannel: 'field_visit' });
    const vacancyId = await openVacancy(businessId);

    // Not onboarded yet: no storefront photo and no agreement.
    await request(app.getHttpServer()).get(`/vacancies/${vacancyId}/shortlist`).set(auth(tokens.fieldAgent)).expect(403);

    await request(app.getHttpServer())
      .post(`/businesses/${businessId}/storefront-photo`)
      .set(auth(tokens.fieldAgent))
      .attach('photo', Buffer.from(`storefront-${suffix}`), { filename: 'shop.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).verificationStatus).toBe('lead');
    await request(app.getHttpServer()).get(`/vacancies/${vacancyId}/shortlist`).set(auth(tokens.fieldAgent)).expect(403);

    // The contact person signs the agreement by OTP during the visit.
    await signAgreement(businessId, fieldAgentId);
    const onboarded = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(onboarded.verificationStatus).toBe('pending_tl_check');
    expect(onboarded.inPersonOnboardedAt).not.toBeNull();
    expect(await prisma.reviewFlag.count({
      where: { subjectType: 'business', subjectId: businessId, kind: 'in_person_onboarding_review', status: 'open' },
    })).toBe(1);

    const shortlist = await request(app.getHttpServer())
      .get(`/vacancies/${vacancyId}/shortlist`)
      .set(auth(tokens.fieldAgent))
      .expect(200);
    expect(shortlist.body.matches.map((row: { jobSeekerId: string }) => row.jobSeekerId)).toContain(candidateId);

    // Pause: only the business's own Team Lead (or above), and only with a reason.
    await request(app.getHttpServer()).post(`/businesses/${businessId}/pause`).set(auth(tokens.otherTeamLead))
      .send({ reason: 'Not my team' }).expect(403);
    await request(app.getHttpServer()).post(`/businesses/${businessId}/pause`).set(auth(tokens.fieldAgent))
      .send({ reason: 'Agents cannot pause' }).expect(403);
    await request(app.getHttpServer()).post(`/businesses/${businessId}/pause`).set(auth(tokens.teamLead))
      .send({}).expect(400);
    const paused = await request(app.getHttpServer()).post(`/businesses/${businessId}/pause`).set(auth(tokens.teamLead))
      .send({ reason: 'Storefront photo does not match the pin' }).expect(201);
    expect(paused.body.pausedAt).toBeTruthy();
    expect(paused.body.pausedByStaffId).toBe(teamLeadId);

    const blocked = await request(app.getHttpServer()).get(`/vacancies/${vacancyId}/shortlist`).set(auth(tokens.fieldAgent));
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toContain('paused');
    await expect(app.get(InterviewService).book({ vacancyId, jobSeekerId: candidateId, slotId: randomUUID() }, fieldAgentId))
      .rejects.toThrow('paused');
    expect(await prisma.auditLog.count({ where: { action: 'business.paused', entityCode: created.body.code } })).toBe(1);

    await request(app.getHttpServer()).post(`/businesses/${businessId}/unpause`).set(auth(tokens.teamLead))
      .send({ reason: 'Owner sent the right pin' }).expect(201);
    await request(app.getHttpServer()).get(`/vacancies/${vacancyId}/shortlist`).set(auth(tokens.fieldAgent)).expect(200);

    // Same-day Team Lead review approves it without a separate verification visit.
    const approved = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/verification/approve`)
      .set(auth(tokens.teamLead))
      .send({})
      .expect(201);
    expect(approved.body).toMatchObject({ verificationStatus: 'verified', accountAgentId: fieldAgentId, verifiedByStaffId: teamLeadId });
    expect(await prisma.reviewFlag.count({
      where: { subjectType: 'business', subjectId: businessId, kind: 'in_person_onboarding_review', status: 'open' },
    })).toBe(0);

    // A verified business can be paused too.
    await request(app.getHttpServer()).post(`/businesses/${businessId}/pause`).set(auth(tokens.manager))
      .send({ reason: 'Complaint from a candidate' }).expect(201);
    await request(app.getHttpServer()).get(`/vacancies/${vacancyId}/shortlist`).set(auth(tokens.fieldAgent)).expect(403);
  }, 120000);

  it('keeps a business that was not onboarded in person hidden until the Team Lead verifies it', async () => {
    const business = await prisma.business.create({
      data: {
        code: `BZ-SV-PH-${suffix}`,
        name: `Phone Lead ${suffix}`,
        phone: `+9197${digits}2`,
        phoneVerified: true,
        city: 'Bengaluru',
        latitude: 12.9716,
        longitude: 77.5946,
        documentsStatus: 'documented',
        verificationStatus: 'lead',
        leadCreatedByStaffId: callAgentId,
        leadChannel: 'phone_call',
        storefrontPhotoPath: `businesses/${suffix}/storefront.jpg`,
      },
    });
    businessIds.push(business.id);
    const vacancyId = await openVacancy(business.id);
    await signAgreement(business.id, callAgentId);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(after.verificationStatus).toBe('lead');
    expect(after.inPersonOnboardedAt).toBeNull();
    await request(app.getHttpServer()).get(`/vacancies/${vacancyId}/shortlist`).set(auth(tokens.fieldAgent)).expect(403);
  }, 60000);

  describe('who can edit a business', () => {
    it('only the account agent, their Team Lead and management; the lead creator loses edit rights', async () => {
      const business = await prisma.business.create({
        data: {
          code: `BZ-SV-ED-${suffix}`,
          name: `Edit Rights ${suffix}`,
          phone: `+9197${digits}3`,
          phoneVerified: true,
          city: 'Bengaluru',
          verificationStatus: 'verified',
          leadCreatedByStaffId: callAgentId,
          accountAgentId: fieldAgentId,
        },
      });
      businessIds.push(business.id);
      const patch = (token: string, name: string) => request(app.getHttpServer())
        .patch(`/businesses/${business.id}`)
        .set(auth(token))
        .send({ name, reason: 'Correct the shop board name' });

      const byCreator = await patch(tokens.callAgent, 'Changed by lead creator');
      expect(byCreator.status).toBe(403);
      await patch(tokens.fieldAgent, 'Changed by account agent').expect(200);
      await patch(tokens.teamLead, 'Changed by Team Lead').expect(200);
      expect((await patch(tokens.otherTeamLead, 'Changed by another Team Lead')).status).toBe(403);
      await patch(tokens.manager, 'Changed by Manager').expect(200);
    });

    it('a business with no account agent can be edited only by a Team Lead or above', async () => {
      const business = await prisma.business.create({
        data: {
          code: `BZ-SV-NA-${suffix}`,
          name: `No Account Agent ${suffix}`,
          phone: `+9197${digits}4`,
          phoneVerified: true,
          city: 'Bengaluru',
          verificationStatus: 'lead',
          leadCreatedByStaffId: callAgentId,
          leadChannel: 'phone_call',
        },
      });
      businessIds.push(business.id);
      const byCreator = await request(app.getHttpServer())
        .patch(`/businesses/${business.id}`)
        .set(auth(tokens.callAgent))
        .send({ name: 'Lead creator edit', reason: 'Typo' });
      expect(byCreator.status).toBe(403);
      expect(byCreator.body.message).toContain('Team Lead');
      await request(app.getHttpServer())
        .patch(`/businesses/${business.id}`)
        .set(auth(tokens.teamLead))
        .send({ name: 'Team Lead edit', reason: 'Typo' })
        .expect(200);
    });
  });
});

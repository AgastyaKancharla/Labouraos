import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { completeJobSeekerRegistration } from '../../test-support/job-seeker-registration';
import { maskPhoneLast4 } from '../../common/rbac/pii-masking.interceptor';
import { JobSeekerService } from './job-seeker.service';

describe('Phase 6.6 Task 2: Field Agent Candidate & Referral Onboarding', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let fieldAgentToken: string;
  let fieldAgentId: string;
  let callAgentToken: string;
  let callAgentId: string;
  let managerToken: string;
  let ceoToken: string;
  let financeToken: string;

  let koramangalaBusinessId: string;
  let indiranagarBusinessId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const cleanStaffIds: string[] = [];
  const cleanJobSeekerIds: string[] = [];
  const cleanReferralIds: string[] = [];
  const cleanBusinessIds: string[] = [];

  const getVerifiedOtp = async (phone: string): Promise<string> => {
    const { requestId } = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(requestId)!;
    await otpService.verifyOtp(requestId, code);
    return requestId;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);

    const passwordHash = await bcrypt.hash(password, 10);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-P66-${timestamp}`,
        name: 'CEO P66',
        email: `ceo_p66_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    cleanStaffIds.push(ceo.id);

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-P66-${timestamp}`,
        name: 'Call Agent P66',
        email: `ca_p66_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;
    cleanStaffIds.push(callAgent.id);

    // Field agent assigned strictly to Koramangala
    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-P66-${timestamp}`,
        name: 'Field Agent P66',
        email: `fa_p66_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });
    fieldAgentId = fieldAgent.id;
    cleanStaffIds.push(fieldAgent.id);

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-P66-${timestamp}`,
        name: 'Manager P66',
        email: `mgr_p66_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    cleanStaffIds.push(manager.id);

    const finance = await prisma.staff.create({
      data: {
        code: `FI-P66-${timestamp}`,
        name: 'Finance P66',
        email: `fi_p66_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    cleanStaffIds.push(finance.id);

    const server = app.getHttpServer();
    const login = async (email: string | null) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    ceoToken = await login(ceo.email);
    managerToken = await login(manager.email);
    callAgentToken = await login(callAgent.email);
    fieldAgentToken = await login(fieldAgent.email);
    financeToken = await login(finance.email);

    // Create businesses: one in Koramangala (FA own area), one in Indiranagar (outside FA area)
    const bzKora = await prisma.business.create({
      data: {
        code: `BZ-KO-${timestamp}`,
        name: 'Kora Tech',
        phone: `93${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        locality: 'Koramangala',
        city: 'Bengaluru',
      },
    });
    koramangalaBusinessId = bzKora.id;
    cleanBusinessIds.push(bzKora.id);

    const bzIndi = await prisma.business.create({
      data: {
        code: `BZ-IN-${timestamp}`,
        name: 'Indi Enterprise',
        phone: `94${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        locality: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    indiranagarBusinessId = bzIndi.id;
    cleanBusinessIds.push(bzIndi.id);
  });

  afterAll(async () => {
    if (cleanJobSeekerIds.length > 0) {
      await prisma.jobSeekerHit.deleteMany({
        where: { jobSeekerId: { in: cleanJobSeekerIds } },
      });
      await prisma.contactAttempt.deleteMany({
        where: { jobSeekerId: { in: cleanJobSeekerIds } },
      });
      await prisma.payment.deleteMany({
        where: { subjectId: { in: cleanJobSeekerIds } },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: cleanJobSeekerIds } },
      });
    }

    if (cleanReferralIds.length > 0) {
      await prisma.payment.deleteMany({
        where: { subjectId: { in: cleanReferralIds } },
      });
      await prisma.referral.deleteMany({
        where: { id: { in: cleanReferralIds } },
      });
    }

    if (cleanBusinessIds.length > 0) {
      await prisma.business.deleteMany({
        where: { id: { in: cleanBusinessIds } },
      });
    }

    if (cleanStaffIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: cleanStaffIds } },
      });
      await prisma.staffSession.deleteMany({
        where: { staffId: { in: cleanStaffIds } },
      });
      await prisma.staff.deleteMany({
        where: { id: { in: cleanStaffIds } },
      });
    }

    await app.close();
  });

  describe('1. Full Job Seeker Onboarding Tool for Field Agent', () => {
    let createdSeekerId: string;
    let createdSeekerCode: string;
    let createdSeekerPhone: string;

    it('Field agent can create a job seeker (POST /job-seekers) with verified OTP', async () => {
      const phone = `95${timestamp.toString().slice(-8)}`;
      const otpRequestId = await getVerifiedOtp(phone);

      const res = await request(app.getHttpServer())
        .post('/job-seekers')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send(completeJobSeekerRegistration({
          name: 'Field Onboarded Seeker',
          phone,
          otpRequestId,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
        }));

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Field Onboarded Seeker');
      expect(res.body.status).toBe('lead');

      createdSeekerId = res.body.id;
      createdSeekerCode = res.body.code;
      createdSeekerPhone = phone;
      expect(createdSeekerCode).toMatch(/^JS-\d{5}$/);
      cleanJobSeekerIds.push(createdSeekerId);
    });

    it('Finance is strictly denied (403) creating job seeker', async () => {
      const phone = `97${timestamp.toString().slice(-8)}`;
      const otpRequestId = await getVerifiedOtp(phone);

      const res = await request(app.getHttpServer())
        .post('/job-seekers')
        .set('Authorization', `Bearer ${financeToken}`)
        .send(completeJobSeekerRegistration({
          name: 'Finance Imposter Seeker',
          phone,
          otpRequestId,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
        }));

      expect(res.status).toBe(403);
    });

    it('Field agent can read candidates city-wide (GET /job-seekers and GET /job-seekers/:id)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/job-seekers')
        .set('Authorization', `Bearer ${fieldAgentToken}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      const listed = listRes.body.find((s: { id: string }) => s.id === createdSeekerId);
      expect(listed).toBeDefined();
      expect(listed.phone).toBe(maskPhoneLast4(createdSeekerPhone));
      expect(JSON.stringify(listRes.body)).not.toContain(createdSeekerPhone);

      const detailRes = await request(app.getHttpServer())
        .get(`/job-seekers/${createdSeekerId}`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.id).toBe(createdSeekerId);
      expect(detailRes.body.phone).toBe(maskPhoneLast4(createdSeekerPhone));
      expect(JSON.stringify(detailRes.body)).not.toContain(createdSeekerPhone);

      const ceoRes = await request(app.getHttpServer())
        .get(`/job-seekers/${createdSeekerId}`)
        .set('Authorization', `Bearer ${ceoToken}`);
      expect(ceoRes.status).toBe(200);
      expect(ceoRes.body.phone).toBe(`+91${createdSeekerPhone}`);
    });

    it('Field agent can create activation payment (POST /job-seekers/:id/activation-payment)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${createdSeekerId}/activation-payment`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);

      expect(res.status).toBe(201);
      expect(res.body.paymentId).toBeDefined();
      expect(res.body.amount).toBe(49900);
      expect(res.body.status).toBe('pending');
    });

    it('Field agent cannot use the removed hand-entered KYC endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${createdSeekerId}/kyc`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          kycReference: `EKYC-REF-${timestamp}`,
          status: 'verified',
        });

      expect(res.status).toBe(404);
    });

    it('Field agent hand-entry contact attempt is gone (POST /job-seekers/:id/contact-attempts -> 404)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${createdSeekerId}/contact-attempts`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          channel: 'call',
          outcome: 'picked_up',
          timeOfDay: 'am',
          notes: 'Field agent pre-interview call attempt',
        });

      expect(res.status).toBe(404);
    });
  });

  describe('2. Job Seeker Hits — Reason Restrictions and Refusal Auditing', () => {
    let testSeekerId: string;
    let testSeekerCode: string;

    beforeAll(async () => {
      const phone = `96${timestamp.toString().slice(-8)}`;
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-HIT-${timestamp}`,
          name: 'Hit Test Seeker',
          phone,
          phoneVerified: true,
          trades: { create: { trade: 'Plumber', isPrimary: true } },
          minSalary: 1500000,
          maxSalary: 2000000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          city: 'Bengaluru',
        },
      });
      testSeekerId = seeker.id;
      testSeekerCode = seeker.code;
      cleanJobSeekerIds.push(seeker.id);
    });

    it("Field agent CAN record 'offer_rejected' hit (personally witnessed)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${testSeekerId}/hits`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          reason: 'offer_rejected',
          note: 'Worker refused offer on-site',
        });

      expect(res.status).toBe(201);
      expect(res.body.hitCount).toBe(1);
      expect(res.body.status).toBe('active');
    });

    it("Field agent CAN record 'interview_no_show' hit (personally witnessed)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${testSeekerId}/hits`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          reason: 'interview_no_show',
          note: 'Worker did not arrive at interview',
        });

      expect(res.status).toBe(201);
      expect(res.body.hitCount).toBe(2);
      expect(res.body.status).toBe('active');
    });

    it("Field agent is strictly REFUSED (403) recording 'no_pickup' hit and refusal is audited", async () => {
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${testSeekerId}/hits`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          reason: 'no_pickup',
          note: 'Field agent trying to log no pickup',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('come only from the phone system');
      expect(res.body.message).toContain('offer_rejected');
      expect(res.body.message).toContain('interview_no_show');

      // Verify audit log for the refusal
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: 'job_seeker.hit_refused',
          entityCode: testSeekerCode,
          actorId: fieldAgentId,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).toBeDefined();
      expect(auditLog?.actorId).toBe(fieldAgentId);
      const after = auditLog?.after as Record<string, unknown>;
      expect(after.refusalReason).toBe('UNAUTHORIZED_HIT_REASON_FOR_ROLE');
      expect(after.attemptedReason).toBe('no_pickup');
      expect(after.role).toBe('field_agent');
    });

    // Master Guide: "Not picked up" comes only from the phone system. Earlier this test let a
    // call agent record it by hand; now staff are refused and only the automated sweep records it.
    it("Call agent is refused 'no_pickup' even with qualifying attempts; the automated sweep records it", async () => {
      // Create required qualifying attempts (AM call no_pickup, PM call no_pickup, whatsapp)
      const now = new Date();
      await prisma.contactAttempt.createMany({
        data: [
          {
            jobSeekerId: testSeekerId,
            channel: 'call',
            outcome: 'no_pickup',
            timeOfDay: 'am',
            staffId: callAgentId,
            attemptedAt: now,
          },
          {
            jobSeekerId: testSeekerId,
            channel: 'call',
            outcome: 'no_pickup',
            timeOfDay: 'pm',
            staffId: callAgentId,
            attemptedAt: now,
          },
          {
            jobSeekerId: testSeekerId,
            channel: 'whatsapp',
            outcome: 'sent',
            timeOfDay: 'pm',
            staffId: callAgentId,
            attemptedAt: now,
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${testSeekerId}/hits`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          reason: 'no_pickup',
          note: 'Call agent trying to type a no pickup hit',
        });
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('come only from the phone system');

      const swept = await app.get(JobSeekerService).recordHit(
        testSeekerId,
        'no_pickup',
        'Automated daily no-pickup evaluation',
        'system',
      );
      expect(swept.hitCount).toBe(3);
      expect(swept.status).toBe('deactivated');
    });

    it('Field agent can reactivate a deactivated candidate (POST /job-seekers/:id/reactivate)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${testSeekerId}/reactivate`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);

      expect(res.status).toBe(201);
      expect(res.body.reactivation).toBe(true);
      expect(res.body.amount).toBe(49900);
      expect(res.body.status).toBe('pending');
    });

    describe('Explicit Reason vs Role Matrix Tests', () => {
      const createActiveCandidateWithQualifyingAttempts = async (suffix: string) => {
        const phone = `91${(timestamp + Math.floor(Math.random() * 100000)).toString().slice(-8)}`;
        const seeker = await prisma.jobSeeker.create({
          data: {
            code: `JS-MTRX-${suffix}-${Date.now().toString().slice(-5)}`,
            name: `Matrix Candidate ${suffix}`,
            phone,
            phoneVerified: true,
            trades: { create: { trade: 'Painter', isPrimary: true } },
            minSalary: 1400000,
            maxSalary: 2100000,
            preferredCallWindowStart: '09:00',
            preferredCallWindowEnd: '18:00',
            status: 'active',
            city: 'Bengaluru',
          },
        });
        cleanJobSeekerIds.push(seeker.id);

        const now = new Date();
        await prisma.contactAttempt.createMany({
          data: [
            {
              jobSeekerId: seeker.id,
              channel: 'call',
              outcome: 'no_pickup',
              timeOfDay: 'am',
              staffId: callAgentId,
              attemptedAt: now,
            },
            {
              jobSeekerId: seeker.id,
              channel: 'call',
              outcome: 'no_pickup',
              timeOfDay: 'pm',
              staffId: callAgentId,
              attemptedAt: now,
            },
            {
              jobSeekerId: seeker.id,
              channel: 'whatsapp',
              outcome: 'sent',
              timeOfDay: 'pm',
              staffId: callAgentId,
              attemptedAt: now,
            },
          ],
        });

        return seeker;
      };

      it('call_agent can record offer_rejected and interview_no_show but is refused no_pickup', async () => {
        const s1 = await createActiveCandidateWithQualifyingAttempts('CA-OFFER');
        const resOffer = await request(app.getHttpServer())
          .post(`/job-seekers/${s1.id}/hits`)
          .set('Authorization', `Bearer ${callAgentToken}`)
          .send({ reason: 'offer_rejected', note: 'CA recorded offer_rejected' });
        expect(resOffer.status).toBe(201);

        const s2 = await createActiveCandidateWithQualifyingAttempts('CA-SHOW');
        const resShow = await request(app.getHttpServer())
          .post(`/job-seekers/${s2.id}/hits`)
          .set('Authorization', `Bearer ${callAgentToken}`)
          .send({ reason: 'interview_no_show', note: 'CA recorded interview_no_show' });
        expect(resShow.status).toBe(201);

        const s3 = await createActiveCandidateWithQualifyingAttempts('CA-NOPICK');
        const resNoPick = await request(app.getHttpServer())
          .post(`/job-seekers/${s3.id}/hits`)
          .set('Authorization', `Bearer ${callAgentToken}`)
          .send({ reason: 'no_pickup', note: 'CA recorded no_pickup' });
        expect(resNoPick.status).toBe(403);
        expect(resNoPick.body.message).toContain('come only from the phone system');
      });

      it('manager can record offer_rejected and interview_no_show but is refused no_pickup', async () => {
        const s1 = await createActiveCandidateWithQualifyingAttempts('MGR-OFFER');
        const resOffer = await request(app.getHttpServer())
          .post(`/job-seekers/${s1.id}/hits`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ reason: 'offer_rejected', note: 'MGR recorded offer_rejected' });
        expect(resOffer.status).toBe(201);

        const s2 = await createActiveCandidateWithQualifyingAttempts('MGR-SHOW');
        const resShow = await request(app.getHttpServer())
          .post(`/job-seekers/${s2.id}/hits`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ reason: 'interview_no_show', note: 'MGR recorded interview_no_show' });
        expect(resShow.status).toBe(201);

        const s3 = await createActiveCandidateWithQualifyingAttempts('MGR-NOPICK');
        const resNoPick = await request(app.getHttpServer())
          .post(`/job-seekers/${s3.id}/hits`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ reason: 'no_pickup', note: 'MGR recorded no_pickup' });
        expect(resNoPick.status).toBe(403);
        expect(resNoPick.body.message).toContain('come only from the phone system');
      });

      it('ceo can record offer_rejected and interview_no_show but is refused no_pickup', async () => {
        const s1 = await createActiveCandidateWithQualifyingAttempts('CEO-OFFER');
        const resOffer = await request(app.getHttpServer())
          .post(`/job-seekers/${s1.id}/hits`)
          .set('Authorization', `Bearer ${ceoToken}`)
          .send({ reason: 'offer_rejected', note: 'CEO recorded offer_rejected' });
        expect(resOffer.status).toBe(201);

        const s2 = await createActiveCandidateWithQualifyingAttempts('CEO-SHOW');
        const resShow = await request(app.getHttpServer())
          .post(`/job-seekers/${s2.id}/hits`)
          .set('Authorization', `Bearer ${ceoToken}`)
          .send({ reason: 'interview_no_show', note: 'CEO recorded interview_no_show' });
        expect(resShow.status).toBe(201);

        const s3 = await createActiveCandidateWithQualifyingAttempts('CEO-NOPICK');
        const resNoPick = await request(app.getHttpServer())
          .post(`/job-seekers/${s3.id}/hits`)
          .set('Authorization', `Bearer ${ceoToken}`)
          .send({ reason: 'no_pickup', note: 'CEO recorded no_pickup' });
        expect(resNoPick.status).toBe(403);
        expect(resNoPick.body.message).toContain('come only from the phone system');
      });

      it('field_agent can record witnessed reasons (offer_rejected, interview_no_show) but is refused no_pickup', async () => {
        const s1 = await createActiveCandidateWithQualifyingAttempts('FA-OFFER');
        const resOffer = await request(app.getHttpServer())
          .post(`/job-seekers/${s1.id}/hits`)
          .set('Authorization', `Bearer ${fieldAgentToken}`)
          .send({ reason: 'offer_rejected', note: 'FA recorded offer_rejected' });
        expect(resOffer.status).toBe(201);

        const s2 = await createActiveCandidateWithQualifyingAttempts('FA-SHOW');
        const resShow = await request(app.getHttpServer())
          .post(`/job-seekers/${s2.id}/hits`)
          .set('Authorization', `Bearer ${fieldAgentToken}`)
          .send({ reason: 'interview_no_show', note: 'FA recorded interview_no_show' });
        expect(resShow.status).toBe(201);

        const s3 = await createActiveCandidateWithQualifyingAttempts('FA-NOPICK');
        const resNoPick = await request(app.getHttpServer())
          .post(`/job-seekers/${s3.id}/hits`)
          .set('Authorization', `Bearer ${fieldAgentToken}`)
          .send({ reason: 'no_pickup', note: 'FA recorded no_pickup' });
        expect(resNoPick.status).toBe(403);
        expect(resNoPick.body.message).toContain('come only from the phone system');
      });
    });
  });

  describe('3. Referral Onboarding for Field Agent', () => {
    let createdRefId: string;
    let createdRefPhone: string;

    it('Field agent can create a referral partner (POST /referrals)', async () => {
      const phone = `87${timestamp.toString().slice(-8)}`;
      const otpRequestId = await getVerifiedOtp(phone);

      const res = await request(app.getHttpServer())
        .post('/referrals')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          name: 'Field Onboarded Partner',
          phone,
          type: 'individual',
          whatsappPhone: phone,
          language: 'en',
          individualRole: 'shop_staff',
          locality: 'Indiranagar',
          pincode: '560038',
          heardFrom: 'field_visit',
          otpRequestId,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Field Onboarded Partner');

      createdRefId = res.body.id;
      createdRefPhone = phone;
      cleanReferralIds.push(createdRefId);
    });

    it('Field agent can list and read referrals (GET /referrals and GET /referrals/:id)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/referrals')
        .set('Authorization', `Bearer ${fieldAgentToken}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      const listed = listRes.body.find((r: { id: string }) => r.id === createdRefId);
      expect(listed).toBeDefined();
      expect(listed.phone).toBe(maskPhoneLast4(createdRefPhone));
      expect(JSON.stringify(listRes.body)).not.toContain(createdRefPhone);

      const detailRes = await request(app.getHttpServer())
        .get(`/referrals/${createdRefId}`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.id).toBe(createdRefId);
      expect(detailRes.body.phone).toBe(maskPhoneLast4(createdRefPhone));
      expect(JSON.stringify(detailRes.body)).not.toContain(createdRefPhone);
    });

    it('Finance is strictly denied (403) creating a referral partner', async () => {
      const phone = `88${timestamp.toString().slice(-8)}`;
      const otpRequestId = await getVerifiedOtp(phone);

      const res = await request(app.getHttpServer())
        .post('/referrals')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          name: 'Finance Imposter Partner',
          phone,
          type: 'individual',
          otpRequestId,
        });

      expect(res.status).toBe(403);
    });
  });

  describe('4. Business access across localities', () => {
    it('Field agents can read businesses regardless of locality', async () => {
      const res = await request(app.getHttpServer())
        .get(`/businesses/${koramangalaBusinessId}`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(koramangalaBusinessId);
    });

    it('Field agents can read a business outside their former area', async () => {
      const res = await request(app.getHttpServer())
        .get(`/businesses/${indiranagarBusinessId}`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(indiranagarBusinessId);
    });
  });
});

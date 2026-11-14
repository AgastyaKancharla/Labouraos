import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { createAwaitingPaymentPlacementFixture } from '../../test-support/paid-placement-fixture';
import { createJoiningCallsFixture } from '../../test-support/joining-call-fixture';
import { completeJobSeekerRegistration } from '../../test-support/job-seeker-registration';
import { confirmVacancyForTest } from '../../test-support/confirm-vacancy';

describe('Phase 6 Task 5: Call Agent API workflow (the old console page is retired; the web app is at /call-agent)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;
  let caToken: string;
  let caStaffId: string;

  const timestamp = Date.now();
  const password = 'Password123!';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);

    const passwordHash = await bcrypt.hash(password, 10);

    const ca = await prisma.staff.create({
      data: {
        code: `CA-CAC-${timestamp}`,
        name: 'Call Agent CAC',
        email: `ca_cac_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const caLogin = await enrolledLogin(app.getHttpServer(), { email: ca.email, password })
      .expect(200);
    caToken = caLogin.body.accessToken;
    caStaffId = ca.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('verifies the Call Agent end-to-end API workflow', async () => {
    const phone = `94001${String(timestamp).slice(-5)}`;

    // 1. OTP send & verify
    const otpSendRes = await request(app.getHttpServer())
      .post('/otp/send')
      .set('Authorization', `Bearer ${caToken}`)
      .send({ phone, purpose: 'job_seeker' })
      .expect(201);
    const requestId = otpSendRes.body.requestId;
    const otpCode = (otpService.getProvider() as MockOtpProvider).getCode(requestId)!;

    await request(app.getHttpServer())
      .post('/otp/verify')
      .set('Authorization', `Bearer ${caToken}`)
      .send({ requestId, code: otpCode })
      .expect(201);

    // 2. Job seeker registration
    const seekerRes = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${caToken}`)
      .send(completeJobSeekerRegistration({
        name: 'Shortlist Candidate',
        phone,
        tradeSkill: 'Electrician',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        otpRequestId: requestId,
      }))
      .expect(201);
    const candidateId = seekerRes.body.id;

    // 3. Payment link generation
    const payLinkRes = await request(app.getHttpServer())
      .post(`/job-seekers/${candidateId}/activation-payment`)
      .set('Authorization', `Bearer ${caToken}`)
      .expect(201);
    expect(payLinkRes.body.paymentLink).toBeDefined();

    // 4. Contact attempt logging endpoint is removed (404)
    await request(app.getHttpServer())
      .post(`/job-seekers/${candidateId}/contact-attempts`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        channel: 'call',
        outcome: 'picked_up',
        timeOfDay: 'am',
      })
      .expect(404);

    // 5. Hit recording
    const hitRes = await request(app.getHttpServer())
      .post(`/job-seekers/${candidateId}/hits`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        reason: 'offer_rejected',
        note: 'Candidate rejected suitable offer during call',
      })
      .expect(201);
    expect(hitRes.body.hitCount).toBe(1);

    // 6. Business onboarding & Vacancy capture
    const bizPhone = `94002${String(timestamp).slice(-5)}`;
    const bizOtp = await request(app.getHttpServer())
      .post('/otp/send')
      .set('Authorization', `Bearer ${caToken}`)
      .send({ phone: bizPhone, purpose: 'business_contact' })
      .expect(201);
    const bizOtpCode = (otpService.getProvider() as MockOtpProvider).getCode(bizOtp.body.requestId)!;
    await request(app.getHttpServer())
      .post('/otp/verify')
      .set('Authorization', `Bearer ${caToken}`)
      .send({ requestId: bizOtp.body.requestId, code: bizOtpCode })
      .expect(201);

    const bizRes = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${caToken}`)
      .send({ locality: 'Koramangala',
        name: 'Call Agent Biz Test',
        phone: bizPhone,
        area: 'Indiranagar',
        contactPersonName: 'Call Contact',
        contactPersonRole: 'owner', heardFrom: 'field_visit',
        otpRequestId: bizOtp.body.requestId,
      })
      .expect(201);
    const bizId = bizRes.body.id;
    await prisma.business.update({ where: { id: bizId }, data: { verificationStatus: 'verified' } });

    const vcRes = await request(app.getHttpServer())
      .post('/vacancies')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        businessId: bizId,
        tradeSkill: 'Electrician',
        salaryMinPaise: 2000000,
        headcount: 1,
        ownerToldMinimumWage: true,
      })
      .expect(201);
    const vacancyId = vcRes.body.id;
    await confirmVacancyForTest(app, vcRes.body);

    // 7. Shortlist retrieval returns the Phase 14 paginated matching result.
    const shortlistRes = await request(app.getHttpServer())
      .get(`/vacancies/${vacancyId}/shortlist`)
      .set('Authorization', `Bearer ${caToken}`)
      .expect(200);
    expect(Array.isArray(shortlistRes.body.matches)).toBe(true);
    expect(shortlistRes.body).toMatchObject({ page: 1, pageSize: expect.any(Number) });

    // Start from a paid placement fixture; Task 15 owns the selected-interview flow.
    const policy = await app.get(PricingService).current();
    const { placement, payment } = await createAwaitingPaymentPlacementFixture({
      prisma, idService: app.get(IdService), vacancyId, jobSeekerId: candidateId, createdByStaffId: caStaffId,
      agreedSalary: 2000000, feePercent: policy.placementFeePercent, gstPercent: policy.gstPercent,
      paymentDueHours: policy.placementPaymentDueHours,
    });
    const placementId = placement.id;
    const paymentRes = await request(app.getHttpServer()).post('/payments/mock/simulate-webhook').send({
      gatewayReference: payment.gatewayReference, status: 'succeeded',
    }).expect(201);
    expect(paymentRes.body.status).toBe('succeeded');
    expect((await prisma.placement.findUniqueOrThrow({ where: { id: placementId } })).status).toBe('confirmed');

    // Placement joined flow
    const joinedDateStr = '2026-10-24T10:00:00.000Z';
    await prisma.placement.update({
      where: { id: placementId },
      data: { joiningDate: new Date(joinedDateStr) },
    });
    await createJoiningCallsFixture({
      prisma,
      idService: app.get(IdService),
      placementId,
      jobSeekerId: candidateId,
      businessId: bizId,
      callTime: new Date(joinedDateStr),
    });
    const joinRes = await request(app.getHttpServer())
      .post(`/placements/${placementId}/joined`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ joinedDate: joinedDateStr })
      .expect(201);
    expect(joinRes.body.status).toBe('active');
  });
});

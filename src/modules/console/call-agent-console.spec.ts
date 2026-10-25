import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 6 Task 5: Call Agent Console', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;
  let caToken: string;

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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /call-agent serves the Call Agent console web frontend with all required flows', async () => {
    const res = await request(app.getHttpServer())
      .get('/call-agent')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    const html = res.text;

    expect(html).toContain('Laboura Call Agent Console');
    // Onboarding forms
    expect(html).toContain('js-name');
    expect(html).toContain('js-phone');
    expect(html).toContain('rf-name');
    expect(html).toContain('biz-name');
    // OTP verification
    expect(html).toContain('sendOtp');
    expect(html).toContain('verifyOtp');
    // Payment link generation
    expect(html).toContain('js-payment-link-card');
    // Vacancy capture
    expect(html).toContain('vc-biz-id');
    expect(html).toContain('vc-trade');
    // Candidate shortlist view
    expect(html).toContain('shortlist-vc-id');
    // Contact attempts and hits
    expect(html).toContain('contact-channel');
    expect(html).toContain('hit-reason');
    // Placement offer and response flow
    expect(html).toContain('place-vc-id');
    expect(html).toContain('resp-response');
    expect(html).toContain('submitPlacementJoined');
  });

  it('verifies Call Agent end-to-end API workflow from console', async () => {
    const phone = `94001${String(timestamp).slice(-5)}`;

    // 1. OTP send & verify
    const otpSendRes = await request(app.getHttpServer())
      .post('/otp/send')
      .set('Authorization', `Bearer ${caToken}`)
      .send({ phone })
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
      .send({
        name: 'Shortlist Candidate',
        phone,
        tradeSkill: 'Electrician',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        otpRequestId: requestId,
      })
      .expect(201);
    const candidateId = seekerRes.body.id;

    // 3. Payment link generation
    const payLinkRes = await request(app.getHttpServer())
      .post(`/job-seekers/${candidateId}/activation-payment`)
      .set('Authorization', `Bearer ${caToken}`)
      .expect(201);
    expect(payLinkRes.body.paymentLink).toBeDefined();

    // 4. Contact attempt logging
    const contactRes = await request(app.getHttpServer())
      .post(`/job-seekers/${candidateId}/contact-attempts`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        channel: 'call',
        outcome: 'picked_up',
        timeOfDay: 'am',
      })
      .expect(201);
    expect(contactRes.body.channel).toBe('call');

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
      .send({ phone: bizPhone })
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
      .send({
        name: 'Call Agent Biz Test',
        phone: bizPhone,
        area: 'Indiranagar',
        otpRequestId: bizOtp.body.requestId,
      })
      .expect(201);
    const bizId = bizRes.body.id;

    const vcRes = await request(app.getHttpServer())
      .post('/vacancies')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        businessId: bizId,
        tradeSkill: 'Electrician',
        offeredSalary: 2000000,
        headcount: 1,
      })
      .expect(201);
    const vacancyId = vcRes.body.id;

    // 7. Shortlist retrieval (calls Phase 4 Task 3 endpoint)
    const shortlistRes = await request(app.getHttpServer())
      .get(`/vacancies/${vacancyId}/shortlist`)
      .set('Authorization', `Bearer ${caToken}`)
      .expect(200);
    expect(Array.isArray(shortlistRes.body)).toBe(true);

    // 8. Placement offer flow
    const placeRes = await request(app.getHttpServer())
      .post(`/vacancies/${vacancyId}/placements`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        jobSeekerId: candidateId,
        agreedSalary: 2000000,
      })
      .expect(201);
    const placementId = placeRes.body.id;

    // Placement response flow
    const respRes = await request(app.getHttpServer())
      .post(`/placements/${placementId}/respond`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ response: 'accepted' })
      .expect(201);
    expect(respRes.body.status).toBe('confirmed');

    // Placement joined flow
    const joinRes = await request(app.getHttpServer())
      .post(`/placements/${placementId}/joined`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ joinedDate: '2026-10-24T10:00:00.000Z' })
      .expect(201);
    expect(joinRes.body.status).toBe('active');
  });
});

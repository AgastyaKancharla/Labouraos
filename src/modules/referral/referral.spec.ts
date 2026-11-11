import { JwtService } from '@nestjs/jwt';
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

describe('Referral Registration (Phase 2 Task 3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let callAgentToken: string;
  let callAgentId: string;
  let fieldAgentToken: string;
  let fieldAgentId: string;
  let financeToken: string;
  let financeId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);

    const passwordHash = await bcrypt.hash(password, 10);

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-RF-${timestamp}`,
        name: 'Call Agent RF',
        email: `call_agent_rf_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;

    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-RF-${timestamp}`,
        name: 'Field Agent RF',
        email: `field_agent_rf_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });
    fieldAgentId = fieldAgent.id;

    const finance = await prisma.staff.create({
      data: {
        code: `FI-RF-${timestamp}`,
        name: 'Finance RF',
        email: `finance_rf_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    financeId = finance.id;

    const server = app.getHttpServer();

    const caRes = await enrolledLogin(server, { email: callAgent.email, password });
    callAgentToken = caRes.body.accessToken;

    const faRes = await enrolledLogin(server, { email: fieldAgent.email, password });
    fieldAgentToken = faRes.body.accessToken;

    const fiRes = await enrolledLogin(server, { email: finance.email, password });
    financeToken = fiRes.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      const referrals = await prisma.referral.findMany({
        where: { phone: { contains: `${timestamp.toString().slice(-8)}` } },
        select: { id: true },
      });
      const referralIds = referrals.map((referral) => referral.id);
      if (referralIds.length) {
        await prisma.payoutAccount.deleteMany({ where: { ownerType: 'referral', ownerId: { in: referralIds } } });
        await prisma.publicLink.deleteMany({ where: { subjectType: 'referral', subjectId: { in: referralIds } } });
      }
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: [callAgentId, fieldAgentId, financeId] },
        },
      });
      await prisma.jobSeeker.deleteMany({
        where: {
          phone: { contains: `${timestamp.toString().slice(-8)}` },
        },
      });
      await prisma.referral.deleteMany({
        where: {
          phone: { contains: `${timestamp.toString().slice(-8)}` },
        },
      });
      await prisma.staff.deleteMany({
        where: {
          id: { in: [callAgentId, fieldAgentId, financeId] },
        },
      });
    }
    if (app) {
      await app.close();
    }
  });

  async function getVerifiedOtp(phone: string): Promise<string> {
    const { requestId } = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(requestId)!;
    await otpService.verifyOtp(requestId, code);
    return requestId;
  }

  it('allows call_agent to register a referral with verified OTP', async () => {
    const phone = `81${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Rajesh Sharma',
        phone,
        type: 'individual',
        whatsappPhone: phone,
        language: 'en',
        individualRole: 'shop_staff',
        locality: 'Indiranagar',
        pincode: '560038',
        heardFrom: 'field_visit',
        otpRequestId,
        city: 'Bengaluru',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^RF-\d{5}$/);
    expect(res.body.name).toBe('Rajesh Sharma');
    expect(res.body.phoneVerified).toBe(true);
    expect(res.body.type).toBe('individual');
    expect(res.body.registrationLinkSent).toBe(true);
    expect(res.body.registrationLinkExpiresAt).toBeDefined();
    const registrationSms = await prisma.messageLog.findFirst({
      where: { subjectType: 'referral', subjectId: res.body.id, template: 'referral_terms_link', status: 'sent' },
    });
    expect(registrationSms).not.toBeNull();
    const registrationLink = await prisma.publicLink.findFirst({
      where: { purpose: 'referral_registration', subjectId: res.body.id, revokedAt: null },
    });
    expect(registrationLink).not.toBeNull();
    expect(Math.abs(registrationLink!.expiresAt.getTime() - registrationLink!.createdAt.getTime() - 48 * 60 * 60 * 1000)).toBeLessThan(1000);

    // Audit log check
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityCode: res.body.code,
        action: 'referral.create',
      },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].actorId).toBe(callAgentId);
  });

  it('allows registering a business-type referral', async () => {
    const phone = `82${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Sharma Staffing Services',
        phone,
        type: 'business',
        whatsappPhone: phone,
        language: 'en',
        partnerBusinessType: 'staffing',
        partnerBusinessName: 'Sharma Staffing Services',
        locality: 'Indiranagar',
        pincode: '560038',
        heardFrom: 'walk_in',
        otpRequestId,
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('business');
  });

  it('rejects referral with invalid type (400)', async () => {
    const phone = `83${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Sharma Agency',
        phone,
        type: 'agency', // Invalid type
        otpRequestId,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('type');
  });

  it('allows field_agent to create a referral (201) while finance is denied (403)', async () => {
    const phoneFa = `84${timestamp.toString().slice(-8)}`;
    const otpRequestIdFa = await getVerifiedOtp(phoneFa);

    const faRes = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({
        name: 'FA Referral',
        phone: phoneFa,
        type: 'individual',
        whatsappPhone: phoneFa,
        language: 'kn',
        individualRole: 'shop_owner',
        locality: 'Jayanagar',
        pincode: '560041',
        heardFrom: 'field_visit',
        otpRequestId: otpRequestIdFa,
      });
    expect(faRes.status).toBe(201);
    expect(faRes.body.id).toBeDefined();

    const phoneFi = `89${timestamp.toString().slice(-8)}`;
    const otpRequestIdFi = await getVerifiedOtp(phoneFi);

    const fiRes = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        name: 'Finance Referral',
        phone: phoneFi,
        type: 'individual',
        whatsappPhone: phoneFi,
        language: 'en',
        individualRole: 'other',
        locality: 'Jayanagar',
        pincode: '560041',
        heardFrom: 'other',
        otpRequestId: otpRequestIdFi,
      });
    expect(fiRes.status).toBe(403);
    await request(app.getHttpServer())
      .post(`/referrals/${faRes.body.id}/terms-links`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ language: 'en' })
      .expect(403);
  });

  it('rejects referral creation without verified OTP (400)', async () => {
    const phone = `85${timestamp.toString().slice(-8)}`;
    const { requestId } = await otpService.sendOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Unverified Referral',
        phone,
        type: 'individual',
        whatsappPhone: phone,
        language: 'en',
        individualRole: 'other',
        locality: 'Jayanagar',
        pincode: '560041',
        heardFrom: 'other',
        otpRequestId: requestId,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('OTP');
  });

  it('enforces each referral registration field and refuses staff-entered payout details', async () => {
    const phone = `85${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);
    const valid = {
      name: 'Required Field Partner', phone, whatsappPhone: phone, language: 'en',
      type: 'individual', individualRole: 'shop_staff', locality: 'Indiranagar',
      pincode: '560038', heardFrom: 'field_visit', otpRequestId,
    };
    const missingFields: Array<keyof typeof valid> = [
      'name', 'phone', 'whatsappPhone', 'language', 'type', 'individualRole', 'locality', 'pincode', 'heardFrom',
    ];
    for (const field of missingFields) {
      const payload = { ...valid } as Record<string, unknown>;
      delete payload[field];
      const response = await request(app.getHttpServer())
        .post('/referrals')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send(payload);
      expect(response.status).toBe(400);
    }

    const incompleteBusiness = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ ...valid, type: 'business' });
    expect(incompleteBusiness.status).toBe(400);
    expect(incompleteBusiness.body.message).toContain('partnerBusinessType and partnerBusinessName');

    const withPayout = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ ...valid, upiId: 'agent@bank' });
    expect(withPayout.status).toBe(400);
    expect(withPayout.body.message).toContain('entered by the referral partner');
  });

  it('keeps the registration link resumable through consent, selfie, ID, and partner-entered UPI', async () => {
    const phone = `86${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);
    const created = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Resuming Referral', phone, whatsappPhone: phone, language: 'en', type: 'individual',
        individualRole: 'existing_worker', locality: 'Indiranagar', pincode: '560038',
        heardFrom: 'field_visit', otpRequestId,
      })
      .expect(201);
    const originalLink = await prisma.publicLink.findFirst({
      where: { purpose: 'referral_registration', subjectId: created.body.id, revokedAt: null },
    });
    expect(originalLink).not.toBeNull();
    const linkResponse = await request(app.getHttpServer())
      .post(`/referrals/${created.body.id}/terms-links`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ language: 'en' })
      .expect(201);
    const revokedOriginalLink = await prisma.publicLink.findUnique({ where: { id: originalLink!.id } });
    expect(revokedOriginalLink?.revokedAt).toBeInstanceOf(Date);
    const token = linkResponse.body.token as string;

    await request(app.getHttpServer())
      .get(`/referral-registration/${token}/status`)
      .expect(200)
      .expect(({ body }) => expect(body.otpRequired).toBe(true));

    const termsOtp = await otpService.sendOtp(phone);
    const termsCode = (otpService.getProvider() as MockOtpProvider).getCode(termsOtp.requestId)!;
    await request(app.getHttpServer())
      .post('/consent/submit')
      .send({ token, requestId: termsOtp.requestId, otpRequestId: termsOtp.requestId, otpCode: termsCode, purposes: ['agreement_terms', 'call_recording'], language: 'en' })
      .expect(201);

    const selfieOtp = await otpService.sendOtp(phone);
    const selfieCode = (otpService.getProvider() as MockOtpProvider).getCode(selfieOtp.requestId)!;
    await otpService.verifyOtp(selfieOtp.requestId, selfieCode);
    await request(app.getHttpServer())
      .post(`/referral-registration/${token}/selfie`)
      .field('requestId', selfieOtp.requestId)
      .field('captureSource', 'live_camera')
      .attach('photo', Buffer.from('camera-image'), { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const idOtp = await otpService.sendOtp(phone);
    const idCode = (otpService.getProvider() as MockOtpProvider).getCode(idOtp.requestId)!;
    await otpService.verifyOtp(idOtp.requestId, idCode);
    const idResult = await request(app.getHttpServer())
      .post(`/referral-registration/${token}/id-check`)
      .send({ requestId: idOtp.requestId, method: 'pan' })
      .expect(201);
    expect(idResult.body.status).toBe('verified');
    expect(idResult.body.nextStep).toBe('upi');

    const payoutOtp = await otpService.sendOtp(phone);
    const payoutCode = (otpService.getProvider() as MockOtpProvider).getCode(payoutOtp.requestId)!;
    await request(app.getHttpServer())
      .post(`/referral-registration/${token}/upi`)
      .send({ otpRequestId: payoutOtp.requestId, otpCode: payoutCode, upiId: `resumeref${timestamp}@bank` })
      .expect(201);

    const completedLink = await prisma.publicLink.findFirst({
      where: { purpose: 'referral_registration', subjectId: created.body.id, revokedAt: null },
    });
    expect(completedLink?.usedAt).toBeInstanceOf(Date);
    const registrationStatus = await request(app.getHttpServer())
      .get(`/referrals/${created.body.id}/registration-status`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(200);
    expect(registrationStatus.body.steps.terms.state).toBe('done');
    expect(registrationStatus.body.steps.selfie.state).toBe('done');
    expect(registrationStatus.body.steps.id.state).toBe('done');
    expect(registrationStatus.body.steps.upi.state).toBe('in_progress');
  });

  it('does not let a referral partner refer themselves for a joining reward', async () => {
    const phone = `87${timestamp.toString().slice(-8)}`;
    const referralOtp = await getVerifiedOtp(phone);
    const referral = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Self Referral Partner', phone, whatsappPhone: phone, language: 'en', type: 'individual',
        individualRole: 'other', locality: 'Jayanagar', pincode: '560041', heardFrom: 'other', otpRequestId: referralOtp,
      })
      .expect(201);
    const candidateOtp = await getVerifiedOtp(phone);
    const response = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId: candidateOtp,
        tradeSkill: 'Painter',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '17:00',
        heardFrom: 'referral_partner',
        referredById: referral.body.id,
      }));
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('cannot refer themselves');
  });

  it('validates referredById when creating a job seeker: rejects invalid and links valid', async () => {
    // 1. Create a valid referral
    const referralPhone = `91${timestamp.toString().slice(-8)}`;
    const refOtpId = await getVerifiedOtp(referralPhone);
    const refRes = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Referral Partner John',
        phone: referralPhone,
        type: 'individual',
        whatsappPhone: referralPhone,
        language: 'en',
        individualRole: 'existing_worker',
        locality: 'Indiranagar',
        pincode: '560038',
        heardFrom: 'field_visit',
        otpRequestId: refOtpId,
      });
    const referralId = refRes.body.id;

    // 2. Attempt to create a job seeker with non-existent referredById -> 400
    const jsPhone1 = `92${timestamp.toString().slice(-8)}`;
    const jsOtp1 = await getVerifiedOtp(jsPhone1);
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    const failRes = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone: jsPhone1,
        otpRequestId: jsOtp1,
        tradeSkill: 'Painter',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '17:00',
        referredById: nonExistentId,
      }));

    expect(failRes.status).toBe(400);
    expect(failRes.body.message).toContain('Referral partner');

    // 3. Create a job seeker with valid referredById -> 201
    const jsPhone2 = `88${timestamp.toString().slice(-8)}`;
    const jsOtp2 = await getVerifiedOtp(jsPhone2);

    const successRes = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone: jsPhone2,
        otpRequestId: jsOtp2,
        tradeSkill: 'Painter',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '17:00',
        referredById: referralId,
      }));

    expect(successRes.status).toBe(201);
    // Verify relation from referral side
    const refWithSeekers = await prisma.referral.findUnique({
      where: { id: referralId },
      include: { jobSeekers: true },
    });
    expect(refWithSeekers?.jobSeekers).toHaveLength(1);
    expect(refWithSeekers?.jobSeekers[0].id).toBe(successRes.body.id);
  });

  it('lets only the CEO pause a partner, with a reason; refuses new referrals naming him while paused; unpause restores', async () => {
    const prismaRef = app.get(PrismaService);
    const jwt = app.get(JwtService);
    const ceo = await prismaRef.staff.create({
      data: { code: `CEO-RF-${timestamp}`, name: 'CEO RF', email: `ceo_rf_${timestamp}@laboura.local`, passwordHash: 'x', role: 'ceo', city: 'Bengaluru' },
    });
    const ceoToken = jwt.sign({ sub: ceo.id, email: ceo.email, role: 'ceo', code: ceo.code, teamLeadId: null });
    try {
      // A mobile no other row uses: '9' + 9 random digits, checked against partners and job seekers.
      const unusedMobile = async (): Promise<string> => {
        for (;;) {
          const candidate = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
          const variants = [candidate, `91${candidate}`, `+91${candidate}`];
          const [r, j] = await Promise.all([
            prismaRef.referral.count({ where: { phone: { in: variants } } }),
            prismaRef.jobSeeker.count({ where: { phone: { in: variants } } }),
          ]);
          if (!r && !j) return candidate;
        }
      };
      const partnerPhone = await unusedMobile();
      const partner = await request(app.getHttpServer())
        .post('/referrals')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          name: `Paused Partner ${partnerPhone.slice(-4)}`, phone: partnerPhone, whatsappPhone: partnerPhone, language: 'en', type: 'individual',
          individualRole: 'other', locality: 'Jayanagar', pincode: '560041', heardFrom: 'other', otpRequestId: await getVerifiedOtp(partnerPhone),
        })
        .expect(201);
      const id = partner.body.id;
      await request(app.getHttpServer()).post(`/referrals/${id}/pause`).set('Authorization', `Bearer ${callAgentToken}`).send({ reason: 'x' }).expect(403);
      await request(app.getHttpServer()).post(`/referrals/${id}/pause`).set('Authorization', `Bearer ${financeToken}`).send({ reason: 'x' }).expect(403);
      await request(app.getHttpServer()).post(`/referrals/${id}/pause`).set('Authorization', `Bearer ${ceoToken}`).send({}).expect(400);
      await request(app.getHttpServer()).post(`/referrals/${id}/pause`).set('Authorization', `Bearer ${ceoToken}`).send({ reason: 'Sending fake candidates' }).expect(201);
      const paused = await prismaRef.referral.findUnique({ where: { id } });
      expect(paused).toMatchObject({ pausedByStaffId: ceo.id, pauseReason: 'Sending fake candidates' });
      expect(await prismaRef.auditLog.count({ where: { action: 'referral.paused', entityCode: partner.body.code } })).toBe(1);

      const seekerPhone = await unusedMobile();
      const register = async () =>
        request(app.getHttpServer())
          .post('/job-seekers')
          .set('Authorization', `Bearer ${callAgentToken}`)
          .send(completeJobSeekerRegistration({ phone: seekerPhone, otpRequestId: await getVerifiedOtp(seekerPhone), heardFrom: 'referral_partner', referredById: id }));
      const refused = await register();
      expect(refused.status).toBe(400);
      expect(refused.body.message).toContain('is paused by the CEO');

      await request(app.getHttpServer()).post(`/referrals/${id}/unpause`).set('Authorization', `Bearer ${ceoToken}`).send({}).expect(201);
      expect((await prismaRef.referral.findUnique({ where: { id } }))?.pausedAt).toBeNull();
      const accepted = await register();
      expect(accepted.status).toBe(201);
      await prismaRef.jobSeekerTrade.deleteMany({ where: { jobSeekerId: accepted.body.id } });
      await prismaRef.jobSeeker.deleteMany({ where: { id: accepted.body.id } }).catch(() => undefined);
      await prismaRef.publicLink.deleteMany({ where: { subjectType: 'referral', subjectId: id } }).catch(() => undefined);
      await prismaRef.referral.deleteMany({ where: { id } }).catch(() => undefined);
    } finally {
      await prismaRef.auditLog.deleteMany({ where: { actorId: ceo.id } });
      await prismaRef.staff.delete({ where: { id: ceo.id } }).catch(() => undefined);
    }
  });
});

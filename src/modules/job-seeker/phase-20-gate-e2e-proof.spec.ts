import { createHmac, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { MessagingService } from '../message/messaging.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { completeJobSeekerRegistration } from '../../test-support/job-seeker-registration';

jest.setTimeout(120000);

describe('Phase 20 gate end-to-end proof', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otp: OtpService;
  let callAgentToken: string;
  let fieldAgentToken: string;

  const stamp = `${Date.now().toString().slice(-6)}${randomUUID().slice(0, 4)}`;
  const password = 'Password123!Secure';
  const shop = { latitude: 12.9784, longitude: 77.6408 };
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const referralIds: string[] = [];
  const bankUtrs: string[] = [];
  const sent: Array<{ template: string; variables?: Record<string, string> }> = [];

  const server = () => app.getHttpServer();
  const provider = () => otp.getProvider() as MockOtpProvider;
  const messageOf = (body: { message?: string | string[] }) => (
    Array.isArray(body.message) ? body.message.join(' ') : body.message ?? ''
  );

  const startApp = async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const next = moduleRef.createNestApplication({ rawBody: true });
    await next.init();
    return next;
  };

  const watchMessages = () => {
    const messaging = app.get(MessagingService);
    const original = messaging.send.bind(messaging);
    jest.spyOn(messaging, 'send').mockImplementation(async (input) => {
      sent.push({ template: input.template, variables: input.variables });
      return original(input);
    });
  };

  const verifiedOtp = async (phone: string) => {
    const sentOtp = await otp.sendOtp(phone);
    const code = provider().getCode(sentOtp.requestId);
    if (!code) throw new Error(`No mock code for ${phone}`);
    await otp.verifyOtp(sentOtp.requestId, code);
    return sentOtp.requestId;
  };

  const postCredit = (bankUtr: string, remark: string) => {
    bankUtrs.push(bankUtr);
    const secret = process.env.BANK_FEED_WEBHOOK_SECRET;
    if (!secret) throw new Error('BANK_FEED_WEBHOOK_SECRET is not set');
    const raw = JSON.stringify({
      bankUtr,
      amountPaise: 49900,
      receivedAt: '2026-11-10T11:00:00.000Z',
      remark,
    });
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    return request(server())
      .post('/payments/bank-feed/webhook')
      .set('Content-Type', 'application/json')
      .set('x-bank-signature', signature)
      .send(raw);
  };

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    app = await startApp();
    prisma = app.get(PrismaService);
    otp = app.get(OtpService);
    const passwordHash = await bcrypt.hash(password, 4);
    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-P20G-${stamp}`, name: 'Gate Call Agent', email: `ca_p20gate_${stamp}@laboura.local`,
        passwordHash, role: 'call_agent',
      },
    });
    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-P20G-${stamp}`, name: 'Gate Field Agent', email: `fa_p20gate_${stamp}@laboura.local`,
        passwordHash, role: 'field_agent',
      },
    });
    staffIds.push(callAgent.id, fieldAgent.id);
    callAgentToken = (await enrolledLogin(server(), { email: callAgent.email, password }).expect(200)).body.accessToken;
    fieldAgentToken = (await enrolledLogin(server(), { email: fieldAgent.email, password }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    try {
      if (app) {
        const db = app.get(PrismaService);
        const subjects = [...seekerIds, ...businessIds, ...vacancyIds, ...referralIds];
        await db.bankCredit.deleteMany({ where: { bankUtr: { in: bankUtrs } } });
        await db.payment.deleteMany({ where: { OR: [{ jobSeekerId: { in: seekerIds } }, { businessId: { in: businessIds } }] } });
        await db.payoutAccount.deleteMany({ where: { ownerType: 'referral', ownerId: { in: referralIds } } });
        await db.publicLink.deleteMany({ where: { subjectId: { in: subjects } } });
        await db.messageLog.deleteMany({ where: { subjectId: { in: subjects } } });
        await db.reviewFlag.deleteMany({ where: { subjectId: { in: subjects } } });
        await db.statusHistory.deleteMany({ where: { subjectId: { in: subjects } } });
        await db.consent.deleteMany({ where: { subjectId: { in: [...seekerIds, ...referralIds] } } });
        await db.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
        await db.businessBranch.deleteMany({ where: { businessId: { in: businessIds } } });
        await db.business.deleteMany({ where: { id: { in: businessIds } } });
        await db.referral.deleteMany({ where: { id: { in: referralIds } } });
        await db.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
        await db.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await db.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      if (app) await app.close();
    }
  });

  it('walks the Phase 20 gate from a checked mobile through a confirmed vacancy and a referral UPI', async () => {
    const seekerPhone = `80${stamp.replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`;
    const brotherPhone = `81${stamp.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`;

    // 1. A new number, resend refused at 10 seconds and allowed at 31.
    const mock = provider();
    let now = Date.now();
    mock.setTimeProvider(() => now);
    const firstOtp = await request(server())
      .post('/otp/send')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ phone: seekerPhone, purpose: 'job_seeker' })
      .expect(201);
    expect(firstOtp.body.resendsLeft).toBe(3);
    now += 10_000;
    const tooSoon = await request(server())
      .post('/otp/send')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ phone: seekerPhone, purpose: 'job_seeker', requestId: firstOtp.body.requestId });
    expect(tooSoon.status).toBe(400);
    expect(messageOf(tooSoon.body)).toContain('Resend is available');
    now += 21_000;
    const resent = await request(server())
      .post('/otp/send')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ phone: seekerPhone, purpose: 'job_seeker', requestId: firstOtp.body.requestId })
      .expect(201);
    expect(resent.body).toMatchObject({ requestId: firstOtp.body.requestId, resendsLeft: 2 });
    const registrationCode = mock.getCode(firstOtp.body.requestId);
    if (!registrationCode) throw new Error('Registration OTP was not stored');
    await request(server())
      .post('/otp/verify')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ requestId: firstOtp.body.requestId, code: registrationCode })
      .expect(201);
    mock.setTimeProvider(() => Date.now());

    // 2. Housekeeper asking ₹25,000. The range tops at ₹23,000.
    const registered = await request(server())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        name: 'Asha Gatekeeper',
        phone: seekerPhone,
        otpRequestId: firstOtp.body.requestId,
        trades: [{ trade: 'Housekeeping', yearsExperience: 4 }],
        minSalary: 2500000,
        maxSalary: 3000000,
        shiftPreference: 'day',
        latitude: shop.latitude,
        longitude: shop.longitude,
        travelDistanceKm: 10,
        locality: 'Indiranagar',
      }))
      .expect(201);
    seekerIds.push(registered.body.id);
    expect(registered.body.warnings).toEqual(['salary_above_market']);
    expect(registered.body.guaranteeFloorPaise).toBe(2300000);
    expect(registered.body.salaryRange).toMatchObject({ maxSalaryPaise: 2300000 });

    const link = await request(server())
      .post('/consent/links')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ jobSeekerId: registered.body.id })
      .expect(201);
    const token = link.body.token as string;
    const linkId = link.body.linkId as string;

    // 3. The app restarts. The same registration link still opens.
    await app.close();
    app = await startApp();
    prisma = app.get(PrismaService);
    otp = app.get(OtpService);
    watchMessages();
    const storedLink = await prisma.publicLink.findUnique({ where: { id: linkId } });
    expect(storedLink?.revokedAt).toBeNull();
    const reopened = await request(server())
      .get(`/consent/${token}`)
      .set('Accept', 'application/json')
      .expect(200);
    expect(reopened.body.otpRequired).toBe(true);

    const linkOtp = await request(server()).post('/consent/send-otp').send({ token }).expect(201);
    const linkCode = provider().getCode(linkOtp.body.requestId);
    if (!linkCode) throw new Error('Link OTP was not stored');
    await otp.verifyOtp(linkOtp.body.requestId, linkCode);
    const requestId = linkOtp.body.requestId as string;

    // 4. Consent, selfie, Aadhaar name mismatch, then PAN.
    await request(server())
      .post('/consent/submit')
      .send({
        token,
        otpRequestId: requestId,
        purposes: ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'],
        language: 'en',
      })
      .expect(201);
    await request(server())
      .post(`/registration/${token}/selfie`)
      .field('requestId', requestId)
      .field('captureSource', 'live_camera')
      .attach('photo', Buffer.from('live-camera-frame'), { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const aadhaar = await request(server())
      .post(`/registration/${token}/id-check`)
      .send({ requestId, method: 'digilocker', simulateFailure: true })
      .expect(201);
    expect(aadhaar.body.nameMatches).toBe(false);
    const pan = await request(server())
      .post(`/registration/${token}/id-check`)
      .send({ requestId, method: 'pan' })
      .expect(201);
    expect(pan.body).toMatchObject({ method: 'pan', status: 'verified', nameMatches: true });

    // 5. The brother pays on a payment-only link. A second credit is refunded.
    const terms = await request(server())
      .post(`/registration/${token}/terms-and-payment`)
      .send({ requestId, acceptTerms: true })
      .expect(201);
    expect(terms.body.payment.amountPaise).toBe(49900);
    await request(server())
      .post(`/registration/${token}/payment-only-link`)
      .send({ requestId, phone: brotherPhone })
      .expect(201);
    const paymentSms = [...sent].reverse().find((row) => row.template === 'payment_only_link');
    const paymentLink = paymentSms?.variables?.link;
    if (!paymentLink) throw new Error('Payment-only link was not sent');
    const paymentToken = new URL(paymentLink).pathname.split('/').filter(Boolean).pop();
    if (!paymentToken) throw new Error('Payment-only link had no token');
    const brotherOtp = await request(server()).post(`/registration/payment/${paymentToken}/send-otp`).expect(201);
    const brotherCode = provider().getCode(brotherOtp.body.requestId);
    if (!brotherCode) throw new Error('Brother OTP was not stored');
    await otp.verifyOtp(brotherOtp.body.requestId, brotherCode);
    const page = await request(server())
      .get(`/registration/payment/${paymentToken}`)
      .query({ requestId: brotherOtp.body.requestId })
      .set('Accept', 'application/json')
      .expect(200);
    expect(page.body).toMatchObject({
      firstName: 'Asha',
      jobSeekerCode: registered.body.code,
      amountPaise: 49900,
    });
    const pageText = JSON.stringify(page.body);
    expect(pageText).not.toContain(seekerPhone);
    expect(pageText).not.toContain('Gatekeeper');
    expect(pageText).not.toContain('Indiranagar');

    const upiReference = terms.body.payment.upiReference as string;
    const paid = await postCredit(`UTR-P20G-1-${stamp}`, upiReference);
    expect(paid.body).toMatchObject({ received: true, status: 'succeeded', paymentId: terms.body.payment.paymentId });
    const active = await prisma.jobSeeker.findUnique({ where: { id: registered.body.id } });
    expect(active).toMatchObject({ status: 'active', guaranteeFloorPaise: 2300000 });

    const duplicate = await postCredit(`UTR-P20G-2-${stamp}`, upiReference);
    expect(duplicate.body).toMatchObject({
      received: true,
      status: 'duplicate_refund_created',
      paymentId: terms.body.payment.paymentId,
    });
    const refund = await prisma.payment.findUnique({ where: { id: duplicate.body.refundPaymentId } });
    expect(refund).toMatchObject({
      type: 'duplicate_refund',
      status: 'approved',
      amount: 49900,
      jobSeekerId: registered.body.id,
    });

    // 6. A bakery, a second branch, two drafts. One is below the legal minimum and opens only after the branch OTP.
    const businessPhone = `82${stamp.replace(/\D/g, '').padEnd(8, '2').slice(0, 8)}`;
    const branchPhone = `83${stamp.replace(/\D/g, '').padEnd(8, '3').slice(0, 8)}`;
    const businessOtp = await verifiedOtp(businessPhone);
    const branchOtp = await verifiedOtp(branchPhone);
    const bakery = await request(server())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({
        name: `Gate Bakery ${stamp}`,
        legalName: `Gate Bakery ${stamp} Pvt Ltd`,
        phone: businessPhone,
        otpRequestId: businessOtp,
        contactPersonName: 'Ravi Rao',
        contactPersonRole: 'owner',
        businessType: 'bakery',
        locality: 'Indiranagar',
        pincode: '560038',
        latitude: shop.latitude,
        longitude: shop.longitude,
        heardFrom: 'field_visit',
        branches: [{
          name: 'Jayanagar counter',
          locality: 'Jayanagar',
          latitude: shop.latitude,
          longitude: shop.longitude,
          contactPersonName: 'Lakshmi Rao',
          contactPersonRole: 'manager',
          contactPersonPhone: branchPhone,
          otpRequestId: branchOtp,
        }],
        staffNeededRows: [
          {
            trade: 'Housekeeping', branchName: 'Jayanagar counter', headcount: 1,
            salaryMinPaise: 2000000, salaryMaxPaise: 2500000, shift: 'day', startDate: '2026-12-01',
          },
          {
            trade: 'Cook', headcount: 1,
            salaryMinPaise: 1800000, salaryMaxPaise: 2400000, shift: 'day', startDate: '2026-12-01',
          },
        ],
      })
      .expect(201);
    businessIds.push(bakery.body.id);
    expect(bakery.body.branches).toHaveLength(1);
    expect(bakery.body.vacancies).toHaveLength(2);
    const housekeeping = bakery.body.vacancies.find((row: { tradeSkill: string }) => row.tradeSkill === 'Housekeeping');
    const cook = bakery.body.vacancies.find((row: { tradeSkill: string }) => row.tradeSkill === 'Cook');
    if (!housekeeping || !cook) throw new Error('Staff-needed drafts were not created');
    vacancyIds.push(housekeeping.id, cook.id);
    expect(housekeeping).toMatchObject({ status: 'draft', branchId: bakery.body.branches[0].id });
    expect(cook).toMatchObject({ status: 'draft', branchId: null });

    await request(server())
      .get(`/vacancies/${housekeeping.id}/shortlist`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .expect(400);
    const refusedWage = await request(server())
      .post(`/vacancies/${housekeeping.id}/submit-for-confirmation`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({})
      .expect(400);
    expect(refusedWage.body.legalMinimumPaise).toBe(2337600);
    const submitted = await request(server())
      .post(`/vacancies/${housekeeping.id}/submit-for-confirmation`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ ownerToldMinimumWage: true })
      .expect(201);
    expect(submitted.body).toMatchObject({
      status: 'awaiting_confirmation',
      belowLegalMinimum: true,
      legalMinimumPaise: 2337600,
    });
    expect(submitted.body.confirmation.sentToLast4).toBe(branchPhone.slice(-4));
    await request(server())
      .get(`/vacancies/${housekeeping.id}/shortlist`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .expect(400);

    // Matching also requires a verified business and a vacancy pin. The draft copies neither.
    await prisma.business.update({ where: { id: bakery.body.id }, data: { verificationStatus: 'verified' } });
    await prisma.vacancy.update({
      where: { id: housekeeping.id },
      data: { latitude: shop.latitude, longitude: shop.longitude },
    });
    await request(server())
      .get(`/vacancies/${housekeeping.id}/shortlist`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .expect(400);

    const confirmCode = provider().getCode(submitted.body.confirmation.otpRequestId);
    if (!confirmCode) throw new Error('Branch confirmation OTP was not stored');
    const confirmed = await request(server())
      .post(`/vacancies/${housekeeping.id}/confirm`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({
        otpRequestId: submitted.body.confirmation.otpRequestId,
        code: confirmCode,
        method: 'code_on_visit',
      })
      .expect(201);
    expect(confirmed.body).toMatchObject({
      status: 'open',
      confirmedByName: 'Lakshmi Rao',
      confirmedPhoneLast4: branchPhone.slice(-4),
    });
    const matchedIds: string[] = [];
    const firstPage = await request(server())
      .get(`/vacancies/${housekeeping.id}/shortlist`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .expect(200);
    matchedIds.push(...firstPage.body.matches.map((row: { jobSeekerId: string }) => row.jobSeekerId));
    const pageSize = firstPage.body.pageSize as number;
    if (pageSize < 1) throw new Error('Matching page size is missing');
    const pages = Math.ceil((firstPage.body.total as number) / pageSize);
    for (let page = 2; page <= pages; page += 1) {
      const nextPage = await request(server())
        .get(`/vacancies/${housekeeping.id}/shortlist`)
        .query({ page })
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .expect(200);
      matchedIds.push(...nextPage.body.matches.map((row: { jobSeekerId: string }) => row.jobSeekerId));
    }
    expect(matchedIds).toContain(registered.body.id);
    await request(server())
      .get(`/vacancies/${cook.id}/shortlist`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .expect(400);

    // 7. A referral partner finishes the link with a UPI ID after an ID whose name matches.
    const referralPhone = `84${stamp.replace(/\D/g, '').padEnd(8, '4').slice(0, 8)}`;
    const referralOtp = await verifiedOtp(referralPhone);
    const partner = await request(server())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Meera Nair',
        phone: referralPhone,
        whatsappPhone: referralPhone,
        language: 'en',
        type: 'individual',
        individualRole: 'shop_staff',
        locality: 'Jayanagar',
        pincode: '560041',
        heardFrom: 'field_visit',
        otpRequestId: referralOtp,
      })
      .expect(201);
    referralIds.push(partner.body.id);
    expect(partner.body.code).toMatch(/^RF-\d{5}$/);
    expect(partner.body.registrationLinkSent).toBe(true);
    const referralLink = await request(server())
      .post(`/referrals/${partner.body.id}/terms-links`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ language: 'en' })
      .expect(201);
    const referralToken = referralLink.body.token as string;
    const termsOtp = await otp.sendOtp(referralPhone);
    const termsCode = provider().getCode(termsOtp.requestId);
    if (!termsCode) throw new Error('Referral terms OTP was not stored');
    await request(server())
      .post('/consent/submit')
      .send({
        token: referralToken,
        requestId: termsOtp.requestId,
        otpRequestId: termsOtp.requestId,
        otpCode: termsCode,
        purposes: ['agreement_terms', 'call_recording'],
        language: 'en',
      })
      .expect(201);
    const selfieOtp = await verifiedOtp(referralPhone);
    await request(server())
      .post(`/referral-registration/${referralToken}/selfie`)
      .field('requestId', selfieOtp)
      .field('captureSource', 'live_camera')
      .attach('photo', Buffer.from('referral-camera'), { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const idOtp = await verifiedOtp(referralPhone);
    const idResult = await request(server())
      .post(`/referral-registration/${referralToken}/id-check`)
      .send({ requestId: idOtp, method: 'pan' })
      .expect(201);
    expect(idResult.body).toMatchObject({ status: 'verified', nameMatches: true, isAdult: true });
    const payoutOtp = await otp.sendOtp(referralPhone);
    const payoutCode = provider().getCode(payoutOtp.requestId);
    if (!payoutCode) throw new Error('Referral UPI OTP was not stored');
    const upi = await request(server())
      .post(`/referral-registration/${referralToken}/upi`)
      .send({
        otpRequestId: payoutOtp.requestId,
        otpCode: payoutCode,
        upiId: `meeranair${stamp.replace(/[^a-z0-9]/gi, '').slice(0, 8)}@okaxis`,
      })
      .expect(201);
    expect(upi.body.status).not.toBe('flagged');
    const account = await prisma.payoutAccount.findFirst({
      where: { ownerType: 'referral', ownerId: partner.body.id },
    });
    expect(account).toBeTruthy();
    expect(account?.nameMatches).not.toBe(false);
    const finished = await prisma.publicLink.findFirst({
      where: { purpose: 'referral_registration', subjectId: partner.body.id, revokedAt: null },
    });
    expect(finished?.usedAt).toBeInstanceOf(Date);
    const panel = await request(server())
      .get(`/referrals/${partner.body.id}/registration-status`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(200);
    expect(panel.body.steps.id.state).toBe('done');
    expect(panel.body.steps.upi.reason).toBeNull();
  });
});

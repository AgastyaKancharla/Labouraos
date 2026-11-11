import { createHmac, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { completeJobSeekerRegistration } from '../../test-support/job-seeker-registration';

describe('Phase 20 terms-and-payment step and a second activation payment', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otp: OtpService;
  let callAgentToken: string;

  const stamp = `${Date.now().toString().slice(-6)}${randomUUID().replace(/\D/g, '').slice(0, 2) || '42'}`;
  const password = 'Password123!Secure';
  const seekerIds: string[] = [];
  const seekerCodes: string[] = [];
  const staffIds: string[] = [];
  const bankUtrs: string[] = [];
  const otherTrade = `Other trade ${randomUUID()}`;
  const purposes = ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'];

  const server = () => app.getHttpServer();
  const messageOf = (body: { message?: string | string[] }) => (
    Array.isArray(body.message) ? body.message.join(' ') : body.message ?? ''
  );

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    otp = app.get(OtpService);

    const passwordHash = await bcrypt.hash(password, 4);
    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-P20T-${stamp}`,
        name: 'Terms Call Agent',
        email: `ca_p20terms_${stamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
      },
    });
    staffIds.push(callAgent.id);
    callAgentToken = (await enrolledLogin(server(), { email: callAgent.email, password }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.bankCredit.deleteMany({ where: { bankUtr: { in: bankUtrs } } });
        await prisma.payment.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
        await prisma.publicLink.deleteMany({ where: { subjectId: { in: seekerIds } } });
        await prisma.messageLog.deleteMany({ where: { subjectId: { in: seekerIds } } });
        await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: seekerIds } } });
        await prisma.statusHistory.deleteMany({ where: { subjectId: { in: seekerIds } } });
        await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
        await prisma.tradeSuggestionSubject.deleteMany({ where: { subjectId: { in: seekerIds } } });
        await prisma.tradeSuggestion.deleteMany({ where: { typedName: otherTrade } });
        await prisma.auditLog.deleteMany({
          where: { OR: [{ actorId: { in: staffIds } }, { entityCode: { in: seekerCodes } }] },
        });
        await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      if (app) await app.close();
    }
  });

  async function register(trade: string, salary = { minSalary: 1800000, maxSalary: 2200000 }) {
    const phone = `9${Math.floor(100000000 + Math.random() * 900000000)}`;
    const sent = await otp.sendOtp(phone);
    const code = (otp.getProvider() as MockOtpProvider).getCode(sent.requestId);
    if (!code) throw new Error('Mock OTP code was not stored');
    await otp.verifyOtp(sent.requestId, code);
    const created = await request(server())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        name: 'Terms Candidate',
        phone,
        otpRequestId: sent.requestId,
        trades: [{ trade, yearsExperience: 2 }],
        minSalary: salary.minSalary,
        maxSalary: salary.maxSalary,
        shiftPreference: 'day',
      }))
      .expect(201);
    seekerIds.push(created.body.id);
    seekerCodes.push(created.body.code);
    const link = await request(server())
      .post('/consent/links')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ jobSeekerId: created.body.id })
      .expect(201);
    return { id: created.body.id as string, phone, token: link.body.token as string };
  }

  async function verifiedLinkOtp(token: string) {
    const sent = await request(server()).post('/consent/send-otp').send({ token }).expect(201);
    const requestId = sent.body.requestId as string;
    const code = (otp.getProvider() as MockOtpProvider).getCode(requestId);
    if (!code) throw new Error('Registration OTP code was not stored');
    expect(await otp.verifyOtp(requestId, code)).toBe(true);
    return requestId;
  }

  async function giveConsent(token: string, requestId: string) {
    await request(server())
      .post('/consent/submit')
      .send({ token, otpRequestId: requestId, purposes, language: 'en' })
      .expect(201);
  }

  async function takeSelfie(token: string, requestId: string) {
    await request(server())
      .post(`/registration/${token}/selfie`)
      .field('requestId', requestId)
      .field('captureSource', 'live_camera')
      .attach('photo', Buffer.from('camera-frame'), { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect(201);
  }

  async function passId(token: string, requestId: string) {
    await request(server())
      .post(`/registration/${token}/id-check`)
      .send({ requestId, method: 'pan' })
      .expect(201);
  }

  function terms(token: string, requestId: string) {
    return request(server()).get(`/registration/${token}/terms`).query({ requestId });
  }

  it('refuses terms before consent, the selfie and the ID check', async () => {
    const seeker = await register('Housekeeping');
    const requestId = await verifiedLinkOtp(seeker.token);

    const beforeConsent = await terms(seeker.token, requestId).expect(400);
    expect(messageOf(beforeConsent.body)).toContain('Consent comes first');
    const payTooEarly = await request(server())
      .post(`/registration/${seeker.token}/terms-and-payment`)
      .send({ requestId, acceptTerms: true })
      .expect(400);
    expect(messageOf(payTooEarly.body)).toContain('Consent comes first');
    expect(await prisma.payment.count({ where: { jobSeekerId: seeker.id } })).toBe(0);

    await giveConsent(seeker.token, requestId);
    const beforeSelfie = await terms(seeker.token, requestId).expect(400);
    expect(messageOf(beforeSelfie.body)).toContain('Take the selfie first');

    await takeSelfie(seeker.token, requestId);
    const beforeId = await terms(seeker.token, requestId).expect(400);
    expect(messageOf(beforeId.body)).toContain('Finish the ID check first');
    expect(await prisma.payment.count({ where: { jobSeekerId: seeker.id } })).toBe(0);
  });

  it('refuses terms while the primary trade is an unlisted Other', async () => {
    const seeker = await register(otherTrade);
    const requestId = await verifiedLinkOtp(seeker.token);
    await giveConsent(seeker.token, requestId);
    await takeSelfie(seeker.token, requestId);
    await passId(seeker.token, requestId);

    const blocked = await terms(seeker.token, requestId).expect(400);
    expect(messageOf(blocked.body)).toContain('Waiting for the new trade to be added in the Command Center');
    const pay = await request(server())
      .post(`/registration/${seeker.token}/terms-and-payment`)
      .send({ requestId, acceptTerms: true })
      .expect(400);
    expect(messageOf(pay.body)).toContain('Waiting for the new trade to be added in the Command Center');
    expect(await prisma.payment.count({ where: { jobSeekerId: seeker.id } })).toBe(0);
  });

  it('refuses terms when the ID check shows the job seeker is under 18', async () => {
    const seeker = await register('Housekeeping');
    const requestId = await verifiedLinkOtp(seeker.token);
    await giveConsent(seeker.token, requestId);
    await takeSelfie(seeker.token, requestId);
    await passId(seeker.token, requestId);
    const verification = await prisma.identityVerification.findFirst({
      where: { jobSeekerId: seeker.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!verification) throw new Error('ID check was not stored');
    await prisma.identityVerification.update({ where: { id: verification.id }, data: { isAdult: false } });

    const blocked = await terms(seeker.token, requestId).expect(400);
    expect(messageOf(blocked.body)).toContain('under 18');
    const pay = await request(server())
      .post(`/registration/${seeker.token}/terms-and-payment`)
      .send({ requestId, acceptTerms: true })
      .expect(400);
    expect(messageOf(pay.body)).toContain('under 18');
    expect(await prisma.payment.count({ where: { jobSeekerId: seeker.id } })).toBe(0);
  });

  it('creates the ₹499 payment after he ticks the terms', async () => {
    const seeker = await register('Housekeeping', { minSalary: 1800000, maxSalary: 2200000 });
    const requestId = await verifiedLinkOtp(seeker.token);
    await giveConsent(seeker.token, requestId);
    await takeSelfie(seeker.token, requestId);
    await passId(seeker.token, requestId);

    const shown = await terms(seeker.token, requestId).expect(200);
    expect(shown.body).toMatchObject({
      trade: 'Housekeeping',
      travelDistanceKm: 10,
      shiftPreference: 'day',
      guaranteeFloorPaise: 1800000,
      amountPaise: 49900,
    });
    // The payment page (P02) names his area and job type in the "suitable" line.
    expect(shown.body).toHaveProperty('locality');
    expect(shown.body).toHaveProperty('jobType');

    const unticked = await request(server())
      .post(`/registration/${seeker.token}/terms-and-payment`)
      .send({ requestId, acceptTerms: false })
      .expect(400);
    expect(messageOf(unticked.body)).toContain('Tick to agree');

    const accepted = await request(server())
      .post(`/registration/${seeker.token}/terms-and-payment`)
      .send({ requestId, acceptTerms: true })
      .expect(201);
    expect(accepted.body.payment).toMatchObject({ amountPaise: 49900, status: 'pending' });
    expect(accepted.body.terms.termsAcceptedAt).toBeTruthy();

    const stored = await prisma.jobSeeker.findUnique({ where: { id: seeker.id } });
    expect(stored?.termsAcceptedAt).toBeInstanceOf(Date);
    expect(stored?.termsAcceptedFloorPaise).toBe(1800000);
    const payment = await prisma.payment.findFirst({ where: { jobSeekerId: seeker.id, type: 'activation' } });
    expect(payment).toMatchObject({ amount: 49900, expectedAmountPaise: 49900, status: 'pending' });
  });

  it('refunds a second activation credit and records an approved duplicate_refund payment', async () => {
    const phone = `8${Math.floor(100000000 + Math.random() * 900000000)}`;
    const sent = await otp.sendOtp(phone);
    const code = (otp.getProvider() as MockOtpProvider).getCode(sent.requestId);
    if (!code) throw new Error('Mock OTP code was not stored');
    await otp.verifyOtp(sent.requestId, code);
    const created = await request(server())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({ phone, otpRequestId: sent.requestId, tradeSkill: 'Cook' }))
      .expect(201);
    seekerIds.push(created.body.id);
    seekerCodes.push(created.body.code);
    const activation = await request(server())
      .post(`/job-seekers/${created.body.id}/activation-payment`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(201);
    const secret = process.env.BANK_FEED_WEBHOOK_SECRET;
    if (!secret) throw new Error('BANK_FEED_WEBHOOK_SECRET is not set');

    const postCredit = (bankUtr: string) => {
      bankUtrs.push(bankUtr);
      const raw = JSON.stringify({
        bankUtr,
        amountPaise: 49900,
        receivedAt: '2026-11-10T10:30:00.000Z',
        remark: activation.body.upiReference,
      });
      const signature = createHmac('sha256', secret).update(raw).digest('hex');
      return request(server())
        .post('/payments/bank-feed/webhook')
        .set('Content-Type', 'application/json')
        .set('x-bank-signature', signature)
        .send(raw);
    };

    const first = await postCredit(`UTR-P20-A-${stamp}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ received: true, status: 'succeeded', paymentId: activation.body.paymentId });

    const second = await postCredit(`UTR-P20-B-${stamp}`);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      received: true,
      status: 'duplicate_refund_created',
      paymentId: activation.body.paymentId,
    });
    const refund = await prisma.payment.findUnique({ where: { id: second.body.refundPaymentId } });
    expect(refund).toMatchObject({
      type: 'duplicate_refund',
      status: 'approved',
      amount: 49900,
      jobSeekerId: created.body.id,
    });
    expect(refund?.approvedAt).toBeInstanceOf(Date);
  });
});

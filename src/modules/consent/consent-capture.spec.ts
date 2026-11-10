import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentClock } from './consent-clock';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { CALL_PURPOSES } from '../call/call-outcomes';
import { JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from './consent.constants';
import { MessagingService } from '../message/messaging.service';

class ControllableConsentClock extends ConsentClock {
  current = new Date('2026-11-05T10:00:00.000Z');

  override now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('Phase 12 Task 4 — Consent capture page and OTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let clock: ControllableConsentClock;
  let otpService: OtpService;
  let messagingService: MessagingService;
  let messagingSend: jest.SpyInstance;

  let agentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;

  const createdStaffIds: string[] = [];
  const createdSeekerIds: string[] = [];

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    clock = new ControllableConsentClock();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConsentClock)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otpService = app.get(OtpService);
    messagingService = app.get(MessagingService);
    messagingSend = jest.spyOn(messagingService, 'send');

    const passwordHash = await bcrypt.hash('StaffPassword123!', 4);

    const randomSuffix1 = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    const ca = await prisma.staff.create({
      data: {
        code: `CA-T4-${randomSuffix1}`,
        name: 'Task 4 Call Agent',
        email: `ca_t4_${randomSuffix1}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        status: 'active',
      },
    });
    createdStaffIds.push(ca.id);
    agentToken = jwt.sign({ sub: ca.id, role: ca.role, code: ca.code, email: ca.email });

    const randomSuffix2 = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    const fa = await prisma.staff.create({
      data: {
        code: `FA-T4-${randomSuffix2}`,
        name: 'Task 4 Field Agent',
        email: `fa_t4_${randomSuffix2}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        status: 'active',
      },
    });
    createdStaffIds.push(fa.id);
    fieldAgentToken = jwt.sign({ sub: fa.id, role: fa.role, code: fa.code, email: fa.email });

    const randomSuffix3 = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    const fin = await prisma.staff.create({
      data: {
        code: `FN-T4-${randomSuffix3}`,
        name: 'Task 4 Finance',
        email: `fn_t4_${randomSuffix3}@laboura.local`,
        passwordHash,
        role: 'finance',
        status: 'active',
      },
    });
    createdStaffIds.push(fin.id);
    financeToken = jwt.sign({ sub: fin.id, role: fin.role, code: fin.code, email: fin.email });
  });

  afterAll(async () => {
    if (createdSeekerIds.length > 0) {
      await prisma.consent.deleteMany({ where: { subjectId: { in: createdSeekerIds } } });
      await prisma.messageLog.deleteMany({ where: { subjectId: { in: createdSeekerIds } } });
      await prisma.statusHistory.deleteMany({ where: { subjectId: { in: createdSeekerIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: createdSeekerIds } } });
    }
    if (createdStaffIds.length > 0) {
      await prisma.staff.deleteMany({ where: { id: { in: createdStaffIds } } });
    }
    await app.close();
  });

  async function createLeadCandidate(): Promise<string> {
    const randomSuffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const phoneSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-T4-${randomSuffix}`,
        name: `Lead ${randomSuffix}`,
        phone: `+9194${phoneSuffix}`,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 1400000,
        maxSalary: 2400000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'lead',
        dateOfBirth: new Date('1995-05-15'),
      },
    });
    createdSeekerIds.push(seeker.id);
    return seeker.id;
  }

  it("CallRecord.purpose closed list includes 'consent_explain'", () => {
    expect(CALL_PURPOSES).toContain('consent_explain');
  });

  it('shows registration progress, current ID service state, and active link expiry to staff', async () => {
    const candidateId = await createLeadCandidate();
    const link = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ jobSeekerId: candidateId });

    const response = await request(app.getHttpServer())
      .get(`/job-seekers/${candidateId}/registration-status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(response.body.steps.phone.state).toBe('not_started');
    expect(response.body.steps.consent.state).toBe('not_started');
    expect(response.body.steps.selfie.state).toBe('not_started');
    expect(response.body.steps.idCheck.state).toBe('not_started');
    expect(response.body.steps.payment.state).toBe('not_started');
    expect(response.body.registrationLinkExpiresAt).toBeDefined();
    const storedLink = await prisma.publicLink.findUnique({ where: { id: link.body.linkId } });
    expect(storedLink?.expiresAt.getTime() - clock.now().getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it('resending a registration link revokes the old link and issues a fresh 48-hour link', async () => {
    const candidateId = await createLeadCandidate();
    const createLink = () => request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ jobSeekerId: candidateId });
    const first = await createLink().expect(201);
    const second = await createLink().expect(201);
    const oldLink = await prisma.publicLink.findUnique({ where: { id: first.body.linkId } });
    const newLink = await prisma.publicLink.findUnique({ where: { id: second.body.linkId } });
    expect(oldLink?.revokedAt).toBeDefined();
    expect(newLink?.revokedAt).toBeNull();
    expect(newLink?.expiresAt.getTime() - clock.now().getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it('POST /consent/links generates token and dispatches SMS; response never contains candidate phone', async () => {
    const candidateId = await createLeadCandidate();

    const res = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ jobSeekerId: candidateId });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(20);

    // Assert phone number never appears in response to agents
    const rawResponseBody = JSON.stringify(res.body);
    expect(rawResponseBody).not.toContain('+91');
    expect(res.body.phone).toBeUndefined();

    // Verify SMS message was logged
    const msg = await prisma.messageLog.findFirst({
      where: { subjectId: candidateId, template: 'consent_link' },
    });
    expect(msg).not.toBeNull();
    expect(msg?.channel).toBe('sms');
    expect(messagingSend).toHaveBeenCalledWith(expect.objectContaining({
      template: 'consent_link',
      variables: { token: res.body.token, link: `https://app.laboura.in/consent/${res.body.token}` },
    }));
  });

  it('full tick-and-submit with OTP verification moves status from lead to consented', async () => {
    const candidateId = await createLeadCandidate();

    // 1. Agent generates link
    const linkRes = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ jobSeekerId: candidateId });
    const token = linkRes.body.token;

    // 2. Candidate opens public consent page / endpoint
    const detailsRes = await request(app.getHttpServer())
      .get(`/consent/${token}`)
      .set('Accept', 'application/json');
    expect(detailsRes.status).toBe(200);
    expect(detailsRes.body.otpRequired).toBe(true);
    expect(detailsRes.body.maskedPhone).toMatch(/^\*+\d{4}$/);
    expect(detailsRes.body.jobSeekerId).toBeUndefined();

    // 3. Request OTP
    const otpSendRes = await request(app.getHttpServer())
      .post('/consent/send-otp')
      .send({ token });
    expect(otpSendRes.status).toBe(201);
    const requestId = otpSendRes.body.requestId;
    expect(requestId).toBeDefined();

    // Retrieve code from MockOtpProvider
    const code = (otpService.getProvider() as MockOtpProvider).getCode(requestId);
    expect(code).toBeDefined();

    // 4. Submit all five required purposes + optional promotions
    const submitRes = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({
        token,
        otpRequestId: requestId,
        otpCode: code,
        purposes: [
          'job_matching',
          'profile_sharing',
          'call_recording',
          'aadhaar_verification',
          'job_updates',
          'promotions',
        ],
        language: 'kn',
      });

    expect(submitRes.status).toBe(201);
    expect(submitRes.body.success).toBe(true);
    expect(submitRes.body.status).toBe('consented');

    // Confirm candidate status in database
    const updatedSeeker = await prisma.jobSeeker.findUnique({ where: { id: candidateId } });
    expect(updatedSeeker?.status).toBe('consented');

    const resumedDetails = await request(app.getHttpServer())
      .get(`/consent/${token}?requestId=${requestId}`)
      .set('Accept', 'application/json');
    expect(resumedDetails.status).toBe(200);
    expect(resumedDetails.body.jobSeekerId).toBe(candidateId);
    expect(resumedDetails.body.otpRequired).toBe(false);
    expect(resumedDetails.body.currentStep).toBe('selfie');

    // Confirm consent records created
    const consents = await prisma.consent.findMany({ where: { subjectId: candidateId } });
    expect(consents).toHaveLength(6);
    expect(consents.every((c) => c.granted && c.method === 'sms_link' && c.otpRequestId === requestId)).toBe(true);
  });

  it('ticking only 4 of 5 required purposes leaves status at lead', async () => {
    const candidateId = await createLeadCandidate();

    const linkRes = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ jobSeekerId: candidateId });
    const token = linkRes.body.token;

    const otpSendRes = await request(app.getHttpServer())
      .post('/consent/send-otp')
      .send({ token });
    const requestId = otpSendRes.body.requestId;
    const code = (otpService.getProvider() as MockOtpProvider).getCode(requestId);

    // Submit only 4 required purposes (leaving out aadhaar_verification)
    const submitRes = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({
        token,
        otpRequestId: requestId,
        otpCode: code,
        purposes: ['job_matching', 'profile_sharing', 'call_recording', 'job_updates'],
        language: 'kn',
      });

    expect(submitRes.status).toBe(201);
    expect(submitRes.body.status).toBe('lead');

    const seeker = await prisma.jobSeeker.findUnique({ where: { id: candidateId } });
    expect(seeker?.status).toBe('lead');
  });

  it('OTP must match before submit succeeds (wrong OTP rejected with 400)', async () => {
    const candidateId = await createLeadCandidate();

    const linkRes = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ jobSeekerId: candidateId });
    const token = linkRes.body.token;

    const otpSendRes = await request(app.getHttpServer())
      .post('/consent/send-otp')
      .send({ token });
    const requestId = otpSendRes.body.requestId;

    const submitRes = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({
        token,
        otpRequestId: requestId,
        otpCode: '000000', // Invalid code
        purposes: [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES],
      });

    expect(submitRes.status).toBe(400);
    expect(submitRes.body.message).toContain('Invalid or expired OTP');

    // Status remains lead
    const seeker = await prisma.jobSeeker.findUnique({ where: { id: candidateId } });
    expect(seeker?.status).toBe('lead');
  });

  it('an expired token is refused with a 400 (not a 500)', async () => {
    const candidateId = await createLeadCandidate();

    const linkRes = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ jobSeekerId: candidateId });
    const token = linkRes.body.token;

    // Registration links remain valid for 48 hours.
    clock.advance(49 * 60 * 60 * 1000);

    const getRes = await request(app.getHttpServer()).get(`/consent/${token}`);
    expect(getRes.status).toBe(400);
    expect(getRes.body.message).toContain('Consent link has expired');

    const submitRes = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({
        token,
        otpRequestId: 'dummy_req',
        otpCode: '123456',
        purposes: [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES],
      });

    expect(submitRes.status).toBe(400);
    expect(submitRes.body.message).toContain('Consent link has expired');
  });

  it('a reused token is refused with a 400 (not a 500)', async () => {
    const candidateId = await createLeadCandidate();

    const linkRes = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ jobSeekerId: candidateId });
    const token = linkRes.body.token;

    const otpSendRes = await request(app.getHttpServer())
      .post('/consent/send-otp')
      .send({ token });
    const requestId = otpSendRes.body.requestId;
    const code = (otpService.getProvider() as MockOtpProvider).getCode(requestId);

    // First redemption succeeds
    const firstSubmit = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({
        token,
        otpRequestId: requestId,
        otpCode: code,
        purposes: [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES],
      });
    expect(firstSubmit.status).toBe(201);

    // Second redemption of the exact same token fails with 400
    const secondSubmit = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({
        token,
        otpRequestId: requestId,
        otpCode: code,
        purposes: [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES],
      });
    expect(secondSubmit.status).toBe(400);
    expect(secondSubmit.body.message).toContain('already been used');
  });

  it('public HTML endpoint returns consent page template', async () => {
    const candidateId = await createLeadCandidate();

    const linkRes = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ jobSeekerId: candidateId });
    const token = linkRes.body.token;

    const htmlRes = await request(app.getHttpServer())
      .get(`/consent/${token}`)
      .set('Accept', 'text/html');

    expect(htmlRes.status).toBe(200);
    expect(htmlRes.text).toContain('<!DOCTYPE html>');
    expect(htmlRes.text).toContain('Laboura Candidate Consent');
    expect(htmlRes.text).toContain('Send OTP via SMS');
  });

  it('Field Agent can generate consent links, but Finance is strictly denied (403)', async () => {
    const candidateId = await createLeadCandidate();

    const faRes = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ jobSeekerId: candidateId });
    expect(faRes.status).toBe(201);
    expect(faRes.body.success).toBe(true);

    const finRes = await request(app.getHttpServer())
      .post('/consent/links')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ jobSeekerId: candidateId });
    expect(finRes.status).toBe(403);
  });
});

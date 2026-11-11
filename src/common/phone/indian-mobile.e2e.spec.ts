import { createHmac, randomInt, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { verifiedOtpFor } from '../../test-support/verified-otp';
import { completeJobSeekerRegistration } from '../../test-support/job-seeker-registration';
import { GST_LOOKUP_PROVIDER } from '../../modules/business/gst-lookup.provider';

/**
 * One stored format for every Indian mobile (+91 and 10 digits), end to end:
 * the web forms send "9876543210", older screens and tests send "+919876543210",
 * and both must be the same person for duplicate checks, OTP, search and the
 * inbound-call match.
 */
describe('Indian mobile numbers are one format end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let callAgentId: string;
  let callAgentToken: string;
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const referralIds: string[] = [];
  const callIds: string[] = [];
  const used = new Set<string>();

  /** A fresh 10-digit mobile starting 9, as the web form sends it. */
  const freshMobile = () => {
    for (;;) {
      const ten = `9${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`;
      if (!used.has(ten)) {
        used.add(ten);
        return ten;
      }
    }
  };
  const spaced = (ten: string) => `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
  const auth = () => ({ Authorization: `Bearer ${callAgentToken}` });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GST_LOOKUP_PROVIDER)
      .useValue({ lookup: async () => { throw new Error('mock lookup unavailable'); } })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const agent = await prisma.staff.create({
      data: {
        code: `PH-${suffix}`,
        name: 'Phone Format Agent',
        email: `ph-${suffix}@laboura.local`,
        passwordHash: await bcrypt.hash('Phone-Format-Password-1', 4),
        role: 'call_agent',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    callAgentId = agent.id;
    callAgentToken = jwt.sign({ sub: agent.id, role: agent.role, code: agent.code, email: agent.email });
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.callbackTask.deleteMany({ where: { callId: { in: callIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: [...seekerIds, ...businessIds, ...referralIds] } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: [...seekerIds, ...businessIds] } } });
    await prisma.jobSeekerTrade.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeekerLanguage.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: callAgentId } });
    await prisma.staff.deleteMany({ where: { id: callAgentId } });
    await app.close();
  });

  async function registerSeeker(phone: string) {
    const otpRequestId = await verifiedOtpFor(app, phone);
    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set(auth())
      .send(completeJobSeekerRegistration({ name: 'Phone Format Seeker', phone, otpRequestId }));
    if (res.body?.id) seekerIds.push(res.body.id as string);
    return res;
  }

  async function registerBusiness(phone: string, name: string) {
    const otpRequestId = await verifiedOtpFor(app, phone);
    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set(auth())
      .send({ name, phone, otpRequestId, contactPersonName: 'Owner', contactPersonRole: 'owner' });
    if (res.body?.id) businessIds.push(res.body.id as string);
    return res;
  }

  async function registerReferral(phone: string) {
    const otpRequestId = await verifiedOtpFor(app, phone);
    const res = await request(app.getHttpServer())
      .post('/referrals')
      .set(auth())
      .send({
        name: 'Phone Format Partner', phone, whatsappPhone: phone, type: 'individual', individualRole: 'auto_driver',
        language: 'kn', locality: 'Madiwala', pincode: '560068', heardFrom: 'walk_in', otpRequestId,
      });
    if (res.body?.id) referralIds.push(res.body.id as string);
    return res;
  }

  it('saves a job seeker typed as 10 digits as +91 and 10 digits, and answers the same number in another spelling with 409 and the existing code', async () => {
    const ten = freshMobile();
    const first = await registerSeeker(ten);
    expect(first.status).toBe(201);
    const stored = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: first.body.id }, select: { phone: true, code: true } });
    expect(stored.phone).toBe(`+91${ten}`);

    for (const spelling of [spaced(ten), `+91${ten}`, `91${ten}`, `0${ten}`, `${ten.slice(0, 5)}-${ten.slice(5)}`]) {
      const again = await registerSeeker(spelling);
      expect(again.status).toBe(409);
      expect(again.body.existingJobSeekerCode).toBe(stored.code);
      expect(again.body.message).toContain('Already registered — open it');
    }
    expect(await prisma.jobSeeker.count({ where: { phone: { endsWith: ten } } })).toBe(1);
  });

  it('tells the agent sending an OTP that the number in any spelling is already registered', async () => {
    const ten = freshMobile();
    const first = await registerSeeker(`+91${ten}`);
    expect(first.status).toBe(201);
    const sent = await request(app.getHttpServer())
      .post('/otp/send')
      .set(auth())
      .send({ phone: ten, purpose: 'job_seeker' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ alreadyRegistered: true, code: first.body.code });
  });

  it('refuses a number that is not a 10-digit Indian mobile with a clear 400', async () => {
    for (const phone of ['98765432', '1234567890', '98765432101']) {
      const sent = await request(app.getHttpServer()).post('/otp/send').set(auth()).send({ phone, purpose: 'job_seeker' });
      expect(sent.status).toBe(400);
      expect(sent.body.message).toBe('Enter a 10-digit mobile number');
    }
    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set(auth())
      .send(completeJobSeekerRegistration({ phone: '1234567890', otpRequestId: 'otp-unused' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Enter a 10-digit mobile number');
  });

  it('treats the saved number typed another way as no change on an edit, and saves a new WhatsApp number in the same format', async () => {
    const ten = freshMobile();
    const first = await registerSeeker(ten);
    expect(first.status).toBe(201);
    const whatsapp = freshMobile();
    const edited = await request(app.getHttpServer())
      .patch(`/job-seekers/${first.body.id}`)
      .set(auth())
      .send({ phone: spaced(ten), whatsappPhone: `0${whatsapp}` });
    // No OTP was given: a real number change would be refused, so this proves "same number".
    expect(edited.status).toBe(200);
    const stored = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(stored.phone).toBe(`+91${ten}`);
    expect(stored.whatsappPhone).toBe(`+91${whatsapp}`);

    const badWhatsapp = await request(app.getHttpServer())
      .patch(`/job-seekers/${first.body.id}`)
      .set(auth())
      .send({ whatsappPhone: '12345' });
    expect(badWhatsapp.status).toBe(400);
    expect(badWhatsapp.body.message).toBe('Enter a 10-digit mobile number');
  });

  it('answers a business registered again with another spelling with 409 and the existing code, and finds it by either spelling or its last 4 digits', async () => {
    const ten = freshMobile();
    const first = await registerBusiness(ten, `Phone Format Shop ${ten}`);
    expect(first.status).toBe(201);
    const stored = await prisma.business.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(stored.phone).toBe(`+91${ten}`);
    expect(stored.additionalContactPhone).toBe(`+91${ten}`);

    const again = await registerBusiness(spaced(ten), `Phone Format Shop Again ${ten}`);
    expect(again.status).toBe(409);
    expect(again.body.existingBusinessCode).toBe(stored.code);

    for (const q of [ten, spaced(ten), `0${ten}`, `+91${ten}`]) {
      const found = await request(app.getHttpServer())
        .get('/screens/call-registration/businesses')
        .query({ q })
        .set(auth());
      expect(found.status).toBe(200);
      expect((found.body as Array<{ code: string }>).map((row) => row.code)).toContain(stored.code);
    }
    const byLast4 = await request(app.getHttpServer())
      .get('/screens/call-registration/businesses')
      .query({ q: ten.slice(-6) })
      .set(auth());
    expect((byLast4.body as Array<{ code: string }>).map((row) => row.code)).toContain(stored.code);
  });

  it('answers a referral partner registered again with another spelling with 409, and finds the partner by either spelling (masked)', async () => {
    const ten = freshMobile();
    const first = await registerReferral(`0${ten}`);
    expect(first.status).toBe(201);
    const stored = await prisma.referral.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(stored.phone).toBe(`+91${ten}`);
    expect(stored.whatsappPhone).toBe(`+91${ten}`);

    const again = await registerReferral(ten);
    expect(again.status).toBe(409);
    expect(again.body.existingReferralCode).toBe(stored.code);

    for (const q of [ten, spaced(ten), `+91${ten}`]) {
      const found = await request(app.getHttpServer())
        .get('/screens/call-registration/referral-partners')
        .query({ q })
        .set(auth());
      expect(found.status).toBe(200);
      expect(found.body.partner).toMatchObject({ code: stored.code, phone: `******${ten.slice(-4)}` });
    }
  });

  it('matches an inbound caller to the job seeker whatever spelling the phone system uses, and saves the caller as +91 and 10 digits', async () => {
    const ten = freshMobile();
    const first = await registerSeeker(ten);
    expect(first.status).toBe(201);
    const secret = process.env.TELEPHONY_WEBHOOK_SECRET ?? '';
    for (const from of [`0${ten}`, `91${ten}`]) {
      const callId = `phone-format-${randomUUID()}`;
      callIds.push(callId);
      const raw = JSON.stringify({ CallSid: callId, From: from, To: '18001234567' });
      const res = await request(app.getHttpServer())
        .post('/telephony/inbound')
        .set('x-telephony-signature', createHmac('sha256', secret).update(raw).digest('hex'))
        .set('content-type', 'application/json')
        .send(raw);
      expect(res.status).toBe(201);
      const task = await prisma.callbackTask.findUniqueOrThrow({ where: { id: res.body.callbackTaskId } });
      expect(task.jobSeekerId).toBe(first.body.id);
      expect(task.phone).toBe(`+91${ten}`);
    }
  });
});

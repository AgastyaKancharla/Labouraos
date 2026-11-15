import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { publicPageOtpPurpose } from '../../common/otp/public-page-otp';
import { withIssuedLinkToken } from '../../test-support/issued-link-token';
import { jobSeekerTermsHash } from '../../test-support/terms-hash';
import { JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from './consent.constants';
import { ConsentLinkService } from './consent-link.service';
import { AGREEMENT_DOCUMENT_STORAGE, MemoryAgreementDocumentStorage } from './agreement-document.storage';

/**
 * Security AC-3 + AUTH-2 (proved on the range): a staff member could complete a
 * job seeker's consent on his own page — the staff route returned the link
 * token, and the page accepted any verified code for his phone (including one
 * the agent sent through POST /otp/send), never used it up, and ignored which
 * link it came from.
 */
describe('Security AC-3: public-page codes are the person’s own, bound to the link and used up', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otp: OtpService;
  let agentToken = '';
  const suffix = Date.now().toString().slice(-7);
  const ids = { staff: '', seekers: [] as string[], business: '', referral: '' };
  const seekerPhone = (n: number) => `+9193${suffix}${n}`.slice(0, 13);

  const server = () => app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${agentToken}` });
  const codeOf = (requestId: string) => (otp.getProvider() as MockOtpProvider).getCode(requestId)!;

  async function lead(n: number) {
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-AC3-${suffix}-${n}`, name: `AC3 Lead ${n}`, phone: seekerPhone(n), status: 'lead', city: 'Bengaluru',
        minSalary: 1400000, maxSalary: 2400000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00',
        registeredByStaffId: ids.staff,
      },
    });
    ids.seekers.push(seeker.id);
    return seeker;
  }

  async function submitConsent(token: string, requestId: string, otpCode?: string) {
    return request(server()).post('/consent/submit').send({
      token, otpRequestId: requestId, ...(otpCode ? { otpCode } : {}),
      purposes: [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES], language: 'en', textHash: await jobSeekerTermsHash(app, 'en'),
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AGREEMENT_DOCUMENT_STORAGE)
      .useValue(new MemoryAgreementDocumentStorage())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    otp = app.get(OtpService);
    const staff = await prisma.staff.create({
      data: { code: `AC3CA-${suffix}`, name: 'AC3 Agent', email: `ac3_${suffix}@laboura.local`, passwordHash: 'hash', role: 'call_agent', city: 'Bengaluru' },
    });
    ids.staff = staff.id;
    agentToken = await app.get(JwtService).signAsync({ sub: staff.id, role: 'call_agent', email: staff.email, code: staff.code });
    const business = await prisma.business.create({
      data: {
        code: `BZ-AC3-${suffix}`, name: `AC3 Shop ${suffix}`, phone: `+9192${suffix}1`.slice(0, 13), phoneVerified: true,
        ownerName: 'AC3 Owner', contactRole: 'owner', leadCreatedByStaffId: staff.id, leadChannel: 'phone_call', verificationStatus: 'lead',
      },
    });
    ids.business = business.id;
    const referral = await prisma.referral.create({
      data: { code: `RF-AC3-${suffix}`, name: 'AC3 Partner', phone: `+9191${suffix}1`.slice(0, 13), phoneVerified: true, language: 'en', registeredByStaffId: staff.id },
    });
    ids.referral = referral.id;
  });

  afterAll(async () => {
    try {
      await prisma.consent.deleteMany({ where: { subjectId: { in: [...ids.seekers, ids.business, ids.referral] } } }).catch(() => undefined);
      await prisma.legalAcceptance.deleteMany({ where: { subjectId: { in: [...ids.seekers, ids.business, ids.referral] } } }).catch(() => undefined);
      await prisma.businessAgreement.deleteMany({ where: { businessId: ids.business } }).catch(() => undefined);
      await prisma.statusHistory.deleteMany({ where: { subjectId: { in: ids.seekers } } }).catch(() => undefined);
      await prisma.jobSeeker.deleteMany({ where: { id: { in: ids.seekers } } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { id: ids.business } }).catch(() => undefined);
      await prisma.referral.deleteMany({ where: { id: ids.referral } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { actorId: ids.staff } }).catch(() => undefined);
      await prisma.staff.deleteMany({ where: { id: ids.staff } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  it('staff routes that issue a public link never return its token', async () => {
    const seeker = await lead(1);
    const links = [
      () => request(server()).post('/consent/links').set(auth()).send({ jobSeekerId: seeker.id }),
      () => request(server()).post(`/businesses/${ids.business}/agreement-links`).set(auth()).send({ language: 'en' }),
      () => request(server()).post(`/referrals/${ids.referral}/terms-links`).set(auth()).send({ language: 'en' }),
    ];
    for (const send of links) {
      const { res, token } = await withIssuedLinkToken(app, send);
      expect(res.status).toBe(201);
      expect(res.body.token).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(token);
    }
  });

  it('a code the agent sent and verified through POST /otp/send opens nothing on the person’s page', async () => {
    const seeker = await lead(2);
    const { token } = await withIssuedLinkToken(app, () => request(server()).post('/consent/links').set(auth()).send({ jobSeekerId: seeker.id }).expect(201));
    // The agent sends a code to his (already registered) phone — a confirmation purpose
    // skips the "already registered" check — and he reads it out.
    const sent = await request(server()).post('/otp/send').set(auth()).send({ phone: seeker.phone, purpose: 'vacancy_confirm' });
    expect(sent.status).toBe(201);
    const staffRequestId = sent.body.requestId as string;
    await request(server()).post('/otp/verify').set(auth()).send({ requestId: staffRequestId, code: codeOf(staffRequestId) }).expect(201);
    expect(await otp.isVerified(staffRequestId, seeker.phone)).toBe(true);

    const status = await request(server()).get(`/registration/${token}/status`).query({ requestId: staffRequestId }).expect(200);
    expect(status.body.otpRequired).toBe(true);
    const details = await request(server()).get(`/consent/${token}`).query({ requestId: staffRequestId }).set('Accept', 'application/json').expect(200);
    expect(details.body.otpRequired).toBe(true);
    expect((await submitConsent(token, staffRequestId)).status).toBe(400);
    expect(await prisma.consent.count({ where: { subjectId: seeker.id, granted: true } })).toBe(0);

    // A code he asks for on his own page works.
    const own = await request(server()).post('/consent/send-otp').send({ token }).expect(201);
    expect((await submitConsent(token, own.body.requestId, codeOf(own.body.requestId))).status).toBe(201);
  });

  it('a code from one link never opens another link for the same person', async () => {
    const seeker = await lead(3);
    const links = app.get(ConsentLinkService);
    const first = await links.createLink(seeker.id, { sms: false, revokeOthers: false });
    const second = await links.createLink(seeker.id, { sms: false, revokeOthers: false });
    const fromFirst = await otp.sendPublicPageOtp(seeker.phone, first.token);
    await otp.verifyOtp(fromFirst.requestId, codeOf(fromFirst.requestId));
    expect(await otp.isVerifiedForPage(fromFirst.requestId, seeker.phone, first.token)).toBe(true);
    expect(await otp.isVerifiedForPage(fromFirst.requestId, seeker.phone, second.token)).toBe(false);
    const status = await request(server()).get(`/registration/${second.token}/status`).query({ requestId: fromFirst.requestId }).expect(200);
    expect(status.body.otpRequired).toBe(true);
    expect((await submitConsent(second.token, fromFirst.requestId)).status).toBe(400);
  });

  it('staff /otp/send cannot create a public-page code', async () => {
    const res = await request(server()).post('/otp/send').set(auth()).send({ phone: seekerPhone(4), purpose: publicPageOtpPurpose('x') });
    expect(res.status).toBe(400);
  });

  it('signing the business agreement uses the owner’s code up', async () => {
    const business = await prisma.business.findUniqueOrThrow({ where: { id: ids.business } });
    const { token } = await withIssuedLinkToken(app, () => request(server()).post(`/businesses/${ids.business}/agreement-links`).set(auth()).send({ language: 'en' }).expect(201));
    const sent = await request(server()).post('/consent/send-otp').send({ token }).expect(201);
    const requestId = sent.body.requestId as string;
    await request(server()).post('/consent/submit').send({
      token, otpRequestId: requestId, otpCode: codeOf(requestId), signedName: 'AC3 Owner',
      purposes: ['agreement_terms', 'agreement_authority', 'call_recording'],
    }).expect(201);
    expect(await otp.isVerifiedForPage(requestId, business.phone, token)).toBe(false);
    expect(await otp.isVerified(requestId, business.phone)).toBe(false);
  });
});

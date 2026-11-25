import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { AGREEMENT_DOCUMENT_STORAGE, MemoryAgreementDocumentStorage } from '../modules/consent/agreement-document.storage';
import { withIssuedLinkToken } from '../test-support/issued-link-token';
import { PrismaService } from './prisma/prisma.service';
import { publicPageLink } from './public-pages';

/**
 * Test-mode links (DEPLOY.md F12): on the hosted test site (LABOURA_SETUP=test,
 * every vendor mock, OTP test mode on) the staff request that sends a link by
 * SMS answers with the full link as `testModeLink`, because the pretend SMS
 * never arrives. Everywhere else the answer is exactly as before: no token and
 * no link (security AC-3).
 */
describe('Test-mode links on the routes that send a link by SMS', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agentToken = '';
  let ceoToken = '';
  const suffix = Date.now().toString().slice(-7);
  const ids = { agent: '', ceo: '', seekers: [] as string[], business: '', referral: '' };
  const saved: Record<string, string | undefined> = {};
  const KEYS = ['LABOURA_SETUP', 'OTP_TEST_MODE', 'NODE_ENV', 'SMS_PROVIDER_MODE', 'OTP_PROVIDER_MODE', 'WHATSAPP_PROVIDER_MODE', 'PUBLIC_APP_URL'];

  const server = () => app.getHttpServer();
  const asAgent = () => ({ Authorization: `Bearer ${agentToken}` });
  const asCeo = () => ({ Authorization: `Bearer ${ceoToken}` });

  /** Runs one request with these settings, then puts the test settings back. */
  async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const before: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
      before[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      return await fn();
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  const TEST_SITE = { LABOURA_SETUP: 'test', OTP_TEST_MODE: 'on', SMS_PROVIDER_MODE: 'mock', OTP_PROVIDER_MODE: 'mock' };

  async function lead(n: number) {
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-TML-${suffix}-${n}`, name: `TML Lead ${n}`, phone: `+9195${suffix}${n}`.slice(0, 13), status: 'lead', city: 'Bengaluru',
        minSalary: 1400000, maxSalary: 2400000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00',
        registeredByStaffId: ids.agent,
      },
    });
    ids.seekers.push(seeker.id);
    return seeker;
  }

  beforeAll(async () => {
    for (const key of KEYS) saved[key] = process.env[key];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AGREEMENT_DOCUMENT_STORAGE)
      .useValue(new MemoryAgreementDocumentStorage())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const agent = await prisma.staff.create({
      data: { code: `TMLCA-${suffix}`, name: 'TML Agent', email: `tml_ca_${suffix}@laboura.local`, passwordHash: 'hash', role: 'call_agent', city: 'Bengaluru' },
    });
    const ceo = await prisma.staff.create({
      data: { code: `TMLCEO-${suffix}`, name: 'TML Finance', email: `tml_ceo_${suffix}@laboura.local`, passwordHash: 'hash', role: 'finance', city: 'Bengaluru' },
    });
    ids.agent = agent.id;
    ids.ceo = ceo.id;
    const jwt = app.get(JwtService);
    agentToken = await jwt.signAsync({ sub: agent.id, role: 'call_agent', email: agent.email, code: agent.code });
    // Rev 211: the payout details link is Finance's send button (the CEO has none).
    ceoToken = await jwt.signAsync({ sub: ceo.id, role: 'finance', email: ceo.email, code: ceo.code });
    const business = await prisma.business.create({
      data: {
        code: `BZ-TML-${suffix}`, name: `TML Shop ${suffix}`, phone: `+9196${suffix}1`.slice(0, 13), phoneVerified: true,
        ownerName: 'TML Owner', contactRole: 'owner', leadCreatedByStaffId: agent.id, leadChannel: 'phone_call', verificationStatus: 'lead',
      },
    });
    ids.business = business.id;
    const referral = await prisma.referral.create({
      data: { code: `RF-TML-${suffix}`, name: 'TML Partner', phone: `+9197${suffix}1`.slice(0, 13), phoneVerified: true, language: 'en', registeredByStaffId: agent.id },
    });
    ids.referral = referral.id;
  });

  afterAll(async () => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: [...ids.seekers, ids.business, ids.referral] } } }).catch(() => undefined);
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: [...ids.seekers, ids.business, ids.referral] } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [ids.agent, ids.ceo] } } }).catch(() => undefined);
    await prisma.jobSeeker.deleteMany({ where: { id: { in: ids.seekers } } }).catch(() => undefined);
    await prisma.business.deleteMany({ where: { id: ids.business } }).catch(() => undefined);
    await prisma.referral.deleteMany({ where: { id: ids.referral } }).catch(() => undefined);
    await prisma.staff.deleteMany({ where: { id: { in: [ids.agent, ids.ceo] } } }).catch(() => undefined);
    await app.close();
  });

  describe('on the test site (LABOURA_SETUP=test, every vendor mock, OTP test mode on)', () => {
    it('"Send / Resend link" for a job seeker answers with the registration link, still without the token field', async () => {
      const seeker = await lead(1);
      const { res, token } = await withEnv(TEST_SITE, () =>
        withIssuedLinkToken(app, () => request(server()).post('/consent/links').set(asAgent()).send({ jobSeekerId: seeker.id }).expect(201)),
      );
      expect(res.body.token).toBeUndefined();
      expect(res.body.testModeLink).toBe(publicPageLink('registration', token));
    });

    it('the business agreement link and the referral partner terms link come back too', async () => {
      const agreement = await withEnv(TEST_SITE, () =>
        withIssuedLinkToken(app, () => request(server()).post(`/businesses/${ids.business}/agreement-links`).set(asAgent()).send({ language: 'en' }).expect(201)),
      );
      expect(agreement.res.body.token).toBeUndefined();
      expect(agreement.res.body.testModeLink).toBe(publicPageLink('businessAgreement', agreement.token));

      const terms = await withEnv(TEST_SITE, () =>
        withIssuedLinkToken(app, () => request(server()).post(`/referrals/${ids.referral}/terms-links`).set(asAgent()).send({ language: 'en' }).expect(201)),
      );
      expect(terms.res.body.token).toBeUndefined();
      expect(terms.res.body.testModeLink).toBe(publicPageLink('referralRegistration', terms.token));
    });

    it('the payout-details link sent by hand comes back as a full link', async () => {
      const res = await withEnv(TEST_SITE, () =>
        request(server()).post('/payout-accounts/links').set(asCeo()).send({ ownerType: 'referral', ownerId: ids.referral }).expect(201),
      );
      expect(res.body.linkSent).toBe(true);
      expect(res.body.testModeLink).toMatch(/^https:\/\/.+\/payout-accounts\/link\/[^/]+$/);
    });
  });

  describe('never outside the test site', () => {
    const cases: Array<[string, Record<string, string | undefined>]> = [
      ['LABOURA_SETUP=live', { ...TEST_SITE, LABOURA_SETUP: 'live' }],
      ['a real SMS vendor', { ...TEST_SITE, SMS_PROVIDER_MODE: 'real' }],
      ['a real OTP vendor', { ...TEST_SITE, OTP_PROVIDER_MODE: 'real' }],
      ['OTP test mode off', { ...TEST_SITE, OTP_TEST_MODE: 'off' }],
      // The default production config has no LABOURA_SETUP (render.yaml sets it
      // per service; NODE_ENV=production itself is covered in test-mode-link.spec.ts,
      // since staff sign-in refuses this suite's sessions in production mode).
      ['the default production config (no LABOURA_SETUP)', { ...TEST_SITE, LABOURA_SETUP: undefined }],
      // The automated suite itself (NODE_ENV=test, nothing set).
      ['the default test config', { LABOURA_SETUP: undefined, OTP_TEST_MODE: undefined }],
    ];

    it.each(cases)('%s: the registration link answer has no token and no testModeLink', async (_name, env) => {
      const seeker = await lead(2 + cases.findIndex(([name]) => name === _name));
      const res = await withEnv(env, () => request(server()).post('/consent/links').set(asAgent()).send({ jobSeekerId: seeker.id }).expect(201));
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeUndefined();
      expect(res.body.testModeLink).toBeUndefined();
      expect(res.body.testModeLinks).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/\/p\/register\//);
    });

    it.each(cases)('%s: the agreement and payout-details answers carry no link', async (_name, env) => {
      // Rev 192 S2: every agreement link shares one per-business limit; earlier links in this suite are aged out of it.
      await prisma.publicLink.updateMany({ where: { purpose: 'business_agreement', subjectId: ids.business }, data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
      const agreement = await withEnv(env, () => request(server()).post(`/businesses/${ids.business}/agreement-links`).set(asAgent()).send({ language: 'en' }).expect(201));
      expect(agreement.body.token).toBeUndefined();
      expect(agreement.body.testModeLink).toBeUndefined();
      const payout = await withEnv(env, () => request(server()).post('/payout-accounts/links').set(asCeo()).send({ ownerType: 'referral', ownerId: ids.referral }).expect(201));
      expect(payout.body.testModeLink).toBeUndefined();
      expect(JSON.stringify(payout.body)).not.toMatch(/payout-accounts\/link/);
    });
  });
});

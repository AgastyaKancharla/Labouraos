import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { jobSeekerTermsHash } from '../../test-support/terms-hash';
import { withIssuedLinkToken } from '../../test-support/issued-link-token';
import { LegalDocumentService } from '../legal/legal-document.service';
import { ConsentClock } from './consent-clock';
import { ConsentService } from './consent.service';
import { DEFAULT_NOTICE_VERSION } from './consent.constants';

class TestConsentClock extends ConsentClock {
  current = new Date('2026-11-16T10:00:00.000Z');
  override now() {
    return new Date(this.current);
  }
}

/**
 * 17 Nov (Master Guide rev 198, item 2): consent once per item, resume where he stopped. A job seeker
 * who stopped part-way and gets the link again is asked only what is still missing; an item already
 * given is not stored again; the CEO's profile shows each item and each accepted text once.
 */
describe('Consent once per item, resume on a new link (17 Nov)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: OtpService;
  let consent: ConsentService;
  const clock = new TestConsentClock();
  const staffIds: string[] = [];
  const seekerIds: string[] = [];

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConsentClock).useValue(clock).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OtpService);
    consent = app.get(ConsentService);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.legalAcceptance.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  async function ceo() {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const row = await prisma.staff.create({
      data: { code: `CO-${suffix}`, name: 'Consent once CEO', email: `co-${suffix}@laboura.local`, passwordHash: await bcrypt.hash('Consent-Password-1', 4), role: 'ceo', status: 'active' },
    });
    staffIds.push(row.id);
    return jwt.sign({ sub: row.id, role: row.role, code: row.code, email: row.email });
  }

  async function seeker() {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-CO-${suffix}`, name: `Kavya ${suffix}`, phone: `+9197${Math.floor(10000000 + Math.random() * 90000000)}`,
        trades: { create: { trade: 'Cook', isPrimary: true } }, minSalary: 1200000, maxSalary: 2200000,
        preferredCallWindowStart: '09:00', preferredCallWindowEnd: '20:00', status: 'lead',
      },
    });
    seekerIds.push(row.id);
    return row;
  }

  async function openLink(token: string, jobSeekerId: string) {
    const { token: linkToken } = await withIssuedLinkToken(app, () => request(app.getHttpServer()).post('/consent/links').set('Authorization', `Bearer ${token}`).send({ jobSeekerId }));
    const sent = await request(app.getHttpServer()).post('/consent/send-otp').send({ token: linkToken });
    const requestId = sent.body.requestId as string;
    const code = (otp.getProvider() as MockOtpProvider).getCode(requestId);
    const verified = await request(app.getHttpServer()).post(`/registration/${linkToken}/verify-otp`).send({ requestId, code });
    expect(verified.status).toBe(201);
    return { linkToken, requestId, code };
  }

  it('asks only the missing item on the second link, stores nothing twice, and the CEO profile shows each item once', async () => {
    const auth = await ceo();
    const s = await seeker();
    // The first link: four items given, then he stopped (call recording later withdrawn on a call).
    const firstAt = new Date('2026-11-10T05:12:00.000Z');
    clock.current = firstAt;
    for (const purpose of ['job_matching', 'profile_sharing', 'aadhaar_verification', 'job_updates', 'call_recording']) {
      await consent.grant({ subjectType: 'job_seeker', subjectId: s.id, purpose, noticeVersion: DEFAULT_NOTICE_VERSION, language: 'en', method: 'sms_link' });
    }
    clock.current = new Date('2026-11-11T09:00:00.000Z');
    await consent.withdraw({ subjectType: 'job_seeker', subjectId: s.id, purpose: 'call_recording', withdrawnMethod: 'agent_call' });

    // The link again: he resumes at consent, and the page is told what is already given.
    clock.current = new Date('2026-11-16T10:00:00.000Z');
    const { linkToken, requestId } = await openLink(auth, s.id);
    const status = await request(app.getHttpServer()).get(`/registration/${linkToken}/status`).query({ requestId });
    expect(status.body.currentStep).toBe('consent');
    expect([...status.body.consentGiven].sort()).toEqual(['aadhaar_verification', 'job_matching', 'job_updates', 'profile_sharing']);

    // The page sends only call recording; a page that still sends everything stores nothing twice either.
    const submit = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({ token: linkToken, otpRequestId: requestId, purposes: ['call_recording', 'job_matching'], language: 'en', textHash: await jobSeekerTermsHash(app) });
    expect(submit.status).toBe(201);
    const rows = await prisma.consent.findMany({ where: { subjectType: 'job_seeker', subjectId: s.id }, orderBy: { createdAt: 'asc' } });
    const count = (purpose: string) => rows.filter((r) => r.purpose === purpose).length;
    expect(count('job_matching')).toBe(1);
    expect(rows.find((r) => r.purpose === 'job_matching')!.grantedAt).toEqual(firstAt);
    // Re-granting after the withdrawal is a new row; the withdrawn one is kept.
    expect(count('call_recording')).toBe(2);
    expect(rows.filter((r) => r.purpose === 'call_recording').map((r) => Boolean(r.withdrawnAt))).toEqual([true, false]);
    // The acceptance names every item he has given, not only the one ticked today.
    const acceptance = await prisma.legalAcceptance.findFirstOrThrow({ where: { subjectId: s.id, context: 'registration' } });
    expect([...acceptance.purposes].sort()).toEqual(['aadhaar_verification', 'call_recording', 'job_matching', 'job_updates', 'profile_sharing']);
    const next = await request(app.getHttpServer()).get(`/registration/${linkToken}/status`).query({ requestId });
    expect(next.body.currentStep).toBe('selfie');

    // CEO profile: "Consent 5 of 5", each item once (the latest state), required list in full.
    const detail = await request(app.getHttpServer()).get(`/ceo/job-seekers/${s.id}`).set('Authorization', `Bearer ${auth}`);
    expect(detail.status).toBe(200);
    expect(detail.body.registration).toMatchObject({ consentsGranted: 5, consentsAsked: 5 });
    expect(detail.body.consents.map((c: { purpose: string }) => c.purpose)).toEqual(['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates', 'promotions']);
    expect(detail.body.consents[2]).toMatchObject({ granted: true, withdrawn: false, at: '2026-11-16T10:00:00.000Z' });
    expect(detail.body.consents[5]).toMatchObject({ required: false, granted: false, at: null });
  }, 120000);

  it('an item given only under an older notice version is asked again, and the acceptance lists only current-notice items', async () => {
    const auth = await ceo();
    const s = await seeker();
    clock.current = new Date('2026-11-01T05:00:00.000Z');
    await consent.grant({ subjectType: 'job_seeker', subjectId: s.id, purpose: 'job_matching', noticeVersion: '1.1', language: 'en', method: 'sms_link' });
    for (const purpose of ['profile_sharing', 'aadhaar_verification', 'job_updates']) {
      await consent.grant({ subjectType: 'job_seeker', subjectId: s.id, purpose, noticeVersion: DEFAULT_NOTICE_VERSION, language: 'en', method: 'sms_link' });
    }
    clock.current = new Date('2026-11-16T10:00:00.000Z');
    const { linkToken, requestId } = await openLink(auth, s.id);
    const status = await request(app.getHttpServer()).get(`/registration/${linkToken}/status`).query({ requestId });
    expect(status.body.currentStep).toBe('consent');
    expect([...status.body.consentGiven].sort()).toEqual(['aadhaar_verification', 'job_updates', 'profile_sharing']);
    const submit = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({ token: linkToken, otpRequestId: requestId, purposes: ['job_matching', 'call_recording'], language: 'en', textHash: await jobSeekerTermsHash(app) });
    expect(submit.status).toBe(201);
    // job_matching is now given under 1.2 too (a new row; the 1.1 row is kept).
    const matching = await prisma.consent.findMany({ where: { subjectId: s.id, purpose: 'job_matching' }, orderBy: { createdAt: 'asc' } });
    expect(matching.map((r) => r.noticeVersion)).toEqual(['1.1', DEFAULT_NOTICE_VERSION]);
    const acceptance = await prisma.legalAcceptance.findFirstOrThrow({ where: { subjectId: s.id, context: 'registration' } });
    expect(acceptance.noticeVersion).toBe(DEFAULT_NOTICE_VERSION);
    expect([...acceptance.purposes].sort()).toEqual(['aadhaar_verification', 'call_recording', 'job_matching', 'job_updates', 'profile_sharing']);
  }, 120000);

  it('"Consent X of Y" counts every required item, also those never recorded', async () => {
    const auth = await ceo();
    const s = await seeker();
    await consent.grant({ subjectType: 'job_seeker', subjectId: s.id, purpose: 'job_matching', noticeVersion: DEFAULT_NOTICE_VERSION, language: 'en', method: 'sms_link' });
    const detail = await request(app.getHttpServer()).get(`/ceo/job-seekers/${s.id}`).set('Authorization', `Bearer ${auth}`);
    expect(detail.body.registration).toMatchObject({ consentsGranted: 1, consentsAsked: 5 });
    expect(detail.body.consents.filter((c: { granted: boolean }) => !c.granted)).toHaveLength(5);
  }, 60000);

  it('the same terms accepted twice (a retried payment step) are listed once, with how many times; both rows stay', async () => {
    const auth = await ceo();
    const s = await seeker();
    const legal = app.get(LegalDocumentService);
    const rendered = await legal.render('job_seeker_terms', 'en');
    for (const acceptedAt of ['2026-11-10T06:00:00.000Z', '2026-11-12T06:00:00.000Z']) {
      await legal.recordAcceptance({ subjectType: 'job_seeker', subjectId: s.id, rendered, context: 'payment_terms', method: 'sms_link', otpRequestId: null, purposes: ['guarantee_terms'], acceptedAt: new Date(acceptedAt) });
    }
    await legal.recordAcceptance({ subjectType: 'job_seeker', subjectId: s.id, rendered, context: 'registration', method: 'sms_link', otpRequestId: null, purposes: [], acceptedAt: new Date('2026-11-10T05:12:00.000Z') });
    const res = await request(app.getHttpServer()).get(`/legal/acceptances/job_seeker/${s.id}`).set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    expect(res.body.acceptances.map((a: { context: string; times: number }) => [a.context, a.times])).toEqual([['payment_terms', 2], ['registration', 1]]);
    expect(res.body.acceptances[0]).toMatchObject({ acceptedAt: '2026-11-12T06:00:00.000Z', firstAcceptedAt: '2026-11-10T06:00:00.000Z' });
    expect(await prisma.legalAcceptance.count({ where: { subjectId: s.id } })).toBe(3);
  }, 60000);
});

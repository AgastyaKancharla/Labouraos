import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { generateKeyPairSync, KeyObject } from 'node:crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OTP_PROVIDER } from '../../common/otp/otp.interface';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { GoogleIdTokenVerifier } from '../customer-account/google-id-token.verifier';

jest.setTimeout(240000);

const API = '/customer-api/v1';
const GOOGLE_CLIENT = 'laboura-android.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** Google's keys, replaced by a test key pair (the real ones are fetched from Google). */
class TestGoogleVerifier extends GoogleIdTokenVerifier {
  protected async fetchKeys() {
    return { keys: [{ ...(publicKey as KeyObject).export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256' }], maxAgeMs: 3_600_000 };
  }
}

function googleToken(claims: Record<string, unknown>): string {
  const pem = (privateKey as KeyObject).export({ type: 'pkcs8', format: 'pem' }).toString();
  return new JwtService({}).sign(
    { email_verified: true, ...claims },
    { privateKey: pem, algorithm: 'RS256', keyid: 'test-kid', audience: GOOGLE_CLIENT, issuer: 'https://accounts.google.com', expiresIn: 600 },
  );
}

/**
 * The customer app API end to end against a real database: sign-in (mobile +
 * OTP, Google), linking to records an agent made, self-registration through the
 * existing services, Home, links, call me back, vacancy drafts and deletion —
 * and above all "my own records only".
 */
describe('Customer app API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otp: MockOtpProvider;
  const stamp = Date.now();
  let seq = 0;
  const phones: string[] = [];
  const savedGoogle = process.env.GOOGLE_CLIENT_ID_ANDROID;

  function newPhone(): string {
    seq += 1;
    const digits = `9${String((stamp + seq * 7919) % 1_000_000_000).padStart(9, '0')}`;
    phones.push(`+91${digits}`);
    return digits;
  }

  const http = () => request(app.getHttpServer());
  let installation = `inst-${stamp}`;
  const HUMAN = 'mock-human-ok';
  const json = (r: request.Test) => r.set('Accept', 'application/json').set('X-Laboura-Installation', installation);

  async function sendCode(phone: string): Promise<{ requestId: string; code: string }> {
    const res = await json(http().post(`${API}/auth/otp/send`)).send({ phone, humanCheckToken: HUMAN }).expect(200);
    return { requestId: res.body.requestId, code: otp.getCode(res.body.requestId)! };
  }

  async function signIn(phone: string, installationId = `dev-${phone}`) {
    const { requestId, code } = await sendCode(phone);
    const res = await json(http().post(`${API}/auth/otp/verify`))
      .send({ phone, requestId, code, device: { installationId, platform: 'android', appVersion: '1.0.0' }, language: 'kn' })
      .expect(200);
    return res.body as { accessToken: string; refreshToken: string; next: string; linked: Array<{ profileId: string; kind: string }>; account: { id: string; profiles: Array<{ id: string; kind: string }> } };
  }

  async function freshOtp(token: string, purpose: string) {
    const res = await json(http().post(`${API}/auth/step-up/send`)).set('Authorization', `Bearer ${token}`).send({ purpose, humanCheckToken: HUMAN }).expect(200);
    return { requestId: res.body.requestId as string, code: otp.getCode(res.body.requestId)! };
  }

  async function stepUp(token: string, purpose: string) {
    const { requestId, code } = await freshOtp(token, purpose);
    await json(http().post(`${API}/auth/step-up/verify`)).set('Authorization', `Bearer ${token}`).send({ purpose, requestId, code }).expect(200);
  }

  const auth = (r: request.Test, token: string) => json(r).set('Authorization', `Bearer ${token}`);

  async function agentJobSeeker(phone: string, extra: Record<string, unknown> = {}) {
    return prisma.jobSeeker.create({
      data: {
        code: `JS-T${stamp % 100000}${seq}${Math.floor(Math.random() * 1000)}`,
        name: 'Ravi Kumar Test',
        phone: `+91${phone}`,
        phoneVerified: true,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID_ANDROID = GOOGLE_CLIENT;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleIdTokenVerifier)
      .useClass(TestGoogleVerifier)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    otp = app.get(OTP_PROVIDER);
  });

  beforeEach(async () => {
    // Only this suite sends customer OTPs; every test starts under the limits, on its own phone.
    await prisma.customerOtpAttempt.deleteMany({ where: { kind: { in: ['send', 'verify_failed'] } } });
    seq += 1;
    installation = `inst-${stamp}-${seq}`;
  });

  afterAll(async () => {
    process.env.GOOGLE_CLIENT_ID_ANDROID = savedGoogle;
    const accounts = await prisma.customerAccount.findMany({ where: { phone: { in: phones } }, select: { id: true } });
    const ids = accounts.map((a) => a.id);
    await prisma.signupTracker.deleteMany({ where: { accountId: { in: ids } } });
    await prisma.customerAccount.deleteMany({ where: { id: { in: ids } } });
    // Records made through the real services carry sequential JS-/BZ-/RF-/VC- codes
    // that the seed script also uses: remove them so later suites can seed.
    const seekers = await prisma.jobSeeker.findMany({ where: { phone: { in: phones } }, select: { id: true } });
    await prisma.jobSeeker.updateMany({ where: { referredBy: { phone: { in: phones } } }, data: { referredById: null } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekers.map((s) => s.id) } } });
    await prisma.referral.deleteMany({ where: { phone: { in: phones } } });
    const businesses = await prisma.business.findMany({ where: { OR: [{ phone: { in: phones } }, { additionalContactPhone: { in: phones } }] }, select: { id: true } });
    const businessIds = businesses.map((b) => b.id);
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await app.close();
  });

  describe('sign-in with mobile + OTP', () => {
    it('creates an account, then asks for a role', async () => {
      const phone = newPhone();
      const session = await signIn(phone);
      expect(session.next).toBe('choose_role');
      expect(session.refreshToken).toEqual(expect.any(String));
      const me = await auth(http().get(`${API}/me`), session.accessToken).expect(200);
      expect(me.body).toEqual(expect.objectContaining({ phone: `+91${phone}`, phoneVerified: true, language: 'kn', profiles: [] }));
      const stored = await prisma.customerSession.findFirstOrThrow({ where: { accountId: me.body.id } });
      expect(stored.refreshTokenHash).not.toContain(session.refreshToken);
      expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(89 * 86_400_000);
    });

    it('refuses a wrong code and says how many tries are left', async () => {
      const phone = newPhone();
      const { requestId } = await sendCode(phone);
      const res = await json(http().post(`${API}/auth/otp/verify`)).send({ phone, requestId, code: '000000' }).expect(400);
      expect(res.body).toEqual(expect.objectContaining({ code: 'OTP_INVALID', attemptsLeft: expect.any(Number) }));
    });

    it('a code cannot be used twice', async () => {
      const phone = newPhone();
      const { requestId, code } = await sendCode(phone);
      await json(http().post(`${API}/auth/otp/verify`)).send({ phone, requestId, code }).expect(200);
      const again = await json(http().post(`${API}/auth/otp/verify`)).send({ phone, requestId, code }).expect(400);
      expect(['OTP_INVALID', 'OTP_EXPIRED']).toContain(again.body.code);
    });

    it('asks for a human check after 3 codes, then limits codes per phone (5 an hour)', async () => {
      const phone = newPhone();
      for (let i = 0; i < 3; i += 1) await json(http().post(`${API}/auth/otp/send`)).send({ phone }).expect(200);
      const human = await json(http().post(`${API}/auth/otp/send`)).send({ phone }).expect(403);
      expect(human.body).toEqual(expect.objectContaining({ code: 'HUMAN_CHECK_REQUIRED', provider: 'mock' }));
      for (let i = 0; i < 2; i += 1) await json(http().post(`${API}/auth/otp/send`)).send({ phone, humanCheckToken: HUMAN }).expect(200);
      const res = await json(http().post(`${API}/auth/otp/send`)).send({ phone, humanCheckToken: HUMAN }).expect(429);
      expect(res.body).toEqual(expect.objectContaining({ code: 'OTP_LIMIT', retryAfterSeconds: expect.any(Number) }));
    });

    it('never returns the code unless the customer OTP test mode is on (C1)', async () => {
      const res = await json(http().post(`${API}/auth/otp/send`)).send({ phone: newPhone() }).expect(200);
      expect(res.body.testModeCode).toBeUndefined();
      const config = await json(http().get(`${API}/config`)).expect(200);
      expect(config.body.otpTestMode).toBe(false);
    });

    it('needs the installation id to send a code', async () => {
      const res = await request(app.getHttpServer()).post(`${API}/auth/otp/send`).set('Accept', 'application/json').send({ phone: newPhone() }).expect(400);
      expect(res.body.code).toBe('INSTALLATION_REQUIRED');
    });

    it('a code sent for an agent flow never signs anyone in (H1)', async () => {
      const phone = newPhone();
      const agentCode = await otp.sendOtp(`+91${phone}`, { purpose: 'vacancy_confirm' });
      const res = await json(http().post(`${API}/auth/otp/verify`))
        .send({ phone, requestId: agentCode.requestId, code: otp.getCode(agentCode.requestId) }).expect(400);
      expect(res.body.code).toBe('OTP_EXPIRED');
      expect(await prisma.customerAccount.count({ where: { phone: `+91${phone}` } })).toBe(0);
    });

    it('a code works only on the installation that asked for it', async () => {
      const phone = newPhone();
      const { requestId, code } = await sendCode(phone);
      installation = `other-${stamp}-${seq}`;
      const res = await json(http().post(`${API}/auth/otp/verify`)).send({ phone, requestId, code }).expect(400);
      expect(res.body.code).toBe('OTP_INVALID');
    });

    it('a code for one number tried with another number does not count against that number (H2)', async () => {
      const victim = newPhone();
      const mine = newPhone();
      const { requestId, code } = await sendCode(mine);
      const res = await json(http().post(`${API}/auth/otp/verify`)).send({ phone: victim, requestId, code }).expect(400);
      expect(res.body.code).toBe('OTP_INVALID');
      const { customerPhoneHash } = await import('../customer-account/customer-otp-limiter.service');
      expect(await prisma.customerOtpAttempt.count({ where: { kind: 'verify_failed', phoneHash: customerPhoneHash(`+91${victim}`) } })).toBe(0);
      expect(await prisma.customerOtpAttempt.count({ where: { kind: 'verify_failed', phoneHash: null } })).toBeGreaterThan(0);
    });

    it('refuses codes that are not 6 digits', async () => {
      const phone = newPhone();
      const { requestId } = await sendCode(phone);
      const res = await json(http().post(`${API}/auth/otp/verify`)).send({ phone, requestId, code: '1234' }).expect(400);
      expect(res.body.code).toBe('OTP_INVALID');
    });

    it('rejects a number that is not a 10-digit Indian mobile', async () => {
      const res = await json(http().post(`${API}/auth/otp/send`)).send({ phone: '12345' }).expect(400);
      expect(res.body.code).toBe('PHONE_INVALID');
    });
  });

  describe('sessions', () => {
    it('renews with the refresh token; a reused refresh token ends the session', async () => {
      const session = await signIn(newPhone());
      const renewed = await json(http().post(`${API}/auth/refresh`)).send({ refreshToken: session.refreshToken }).expect(200);
      expect(renewed.body.refreshToken).not.toBe(session.refreshToken);
      await auth(http().get(`${API}/me`), renewed.body.accessToken).expect(200);
      // Within 30 seconds on the same phone (two renewals at once): a new access token, no new refresh token.
      const grace = await json(http().post(`${API}/auth/refresh`)).send({ refreshToken: session.refreshToken }).expect(200);
      expect(grace.body.refreshToken).toBeNull();
      // Another phone can never use it.
      const savedInstallation = installation;
      installation = `thief-${stamp}-${seq}`;
      await json(http().post(`${API}/auth/refresh`)).send({ refreshToken: renewed.body.refreshToken }).expect(401);
      installation = savedInstallation;
      // Later, the old token again means it was copied: the session ends.
      await prisma.customerSession.updateMany({ where: { accountId: session.account.id }, data: { lastUsedAt: new Date(Date.now() - 120_000) } });
      const reused = await json(http().post(`${API}/auth/refresh`)).send({ refreshToken: session.refreshToken }).expect(401);
      expect(reused.body.code).toBe('CUSTOMER_REFRESH_INVALID');
      // The copied token ended the session: the latest one no longer works either.
      await json(http().post(`${API}/auth/refresh`)).send({ refreshToken: renewed.body.refreshToken }).expect(401);
      const ended = await auth(http().get(`${API}/me`), renewed.body.accessToken).expect(401);
      expect(ended.body.code).toBe('CUSTOMER_SESSION_ENDED');
    });

    it('sign-out ends the session and removes the push token', async () => {
      const session = await signIn(newPhone());
      const device = await prisma.customerDevice.findFirstOrThrow({ where: { accountId: session.account.id } });
      await prisma.customerDevice.update({ where: { id: device.id }, data: { pushToken: `ExponentPushToken[${stamp}-${seq}]` } });
      await auth(http().post(`${API}/auth/sign-out`), session.accessToken).expect(204);
      await auth(http().get(`${API}/me`), session.accessToken).expect(401);
      expect((await prisma.customerDevice.findUniqueOrThrow({ where: { id: device.id } })).pushToken).toBeNull();
    });

    it('a second sign-in on the same phone replaces the first session', async () => {
      const phone = newPhone();
      const first = await signIn(phone, 'same-phone');
      await signIn(phone, 'same-phone');
      await auth(http().get(`${API}/me`), first.accessToken).expect(401);
    });
  });

  describe('linking to records an agent made', () => {
    it('links the job seeker with the same verified mobile, never a second record', async () => {
      const phone = newPhone();
      const seeker = await agentJobSeeker(phone);
      const session = await signIn(phone);
      expect(session.linked).toEqual([expect.objectContaining({ kind: 'job_seeker', linkedVia: 'phone_match' })]);
      expect(session.next).toBe('home');
      const profileId = session.linked[0]!.profileId;
      const home = await auth(http().get(`${API}/me/profiles/${profileId}/home`), session.accessToken).expect(200);
      expect(home.body).toEqual(expect.objectContaining({ kind: 'job_seeker', code: seeker.code, firstName: 'Ravi' }));
      // Signing in again links nothing new.
      const again = await signIn(phone);
      expect(again.linked).toEqual([]);
      expect(await prisma.jobSeeker.count({ where: { phone: `+91${phone}` } })).toBe(1);
    });
  });

  describe('my own records only', () => {
    it('another account gets 404 for my profile, my links and my drafts', async () => {
      const mine = newPhone();
      await agentJobSeeker(mine);
      const me = await signIn(mine);
      const myProfile = me.linked[0]!.profileId;
      const other = await signIn(newPhone());
      for (const [method, path, body] of [
        ['get', `${API}/me/profiles/${myProfile}/home`, undefined],
        ['post', `${API}/me/profiles/${myProfile}/links`, { purpose: 'registration' }],
        ['post', `${API}/me/profiles/${myProfile}/vacancy-drafts`, { form: { tradeSkill: 'Cook' } }],
      ] as const) {
        const call = method === 'get' ? http().get(path) : http().post(path).send(body ?? {});
        const res = await auth(call, other.accessToken).expect(404);
        expect(res.body.code).toBe('PROFILE_NOT_FOUND');
      }
      const lastProfile = await auth(http().put(`${API}/me/last-profile`), other.accessToken).send({ profileId: myProfile }).expect(404);
      expect(lastProfile.body.code).toBe('PROFILE_NOT_FOUND');
    });

    it('a staff token opens no customer route and a customer token no staff route', async () => {
      const session = await signIn(newPhone());
      await json(http().get('/job-seekers')).set('Authorization', `Bearer ${session.accessToken}`).expect(401);
      const staffToken = app.get(JwtService).sign({ sub: 'x', role: 'ceo', email: null, code: 'CEO-X' });
      const res = await json(http().get(`${API}/me`)).set('Authorization', `Bearer ${staffToken}`).expect(401);
      expect(res.body.code).toBe('CUSTOMER_TOKEN_INVALID');
    });
  });

  describe('self-registration', () => {
    const jobSeekerForm = {
      name: 'Meena Devi',
      messageLanguage: 'kn',
      bestTimeToCall: '09-21',
      gender: 'female',
      locality: 'Indiranagar',
      pincode: '560038',
      latitude: 12.9784,
      longitude: 77.6408,
      travelDistanceKm: 10,
      trades: [{ trade: 'Housekeeping', yearsExperience: 2 }],
      availableFrom: '2026-12-01',
      lookingSince: '2026-11-01',
      minSalary: 1500000,
      maxSalary: 2000000,
      salaryPeriod: 'monthly',
      shiftPreference: 'any',
      jobType: 'full_time',
      spokenLanguages: ['Kannada'],
    };

    it('stops under-18s at the age step, before anything is saved', async () => {
      const session = await signIn(newPhone());
      const year = new Date().getUTCFullYear() - 16;
      const res = await auth(http().post(`${API}/me/register/age-check`), session.accessToken).send({ dateOfBirth: `${year}-01-01` }).expect(422);
      expect(res.body.code).toBe('UNDER_18');
      const form = await auth(http().post(`${API}/me/register/job-seeker`), session.accessToken)
        .send({ ...jobSeekerForm, dateOfBirth: `${year}-01-01` }).expect(422);
      expect(form.body.code).toBe('UNDER_18');
      await auth(http().post(`${API}/me/register/age-check`), session.accessToken).send({ dateOfBirth: '1995-05-17' }).expect(200);
    });

    it('registers a job seeker through the existing service with a fresh OTP, tracked at stage B', async () => {
      const phone = newPhone();
      const session = await signIn(phone);
      const started = await auth(http().post(`${API}/me/signups`), session.accessToken).send({ kind: 'job_seeker', source: 'store', contactMe: true }).expect(201);
      expect(started.body).toEqual(expect.objectContaining({ kind: 'job_seeker', stage: 'A' }));
      const noOtp = await auth(http().post(`${API}/me/register/job-seeker`), session.accessToken).send({ ...jobSeekerForm, dateOfBirth: '1995-05-17' }).expect(400);
      expect(noOtp.body.code).toBe('OTP_INVALID');
      const code = await freshOtp(session.accessToken, 'register');
      const res = await auth(http().post(`${API}/me/register/job-seeker`), session.accessToken)
        .send({ ...jobSeekerForm, dateOfBirth: '1995-05-17', phone: '9000000000', otp: code })
        .expect(201);
      expect(res.body).toEqual(expect.objectContaining({ kind: 'job_seeker', status: 'lead', next: 'registration_link' }));
      const seeker = await prisma.jobSeeker.findUniqueOrThrow({ where: { code: res.body.code } });
      // The mobile is the account's verified one, never the one in the body.
      expect(seeker.phone).toBe(`+91${phone}`);
      expect(seeker.registeredByStaffId).toBeNull();
      expect(seeker.heardFrom).toBe('laboura_app');
      const tracker = await prisma.signupTracker.findFirstOrThrow({ where: { id: started.body.signupId } });
      expect(tracker).toEqual(expect.objectContaining({ stage: 'B', subjectType: 'job_seeker', subjectId: seeker.id, contactConsent: true }));
      // One code, one record.
      const again = await auth(http().post(`${API}/me/register/job-seeker`), session.accessToken)
        .send({ ...jobSeekerForm, dateOfBirth: '1995-05-17', otp: code }).expect(409);
      expect(again.body).toEqual(expect.objectContaining({ code: 'PROFILE_EXISTS', profileId: res.body.profileId }));
      // The registration link opens in the app without an SMS.
      const link = await auth(http().post(`${API}/me/profiles/${res.body.profileId}/links`), session.accessToken).send({ purpose: 'registration' }).expect(201);
      expect(link.body.url).toMatch(/\/p\/register\//);
      const home = await auth(http().get(`${API}/me/profiles/${res.body.profileId}/home`), session.accessToken).expect(200);
      expect(home.body).toEqual(expect.objectContaining({ currentStep: 'consent', nextAction: 'open_registration_link', interview: null }));
      expect(home.body.payment.state).toBe('not_started');
    });

    it('a Google account must verify a mobile before any profile', async () => {
      const sub = `google-${stamp}-${seq}`;
      const res = await json(http().post(`${API}/auth/google`))
        .send({ idToken: googleToken({ sub, email: `t${seq}@example.com`, name: 'Test Owner' }), device: { installationId: `g-${sub}`, platform: 'android' } })
        .expect(200);
      expect(res.body.next).toBe('add_phone');
      const blocked = await auth(http().post(`${API}/me/signups`), res.body.accessToken).send({ kind: 'business' }).expect(403);
      expect(blocked.body.code).toBe('PHONE_NOT_VERIFIED');
      const phone = newPhone();
      await agentJobSeeker(phone);
      const sent = await auth(http().post(`${API}/auth/phone/send`), res.body.accessToken).send({ phone, humanCheckToken: HUMAN }).expect(200);
      const added = await auth(http().post(`${API}/auth/phone/verify`), res.body.accessToken)
        .send({ phone, requestId: sent.body.requestId, code: otp.getCode(sent.body.requestId) })
        .expect(200);
      expect(added.body.linked).toEqual([expect.objectContaining({ kind: 'job_seeker' })]);
      // Next time, Google or the mobile both open the same account.
      const byPhone = await signIn(phone);
      expect(byPhone.account.id).toBe(res.body.account.id);
    });

    it('refuses a Google token for another app', async () => {
      const token = new JwtService({}).sign(
        { sub: 'x', email_verified: true },
        { privateKey: (privateKey as KeyObject).export({ type: 'pkcs8', format: 'pem' }).toString(), algorithm: 'RS256', keyid: 'test-kid', audience: 'someone-else', issuer: 'accounts.google.com', expiresIn: 600 },
      );
      const res = await json(http().post(`${API}/auth/google`)).send({ idToken: token }).expect(401);
      expect(res.body.code).toBe('GOOGLE_TOKEN_INVALID');
    });

    it('registers a business as a lead with a visit request, then a vacancy confirmed by fresh OTP', async () => {
      const phone = newPhone();
      const session = await signIn(phone);
      const otpCode = await freshOtp(session.accessToken, 'register');
      const res = await auth(http().post(`${API}/me/register/business`), session.accessToken)
        .send({
          name: `App Bakery ${seq}`, contactPersonName: 'Lakshmi', contactPersonRole: 'owner', businessType: 'bakery',
          locality: 'Jayanagar', pincode: '560041', latitude: 12.93, longitude: 77.58, noDocuments: true,
          visitPreferredAt: new Date(Date.now() + 86_400_000).toISOString(), contactMe: true, otp: otpCode,
        })
        .expect(201);
      expect(res.body).toEqual(expect.objectContaining({ kind: 'business', verificationStatus: 'lead', next: 'agreement' }));
      const business = await prisma.business.findUniqueOrThrow({ where: { code: res.body.code } });
      expect(business).toEqual(expect.objectContaining({ leadCreatedByStaffId: null, leadChannel: 'laboura_app', heardFrom: 'laboura_app' }));
      const visit = await prisma.visitAssignment.findFirstOrThrow({ where: { businessId: business.id } });
      expect(visit).toEqual(expect.objectContaining({ purpose: 'business_signup', status: 'pending', requestedFor: expect.any(Date), signupTrackerId: expect.any(String) }));

      const home = await auth(http().get(`${API}/me/profiles/${res.body.profileId}/home`), session.accessToken).expect(200);
      expect(home.body).toEqual(expect.objectContaining({ kind: 'business', nextAction: 'sign_agreement', vacancies: [] }));
      // No phone number anywhere (ids are random UUIDs, whose last group can hold 10+ digits by chance: left out).
      expect(JSON.stringify(home.body).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')).not.toMatch(/\+91|\d{10}/);
      const agreement = await auth(http().post(`${API}/me/profiles/${res.body.profileId}/links`), session.accessToken).send({ purpose: 'business_agreement' }).expect(201);
      expect(agreement.body.url).toMatch(/\/p\/agreement\//);

      const draft = await auth(http().post(`${API}/me/profiles/${res.body.profileId}/vacancy-drafts`), session.accessToken)
        .send({ form: { tradeSkill: 'Helper', headcount: 1, salaryMinPaise: 1000000, salaryMaxPaise: 1200000, salaryPeriod: 'monthly', shift: 'day' } })
        .expect(201);
      expect(draft.body.warnings).toEqual(expect.objectContaining({ belowLegalMinimum: true, legalMinimumPaise: expect.any(Number) }));
      const path = `${API}/me/profiles/${res.body.profileId}/vacancy-drafts/${draft.body.id}/confirm`;
      const noTick = await auth(http().post(path), session.accessToken).send({}).expect(409);
      expect(noTick.body.code).toBe('BELOW_MINIMUM_WAGE_TICK_REQUIRED');
      const noOtp = await auth(http().post(path), session.accessToken).send({ ownerToldMinimumWage: true }).expect(403);
      expect(noOtp.body).toEqual(expect.objectContaining({ code: 'STEP_UP_REQUIRED', purpose: 'confirm_vacancy' }));
      await stepUp(session.accessToken, 'confirm_vacancy');
      const confirmed = await auth(http().post(path), session.accessToken).send({ ownerToldMinimumWage: true }).expect(201);
      expect(confirmed.body.vacancy).toEqual(expect.objectContaining({ status: 'open' }));
      const vacancy = await prisma.vacancy.findUniqueOrThrow({ where: { code: confirmed.body.vacancy.code } });
      expect(vacancy).toEqual(expect.objectContaining({ belowLegalMinimum: true, ownerToldMinimumWage: true, confirmationMethod: 'in_app', capturedByStaffId: null }));
    });

    it('registers a referral partner; Home shows referred people by first name and stage only', async () => {
      const phone = newPhone();
      const session = await signIn(phone);
      const otpCode = await freshOtp(session.accessToken, 'register');
      const res = await auth(http().post(`${API}/me/register/referral`), session.accessToken)
        .send({ name: 'Manju Gowda', type: 'individual', individualRole: 'auto_driver', whatsappPhone: phone, language: 'kn', locality: 'Jayanagar', pincode: '560041', otp: otpCode })
        .expect(201);
      const referral = await prisma.referral.findUniqueOrThrow({ where: { code: res.body.code } });
      expect(referral.registeredByStaffId).toBeNull();
      await agentJobSeeker(newPhone(), { name: 'Suresh Kumar Rao', referredById: referral.id, paymentReceivedAt: new Date() });
      const home = await auth(http().get(`${API}/me/profiles/${res.body.profileId}/home`), session.accessToken).expect(200);
      expect(home.body.referred).toEqual([expect.objectContaining({ firstName: 'Suresh', stage: 'paid' })]);
      expect(JSON.stringify(home.body.referred)).not.toMatch(/Kumar|Rao|\+91|phone/);
      expect(home.body.share.link).toContain(referral.code);
      // Referring yourself is refused.
      const selfRef = await auth(http().post(`${API}/me/register/job-seeker`), session.accessToken)
        .send({ dateOfBirth: '1995-05-17', referralCode: referral.code, otp: await freshOtp(session.accessToken, 'register') })
        .expect(422);
      expect(selfRef.body.code).toBe('REFERRAL_SELF');
    });
  });

  describe('call me back', () => {
    it('keeps one open request per account', async () => {
      const session = await signIn(newPhone());
      const first = await auth(http().post(`${API}/me/callback-requests`), session.accessToken).send({ topic: 'signup', preferredFrom: '18:00', preferredTo: '21:00' }).expect(201);
      const second = await auth(http().post(`${API}/me/callback-requests`), session.accessToken).send({ topic: 'payment' }).expect(200);
      expect(second.body.id).toBe(first.body.id);
      const bad = await auth(http().post(`${API}/me/callback-requests`), session.accessToken).send({ topic: 'signup', preferredFrom: '22:00' }).expect(400);
      expect(bad.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('delete my account', () => {
    it('needs a fresh OTP and, during a running guarantee, the refund warning', async () => {
      const phone = newPhone();
      await agentJobSeeker(phone, { status: 'active', paymentReceivedAt: new Date() });
      const session = await signIn(phone);
      const info = await auth(http().get(`${API}/me/deletion`), session.accessToken).expect(200);
      expect(info.body).toEqual(expect.objectContaining({ guaranteeRunning: true, endsRefund: true, openRequest: null }));
      const warn = await auth(http().post(`${API}/me/deletion`), session.accessToken).send({}).expect(409);
      expect(warn.body.code).toBe('GUARANTEE_WARNING_REQUIRED');
      const noOtp = await auth(http().post(`${API}/me/deletion`), session.accessToken).send({ refundLossAcknowledged: true }).expect(403);
      expect(noOtp.body.code).toBe('STEP_UP_REQUIRED');
      await stepUp(session.accessToken, 'delete_account');
      const phoneRow = await prisma.customerDevice.findFirstOrThrow({ where: { accountId: session.account.id } });
      await prisma.customerDevice.update({ where: { id: phoneRow.id }, data: { pushToken: `ExponentPushToken[del-${stamp}-${seq}]` } });
      const done = await auth(http().post(`${API}/me/deletion`), session.accessToken).send({ refundLossAcknowledged: true }).expect(201);
      expect(done.body.status).toBe('requested');
      const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id: session.account.id } });
      expect(account.status).toBe('deletion_requested');
      // No phone of an account being deleted keeps a push token, the requesting one included.
      expect(await prisma.customerDevice.count({ where: { accountId: session.account.id, pushToken: { not: null } } })).toBe(0);
      const row = await prisma.customerDeletionRequest.findUniqueOrThrow({ where: { id: done.body.id } });
      expect(row).toEqual(expect.objectContaining({ guaranteeRunning: true, refundLossAcknowledged: true }));
      const twice = await auth(http().post(`${API}/me/deletion`), session.accessToken).send({ refundLossAcknowledged: true }).expect(409);
      expect(twice.body.code).toBe('DELETION_PENDING');
    });
  });

  describe('security review follow-ups', () => {
    it('a profile is revoked when the agent changes the phone on the record (M1)', async () => {
      const phone = newPhone();
      const seeker = await agentJobSeeker(phone);
      const session = await signIn(phone);
      const profileId = session.linked[0]!.profileId;
      await auth(http().get(`${API}/me/profiles/${profileId}/home`), session.accessToken).expect(200);
      await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { phone: `+91${newPhone()}` } });
      const res = await auth(http().get(`${API}/me/profiles/${profileId}/home`), session.accessToken).expect(404);
      expect(res.body.code).toBe('PROFILE_NOT_FOUND');
      const me = await auth(http().get(`${API}/me`), session.accessToken).expect(200);
      expect(me.body.profiles).toEqual([]);
      expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: profileId } })).status).toBe('revoked');
    });

    it('an unverified "additional contact" number links no business (M1)', async () => {
      const phone = newPhone();
      await prisma.business.create({
        data: { code: `BZ-T${stamp % 100000}${seq}`, name: 'Other Shop', phone: `+91${newPhone()}`, additionalContactPhone: `+91${phone}` },
      });
      const session = await signIn(phone);
      expect(session.linked).toEqual([]);
    });

    it('a step-up code for one action cannot be used for another (H1)', async () => {
      const session = await signIn(newPhone());
      const code = await freshOtp(session.accessToken, 'delete_account');
      const res = await auth(http().post(`${API}/auth/step-up/verify`), session.accessToken)
        .send({ purpose: 'confirm_vacancy', requestId: code.requestId, code: code.code }).expect(400);
      expect(res.body.code).toBe('OTP_INVALID');
    });

    it('a deletion can be cancelled; while pending, no links, no drafts and no new phones (M4)', async () => {
      const phone = newPhone();
      await agentJobSeeker(phone);
      const session = await signIn(phone);
      const profileId = session.linked[0]!.profileId;
      await stepUp(session.accessToken, 'delete_account');
      await auth(http().post(`${API}/me/deletion`), session.accessToken).send({}).expect(201);
      const link = await auth(http().post(`${API}/me/profiles/${profileId}/links`), session.accessToken).send({ purpose: 'registration' }).expect(409);
      expect(link.body.code).toBe('DELETION_PENDING');
      const savedInstallation = installation;
      installation = `new-phone-${stamp}-${seq}`;
      const { requestId, code } = await sendCode(phone);
      const newPhoneSignIn = await json(http().post(`${API}/auth/otp/verify`)).send({ phone, requestId, code }).expect(409);
      expect(newPhoneSignIn.body.code).toBe('DELETION_PENDING');
      installation = savedInstallation;
      const cancelled = await auth(http().post(`${API}/me/deletion/cancel`), session.accessToken).expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      expect((await prisma.customerAccount.findUniqueOrThrow({ where: { id: session.account.id } })).status).toBe('active');
      await auth(http().post(`${API}/me/profiles/${profileId}/links`), session.accessToken).send({ purpose: 'registration' }).expect(201);
    });

    it('a Google-only account deletes with a fresh Google sign-in as proof (M4)', async () => {
      const sub = `google-del-${stamp}-${seq}`;
      const signedIn = await json(http().post(`${API}/auth/google`)).send({ idToken: googleToken({ sub, email: `d${seq}@example.com` }) }).expect(200);
      const info = await auth(http().get(`${API}/me/deletion`), signedIn.body.accessToken).expect(200);
      expect(info.body).toEqual(expect.objectContaining({ proof: 'google', warningRequired: false }));
      const noProof = await auth(http().post(`${API}/me/deletion`), signedIn.body.accessToken).send({}).expect(403);
      expect(noProof.body.code).toBe('STEP_UP_REQUIRED');
      const otherSub = await auth(http().post(`${API}/me/deletion`), signedIn.body.accessToken)
        .send({ proof: { provider: 'google', idToken: googleToken({ sub: `${sub}-other` }) } }).expect(403);
      expect(otherSub.body.code).toBe('STEP_UP_REQUIRED');
      const done = await auth(http().post(`${API}/me/deletion`), signedIn.body.accessToken)
        .send({ proof: { provider: 'google', idToken: googleToken({ sub }) } }).expect(201);
      expect((await prisma.customerDeletionRequest.findUniqueOrThrow({ where: { id: done.body.id } })).proof).toBe('google');
      await prisma.customerAccount.update({ where: { id: signedIn.body.account.id }, data: { phone: `+91${newPhone()}` } });
    });

    it('serves the form options and my documents', async () => {
      const session = await signIn(newPhone());
      const options = await auth(http().get(`${API}/me/form-options`), session.accessToken).expect(200);
      expect(options.body).toEqual(expect.objectContaining({
        areas: expect.any(Array), trades: expect.any(Array), legalMinimumWagePaise: expect.objectContaining({ unskilled: expect.any(Number) }),
      }));
      expect(options.body.business.businessTypes).not.toContain('household');
      const phone = newPhone();
      const partner = await signIn(phone);
      const code = await freshOtp(partner.accessToken, 'register');
      const reg = await auth(http().post(`${API}/me/register/referral`), partner.accessToken)
        .send({ name: 'Docs Partner', type: 'individual', individualRole: 'other', whatsappPhone: phone, language: 'en', locality: 'Jayanagar', pincode: '560041', otp: code })
        .expect(201);
      const docs = await auth(http().get(`${API}/me/profiles/${reg.body.profileId}/documents`), partner.accessToken).expect(200);
      expect(docs.body).toEqual({ consents: [], documents: [] });
      await auth(http().get(`${API}/me/profiles/${reg.body.profileId}/documents/referral_terms`), partner.accessToken).expect(404);
      await auth(http().get(`${API}/me/profiles/${reg.body.profileId}/documents`), session.accessToken).expect(404);
    });

    it('a send the provider refuses does not use up the person\'s codes (N1)', async () => {
      const phone = newPhone();
      const { requestId } = await sendCode(phone);
      // The mock sender refuses a resend within 30 seconds.
      await json(http().post(`${API}/auth/otp/send`)).send({ phone, requestId, humanCheckToken: HUMAN }).expect(400);
      const { customerPhoneHash } = await import('../customer-account/customer-otp-limiter.service');
      expect(await prisma.customerOtpAttempt.count({ where: { kind: 'send', phoneHash: customerPhoneHash(`+91${phone}`) } })).toBe(1);
    });

    it('Google sign-in and refresh need the installation id (N2)', async () => {
      const google = await request(app.getHttpServer()).post(`${API}/auth/google`).set('Accept', 'application/json')
        .send({ idToken: googleToken({ sub: `no-inst-${stamp}-${seq}` }) }).expect(400);
      expect(google.body.code).toBe('INSTALLATION_REQUIRED');
      const session = await signIn(newPhone());
      const refresh = await request(app.getHttpServer()).post(`${API}/auth/refresh`).set('Accept', 'application/json')
        .send({ refreshToken: session.refreshToken }).expect(400);
      expect(refresh.body.code).toBe('INSTALLATION_REQUIRED');
    });

    it('above the daily limit the service degrades: everyone gets the human check, known customers and new numbers still get codes (N3, INF-4)', async () => {
      const existing = newPhone();
      await signIn(existing);
      const saved = process.env.CUSTOMER_OTP_DAILY_LIMIT;
      process.env.CUSTOMER_OTP_DAILY_LIMIT = '1';
      try {
        const fresh = newPhone();
        installation = `breaker-a-${stamp}-${seq}`;
        const asked = await json(http().post(`${API}/auth/otp/send`)).send({ phone: fresh }).expect(403);
        expect(asked.body.code).toBe('HUMAN_CHECK_REQUIRED');
        await json(http().post(`${API}/auth/otp/send`)).send({ phone: fresh, humanCheckToken: HUMAN }).expect(200);
        installation = `breaker-b-${stamp}-${seq}`;
        await json(http().post(`${API}/auth/otp/send`)).send({ phone: existing }).expect(403);
        await json(http().post(`${API}/auth/otp/send`)).send({ phone: existing, humanCheckToken: HUMAN }).expect(200);
      } finally {
        if (saved === undefined) delete process.env.CUSTOMER_OTP_DAILY_LIMIT;
        else process.env.CUSTOMER_OTP_DAILY_LIMIT = saved;
      }
    });

    it('asks for the human check by address after 3 different numbers in an hour (INF-4)', async () => {
      // Each number from its own installation: only the address links them.
      for (let i = 0; i < 3; i += 1) {
        installation = `addr-${stamp}-${seq}-${i}`;
        await json(http().post(`${API}/auth/otp/send`)).send({ phone: newPhone() }).expect(200);
      }
      installation = `addr-${stamp}-${seq}-last`;
      const fourth = newPhone();
      const asked = await json(http().post(`${API}/auth/otp/send`)).send({ phone: fourth }).expect(403);
      expect(asked.body).toEqual(expect.objectContaining({ code: 'HUMAN_CHECK_REQUIRED' }));
      await json(http().post(`${API}/auth/otp/send`)).send({ phone: fourth, humanCheckToken: HUMAN }).expect(200);
    });

    it('the number of different numbers before the address check is a setting', async () => {
      const saved = process.env.CUSTOMER_OTP_ADDRESS_PHONES_BEFORE_CHECK;
      process.env.CUSTOMER_OTP_ADDRESS_PHONES_BEFORE_CHECK = '1';
      try {
        installation = `addr1-${stamp}-${seq}-a`;
        await json(http().post(`${API}/auth/otp/send`)).send({ phone: newPhone() }).expect(200);
        installation = `addr1-${stamp}-${seq}-b`;
        await json(http().post(`${API}/auth/otp/send`)).send({ phone: newPhone() }).expect(403);
      } finally {
        if (saved === undefined) delete process.env.CUSTOMER_OTP_ADDRESS_PHONES_BEFORE_CHECK;
        else process.env.CUSTOMER_OTP_ADDRESS_PHONES_BEFORE_CHECK = saved;
      }
    });

    it('caps one address at 20 codes an hour, even with the human check passed (INF-4)', async () => {
      const { CUSTOMER_OTP_LIMITS, hashOf, customerPhoneHash } = await import('../customer-account/customer-otp-limiter.service');
      expect(CUSTOMER_OTP_LIMITS.perAddressPerHour).toBe(20);
      // 20 earlier sends from this test's address (the test client's own address), each for another number.
      const addresses = ['127.0.0.1', '::ffff:127.0.0.1', '::1'];
      await prisma.customerOtpAttempt.createMany({
        data: addresses.flatMap((ip) => Array.from({ length: 20 }, (_, i) => ({ kind: 'send', ipHash: hashOf('ip', ip), phoneHash: customerPhoneHash(`+9198${String(i).padStart(8, '0')}`) }))),
      });
      installation = `cap-${stamp}-${seq}`;
      const res = await json(http().post(`${API}/auth/otp/send`)).send({ phone: newPhone(), humanCheckToken: HUMAN }).expect(429);
      expect(res.body.code).toBe('OTP_LIMIT');
    });

    it('wrong codes from another installation never lock the owner\'s phone (N4)', async () => {
      const victim = newPhone();
      const { customerPhoneHash, hashOf } = await import('../customer-account/customer-otp-limiter.service');
      const attacker = hashOf('device', `attacker-${stamp}-${seq}`);
      await prisma.customerOtpAttempt.createMany({
        data: Array.from({ length: 10 }, () => ({ kind: 'verify_failed', phoneHash: customerPhoneHash(`+91${victim}`), deviceHash: attacker })),
      });
      const session = await signIn(victim);
      expect(session.accessToken).toEqual(expect.any(String));
    });

    it('a Google account cannot add or join a mobile while a deletion is pending', async () => {
      const sub = `google-pending-${stamp}-${seq}`;
      const signedIn = await json(http().post(`${API}/auth/google`)).send({ idToken: googleToken({ sub }) }).expect(200);
      await auth(http().post(`${API}/me/deletion`), signedIn.body.accessToken)
        .send({ proof: { provider: 'google', idToken: googleToken({ sub }) } }).expect(201);
      const phone = newPhone();
      const sent = await auth(http().post(`${API}/auth/phone/send`), signedIn.body.accessToken).send({ phone, humanCheckToken: HUMAN }).expect(200);
      const res = await auth(http().post(`${API}/auth/phone/verify`), signedIn.body.accessToken)
        .send({ phone, requestId: sent.body.requestId, code: otp.getCode(sent.body.requestId) }).expect(409);
      expect(res.body.code).toBe('DELETION_PENDING');
      await prisma.customerAccount.update({ where: { id: signedIn.body.account.id }, data: { phone: `+91${phone}` } });
    });

    it('two first sign-ins with the same Google account at once make one account', async () => {
      const sub = `google-race-${stamp}-${seq}`;
      const [a, b] = await Promise.all([1, 2].map(() => json(http().post(`${API}/auth/google`)).send({ idToken: googleToken({ sub }) })));
      expect([a!.status, b!.status]).toEqual([200, 200]);
      expect(a!.body.account.id).toBe(b!.body.account.id);
      await prisma.customerAccount.update({ where: { id: a!.body.account.id }, data: { phone: `+91${newPhone()}` } });
    });

    it('a branch contact with an unknown role is linked as supervisor, never owner', async () => {
      const phone = newPhone();
      const business = await prisma.business.create({ data: { code: `BZ-B${stamp % 100000}${seq}`, name: 'Branch Shop', phone: `+91${newPhone()}` } });
      await prisma.businessBranch.create({ data: { businessId: business.id, name: 'Branch 2', contactPersonName: 'C', contactPersonRole: 'other', contactPersonPhone: `+91${phone}` } });
      const session = await signIn(phone);
      expect(session.linked).toEqual([expect.objectContaining({ kind: 'business' })]);
      const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { id: session.linked[0]!.profileId } });
      expect(profile).toEqual(expect.objectContaining({ role: 'supervisor', branchId: expect.any(String) }));
    });

    it('Sign in with Apple is refused while it is not configured', async () => {
      const res = await json(http().post(`${API}/auth/apple`)).send({ idToken: 'a.b.c' }).expect(503);
      expect(res.body.code).toBe('APPLE_NOT_CONFIGURED');
      const config = await json(http().get(`${API}/config`)).expect(200);
      expect(config.body.appleSignIn).toBe(false);
    });
  });
});

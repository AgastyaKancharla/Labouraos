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
  const json = (r: request.Test) => r.set('Accept', 'application/json').set('X-Laboura-Installation', `inst-${stamp}`);

  async function sendCode(phone: string): Promise<{ requestId: string; code: string }> {
    const res = await json(http().post(`${API}/auth/otp/send`)).send({ phone }).expect(200);
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
    const res = await json(http().post(`${API}/auth/step-up/send`)).set('Authorization', `Bearer ${token}`).send({ purpose }).expect(200);
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
    // Only this suite sends customer OTPs; every test starts under the limits.
    await prisma.customerOtpAttempt.deleteMany({});
  });

  afterAll(async () => {
    process.env.GOOGLE_CLIENT_ID_ANDROID = savedGoogle;
    const accounts = await prisma.customerAccount.findMany({ where: { phone: { in: phones } }, select: { id: true } });
    const ids = accounts.map((a) => a.id);
    await prisma.signupTracker.deleteMany({ where: { accountId: { in: ids } } });
    await prisma.customerAccount.deleteMany({ where: { id: { in: ids } } });
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

    it('limits codes per phone (5 an hour)', async () => {
      const phone = newPhone();
      for (let i = 0; i < 5; i += 1) await json(http().post(`${API}/auth/otp/send`)).send({ phone }).expect(200);
      const res = await json(http().post(`${API}/auth/otp/send`)).send({ phone }).expect(429);
      expect(res.body).toEqual(expect.objectContaining({ code: 'OTP_LIMIT', retryAfterSeconds: expect.any(Number) }));
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
      const sent = await auth(http().post(`${API}/auth/phone/send`), res.body.accessToken).send({ phone }).expect(200);
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
      expect(JSON.stringify(home.body)).not.toMatch(/\+91|\d{10}/);
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
      const done = await auth(http().post(`${API}/me/deletion`), session.accessToken).send({ refundLossAcknowledged: true }).expect(201);
      expect(done.body.status).toBe('requested');
      const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id: session.account.id } });
      expect(account.status).toBe('deletion_requested');
      const row = await prisma.customerDeletionRequest.findUniqueOrThrow({ where: { id: done.body.id } });
      expect(row).toEqual(expect.objectContaining({ guaranteeRunning: true, refundLossAcknowledged: true }));
      const twice = await auth(http().post(`${API}/me/deletion`), session.accessToken).send({ refundLossAcknowledged: true }).expect(409);
      expect(twice.body.code).toBe('DELETION_PENDING');
    });
  });
});

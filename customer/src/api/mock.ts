import { ApiError } from './errors';
import { announceTestMode } from './testMode';
import type { CustomerApi } from './customerApi';
import type {
  BusinessHome,
  CustomerAccount,
  FormOptions,
  JobSeekerHome,
  OtpProof,
  OtpSent,
  ProfileHome,
  ProfileKind,
  ProfileSummary,
  ReferralHome,
  VacancySummary,
} from './types';

/**
 * Pretend data (EXPO_PUBLIC_API_MODE=mock): every screen works with no
 * server, for building and for showing the flow on a phone. Nothing leaves
 * the phone and everything is forgotten when the app closes.
 *
 * - Every OTP is 123456 (shown in the amber test-mode strip, like the test setup).
 * - A mobile number ending in 0000 pretends an agent already registered it
 *   ("We found your registration JS-1234").
 * - Opening the secure sheet pretends the person finished the next steps:
 *   job seeker consent, selfie and ID → payment "confirming" → paid, day 1 of 30;
 *   business agreement signed → visit booked; partner terms, selfie, ID and UPI.
 * Errors use the contract's codes, so screens show the same words as live.
 * All names and numbers are made up.
 */
export const MOCK_OTP = '123456';
export const MOCK_SHEET_URL = 'laboura-mock://sheet';

interface State {
  account: CustomerAccount | null;
  pendingPhone: string | null;
  homes: Record<string, ProfileHome>;
  /** Draft id → owner told about the legal minimum. */
  seq: number;
}

const options: FormOptions = {
  areas: [
    { name: 'BTM Layout', pincode: '560076', latitude: 12.9166, longitude: 77.6101 },
    { name: 'JP Nagar', pincode: '560078', latitude: 12.9063, longitude: 77.5857 },
    { name: 'Koramangala', pincode: '560034', latitude: 12.9352, longitude: 77.6245 },
    { name: 'Madiwala', pincode: '560068', latitude: 12.9226, longitude: 77.6174 },
    { name: 'Jayanagar', pincode: '560041', latitude: 12.925, longitude: 77.5938 },
  ],
  trades: [
    { id: 't-cook', name: 'Cook', salaryMinPaise: 1_600_000, salaryMaxPaise: 2_600_000, legalMinimumPaise: 2_570_000 },
    { id: 't-helper', name: 'Kitchen helper', salaryMinPaise: 1_200_000, salaryMaxPaise: 1_700_000, legalMinimumPaise: 2_340_000 },
    { id: 't-driver', name: 'Driver', salaryMinPaise: 1_800_000, salaryMaxPaise: 2_800_000, legalMinimumPaise: 2_830_000 },
    { id: 't-security', name: 'Security guard', salaryMinPaise: 1_400_000, salaryMaxPaise: 2_000_000, legalMinimumPaise: 2_340_000 },
    { id: 't-sales', name: 'Sales staff', salaryMinPaise: 1_300_000, salaryMaxPaise: 2_000_000, legalMinimumPaise: 2_570_000 },
  ],
};

function otpSent(prefix: string, seq: number): OtpSent {
  const answer: OtpSent = {
    requestId: `${prefix}-${seq}`,
    resendAvailableAt: new Date(Date.now() + 30_000).toISOString(),
    resendsLeft: 3,
    testModeBanner: `Test mode code: ${MOCK_OTP}`,
  };
  announceTestMode(answer);
  return answer;
}

const fail = (status: number, code: string, message: string, extra: object = {}) =>
  new ApiError({ status, messages: [message], body: { statusCode: status, code, message, ...extra } });

function checkOtp(otp: OtpProof | { code: string }) {
  if (otp.code !== MOCK_OTP) throw fail(400, 'OTP_INVALID', 'Wrong code', { attemptsLeft: 4 });
}

export function mockCustomerApi({ latencyMs = 250 }: { latencyMs?: number } = {}): CustomerApi {
  const state: State = { account: null, pendingPhone: null, homes: {}, seq: 0 };
  const wait = <T,>(value: T | (() => T)): Promise<T> =>
    new Promise((resolve, reject) => {
      const run = () => {
        try {
          resolve(typeof value === 'function' ? (value as () => T)() : value);
        } catch (err) {
          reject(err);
        }
      };
      if (latencyMs > 0) setTimeout(run, latencyMs);
      else run();
    });
  const next = () => (state.seq += 1);
  const account = (): CustomerAccount => {
    if (!state.account) throw fail(401, 'CUSTOMER_SESSION_ENDED', 'Signed out');
    return state.account;
  };
  const snapshot = (): CustomerAccount => JSON.parse(JSON.stringify(account())) as CustomerAccount;
  const addProfile = (kind: ProfileKind, displayName: string, home: ProfileHome, code: string | null): ProfileSummary => {
    const profile: ProfileSummary = { id: `p-${next()}`, kind, code, displayName, stage: 'verifying' };
    if (kind === 'business') profile.businessRole = 'owner';
    account().profiles.push(profile);
    account().lastProfileId = profile.id;
    state.homes[profile.id] = home;
    return profile;
  };
  const jobSeekerHome = (firstName: string, code: string): JobSeekerHome => ({
    kind: 'job_seeker',
    code,
    firstName,
    steps: { phone: 'done', profile: 'done', consent: 'not_started', selfie: 'not_started', idCheck: 'not_started', payment: 'not_started' },
    stuckReason: null,
    payment: { status: 'not_paid', amountPaise: 49_900 },
    guarantee: { status: 'not_started', day: null, totalDays: 30, endsOn: null, hits: 0, maxHits: 3 },
    interview: null,
    refund: null,
  });
  const setStage = (profileId: string, stage: ProfileSummary['stage']) => {
    const p = account().profiles.find((x) => x.id === profileId);
    if (p) p.stage = stage;
  };
  const signedIn = (acc: CustomerAccount) => {
    state.account = acc;
    return { accessToken: `mock-token-${next()}`, refreshToken: `mock-refresh-${state.seq}`, account: snapshot() };
  };
  const newAccount = (over: Partial<CustomerAccount>): CustomerAccount => ({
    id: `acc-${next()}`,
    name: null,
    email: null,
    phoneVerified: false,
    phoneLast4: null,
    language: null,
    signInMethods: [],
    profiles: [],
    lastProfileId: null,
    contactMe: false,
    status: 'active',
    ...over,
  });
  const linkAgentRecord = (phone: string) => {
    if (!phone.endsWith('0000') || account().profiles.some((p) => p.kind === 'job_seeker')) return [];
    addProfile('job_seeker', 'Ravi', jobSeekerHome('Ravi', 'JS-1234'), 'JS-1234');
    return [{ kind: 'job_seeker' as const, code: 'JS-1234' }];
  };
  const existing = (kind: ProfileKind) => account().profiles.find((p) => p.kind === kind);

  return {
    config: () => wait({ googleSignIn: true, googleWebClientId: null, googleIosClientId: null, appleSignIn: true, otpTestMode: true }),

    sendSignInOtp: (phone) =>
      wait(() => {
        if (!/^[6-9]\d{9}$/.test(phone)) throw fail(400, 'PHONE_INVALID', 'Invalid phone');
        state.pendingPhone = phone;
        return otpSent('signin', next());
      }),
    verifySignInOtp: ({ phone, code, contactConsent }) =>
      wait(() => {
        checkOtp({ code });
        const result = signedIn(newAccount({ phoneVerified: true, phoneLast4: phone.slice(-4), signInMethods: ['phone'], contactMe: contactConsent }));
        const linked = linkAgentRecord(phone);
        return { ...result, account: snapshot(), linkedExisting: linked };
      }),
    signInWithGoogle: () => wait(() => signedIn(newAccount({ name: 'Test Person', email: 'test.person@example.com', signInMethods: ['google'] }))),
    signInWithApple: ({ fullName }) => wait(() => signedIn(newAccount({ name: fullName, signInMethods: ['apple'] }))),
    signOut: () =>
      wait(() => {
        state.account = null;
      }),

    me: () => wait(snapshot),
    updateMe: ({ language, contactMe }) =>
      wait(() => {
        if (language) account().language = language;
        if (contactMe !== undefined) account().contactMe = contactMe;
        return snapshot();
      }),
    setLastProfile: (profileId) =>
      wait(() => {
        account().lastProfileId = profileId;
      }),
    sendPhoneOtp: ({ phone, contactConsent }) =>
      wait(() => {
        account().contactMe = contactConsent || account().contactMe;
        state.pendingPhone = phone;
        return otpSent('phone', next());
      }),
    verifyPhoneOtp: ({ phone, code }) =>
      wait(() => {
        checkOtp({ code });
        const acc = account();
        acc.phoneVerified = true;
        acc.phoneLast4 = phone.slice(-4);
        acc.signInMethods = Array.from(new Set([...acc.signInMethods, 'phone' as const]));
        const linked = linkAgentRecord(phone);
        return { account: snapshot(), linkedExisting: linked, session: null };
      }),
    sendStepUp: (purpose) =>
      wait(() => {
        account();
        return otpSent(purpose, next());
      }),

    startSignup: (kind) => wait(() => ({ existingProfileId: kind === 'business' ? null : (existing(kind)?.id ?? null) })),
    formOptions: () => wait(options),
    ageCheck: (dateOfBirth) =>
      wait(() => {
        const [y, m, d] = dateOfBirth.split('-').map(Number);
        const now = new Date();
        let age = now.getUTCFullYear() - y;
        if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
        return { adult: age >= 18 };
      }),
    registerJobSeeker: (form, otp) =>
      wait(() => {
        checkOtp(otp);
        const found = existing('job_seeker');
        if (found) return { profile: found, existing: true };
        const firstName = form.fullName.trim().split(/\s+/)[0] ?? form.fullName;
        const code = `JS-${2000 + next()}`;
        return { profile: addProfile('job_seeker', firstName, jobSeekerHome(firstName, code), code), existing: false };
      }),
    registerBusiness: (form, otp) =>
      wait(() => {
        checkOtp(otp);
        const code = `BZ-${3000 + next()}`;
        const home: BusinessHome = {
          kind: 'business',
          code,
          name: form.boardName,
          tracker: { phoneVerified: true, agreement: 'not_signed', visit: 'requested', visitAt: null, visitAgentFirstName: null, approval: 'waiting' },
          vacancies: form.staffNeeded.map((row) => ({
            id: `v-${next()}`,
            code: null,
            trade: row.trade,
            roleTitle: null,
            openings: row.count,
            salaryMinPaise: row.salaryMinPaise,
            salaryMaxPaise: row.salaryMaxPaise,
            salaryPeriod: 'monthly',
            status: 'draft',
            belowLegalMinimum: row.salaryMinPaise < (options.trades.find((t) => t.name === row.trade)?.legalMinimumPaise ?? 0),
          })),
          counts: { interviewsUpcoming: 0, placements: 0 },
        };
        return { profile: addProfile('business', form.boardName, home, code), existing: false };
      }),
    registerReferralPartner: (form, otp) =>
      wait(() => {
        checkOtp(otp);
        const found = existing('referral_partner');
        if (found) return { profile: found, existing: true };
        const code = `RF-${4000 + next()}`;
        const home: ReferralHome = {
          kind: 'referral_partner',
          code,
          name: form.name,
          paused: false,
          pausedReason: null,
          steps: { terms: 'not_started', selfie: 'not_started', idCheck: 'not_started', upi: 'not_started' },
          stuckReason: null,
          shareLink: null,
          referrals: [],
          money: { rewardPaise: 20_000, duePaise: 0, approvedPaise: 0, paidPaise: 0, yearTotalPaise: 0, payouts: [] },
          documents: [],
        };
        return { profile: addProfile('referral_partner', form.name, home, code), existing: false };
      }),
    sheetLink: (profileId, purpose) =>
      wait(() => {
        const home = state.homes[profileId];
        if (!home) throw fail(404, 'PROFILE_NOT_FOUND', 'Not found');
        if (purpose === 'document') return { url: MOCK_SHEET_URL };
        if (home.kind === 'job_seeker') {
          if (home.steps.consent !== 'done') {
            home.steps = { ...home.steps, consent: 'done', selfie: 'done', idCheck: 'done', payment: 'in_progress' };
            home.payment.status = 'confirming';
            setStage(profileId, 'payment');
          } else if (home.payment.status !== 'paid' || home.guarantee.status === 'deactivated') {
            home.steps.payment = 'done';
            home.payment.status = 'paid';
            home.guarantee = { ...home.guarantee, status: 'running', day: 1, hits: 0, endsOn: new Date(Date.now() + 29 * 86_400_000).toISOString().slice(0, 10) };
            setStage(profileId, 'active');
          }
        } else if (home.kind === 'business') {
          home.tracker = { ...home.tracker, agreement: 'signed', visit: 'booked', visitAt: new Date(Date.now() + 86_400_000).toISOString(), visitAgentFirstName: 'Kiran' };
        } else {
          home.steps = { terms: 'done', selfie: 'done', idCheck: 'done', upi: 'done' };
          home.shareLink = `https://app.laboura.com/r/${home.code ?? 'RF'}`;
          home.documents = [];
          setStage(profileId, 'active');
        }
        return { url: MOCK_SHEET_URL };
      }),

    home: (profileId) =>
      wait(() => {
        account();
        const home = state.homes[profileId];
        if (!home) throw fail(404, 'PROFILE_NOT_FOUND', 'Not found');
        return JSON.parse(JSON.stringify(home)) as ProfileHome;
      }),

    createVacancy: (profileId, draft) =>
      wait(() => {
        const home = state.homes[profileId];
        if (!home || home.kind !== 'business') throw fail(400, 'PROFILE_KIND_MISMATCH', 'Not a business');
        const trade = options.trades.find((t) => t.name === draft.trade);
        const monthly = draft.salaryPeriod === 'daily' ? draft.salaryMinPaise * 26 : draft.salaryMinPaise;
        const below = !!trade && monthly < trade.legalMinimumPaise;
        const vacancy: VacancySummary = {
          id: `v-${next()}`,
          code: null,
          trade: draft.trade,
          roleTitle: draft.roleTitle,
          openings: draft.openings,
          salaryMinPaise: draft.salaryMinPaise,
          salaryMaxPaise: draft.salaryMaxPaise,
          salaryPeriod: draft.salaryPeriod,
          status: 'draft',
          belowLegalMinimum: below,
          legalMinimumPaise: below ? (trade?.legalMinimumPaise ?? null) : null,
        };
        home.vacancies.push(vacancy);
        return vacancy;
      }),
    confirmVacancy: (profileId, draftId, { otp, ownerToldMinimumWage }) =>
      wait(() => {
        if (otp) checkOtp(otp);
        const home = state.homes[profileId];
        const vacancy = home && home.kind === 'business' ? home.vacancies.find((v) => v.id === draftId) : undefined;
        if (!vacancy || home.kind !== 'business') throw fail(404, 'PROFILE_NOT_FOUND', 'Not found');
        if (vacancy.belowLegalMinimum && !ownerToldMinimumWage) {
          const legal = options.trades.find((t) => t.name === vacancy.trade)?.legalMinimumPaise ?? 0;
          throw fail(409, 'BELOW_MINIMUM_WAGE_TICK_REQUIRED', 'Tick required', { legalMinimumPaise: legal });
        }
        vacancy.status = home.tracker.visit === 'done' && home.tracker.approval === 'approved' ? 'open' : 'waiting_for_visit';
        vacancy.code = `VC-${5000 + next()}`;
        return { ...vacancy };
      }),

    requestCallback: () => wait(() => ({ id: `cb-${next()}` })),
    deletionInfo: () =>
      wait(() => ({
        guaranteeRunning: Object.values(state.homes).some((h) => h.kind === 'job_seeker' && (h.guarantee.status === 'running' || h.payment.status === 'confirming')),
        kept: ['payments', 'invoices'],
        openRequest: false,
      })),
    requestDeletion: ({ otp, acceptGuaranteeLoss }) =>
      wait(() => {
        checkOtp(otp);
        const running = Object.values(state.homes).some((h) => h.kind === 'job_seeker' && h.guarantee.status === 'running');
        if (running && !acceptGuaranteeLoss) throw fail(409, 'GUARANTEE_WARNING_REQUIRED', 'Warning required');
        state.account = null;
        return { status: 'requested' as const };
      }),
  };
}

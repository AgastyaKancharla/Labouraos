import { onMockProgress } from '@/verify/mockSteps';
import type { MockPersist } from './mockPersist';
import { ApiError } from './errors';
import { announceTestMode } from './testMode';
import type { CustomerApi } from './customerApi';
import type {
  BusinessShift,
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
  VacancySummary, PlacedWorker, WorkerLeftReport, WorkersAnswer, ReferralLead } from './types';

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
  /** Profile id → the business's shifts (17 Nov). */
  shifts: Record<string, BusinessShift[]>;
  /** Profile id → "a worker left" reports (contract 8.2). */
  workerReports: Record<string, WorkerLeftReport[]>;
  /** Partner profile id → leads sent (contract 7.3b). */
  leads: Record<string, (ReferralLead & { phone: string })[]>;
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

export function mockCustomerApi({ latencyMs = 250, persist }: { latencyMs?: number; persist?: MockPersist } = {}): CustomerApi {
  const state: State = { account: null, pendingPhone: null, homes: {}, shifts: {}, workerReports: {}, leads: {}, seq: 0 };
  // Pretend builds keep the pretend server on the phone (mockPersist.ts).
  const ready: Promise<void> = persist
    ? persist
        .load()
        .then((json) => {
          if (json) Object.assign(state, JSON.parse(json) as State);
        })
        .catch(() => undefined)
    : Promise.resolve();
  const save = () => persist?.save(JSON.stringify(state));
  const wait = <T,>(value: T | (() => T)): Promise<T> =>
    new Promise((resolve, reject) => {
      const run = () => {
        try {
          resolve(typeof value === 'function' ? (value as () => T)() : value);
          save();
        } catch (err) {
          reject(err);
        }
      };
      void ready.then(() => {
        if (latencyMs > 0) setTimeout(run, latencyMs);
        else run();
      });
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

  // A step finished on the pretend link endpoints: show it on Home, as the real server does.
  onMockProgress((profileId, event) => {
    void ready.then(() => {
      const home = state.homes[profileId];
      if (!home) return;
      if (home.kind === 'job_seeker') {
        if (event === 'consent') home.steps.consent = 'done';
        if (event === 'selfie') home.steps.selfie = 'done';
        if (event === 'id_check') home.steps.idCheck = 'done';
        if (event === 'terms_accepted') {
          home.steps.payment = 'in_progress';
          home.payment.status = 'confirming';
          setStage(profileId, 'payment');
        }
        if (event === 'paid') {
          home.steps.payment = 'done';
          home.payment.status = 'paid';
          home.guarantee = { ...home.guarantee, status: 'running', day: 1, hits: 0, endsOn: new Date(Date.now() + 29 * 86_400_000).toISOString().slice(0, 10) };
          setStage(profileId, 'active');
        }
      } else if (home.kind === 'referral_partner') {
        if (event === 'terms') home.steps.terms = 'done';
        if (event === 'selfie') home.steps.selfie = 'done';
        if (event === 'id_check') home.steps.idCheck = 'done';
        if (event === 'payout') {
          home.steps.upi = 'done';
          home.shareLink = `https://app.laboura.com/r/${home.code ?? 'RF'}`;
          home.documents = [];
          setStage(profileId, 'active');
        }
      } else if (event === 'agreement_signed') {
        home.tracker = { ...home.tracker, agreement: 'signed', visit: 'booked', visitAt: new Date(Date.now() + 86_400_000).toISOString(), visitAgentFirstName: 'Kiran' };
      }
      save();
    });
  });
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
    config: () => wait({ googleSignIn: true, googleWebClientId: null, googleIosClientId: null, appleSignIn: true, otpTestMode: true, referralLeads: true, workerLeftReports: true }),

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
    signInWithApple: ({ name }) => wait(() => signedIn(newAccount({ name, signInMethods: ['apple'] }))),
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
          // One made-up worker, so "Report a worker left" can be tried with pretend data.
          counts: { interviewsUpcoming: 0, placements: 1, workersPlaced: 1 },
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
    // The steps themselves run on the pretend link endpoints (src/verify/mockSteps.ts), which report
    // each finished step back here (onMockProgress below) — opening the steps changes nothing by itself.
    sheetLink: (profileId) =>
      wait(() => {
        if (!state.homes[profileId]) throw fail(404, 'PROFILE_NOT_FOUND', 'Not found');
        return { url: MOCK_SHEET_URL };
      }),

    home: (profileId) =>
      wait(() => {
        account();
        const home = state.homes[profileId];
        if (!home) throw fail(404, 'PROFILE_NOT_FOUND', 'Not found');
        return JSON.parse(JSON.stringify(home)) as ProfileHome;
      }),

    workers: (profileId) =>
      wait(() => {
        const home = state.homes[profileId];
        if (!home || home.kind !== 'business') throw fail(400, 'PROFILE_KIND_MISMATCH', 'Not a business');
        const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
        const joined = new Date(Date.now() + 330 * 60_000 - 10 * 86_400_000).toISOString().slice(0, 10);
        const last = new Date(Date.now() + 330 * 60_000 + 50 * 86_400_000).toISOString().slice(0, 10);
        const reports = state.workerReports[profileId] ?? [];
        const open = reports.some((r) => r.status === 'open');
        const worker: PlacedWorker = {
          placementId: 'pl-mock-1', placementCode: 'PL-00001', workerFirstName: 'Ravi', trade: 'Cook', joinedOn: joined, joiningOn: joined,
          neverJoined: false, guaranteeLastDay: last, leftOnEarliest: joined, leftOnLatest: today, state: open ? 'reported' : 'can_report',
        };
        const answer: WorkersAnswer = {
          open: true,
          reasons: {
            covered: ['resigned', 'absconded_3_days', 'serious_misconduct', 'repeated_absence', 'skill_gap_15_days', 'misrepresentation', 'medically_unfit_or_relocated'],
            notCovered: ['business_closed', 'role_changed', 'salary_unpaid', 'unsafe_workplace', 'fired_without_reason', 'hired_own_person'],
            neverJoined: ['never_joined'],
          },
          reportWithinDays: 7,
          windowDays: 60,
          workers: [worker],
          reports: [...reports],
        };
        return answer;
      }),
    reportWorkerLeft: (profileId, placementId, input) =>
      wait(() => {
        if (placementId !== 'pl-mock-1') throw fail(404, 'PROFILE_NOT_FOUND', 'Worker not found');
        const list = (state.workerReports[profileId] ??= []);
        const open = list.find((r) => r.status === 'open');
        if (open) return { reportId: open.id, status: open.status };
        const report: WorkerLeftReport = {
          id: `wl-${next()}`, placementCode: 'PL-00001', workerFirstName: 'Ravi', workerLeftOn: input.workerLeftOn,
          reason: input.reason, status: 'open', claimDecision: null, reportedAt: new Date().toISOString(),
        };
        list.unshift(report);
        return { reportId: report.id, status: report.status };
      }),

    referralLeads: (profileId) =>
      wait(() => ({ open: true, leads: (state.leads[profileId] ?? []).map(({ phone: _phone, ...lead }) => lead) })),
    sendReferralLead: (profileId, input) =>
      wait(() => {
        const list = (state.leads[profileId] ??= []);
        const same = list.find((l) => l.phone === input.phone);
        if (same) return { leadId: same.id, stage: same.stage };
        const lead = { id: `lead-${next()}`, firstName: input.name.trim().split(/\s+/)[0] ?? null, kind: input.kind ?? null, stage: 'with_team' as const, sentAt: new Date().toISOString(), phone: input.phone };
        list.unshift(lead);
        return { leadId: lead.id, stage: lead.stage };
      }),
    shifts: (profileId) => wait(() => [...(state.shifts[profileId] ?? [])]),
    addShift: (profileId, input) =>
      wait(() => {
        const list = (state.shifts[profileId] ??= []);
        if (list.some((s) => s.name.toLowerCase() === input.name.toLowerCase())) throw fail(409, 'VALIDATION_FAILED', 'This business already has a shift with this name');
        const [sh, eh] = [Number(input.startTime.slice(0, 2)), Number(input.endTime.slice(0, 2))];
        const shift: BusinessShift = {
          id: `sh-${next()}`, ...input, label: `${input.name} ${input.startTime}–${input.endTime}`,
          category: sh >= 20 || sh < 4 || (eh <= sh && eh >= 2) ? 'night' : 'day',
        };
        list.push(shift);
        return shift;
      }),
    removeShift: (profileId, shiftId) =>
      wait(() => {
        state.shifts[profileId] = (state.shifts[profileId] ?? []).filter((s) => s.id !== shiftId);
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
    legalDocument: () =>
      wait(() => ({
        version: '1.1',
        title: 'Job Seeker Terms, Consent and Privacy Notice',
        summary: ['You pay <strong>₹499</strong> once to register.'],
        bodyHtml: '<section><h3>1. What Laboura does</h3><p>Full terms.</p></section>',
        consents: [
          { purpose: 'job_matching', required: true, title: '1. Job matching', description: 'I consent to Laboura matching my profile.' },
          { purpose: 'promotions', required: false, title: '6. Promotions (optional)', description: 'Offers and news.' },
        ],
      })),
    acceptTerms: (profileId, { otp }) =>
      wait(() => {
        checkOtp(otp);
        const home = state.homes[profileId] as ProfileHome | undefined;
        if (home?.legal) home.legal = { ...home.legal, acceptedVersion: home.legal.currentVersion, needsReconsent: false };
        return { version: '1.1' };
      }),
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

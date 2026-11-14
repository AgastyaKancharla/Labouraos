import { deviceInfo, installationId } from '@/auth/installation';
import type { SessionStore } from '@/auth/session';
import { isLanguage, LANGUAGE_STORAGE_KEY } from '@/i18n/translate';
import { secureStorage } from '@/lib/storage';
import type { ApiClient } from './client';
import type { CustomerApi } from './customerApi';
import { isApiError } from './errors';
import type {
  AppConfig,
  AuthResult,
  BusinessHome,
  CallbackTopic,
  CustomerAccount,
  FormOptions,
  JobSeekerHome,
  KeptItem,
  Language,
  OtpSent,
  ProfileHome,
  ProfileKind,
  ProfileSummary,
  ReferralHome,
  SheetLink,
  StepState,
  VacancyStatus,
  VacancySummary,
} from './types';

/**
 * The real API: docs/customer-app-api.md (Agent A, merged in PR #140), under
 * /customer-api/v1. This file is the only place that knows the wire shapes;
 * it maps them to the app's own types (types.ts).
 *
 * Not in the v1 contract yet (asked of Agent A, see customer/README.md):
 *   GET /me/form-options (areas and trades for the forms), POST /auth/apple,
 *   copies of a partner's signed papers.
 */
export const CUSTOMER_API_PATH = '/customer-api/v1';
export const REFERRAL_REWARD_PAISE = 20_000;

// ------------------------------------------------------------ wire shapes

type WireKind = 'job_seeker' | 'business' | 'referral';
interface WireProfile {
  id: string;
  kind: WireKind;
  role?: string | null;
  code?: string | null;
  title?: string | null;
  branchName?: string | null;
}
interface WireAccount {
  id: string;
  phone?: string | null;
  phoneVerified: boolean;
  email?: string | null;
  displayName?: string | null;
  language?: string | null;
  contactMeConsent?: boolean;
  status?: 'active' | 'deletion_requested';
  signInMethods?: ('phone' | 'google' | 'apple')[];
  lastProfileId?: string | null;
  profiles?: WireProfile[];
}
interface WireSession {
  accessToken?: string;
  refreshToken?: string | null;
  account: WireAccount;
  linked?: { profileId: string; kind: WireKind; code?: string | null }[];
  next?: string;
}
interface WireOtp {
  requestId: string;
  resendAvailableAt?: string | null;
  resendsLeft?: number | null;
  testModeCode?: string;
}

const toKind = (kind: WireKind): ProfileKind => (kind === 'referral' ? 'referral_partner' : kind);
const toWireKind = (kind: ProfileKind): WireKind => (kind === 'referral_partner' ? 'referral' : kind);

function toProfile(p: WireProfile): ProfileSummary {
  const kind = toKind(p.kind);
  return {
    id: p.id,
    kind,
    code: p.code ?? null,
    displayName: p.title || p.code || '',
    businessRole: kind === 'business' && p.role && p.role !== 'self' ? (p.role as ProfileSummary['businessRole']) : null,
    branchName: p.branchName ?? null,
  };
}

export function toAccount(w: WireAccount): CustomerAccount {
  return {
    id: w.id,
    name: w.displayName ?? null,
    email: w.email ?? null,
    phoneVerified: !!w.phoneVerified,
    phoneLast4: w.phone ? w.phone.replace(/\D/g, '').slice(-4) : null,
    language: isLanguage(w.language) ? w.language : null,
    signInMethods: w.signInMethods ?? [],
    profiles: (w.profiles ?? []).map(toProfile),
    lastProfileId: w.lastProfileId ?? null,
    contactMe: w.contactMeConsent,
    status: w.status,
  };
}

function toAuth(w: WireSession): AuthResult {
  return {
    accessToken: w.accessToken ?? '',
    refreshToken: w.refreshToken ?? null,
    account: toAccount(w.account),
    linkedExisting: (w.linked ?? []).map((l) => ({ kind: toKind(l.kind), code: l.code ?? null })),
  };
}

const toOtp = (w: WireOtp): OtpSent => ({
  requestId: w.requestId,
  resendAvailableAt: w.resendAvailableAt ?? null,
  resendsLeft: w.resendsLeft ?? null,
  ...(w.testModeCode ? { testModeBanner: `Test mode code: ${w.testModeCode}` } : {}),
});

// ------------------------------------------------------------ homes

/* Wire home shapes are read loosely: the contract lets fields be added at any time (1.1). */
export function toJobSeekerHome(w: any): JobSeekerHome {
  const steps = w.steps ?? {};
  const current: string | undefined = w.currentStep;
  const st = (done: boolean | undefined, key: string): StepState => (done ? 'done' : current === key ? 'in_progress' : 'not_started');
  const payState: string = w.payment?.state ?? 'not_started';
  const amountPaise: number = w.payment?.amountPaise ?? 49_900;
  const paid = payState === 'confirmed';
  const paymentStep: StepState = steps.payment ? 'done' : current === 'terms' || current === 'payment' || ['pending', 'confirming', 'failed'].includes(payState) ? 'in_progress' : 'not_started';
  const status: JobSeekerHome['guarantee']['status'] =
    w.nextAction === 'pay_again' || w.status === 'deactivated'
      ? 'deactivated'
      : w.status === 'placed'
        ? 'placed'
        : w.guarantee?.active
          ? 'running'
          : paid
            ? 'ended'
            : 'not_started';
  const interview = w.interview && w.interview.state === 'booked' && w.interview.businessName ? w.interview : null;
  const refundState: string = w.refund?.state ?? 'none';
  const stopped = w.stopped;
  return {
    kind: 'job_seeker',
    code: w.code ?? null,
    firstName: w.firstName ?? '',
    steps: {
      phone: st(steps.phone, 'phone'),
      profile: st(steps.profile, 'profile'),
      consent: st(steps.consent, 'consent'),
      selfie: st(steps.selfie, 'selfie'),
      idCheck: steps.idCheck ? 'done' : current === 'id_check' || current === 'idCheck' || w.idCheck?.waitingForService ? 'in_progress' : 'not_started',
      payment: paymentStep,
    },
    stuckReason: typeof stopped === 'string' ? stopped : typeof stopped?.reason === 'string' ? stopped.reason : null,
    payment: { status: paid ? 'paid' : payState === 'confirming' ? 'confirming' : 'not_paid', amountPaise },
    guarantee: {
      status,
      day: w.guarantee?.day ?? null,
      totalDays: w.guarantee?.days ?? 30,
      endsOn: typeof w.guarantee?.endsAt === 'string' ? w.guarantee.endsAt.slice(0, 10) : null,
      hits: w.hits?.count ?? 0,
      maxHits: w.hits?.max ?? 3,
    },
    interview: interview
      ? {
          status: 'booked',
          startsAt: interview.at,
          trade: interview.trade ?? null,
          businessName: interview.businessName,
          address: interview.address ?? '',
          latitude: interview.latitude ?? null,
          longitude: interview.longitude ?? null,
          replyDueAt: interview.replyBy ?? null,
        }
      : null,
    refund:
      refundState === 'none'
        ? null
        : {
            status: refundState === 'not_owed' ? 'not_eligible' : (refundState as 'due' | 'with_finance' | 'paid'),
            dueOn: w.refund?.dueOn ?? null,
            amountPaise,
            upiRef: w.refund?.reference ?? null,
          },
  };
}

const VACANCY_STATUS: Record<string, VacancyStatus> = {
  open: 'open',
  filled: 'filled',
  closed: 'closed',
  cancelled: 'closed',
  paused: 'closed',
  awaiting_confirmation: 'awaiting_otp',
};

export function toBusinessHome(w: any): BusinessHome {
  const t = w.tracker ?? {};
  const visit = w.visit ?? {};
  const drafts: VacancySummary[] = (w.drafts ?? []).map((d: any) => ({
    id: d.id,
    code: null,
    trade: d.trade ?? '',
    openings: d.headcount ?? null,
    status: 'draft',
    belowLegalMinimum: !!d.belowLegalMinimum,
  }));
  const vacancies: VacancySummary[] = (w.vacancies ?? []).map((v: any, i: number) => {
    const mapped = VACANCY_STATUS[v.status] ?? 'open';
    return {
      id: v.id ?? v.code ?? `vacancy-${i}`,
      code: v.code ?? null,
      trade: v.trade ?? '',
      openings: v.headcount ?? null,
      salaryMinPaise: v.salaryMinPaise ?? null,
      salaryMaxPaise: v.salaryMaxPaise ?? null,
      salaryPeriod: v.salaryPeriod ?? null,
      status: mapped === 'open' && !t.approved ? 'waiting_for_visit' : mapped,
      belowLegalMinimum: !!v.belowLegalMinimum,
    };
  });
  return {
    kind: 'business',
    code: w.code ?? null,
    name: w.name ?? '',
    tracker: {
      phoneVerified: !!t.phoneVerified,
      agreement: t.agreement ? 'signed' : 'not_signed',
      visit: t.visitDone ? 'done' : t.visitBooked ? 'booked' : visit.state === 'requested' ? 'requested' : 'not_booked',
      visitAt: visit.requestedFor ?? null,
      visitAgentFirstName: visit.agentFirstName ?? null,
      approval: t.approved ? 'approved' : w.verificationStatus === 'paused' ? 'paused' : 'waiting',
    },
    vacancies: [...drafts, ...vacancies],
    counts: { interviewsUpcoming: w.counts?.interviewsUpcoming ?? 0, placements: w.counts?.placements ?? 0 },
  };
}

export function toReferralHome(w: any): ReferralHome {
  const s = w.steps ?? {};
  const st = (done: boolean | undefined): StepState => (done ? 'done' : 'not_started');
  const m = w.money ?? {};
  return {
    kind: 'referral_partner',
    code: w.code ?? null,
    name: w.firstName ?? w.name ?? '',
    paused: !!w.paused,
    pausedReason: null,
    steps: { terms: st(s.terms), selfie: st(s.selfie), idCheck: st(s.idCheck), upi: st(s.upi) },
    stuckReason: null,
    shareLink: w.share?.link ?? null,
    shareText: w.share?.whatsappText ?? null,
    referrals: (w.referred ?? []).map((r: any, i: number) => ({ id: r.id ?? `r-${i}`, firstName: r.firstName, stage: r.stage, referredOn: r.since ?? null })),
    money: {
      rewardPaise: REFERRAL_REWARD_PAISE,
      duePaise: m.duePaise ?? 0,
      approvedPaise: m.approvedPaise ?? 0,
      paidPaise: m.paidPaise ?? 0,
      yearTotalPaise: m.yearTotalPaise ?? 0,
      payouts: (m.statement ?? []).map((l: any, i: number) => ({
        id: l.id ?? `po-${i}`,
        firstName: l.firstName ?? null,
        amountPaise: l.amountPaise,
        status: l.status,
        paidOn: l.status === 'paid' ? (l.date ?? null) : null,
        upiRef: l.upiReference ?? null,
      })),
    },
    documents: Array.isArray(w.documents) ? w.documents : [],
  };
}

export function toHome(w: any): ProfileHome {
  if (w.kind === 'business') return toBusinessHome(w);
  if (w.kind === 'referral' || w.kind === 'referral_partner') return toReferralHome(w);
  return toJobSeekerHome(w);
}

const TOPIC: Record<CallbackTopic, string> = {
  registration: 'signup',
  payment: 'payment',
  interview: 'interview',
  refund: 'refund',
  business: 'vacancy',
  referral: 'payout',
  other: 'other',
};
const KEPT: KeptItem[] = ['payments', 'invoices', 'refunds', 'payouts'];

// ------------------------------------------------------------ refresh

/** POST /auth/refresh with the saved refresh token; true when new tokens are stored. */
export async function refreshSession(baseUrl: string, store: SessionStore, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
  const refreshToken = store.session()?.refreshToken;
  if (!refreshToken) return false;
  try {
    const response = await fetchImpl(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Laboura-Installation': await installationId() },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    const body = JSON.parse(await response.text()) as WireSession;
    if (!body.accessToken) return false;
    await store.start(body.accessToken, body.refreshToken ?? refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ the API

interface Options {
  /** The app language, sent at sign-in (defaults to the saved choice). */
  language?: () => Promise<Language>;
  device?: typeof deviceInfo;
}

async function savedLanguage(): Promise<Language> {
  const saved = await secureStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguage(saved) ? saved : 'en';
}

export function liveCustomerApi(api: ApiClient, options: Options = {}): CustomerApi {
  const enc = encodeURIComponent;
  const language = options.language ?? savedLanguage;
  const device = options.device ?? deviceInfo;
  const profilePath = (profileId: string) => `/me/profiles/${enc(profileId)}`;
  const verifyStepUp = (purpose: string, requestId: string, code: string) => api.post('/auth/step-up/verify', { purpose, requestId, code });

  /** A registration answer, or the profile that already exists (409 PROFILE_EXISTS). */
  async function register(path: string, body: object, kind: ProfileKind, displayName: string) {
    try {
      const r = await api.post<{ profileId: string; code?: string | null }>(path, body);
      return { profile: { id: r.profileId, kind, code: r.code ?? null, displayName }, existing: false };
    } catch (err) {
      if (isApiError(err) && err.code === 'PROFILE_EXISTS' && err.field<string>('profileId')) {
        return { profile: { id: err.field<string>('profileId') as string, kind, code: null, displayName }, existing: true };
      }
      throw err;
    }
  }

  return {
    config: async () => {
      const c = await api.get<{ googleSignIn?: boolean; googleClientIds?: { web?: string | null; ios?: string | null }; appleSignIn?: boolean; otpTestMode?: boolean }>('/config', { auth: false });
      const result: AppConfig = {
        googleSignIn: !!c.googleSignIn,
        googleWebClientId: c.googleClientIds?.web ?? null,
        googleIosClientId: c.googleClientIds?.ios ?? null,
        appleSignIn: c.appleSignIn === true,
        otpTestMode: !!c.otpTestMode,
      };
      return result;
    },

    sendSignInOtp: async (phone, resendOf) => toOtp(await api.post<WireOtp>('/auth/otp/send', { phone, ...(resendOf ? { requestId: resendOf } : {}) }, { auth: false })),
    verifySignInOtp: async ({ phone, requestId, code, contactConsent }) => {
      const session = await api.post<WireSession>('/auth/otp/verify', { phone, requestId, code, device: await device(), language: await language() }, { auth: false });
      if (contactConsent && session.accessToken) {
        // The tick lives on the account (PATCH /me contactMe, C7); the new session is not stored yet.
        const updated = await api
          .patch<WireAccount>('/me', { contactMe: true }, { auth: false, headers: { Authorization: `Bearer ${session.accessToken}` } })
          .catch(() => null);
        if (updated) session.account = updated;
      }
      return toAuth(session);
    },
    signInWithGoogle: async (idToken) => toAuth(await api.post<WireSession>('/auth/google', { idToken, device: await device(), language: await language() }, { auth: false })),
    signInWithApple: async (input) => toAuth(await api.post<WireSession>('/auth/apple', { ...input, device: await device(), language: await language() }, { auth: false })),
    signOut: async () => {
      await api.post('/auth/sign-out', {});
    },

    me: async () => toAccount(await api.get<WireAccount>('/me')),
    updateMe: async (input) => toAccount(await api.patch<WireAccount>('/me', input)),
    setLastProfile: async (profileId) => {
      await api.put('/me/last-profile', { profileId });
    },
    sendPhoneOtp: async ({ phone, contactConsent, resendOf }) => {
      if (contactConsent) await api.patch('/me', { contactMe: true }).catch(() => undefined);
      return toOtp(await api.post<WireOtp>('/auth/phone/send', { phone, ...(resendOf ? { requestId: resendOf } : {}) }));
    },
    verifyPhoneOtp: async ({ phone, requestId, code }) => {
      const w = await api.post<WireSession>('/auth/phone/verify', { phone, requestId, code });
      return {
        account: toAccount(w.account),
        linkedExisting: (w.linked ?? []).map((l) => ({ kind: toKind(l.kind), code: l.code ?? null })),
        session: w.accessToken ? { accessToken: w.accessToken, refreshToken: w.refreshToken ?? null } : null,
      };
    },
    sendStepUp: async (purpose, resendOf) => toOtp(await api.post<WireOtp>('/auth/step-up/send', { purpose, ...(resendOf ? { requestId: resendOf } : {}) })),

    startSignup: async (kind) => {
      try {
        await api.post('/me/signups', { kind: toWireKind(kind), source: 'organic' });
        return { existingProfileId: null };
      } catch (err) {
        if (isApiError(err) && err.code === 'PROFILE_EXISTS') return { existingProfileId: err.field<string>('profileId') ?? null };
        throw err;
      }
    },
    formOptions: () => api.get<FormOptions>('/me/form-options'),
    ageCheck: async (dateOfBirth) => {
      try {
        await api.post('/me/register/age-check', { dateOfBirth });
        return { adult: true };
      } catch (err) {
        if (isApiError(err) && err.code === 'UNDER_18') return { adult: false };
        throw err;
      }
    },
    registerJobSeeker: (f, otp) =>
      register(
        '/me/register/job-seeker',
        {
          name: f.fullName,
          messageLanguage: f.messageLanguage,
          bestTimeToCall: f.bestTimeToCall,
          dateOfBirth: f.dateOfBirth,
          gender: f.gender,
          locality: f.area,
          pincode: f.pincode,
          ...(f.pin ? { latitude: f.pin.latitude, longitude: f.pin.longitude } : {}),
          travelDistanceKm: f.travelKm,
          trades: f.trades.map((t) => ({ trade: t.trade === 'other' ? (t.otherName ?? '') : t.trade, yearsExperience: t.years })),
          availableFrom: f.availableFrom,
          lookingSince: f.lookingSince,
          minSalary: f.salaryMinPaise,
          maxSalary: f.salaryMaxPaise,
          salaryPeriod: f.salaryPeriod,
          shiftPreference: f.shift,
          jobType: f.jobType,
          spokenLanguages: f.languagesSpoken,
          heardFrom: f.heardFrom,
          otp,
        },
        'job_seeker',
        f.fullName.split(/\s+/)[0] ?? f.fullName,
      ),
    registerBusiness: (f, otp) =>
      register(
        '/me/register/business',
        {
          contactPersonName: f.contactName,
          contactPersonRole: f.contactRole,
          name: f.boardName,
          legalName: f.legalName,
          businessType: f.businessType,
          employeeCountBand: f.employeeBand,
          ...(f.yearsBand ? { yearsInOperationBand: f.yearsBand } : {}),
          shopNumber: f.shopNumber,
          street: f.street,
          landmark: f.landmark,
          locality: f.area,
          pincode: f.pincode,
          ...(f.pin ? { latitude: f.pin.latitude, longitude: f.pin.longitude } : {}),
          ...(f.openingTime ? { openingTime: f.openingTime } : {}),
          ...(f.closingTime ? { closingTime: f.closingTime } : {}),
          noDocuments: f.noDocuments,
          ...(f.documents.gstin ? { gstNumber: f.documents.gstin } : {}),
          ...(f.documents.fssai ? { fssaiNumber: f.documents.fssai } : {}),
          ...(f.documents.shopEstablishment ? { shopEstablishmentNumber: f.documents.shopEstablishment } : {}),
          ...(f.documents.udyamOrTradeLicence ? { licenceNumber: f.documents.udyamOrTradeLicence } : {}),
          ...(f.documents.pan ? { pan: f.documents.pan } : {}),
          ...(f.billingEmail ? { billingEmail: f.billingEmail } : {}),
          staffNeededRows: f.staffNeeded.map((r) => ({ trade: r.trade, headcount: r.count, salaryMinPaise: r.salaryMinPaise, salaryMaxPaise: r.salaryMaxPaise, shift: r.shift, startDate: r.startDate })),
          heardFrom: f.heardFrom,
          ...(f.visitPreferredAt ? { visitPreferredAt: f.visitPreferredAt } : {}),
          otp,
        },
        'business',
        f.boardName,
      ),
    registerReferralPartner: (f, otp) =>
      register(
        '/me/register/referral',
        {
          name: f.name,
          type: f.partnerType,
          individualRole: f.partnerType === 'individual' ? f.individualKind : null,
          partnerBusinessType: f.partnerType === 'business' ? f.businessType : null,
          partnerBusinessName: f.partnerType === 'business' ? f.businessName : null,
          ...(f.whatsappPhone ? { whatsappPhone: f.whatsappPhone } : {}),
          language: f.messageLanguage,
          locality: f.area,
          pincode: f.pincode,
          ...(f.pin ? { latitude: f.pin.latitude, longitude: f.pin.longitude } : {}),
          heardFrom: 'laboura_app',
          otp,
        },
        'referral_partner',
        f.name,
      ),
    sheetLink: (profileId, purpose, documentId) => api.post<SheetLink>(`${profilePath(profileId)}/links`, { purpose, ...(documentId ? { documentId } : {}) }),

    home: async (profileId) => toHome(await api.get<unknown>(`${profilePath(profileId)}/home`)),

    createVacancy: async (profileId, d) => {
      const r = await api.post<{ id: string; warnings?: { belowLegalMinimum?: boolean; legalMinimumPaise?: number } }>(`${profilePath(profileId)}/vacancy-drafts`, {
        form: {
          tradeSkill: d.trade,
          ...(d.roleTitle ? { roleTitle: d.roleTitle } : {}),
          headcount: d.openings,
          salaryMinPaise: d.salaryMinPaise,
          ...(d.salaryMaxPaise ? { salaryMaxPaise: d.salaryMaxPaise } : {}),
          salaryPeriod: d.salaryPeriod,
          shift: d.shift,
          startDate: d.startDate,
          ...(d.description ? { description: d.description } : {}),
          ownerToldMinimumWage: d.legalMinimumAcknowledged,
        },
      });
      return {
        id: r.id,
        code: null,
        trade: d.trade,
        roleTitle: d.roleTitle,
        openings: d.openings,
        salaryMinPaise: d.salaryMinPaise,
        salaryMaxPaise: d.salaryMaxPaise,
        salaryPeriod: d.salaryPeriod,
        status: 'draft',
        belowLegalMinimum: !!r.warnings?.belowLegalMinimum,
        legalMinimumPaise: r.warnings?.legalMinimumPaise ?? null,
      };
    },
    confirmVacancy: async (profileId, draftId, { otp, ownerToldMinimumWage }) => {
      if (otp) await verifyStepUp('confirm_vacancy', otp.requestId, otp.code);
      const r = await api.post<{ vacancy: { code?: string | null; status?: string } }>(`${profilePath(profileId)}/vacancy-drafts/${enc(draftId)}/confirm`, { ownerToldMinimumWage });
      return {
        id: draftId,
        code: r.vacancy?.code ?? null,
        trade: '',
        openings: null,
        status: VACANCY_STATUS[r.vacancy?.status ?? 'open'] ?? 'open',
        belowLegalMinimum: false,
      };
    },

    requestCallback: (r) =>
      api.post<{ id: string }>('/me/callback-requests', {
        ...(r.profileId ? { profileId: r.profileId } : {}),
        topic: TOPIC[r.topic],
        ...(r.when === 'later' && r.from && r.to ? { preferredFrom: r.from, preferredTo: r.to } : {}),
      }),
    deletionInfo: async () => {
      const r = await api.get<{ guaranteeRunning?: boolean; keptByLaw?: string[]; openRequest?: unknown }>('/me/deletion');
      return {
        guaranteeRunning: !!r.guaranteeRunning,
        kept: (r.keptByLaw ?? []).filter((k): k is KeptItem => (KEPT as string[]).includes(k)),
        openRequest: !!r.openRequest,
      };
    },
    requestDeletion: async ({ otp, acceptGuaranteeLoss }) => {
      await verifyStepUp('delete_account', otp.requestId, otp.code);
      await api.post('/me/deletion', { refundLossAcknowledged: acceptGuaranteeLoss });
      return { status: 'requested' };
    },
  };
}

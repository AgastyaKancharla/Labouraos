import { refundGuaranteeDeadline } from '../../common/money/money';
import { JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from '../consent/consent.constants';

/**
 * What the registration link (web pages P00 → P02b) shows a job seeker: which
 * of the four steps are done, where he carries on, and the state of his ₹499.
 * Each step is saved to the person, not to the link, so a fresh link resumes
 * at the first unfinished step (Master Guide, "Registration, in order").
 *
 * Before the OTP to his own number is verified the link shows nothing about
 * him: only the masked number the code goes to and his language.
 */
export type RegistrationStep = 'consent' | 'selfie' | 'id_check' | 'payment' | 'complete';

/**
 * not_started – terms not accepted yet; pending – UPI request made, no money;
 * confirming – he says he paid (UPI reference hint) but the bank has not shown
 * it yet (a screenshot is never proof); failed – the last try failed;
 * confirmed – the money is in Laboura's bank and the 30 days have started.
 */
export type RegistrationPaymentState = 'not_started' | 'pending' | 'confirming' | 'failed' | 'confirmed';

export type PublicLanguage = 'kn' | 'hi' | 'en';

const LANGUAGE_NAMES: Record<string, PublicLanguage> = {
  kn: 'kn', kannada: 'kn', 'ಕನ್ನಡ': 'kn',
  hi: 'hi', hindi: 'hi', 'हिंदी': 'hi', 'हिन्दी': 'hi',
  en: 'en', english: 'en',
};

/** The person's language for the public pages; null when it isn't one of the three. */
export function publicLanguage(value: string | null | undefined): PublicLanguage | null {
  if (!value) return null;
  return LANGUAGE_NAMES[value.trim().toLowerCase()] ?? null;
}

export function maskPublicPhone(phone: string): string {
  return `******${phone.replace(/\D/g, '').slice(-4)}`;
}

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name.trim();
}

/** "Kavya R." — first name and the initial of the last name, for the payment-only page. */
export function shortNameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

export interface JourneyInput {
  seeker: {
    name: string;
    code: string;
    phone: string;
    messageLanguage: string | null;
    photoStoragePath: string | null;
    paymentReceivedAt: Date | null;
    termsAcceptedAt: Date | null;
    guaranteeFloorPaise: number | null;
    isUnder18ByDateOfBirth: boolean;
  };
  grantedPurposes: string[];
  latestVerification: {
    status: string;
    nameMatches: boolean | null;
    isAdult: boolean | null;
    failureReason: string | null;
  } | null;
  latestPayment: {
    id: string;
    status: string;
    upiReference: string | null;
    expectedAmountPaise: number | null;
    payerUtrHint: string | null;
    confirmedAt: Date | null;
  } | null;
  activationFeePaise: number;
  guaranteeDays: number;
  idServiceDown: boolean;
  waitingForIdService: boolean;
}

export interface JourneyStatus {
  otpRequired: false;
  maskedPhone: string;
  language: PublicLanguage | null;
  firstName: string;
  jobSeekerCode: string;
  currentStep: RegistrationStep;
  steps: { consent: boolean; selfie: boolean; idCheck: boolean; payment: boolean };
  idCheck: {
    serviceDown: boolean;
    waitingForService: boolean;
    lastResult: 'none' | 'verified' | 'name_mismatch' | 'under_18' | 'failed';
  };
  /** Registration stops before payment when he is under 18. */
  stopped: 'under_18' | null;
  /** His only trade is a new "Other" not yet on the list, so there is no salary floor to agree to. */
  waitingForTrade: boolean;
  termsAcceptedAt: Date | null;
  payment: {
    state: RegistrationPaymentState;
    amountPaise: number;
    upiReference: string | null;
    confirmedAt: Date | null;
    guaranteeEndsAt: Date | null;
    paymentId: string | null;
  };
}

const SUCCEEDED = ['succeeded', 'completed'];

export function buildJourneyStatus(input: JourneyInput): JourneyStatus {
  const { seeker, latestVerification: verification, latestPayment: payment } = input;
  const consent = JOB_SEEKER_REQUIRED_CONSENT_PURPOSES.every((purpose) => input.grantedPurposes.includes(purpose));
  const selfie = Boolean(seeker.photoStoragePath);
  const idCheck = Boolean(
    verification && verification.status === 'verified' && verification.nameMatches !== false && verification.isAdult !== false,
  );
  const paid = Boolean(seeker.paymentReceivedAt) || Boolean(payment && SUCCEEDED.includes(payment.status));

  const currentStep: RegistrationStep = !consent ? 'consent' : !selfie ? 'selfie' : !idCheck ? 'id_check' : !paid ? 'payment' : 'complete';

  const lastResult: JourneyStatus['idCheck']['lastResult'] = !verification
    ? 'none'
    : verification.isAdult === false
      ? 'under_18'
      : verification.nameMatches === false
        ? 'name_mismatch'
        : verification.status === 'verified'
          ? 'verified'
          : 'failed';

  let paymentState: RegistrationPaymentState = 'not_started';
  if (paid) paymentState = 'confirmed';
  else if (payment?.status === 'failed') paymentState = 'failed';
  else if (payment?.status === 'pending') paymentState = payment.payerUtrHint ? 'confirming' : 'pending';

  const confirmedAt = seeker.paymentReceivedAt ?? payment?.confirmedAt ?? null;
  return {
    otpRequired: false,
    maskedPhone: maskPublicPhone(seeker.phone),
    language: publicLanguage(seeker.messageLanguage),
    firstName: firstNameOf(seeker.name),
    jobSeekerCode: seeker.code,
    currentStep,
    steps: { consent, selfie, idCheck, payment: paid },
    idCheck: { serviceDown: input.idServiceDown, waitingForService: input.waitingForIdService, lastResult },
    stopped: seeker.isUnder18ByDateOfBirth || verification?.isAdult === false ? 'under_18' : null,
    waitingForTrade: seeker.guaranteeFloorPaise === null,
    termsAcceptedAt: seeker.termsAcceptedAt,
    payment: {
      state: paymentState,
      amountPaise: payment?.expectedAmountPaise ?? input.activationFeePaise,
      upiReference: payment && payment.status === 'pending' ? payment.upiReference : null,
      confirmedAt: paid ? confirmedAt : null,
      guaranteeEndsAt: paid && confirmedAt ? refundGuaranteeDeadline(confirmedAt, input.guaranteeDays) : null,
      paymentId: paid ? payment?.id ?? null : null,
    },
  };
}

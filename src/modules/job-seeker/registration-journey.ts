import { ProductLanguage, productLanguage } from '../../common/language/english-only';
import { ID_PHOTO_EXPIRED_REASON } from '../aadhaar-qr/id-check-photo.service';
import { refundGuaranteeDeadline } from '../../common/money/money';
import { JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from '../consent/consent.constants';

/**
 * What the registration link (web pages P00 → P02b) shows a job seeker: which
 * of the four steps are done, where he carries on, and the state of his ₹499.
 * The order (Master Guide rev 211, 25 Nov): Consent → Selfie → Payment ₹499 →
 * ID check. Payment needs consent and the selfie (and the terms, a trade floor,
 * no under-18 stop); it no longer waits for the ID check. An ID check done
 * before payment (a field agent scanning in person) still counts: the page
 * then goes from the payment straight to done.
 * Each step is saved to the person, not to the link, so a fresh link resumes
 * at the first unfinished step (Master Guide, "Registration, in order").
 *
 * Before the OTP to his own number is verified the link shows nothing about
 * him: only the masked number the code goes to and his language.
 */
export type RegistrationStep = 'consent' | 'selfie' | 'payment' | 'id_check' | 'complete';

/**
 * not_started – terms not accepted yet; pending – UPI request made, no money;
 * confirming – he says he paid (UPI reference hint) but the bank has not shown
 * it yet (a screenshot is never proof); failed – the last try failed;
 * confirmed – the money is in Laboura's bank. The 30 days start when the ID
 * check has passed too (guaranteeStartsAt; rev 211): until then he is "paid,
 * waiting for ID".
 */
export type RegistrationPaymentState = 'not_started' | 'pending' | 'confirming' | 'failed' | 'confirmed';

/** English only (Master Guide rev 193). */
export type PublicLanguage = ProductLanguage;

/** The language of the public pages: always English, whatever an old record says (rev 193). */
export function publicLanguage(value?: string | null): PublicLanguage {
  return productLanguage(value);
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
    /** Rev 211: when his 30 days started (paid and ID passed); null while waiting for the ID. */
    guaranteeStartsAt?: Date | null;
    termsAcceptedAt: Date | null;
    guaranteeFloorPaise: number | null;
    isUnder18ByDateOfBirth: boolean;
  };
  grantedPurposes: string[];
  /** Items given (not withdrawn) under the CURRENT consent notice version: only these count as "already given". */
  grantedUnderCurrentNotice?: string[];
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
  /** A signed Aadhaar QR showed under 18 and no Manager / CEO has lifted the stop (sticky, rev 154). */
  under18Stop: boolean;
  /** Any verified ID check (not only the latest): a later failed or waiting check doesn't undo it (L-5). */
  anyVerifiedCheck?: boolean;
}

export interface JourneyStatus {
  otpRequired: false;
  maskedPhone: string;
  language: PublicLanguage | null;
  firstName: string;
  jobSeekerCode: string;
  currentStep: RegistrationStep;
  steps: { consent: boolean; selfie: boolean; idCheck: boolean; payment: boolean };
  /** Consent items already given under the current notice version and not withdrawn: the consent page does not ask them again (17 Nov). An item given under an older notice is asked again. */
  consentGiven: string[];
  idCheck: {
    /** Another ID is waiting for the Team Lead's check (rev 154); the 30 days start when it is approved (rev 211). */
    waitingForTeamLead: boolean;
    /** photo_expired: the photo of another ID card expired before anyone checked it — take a new photo (rev 169). */
    lastResult: 'none' | 'verified' | 'pending' | 'name_mismatch' | 'under_18' | 'photo_expired' | 'failed';
  };
  /** Registration stops when he is under 18: before payment by his typed date of birth, or at the ID check. */
  stopped: 'under_18' | null;
  /** Rev 211: paid, and no ID check has passed yet — not active, the 30 days have not started. */
  paidWaitingForId: boolean;
  /** His only trade is a new "Other" not yet on the list, so there is no salary floor to agree to. */
  waitingForTrade: boolean;
  termsAcceptedAt: Date | null;
  payment: {
    state: RegistrationPaymentState;
    amountPaise: number;
    upiReference: string | null;
    confirmedAt: Date | null;
    /** Rev 211: when the 30 days started (null until the ID check has passed too). */
    guaranteeStartsAt: Date | null;
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
    !input.under18Stop &&
      (input.anyVerifiedCheck || (verification && verification.status === 'verified' && verification.nameMatches === true && verification.isAdult === true)),
  );
  const paid = Boolean(seeker.paymentReceivedAt) || Boolean(payment && SUCCEEDED.includes(payment.status));

  // Rev 211: Consent → Selfie → Payment → ID check.
  const currentStep: RegistrationStep = !consent ? 'consent' : !selfie ? 'selfie' : !paid ? 'payment' : !idCheck ? 'id_check' : 'complete';

  // A lifted under-18 stop (isAdult false, no longer standing) needs a new ID check: 'failed'.
  const lastResult: JourneyStatus['idCheck']['lastResult'] = input.under18Stop
    ? 'under_18'
    : !verification
      ? 'none'
      : verification.status === 'pending'
        ? 'pending'
        : verification.nameMatches === false
          ? 'name_mismatch'
          : verification.status === 'verified' && verification.isAdult === true
            ? 'verified'
            : verification.failureReason === ID_PHOTO_EXPIRED_REASON
              ? 'photo_expired'
              : 'failed';

  let paymentState: RegistrationPaymentState = 'not_started';
  if (paid) paymentState = 'confirmed';
  else if (payment?.status === 'failed') paymentState = 'failed';
  else if (payment?.status === 'pending') paymentState = payment.payerUtrHint ? 'confirming' : 'pending';

  const confirmedAt = seeker.paymentReceivedAt ?? payment?.confirmedAt ?? null;
  // The 30 days run from guaranteeStartsAt only (paid AND ID passed), never from the payment alone.
  const guaranteeStartsAt = paid && idCheck ? seeker.guaranteeStartsAt ?? null : null;
  return {
    otpRequired: false,
    maskedPhone: maskPublicPhone(seeker.phone),
    language: publicLanguage(seeker.messageLanguage),
    firstName: firstNameOf(seeker.name),
    jobSeekerCode: seeker.code,
    currentStep,
    steps: { consent, selfie, idCheck, payment: paid },
    consentGiven: [...new Set(input.grantedUnderCurrentNotice ?? input.grantedPurposes)],
    idCheck: { waitingForTeamLead: lastResult === 'pending', lastResult },
    stopped: seeker.isUnder18ByDateOfBirth || input.under18Stop ? 'under_18' : null,
    paidWaitingForId: paid && !idCheck,
    waitingForTrade: seeker.guaranteeFloorPaise === null,
    termsAcceptedAt: seeker.termsAcceptedAt,
    payment: {
      state: paymentState,
      amountPaise: payment?.expectedAmountPaise ?? input.activationFeePaise,
      upiReference: payment && payment.status === 'pending' ? payment.upiReference : null,
      confirmedAt: paid ? confirmedAt : null,
      guaranteeStartsAt,
      guaranteeEndsAt: guaranteeStartsAt ? refundGuaranteeDeadline(guaranteeStartsAt, input.guaranteeDays) : null,
      paymentId: paid ? payment?.id ?? null : null,
    },
  };
}

import type { SignupStage } from '../../common/customer-auth/customer-app.constants';

/**
 * Where an app sign-up stands, worked out from the records the existing
 * registration steps already write (customer app proposal 4.1). Nothing is
 * typed in by anyone: the same consent, selfie, ID check, payment, agreement
 * and visit records an agent's registration produces.
 *
 * | Stage | Job seeker               | Business                    | Referral partner |
 * | A     | phone verified, role     | phone verified              | phone verified   |
 * | B     | profile filled           | business form filled        | details filled   |
 * | C     | consent given            | agreement signed            | terms accepted   |
 * | D     | selfie done, pay pending | visit booked                | selfie and ID    |
 * | E     | paid, waiting for ID     | visit done, TL approval     | UPI added        |
 * | done  | paid and ID verified     | verified                    | active (UPI ok)  |
 *
 * Job seekers follow Consent → Selfie → Payment → ID check (Master Guide rev
 * 211, 25 Nov): stage E is "Paid, waiting for ID" and a sign-up is done when
 * he is paid AND his ID passed (his 30 days started), which is also when the
 * agent's credit counts.
 */
export const STAGE_ORDER: readonly SignupStage[] = ['A', 'B', 'C', 'D', 'E', 'done'];

export function stageIndex(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage as SignupStage);
  return i < 0 ? 0 : i;
}

export interface SeekerFacts {
  /** Every required consent purpose granted and not withdrawn. */
  consentDone: boolean;
  selfie: boolean;
  /** An ID check passed (verified, name matches, 18+). */
  idVerified: boolean;
  /** An ID check was tried and failed (name mismatch, not adult, unreadable). */
  idFailed: boolean;
  /** Terms agreed: the guarantee floor is frozen when the terms page is accepted. */
  termsAgreed: boolean;
  paymentFailures: number;
  paid: boolean;
  /** Rev 211: his 30 days started (paid and ID passed; JobSeeker.guaranteeStartsAt). */
  guaranteeStarted?: boolean;
}

export interface BusinessFacts {
  agreementSigned: boolean;
  /** A verification or app sign-up visit has a field agent assigned (or is done). */
  visitBooked: boolean;
  /** The visit request exists but nobody is assigned yet. */
  visitRequested: boolean;
  /** Verification visit done: waiting for the Team Lead's approval. */
  visitDone: boolean;
  verified: boolean;
  rejected: boolean;
}

export interface ReferralFacts {
  termsAccepted: boolean;
  selfie: boolean;
  idVerified: boolean;
  idFailed: boolean;
  upiAdded: boolean;
  upiVerified: boolean;
  upiNameMismatch: boolean;
}

export interface StageResult {
  stage: SignupStage;
  /** The step they are on now (the first one not done), for the script hint. */
  step: string;
  /** Steps still to do, in order. */
  missing: string[];
  /** A few words on why they are stuck, when the records say so. No personal data. */
  stuckReason: string | null;
}

export function seekerStage(f: SeekerFacts): StageResult {
  // Rev 211: Consent → Selfie → (terms) Payment → ID check.
  const done = Boolean(f.guaranteeStarted) || (f.paid && f.idVerified);
  const missing: string[] = [];
  if (!f.consentDone) missing.push('consent');
  if (!f.selfie) missing.push('selfie');
  if (!f.paid && !f.termsAgreed) missing.push('terms');
  if (!f.paid) missing.push('payment');
  if (!done && !f.idVerified) missing.push('id_check');
  let stage: SignupStage = 'B';
  if (done) stage = 'done';
  else if (f.paid) stage = 'E';
  else if (f.consentDone && f.selfie) stage = 'D';
  else if (f.consentDone) stage = 'C';
  let stuckReason: string | null = null;
  if (f.paid && !done) stuckReason = f.idFailed ? 'Paid, waiting for ID: the ID check did not pass' : 'Paid, waiting for ID';
  else if (!f.paid && f.paymentFailures >= 2) stuckReason = `UPI failed ${f.paymentFailures} times`;
  else if (!f.paid && f.paymentFailures === 1) stuckReason = 'UPI failed once';
  const step = done ? 'complete' : (missing[0] ?? 'complete');
  return { stage, step: step === 'payment' && f.paymentFailures > 0 ? 'payment_failed' : step, missing: done ? [] : missing, stuckReason };
}

export function businessStage(f: BusinessFacts): StageResult {
  const missing: string[] = [];
  if (!f.agreementSigned) missing.push('agreement');
  if (!f.visitBooked && !f.visitDone && !f.verified) missing.push('visit_booked');
  if (!f.visitDone && !f.verified) missing.push('visit_done');
  if (!f.verified) missing.push('approval');
  let stage: SignupStage = 'B';
  if (f.verified) stage = 'done';
  else if (f.visitDone) stage = 'E';
  else if (f.visitBooked) stage = 'D';
  else if (f.agreementSigned) stage = 'C';
  let stuckReason: string | null = null;
  if (f.rejected) stuckReason = 'Rejected at verification';
  else if (!f.visitBooked && f.visitRequested && !f.visitDone && !f.verified) stuckReason = 'Visit not assigned yet';
  return { stage, step: missing[0] ?? 'complete', missing, stuckReason };
}

export function referralStage(f: ReferralFacts): StageResult {
  const missing: string[] = [];
  if (!f.termsAccepted) missing.push('terms');
  if (!f.selfie) missing.push('selfie');
  if (!f.idVerified) missing.push('id_check');
  if (!f.upiVerified) missing.push('upi');
  let stage: SignupStage = 'B';
  if (f.termsAccepted && f.selfie && f.idVerified && f.upiVerified) stage = 'done';
  else if (f.termsAccepted && f.selfie && f.idVerified && f.upiAdded) stage = 'E';
  else if (f.termsAccepted && f.selfie && f.idVerified) stage = 'D';
  else if (f.termsAccepted) stage = 'C';
  let stuckReason: string | null = null;
  if (!f.idVerified && f.idFailed) stuckReason = 'ID check did not pass';
  else if (f.upiNameMismatch) stuckReason = "UPI name didn't match";
  return { stage, step: missing[0] ?? 'complete', missing, stuckReason };
}

/** Stage A: no record yet (they chose a role but did not fill the form). */
export function noRecordStage(profileKind: string): StageResult {
  const first = profileKind === 'business' ? 'business_form' : profileKind === 'referral' ? 'details' : 'profile';
  return { stage: 'A', step: first, missing: [first], stuckReason: null };
}

/**
 * Script hint key for the call agent: what to say for this kind of sign-up at
 * this step. The words live in the console's three language files
 * (`ca.signup.script.<kind>.<step>`).
 */
export function scriptHintKey(profileKind: string, step: string): string {
  return `${profileKind}.${step}`;
}

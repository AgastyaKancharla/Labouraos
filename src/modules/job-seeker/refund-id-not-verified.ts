import { Prisma } from '@prisma/client';
import { PAID_WAITING_ID } from './job-seeker.status';

/**
 * A ₹499 refund before a passed ID check (Master Guide rev 211, "Decided 25 Nov"; job seeker terms
 * v1.2): under 18, or an ID that could not be verified (failed, name mismatch, or never finished)
 * → the full ₹499, ONLY when he contacts Laboura and asks. The CEO or Finance records "Refund
 * requested by the job seeker (ID not verified)" from his profile or the refunds screen and approves
 * it as usual — never automatically. The refund goes back to whoever paid (a payment-only link:
 * the payer). A forged or altered ID gets no refund: a Manager or the CEO marks it with the
 * permanent ban (category forged_id, D11), and while a Team Lead's "fake" flag waits for that
 * decision nothing is refunded. The normal day-30 refund is unchanged but counts from
 * guaranteeStartsAt (job-seeker-refund-eligibility.ts).
 */
export const ID_NOT_VERIFIED_REFUND_KIND = 'id_not_verified';
export const ID_NOT_VERIFIED_REFUND_LABEL = 'Refund requested by the job seeker (ID not verified)';

/** Where his ID check stands, for the record (no personal data). */
export type IdCheckState = 'none' | 'pending' | 'failed' | 'under_18';

export interface IdNotVerifiedRefundInput {
  code: string;
  status: string;
  paymentReceivedAt: Date | null;
  guaranteeStartsAt: Date | null;
  activationPaymentPaise: number | null;
  hasExistingRefund: boolean;
  /** A live permanent ban for a forged or altered ID: no refund. */
  forgedIdBan: boolean;
  /** A Team Lead's "fake" flag still open: a Manager or the CEO decides first whether it was forged. */
  openFakeIdFlag: boolean;
}

export interface IdNotVerifiedRefundResult {
  eligible: boolean;
  reason?: string;
  amountPaise: number;
}

export function evaluateIdNotVerifiedRefund(input: IdNotVerifiedRefundInput): IdNotVerifiedRefundResult {
  const no = (reason: string): IdNotVerifiedRefundResult => ({ eligible: false, reason, amountPaise: 0 });
  if (input.forgedIdBan) return no(`Job seeker '${input.code}' used a forged or altered ID: no refund`);
  if (!input.paymentReceivedAt || input.activationPaymentPaise === null) {
    return no(`Job seeker '${input.code}' has no ₹499 received, so nothing can be refunded`);
  }
  if (input.guaranteeStartsAt || input.status !== PAID_WAITING_ID) {
    return no(`Job seeker '${input.code}' is not waiting for his ID check: his ID passed, so the day-30 refund rules apply`);
  }
  if (input.openFakeIdFlag) {
    return no(`A Team Lead flagged job seeker '${input.code}''s ID as fake: a Manager or the CEO decides first whether it was forged (no refund for a forged ID)`);
  }
  if (input.hasExistingRefund) return no(`A refund for job seeker '${input.code}' already exists`);
  return { eligible: true, amountPaise: input.activationPaymentPaise };
}

type Db = Pick<Prisma.TransactionClient, 'identityVerification' | 'permanentBan' | 'reviewFlag' | 'publicLink'>;

/** His ID check state (for the audit row and the screens). */
export async function idCheckStateOf(db: Pick<Db, 'identityVerification'>, jobSeekerId: string): Promise<IdCheckState> {
  const stop = await db.identityVerification.findFirst({
    where: { jobSeekerId, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', isAdult: false, under18LiftedAt: null },
    select: { id: true },
  });
  if (stop) return 'under_18';
  const latest = await db.identityVerification.findFirst({ where: { jobSeekerId }, orderBy: { createdAt: 'desc' }, select: { status: true } });
  if (!latest) return 'none';
  return latest.status === 'pending' ? 'pending' : 'failed';
}

export async function loadForgedIdGuards(db: Pick<Db, 'permanentBan' | 'reviewFlag'>, jobSeekerId: string): Promise<{ forgedIdBan: boolean; openFakeIdFlag: boolean }> {
  const [ban, flag] = await Promise.all([
    db.permanentBan.findFirst({ where: { subjectType: 'job_seeker', subjectId: jobSeekerId, category: 'forged_id', liftedAt: null }, select: { id: true } }),
    db.reviewFlag.findFirst({ where: { subjectType: 'job_seeker', subjectId: jobSeekerId, kind: 'registration_suspect', status: 'open' }, select: { id: true } }),
  ]);
  return { forgedIdBan: Boolean(ban), openFakeIdFlag: Boolean(flag) };
}

/**
 * Who paid the ₹499: someone else when the payer of a payment-only link for that very payment
 * verified the code sent to his number on it (metadata.payerVerifiedAt). The refund goes back to him.
 */
export async function otherPayerLink(
  db: Pick<Db, 'publicLink'>,
  jobSeekerId: string,
  activationPaymentId: string,
): Promise<{ id: string; phone: string | null; relation: string | null } | null> {
  const links = await db.publicLink.findMany({
    where: { purpose: 'payment_only', subjectType: 'job_seeker', subjectId: jobSeekerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, phone: true, metadata: true },
    take: 20,
  });
  for (const link of links) {
    const metadata = (link.metadata ?? {}) as { paymentId?: unknown; relation?: unknown; payerVerifiedAt?: unknown };
    if (metadata.paymentId === activationPaymentId && typeof metadata.payerVerifiedAt === 'string') {
      return { id: link.id, phone: link.phone, relation: typeof metadata.relation === 'string' ? metadata.relation : null };
    }
  }
  return null;
}

/** "******1234" for the screens (only the CEO sees full numbers, and not here). */
export function maskedPayerPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `******${phone.replace(/\D/g, '').slice(-4)}`;
}

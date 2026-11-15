import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';
import { DEFAULT_NOTICE_VERSION, JOB_SEEKER_REQUIRED_CONSENT_PURPOSES, REQUIRED_CONSENT_PURPOSES_BY_SUBJECT } from '../consent/consent.constants';
import { LEGAL_DOCUMENT_FOR_SUBJECT, LEGAL_DOCUMENT_VERSIONS, LegalDocumentKey } from './legal-documents';

type Reader = Pick<PrismaService | Prisma.TransactionClient, 'legalAcceptance' | 'businessAgreement' | 'consent'>;
export type LegalSubjectType = 'job_seeker' | 'business' | 'referral';

export interface LegalStatus {
  documentKey: LegalDocumentKey;
  currentVersion: string;
  /** The version of the last acceptance on record (null: none in the new record yet). */
  acceptedVersion: string | null;
  acceptedLanguage: string | null;
  acceptedAt: Date | null;
  /** Job seekers: the consent notice version of the ticks. */
  noticeVersion: string | null;
  currentNoticeVersion: string | null;
  /** Accepted something before, but not the current version: ask again (blocking) on the next open. */
  needsReconsent: boolean;
}

/**
 * Has this person accepted the current version? Someone who accepted
 * nothing yet is not asked to "re-consent" (they go through the normal
 * first steps). Consents given under an older notice stay valid until then.
 *
 * A job seeker's guarantee terms at payment (context 'payment_terms') carry
 * no consent ticks, so they never decide the notice version (review H1): a
 * new job seeker who just ticked the terms is not asked again.
 */
export async function legalStatusOf(prisma: Reader, subjectType: LegalSubjectType, subjectId: string): Promise<LegalStatus> {
  const documentKey = LEGAL_DOCUMENT_FOR_SUBJECT[subjectType];
  const currentVersion = LEGAL_DOCUMENT_VERSIONS[documentKey];
  const latest = await prisma.legalAcceptance.findFirst({
    where: { subjectType, subjectId, documentKey, ...(subjectType === 'job_seeker' ? { context: { not: 'payment_terms' } } : {}) },
    orderBy: { acceptedAt: 'desc' },
    select: { version: true, language: true, acceptedAt: true, noticeVersion: true },
  });
  const currentNoticeVersion = subjectType === 'job_seeker' ? DEFAULT_NOTICE_VERSION : null;
  const base = {
    documentKey,
    currentVersion,
    acceptedVersion: latest?.version ?? null,
    acceptedLanguage: latest?.language ?? null,
    acceptedAt: latest?.acceptedAt ?? null,
    noticeVersion: latest?.noticeVersion ?? null,
    currentNoticeVersion,
  };

  if (subjectType === 'business') {
    const agreement = await prisma.businessAgreement.findFirst({
      where: { businessId: subjectId },
      orderBy: { signedAt: 'desc' },
      select: { version: true, signedAt: true },
    });
    if (!agreement) return { ...base, needsReconsent: false };
    // The signed agreement is the business's acceptance record (older ones predate LegalAcceptance).
    const acceptedVersion = latest && latest.acceptedAt >= agreement.signedAt ? latest.version : agreement.version;
    return {
      ...base,
      acceptedVersion,
      acceptedAt: latest?.acceptedAt ?? agreement.signedAt,
      needsReconsent: acceptedVersion !== currentVersion,
    };
  }

  if (latest) {
    const versionOk = latest.version === currentVersion;
    const noticeOk = subjectType !== 'job_seeker' || latest.noticeVersion === currentNoticeVersion;
    return { ...base, needsReconsent: !(versionOk && noticeOk) };
  }

  // No acceptance in the new record: someone who already gave the required
  // consents under an older version accepts the current one once.
  const required = REQUIRED_CONSENT_PURPOSES_BY_SUBJECT[subjectType] ?? [];
  const legacyPurposes = subjectType === 'referral' ? ['agreement_terms'] : [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES];
  const granted = await prisma.consent.findMany({
    where: { subjectType, subjectId, granted: true, withdrawnAt: null, purpose: { in: [...new Set([...required, ...legacyPurposes])] } },
    select: { purpose: true },
  });
  const purposes = new Set(granted.map((g) => g.purpose));
  const acceptedBefore = legacyPurposes.every((p) => purposes.has(p));
  return { ...base, needsReconsent: acceptedBefore };
}

export const RECONSENT_REQUIRED_MESSAGE = 'Our terms have changed. Please open your link or the Laboura app and accept the updated terms first.';

/**
 * Review H3: while someone must accept the updated terms, the server refuses
 * paying, ID checks, interview bookings and accepting offers. The body carries
 * code RECONSENT_REQUIRED (the apps show the "We've updated our terms" screen).
 */
export class ReconsentRequiredException extends CustomerApiError {
  constructor(status: Pick<LegalStatus, 'documentKey' | 'currentVersion' | 'acceptedVersion'>) {
    super(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.RECONSENT_REQUIRED, RECONSENT_REQUIRED_MESSAGE, {
      documentKey: status.documentKey,
      currentVersion: status.currentVersion,
      acceptedVersion: status.acceptedVersion,
    });
  }
}

export async function assertTermsCurrent(prisma: Reader, subjectType: 'job_seeker' | 'referral', subjectId: string): Promise<void> {
  const status = await legalStatusOf(prisma, subjectType, subjectId);
  if (status.needsReconsent) throw new ReconsentRequiredException(status);
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { VISIT_PURPOSE_BUSINESS_SIGNUP } from '../../common/customer-auth/customer-app.constants';
import {
  StageResult,
  businessStage,
  noRecordStage,
  referralStage,
  seekerStage,
} from './signup-stage';

/** The consents a job seeker gives before the selfie (same list as the call agent console). */
export const SEEKER_REQUIRED_CONSENTS = ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'];

export interface SubjectRef {
  subjectType: string | null;
  subjectId: string | null;
}

/**
 * Reads the records an app sign-up's steps write and turns them into a stage
 * (signup-stage.ts). One read per sign-up; the tracker job calls it for the
 * sign-ups that are due.
 */
@Injectable()
export class SignupFactsService {
  constructor(private readonly prisma: PrismaService) {}

  async stageOf(profileKind: string, ref: SubjectRef): Promise<StageResult> {
    if (!ref.subjectType || !ref.subjectId) return noRecordStage(profileKind);
    if (ref.subjectType === 'job_seeker') return this.seeker(ref.subjectId);
    if (ref.subjectType === 'business') return this.business(ref.subjectId);
    if (ref.subjectType === 'referral') return this.referral(ref.subjectId);
    return noRecordStage(profileKind);
  }

  private async seeker(id: string): Promise<StageResult> {
    const [seeker, consents, idv, payments, idService] = await Promise.all([
      this.prisma.jobSeeker.findUnique({
        where: { id },
        select: { photoStoragePath: true, guaranteeFloorPaise: true, paymentReceivedAt: true },
      }),
      this.prisma.consent.findMany({
        where: { subjectType: 'job_seeker', subjectId: id, granted: true, withdrawnAt: null },
        select: { purpose: true },
      }),
      this.prisma.identityVerification.findFirst({
        where: { jobSeekerId: id },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      }),
      this.prisma.payment.findMany({ where: { jobSeekerId: id, type: 'activation' }, select: { status: true } }),
      this.prisma.kycServiceState.findUnique({ where: { id: 'id-check' } }),
    ]);
    if (!seeker) return noRecordStage('job_seeker');
    const given = new Set(consents.map((c) => c.purpose));
    return seekerStage({
      consentDone: SEEKER_REQUIRED_CONSENTS.every((p) => given.has(p)),
      selfie: Boolean(seeker.photoStoragePath),
      idVerified: idv?.status === 'verified',
      idFailed: idv?.status === 'failed',
      idServiceDown: idService?.status === 'down',
      termsAgreed: seeker.guaranteeFloorPaise !== null,
      paymentFailures: payments.filter((p) => p.status === 'failed').length,
      paid: seeker.paymentReceivedAt !== null,
    });
  }

  private async business(id: string): Promise<StageResult> {
    const [business, agreement, visits] = await Promise.all([
      this.prisma.business.findUnique({ where: { id }, select: { verificationStatus: true } }),
      this.prisma.businessAgreement.findFirst({ where: { businessId: id }, select: { id: true } }),
      this.prisma.visitAssignment.findMany({
        where: { businessId: id, purpose: { in: ['verification', VISIT_PURPOSE_BUSINESS_SIGNUP] }, status: { not: 'cancelled' } },
        select: { status: true },
      }),
    ]);
    if (!business) return noRecordStage('business');
    const status = business.verificationStatus ?? 'lead';
    return businessStage({
      agreementSigned: Boolean(agreement),
      visitBooked: visits.some((v) => v.status === 'assigned' || v.status === 'done'),
      visitRequested: visits.some((v) => v.status === 'pending'),
      visitDone: status === 'pending_tl_check' || visits.some((v) => v.status === 'done'),
      verified: status === 'verified',
      rejected: status === 'rejected',
    });
  }

  private async referral(id: string): Promise<StageResult> {
    const [referral, terms, idv, account] = await Promise.all([
      this.prisma.referral.findUnique({ where: { id }, select: { photoStoragePath: true } }),
      this.prisma.consent.findFirst({
        where: { subjectType: 'referral', subjectId: id, purpose: 'agreement_terms', granted: true, withdrawnAt: null },
        select: { id: true },
      }),
      this.prisma.referralIdentityVerification.findFirst({
        where: { referralId: id },
        orderBy: { createdAt: 'desc' },
        select: { status: true, nameMatches: true, isAdult: true },
      }),
      this.prisma.payoutAccount.findFirst({
        where: { ownerType: 'referral', ownerId: id, status: { not: 'superseded' } },
        orderBy: { createdAt: 'desc' },
        select: { status: true, nameMatches: true },
      }),
    ]);
    if (!referral) return noRecordStage('referral');
    const idVerified = idv?.status === 'verified' && idv.nameMatches === true && idv.isAdult === true;
    return referralStage({
      termsAccepted: Boolean(terms),
      selfie: Boolean(referral.photoStoragePath),
      idVerified,
      idFailed: Boolean(idv) && !idVerified && idv?.status !== 'pending',
      upiAdded: Boolean(account),
      upiVerified: account?.status === 'verified',
      upiNameMismatch: account?.nameMatches === false,
    });
  }
}

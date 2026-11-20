import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ConsentClock } from '../consent/consent-clock';
import { receiptToken } from '../payment/receipt-link';
import { ensurePayPageToken } from '../payment/pay-page-token';
import { calculateAge } from './job-seeker.validator';
import { buildJourneyStatus, JourneyStatus, maskPublicPhone, publicLanguage, PublicLanguage } from './registration-journey';
import { LegalDocumentService, LegalStatus } from '../legal/legal-document.service';
import { DEFAULT_NOTICE_VERSION } from '../consent/consent.constants';

export interface JourneyLocked {
  otpRequired: true;
  maskedPhone: string;
  language: PublicLanguage | null;
  /** Lets a page that waits for the bank stop polling without a fresh OTP. Nothing else is shown. */
  registrationComplete: boolean;
}

/** payPageToken (INF-1): opens his ₹499 pay page while it waits for money; the UPI reference no longer does. */
export type JourneyResponse = JourneyLocked | (JourneyStatus & { receiptToken: string | null; payPageToken: string | null; reconsent: LegalStatus | null });

/** Loads what the public registration pages need (see registration-journey.ts). */
@Injectable()
export class RegistrationJourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly clock: ConsentClock,
    @Optional() private readonly legal?: LegalDocumentService,
  ) {}

  async status(jobSeekerId: string, otpVerified: boolean): Promise<JourneyResponse> {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
      select: {
        id: true, name: true, code: true, phone: true, messageLanguage: true, photoStoragePath: true,
        paymentReceivedAt: true, termsAcceptedAt: true, guaranteeFloorPaise: true, dateOfBirth: true,
      },
    });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    if (!otpVerified) {
      return {
        otpRequired: true,
        maskedPhone: maskPublicPhone(seeker.phone),
        language: publicLanguage(seeker.messageLanguage),
        registrationComplete: Boolean(seeker.paymentReceivedAt),
      };
    }
    const [policy, consents, latestVerification, latestPayment, under18Stop, anyVerified] = await Promise.all([
      this.pricing.current(),
      this.prisma.consent.findMany({
        where: { subjectType: 'job_seeker', subjectId: seeker.id, granted: true, withdrawnAt: null },
        select: { purpose: true, noticeVersion: true },
      }),
      this.prisma.identityVerification.findFirst({
        where: { jobSeekerId: seeker.id },
        orderBy: { createdAt: 'desc' },
        select: { status: true, nameMatches: true, isAdult: true, failureReason: true },
      }),
      this.prisma.payment.findFirst({
        where: { jobSeekerId: seeker.id, type: 'activation' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, upiReference: true, expectedAmountPaise: true, payerUtrHint: true, confirmedAt: true },
      }),
      this.prisma.identityVerification.findFirst({
        where: { jobSeekerId: seeker.id, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', isAdult: false, under18LiftedAt: null },
        select: { id: true },
      }),
      // The same gate as the payment (id-payment-gate.ts): any verified check counts.
      this.prisma.identityVerification.findFirst({
        where: { jobSeekerId: seeker.id, status: 'verified', nameMatches: true, isAdult: true },
        select: { id: true },
      }),
    ]);
    const now = this.clock.now();
    const status = buildJourneyStatus({
      seeker: {
        ...seeker,
        isUnder18ByDateOfBirth: seeker.dateOfBirth ? calculateAge(seeker.dateOfBirth, now) < policy.adultMinimumAge : false,
      },
      grantedPurposes: consents.map((row) => row.purpose),
      grantedUnderCurrentNotice: consents.filter((row) => row.noticeVersion === DEFAULT_NOTICE_VERSION).map((row) => row.purpose),
      latestVerification,
      latestPayment,
      activationFeePaise: policy.activationFeePaise,
      guaranteeDays: policy.jobSeekerGuaranteeDays,
      under18Stop: Boolean(under18Stop),
      anyVerifiedCheck: Boolean(anyVerified),
    });
    // Accepted an older terms / notice version: "We've updated our terms" comes first (rev 176).
    const legalStatus = status.currentStep !== 'consent' && this.legal ? await this.legal.status('job_seeker', seeker.id) : null;
    return {
      ...status,
      receiptToken: status.payment.paymentId ? receiptToken(status.payment.paymentId) : null,
      payPageToken: latestPayment && latestPayment.status === 'pending' && status.payment.upiReference
        ? await ensurePayPageToken(this.prisma, latestPayment.id)
        : null,
      reconsent: legalStatus?.needsReconsent ? legalStatus : null,
    };
  }
}

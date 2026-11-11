import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ConsentClock } from '../consent/consent-clock';
import { receiptToken } from '../payment/receipt-link';
import { calculateAge } from './job-seeker.validator';
import { buildJourneyStatus, JourneyStatus, maskPublicPhone, publicLanguage, PublicLanguage } from './registration-journey';

export interface JourneyLocked {
  otpRequired: true;
  maskedPhone: string;
  language: PublicLanguage | null;
  /** Lets a page that waits for the bank stop polling without a fresh OTP. Nothing else is shown. */
  registrationComplete: boolean;
}

export type JourneyResponse = JourneyLocked | (JourneyStatus & { receiptToken: string | null });

/** Loads what the public registration pages need (see registration-journey.ts). */
@Injectable()
export class RegistrationJourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly clock: ConsentClock,
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
    const [policy, consents, latestVerification, latestPayment, idService, waiting] = await Promise.all([
      this.pricing.current(),
      this.prisma.consent.findMany({
        where: { subjectType: 'job_seeker', subjectId: seeker.id, granted: true, withdrawnAt: null },
        select: { purpose: true },
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
      this.prisma.kycServiceState.findUnique({ where: { id: 'id-check' }, select: { status: true } }),
      this.prisma.kycRecoveryRequest.findFirst({ where: { jobSeekerId: seeker.id, status: 'waiting' }, select: { id: true } }),
    ]);
    const now = this.clock.now();
    const status = buildJourneyStatus({
      seeker: {
        ...seeker,
        isUnder18ByDateOfBirth: seeker.dateOfBirth ? calculateAge(seeker.dateOfBirth, now) < policy.adultMinimumAge : false,
      },
      grantedPurposes: consents.map((row) => row.purpose),
      latestVerification,
      latestPayment,
      activationFeePaise: policy.activationFeePaise,
      guaranteeDays: policy.jobSeekerGuaranteeDays,
      idServiceDown: idService?.status === 'down',
      waitingForIdService: Boolean(waiting),
    });
    return {
      ...status,
      receiptToken: status.payment.paymentId ? receiptToken(status.payment.paymentId) : null,
    };
  }
}

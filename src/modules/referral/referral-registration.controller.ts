import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { KycRecoveryService } from '../../common/kyc/kyc-recovery.service';
import { AuditService } from '../../common/audit/audit.service';
import { ConsentClock } from '../consent/consent-clock';
import { ConsentService } from '../consent/consent.service';
import { PayoutAccountService } from '../payout-account/payout-account.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { assertNoRawAadhaar } from '../job-seeker/job-seeker.validator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { Public } from '../../common/rbac/public.decorator';
import { CheckLinkBeforeUpload } from '../../common/public-link-upload.guard';
import { PricingService } from '../pricing/pricing.service';
import { publicLanguage, shortNameOf } from '../job-seeker/registration-journey';

@Controller()
export class ReferralRegistrationController {
  constructor(
    private readonly links: PublicLinkStoreService,
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly kyc: KycRecoveryService,
    private readonly audit: AuditService,
    private readonly clock: ConsentClock,
    private readonly consent: ConsentService,
    private readonly payouts: PayoutAccountService,
    private readonly flags: ReviewFlagService,
    @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photos: CandidatePhotoStorage,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Where the partner's one link stands (web: /app/p/partner/:token and each
   * step after it). Without a verified code to their own number it shows only
   * the masked number, the language and whether everything is done.
   */
  @Get('referral-registration/:token/status')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async getLinkStatus(@Param('token') token: string, @Query('requestId') requestId: string | undefined) {
    const link = await this.requireLink(token);
    if (!requestId || !(await this.otp.isVerified(requestId, link.phone ?? ''))) {
      const done = await this.status(link.subjectId);
      return {
        valid: true,
        otpRequired: true,
        maskedPhone: this.maskPhone(link.phone ?? ''),
        language: publicLanguage(link.language),
        registrationComplete: done.currentStep === 'complete',
      };
    }
    return this.publicStatus(link);
  }

  /** The partner types the code sent to their own number (POST /consent/send-otp); the answer is the open status. */
  @Post('referral-registration/:token/verify-otp')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async verifyOtp(@Param('token') token: string, @Body() body: { requestId?: string; code?: string }) {
    const link = await this.requireLink(token);
    if (!body?.requestId || !body.code || !/^\d{4,8}$/.test(body.code)) throw new BadRequestException('Type the code from the SMS');
    const ok = await this.otp.verifyOtp(body.requestId, body.code);
    if (!ok || !(await this.otp.isVerified(body.requestId, link.phone ?? ''))) {
      throw new BadRequestException('Wrong or expired code. Check the SMS or ask for a new code.');
    }
    return this.publicStatus(link);
  }

  /**
   * The referral terms frozen on the link when it was sent (amount, version,
   * language and the full text), shown before the partner agrees. Only after
   * their code: the page shows nothing about them before that.
   */
  @Get('referral-registration/:token/terms')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async getTerms(@Param('token') token: string, @Query('requestId') requestId: string | undefined) {
    const link = await this.requireVerifiedLink(token, requestId);
    const terms = ((link.metadata ?? {}) as { terms?: { referralPayoutPaise?: number; version?: string; language?: string; termsHtml?: string } }).terms ?? {};
    const policy = await this.pricing.current();
    return {
      referralPayoutPaise: terms.referralPayoutPaise ?? policy.referralPayoutPaise,
      version: terms.version ?? null,
      language: publicLanguage(terms.language ?? null),
      termsHtml: terms.termsHtml ?? '',
      payoutDetailsCoolingHours: policy.payoutDetailsCoolingHours,
      activationFeePaise: policy.activationFeePaise,
    };
  }

  @Post('referral-registration/:token/selfie')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  @CheckLinkBeforeUpload('referral_registration', 'referral', 'A valid referral registration link is required')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadSelfie(
    @Param('token') token: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Body() body: { requestId?: string; captureSource?: string },
  ) {
    const link = await this.requireVerifiedLink(token, body.requestId);
    if (body.captureSource !== 'live_camera') throw new BadRequestException('A live camera capture is required; gallery uploads are refused');
    if (!photo?.buffer.length || !photo.mimetype.toLowerCase().startsWith('image/')) throw new BadRequestException('A live camera image is required');
    if (!(await this.consent.hasConsent('referral', link.subjectId, 'agreement_terms')) || !(await this.consent.hasConsent('referral', link.subjectId, 'call_recording'))) {
      throw new BadRequestException('Referral terms and call-recording consent are required before the selfie');
    }
    const referral = await this.prisma.referral.findUnique({ where: { id: link.subjectId } });
    if (!referral) throw new BadRequestException('Referral partner not found');
    const path = `referrals/${referral.id}/profile-photo`;
    const photoTakenAt = this.clock.now();
    await this.photos.put(path, photo.buffer, photo.mimetype);
    const updated = await this.prisma.referral.update({ where: { id: referral.id }, data: { photoStoragePath: path, photoTakenAt } });
    await this.audit.log({
      actorId: link.createdByStaffId ?? 'system',
      action: 'referral.photo_uploaded',
      entityType: 'referral',
      entityCode: referral.code,
      before: { photoStoragePath: referral.photoStoragePath, photoTakenAt: referral.photoTakenAt?.toISOString() ?? null },
      after: { photoStoragePath: path, photoTakenAt: photoTakenAt.toISOString() },
      changedFields: ['photoStoragePath', 'photoTakenAt'],
      reason: 'Referral partner uploaded a live camera capture through their registration link',
      city: referral.city,
    });
    return { referralId: updated.id, capturedAt: updated.photoTakenAt };
  }

  @Post('referral-registration/:token/id-check')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async verifyIdentity(@Param('token') token: string, @Body() body: Record<string, unknown> & { requestId?: string }) {
    const link = await this.requireVerifiedLink(token, body.requestId);
    assertNoRawAadhaar(body);
    if (!(await this.consent.hasConsent('referral', link.subjectId, 'agreement_terms')) || !(await this.consent.hasConsent('referral', link.subjectId, 'call_recording'))) {
      throw new BadRequestException('Referral terms and call-recording consent are required before ID verification');
    }
    const referral = await this.prisma.referral.findUnique({ where: { id: link.subjectId } });
    if (!referral) throw new BadRequestException('Referral partner not found');
    if (!referral.photoStoragePath) throw new BadRequestException('Complete the live-camera selfie before the ID check');
    const providerInput = { ...body, candidateName: referral.name };
    delete providerInput.requestId;
    const result = await this.kyc.verify(providerInput);
    const verification = await this.prisma.referralIdentityVerification.create({
      data: {
        referralId: referral.id,
        method: typeof body.method === 'string' ? body.method : 'digilocker',
        vendor: 'configured_kyc_provider',
        vendorReference: result.vendorReference,
        status: result.status,
        last4: result.last4 ?? null,
        nameMatches: result.nameMatches ?? null,
        isAdult: result.isAdult ?? null,
        verifiedAt: result.status === 'verified' ? this.clock.now() : null,
        failureReason: result.error ?? null,
      },
    });
    await this.audit.log({
      actorId: link.createdByStaffId ?? 'system',
      action: 'referral.identity_verified',
      entityType: 'referral_identity_verification',
      entityCode: verification.id,
      after: { referralId: referral.id, method: verification.method, status: verification.status, last4: verification.last4, nameMatches: verification.nameMatches, isAdult: verification.isAdult },
      changedFields: ['method', 'status', 'last4', 'nameMatches', 'isAdult'],
      reason: 'Identity verification completed through the referral registration link',
      city: referral.city,
    });
    if (result.nameMatches === false) {
      await this.flags.raise({ kind: 'name_check', subjectType: 'referral', subjectId: referral.id, details: { identityVerificationId: verification.id } });
    }
    return { ...verification, nextStep: result.status === 'verified' && result.isAdult === true && result.nameMatches === true ? 'upi' : 'id_check' };
  }

  @Post('referral-registration/:token/upi')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async submitUpi(
    @Param('token') token: string,
    @Body() body: { otpRequestId?: string; otpCode?: string; method?: 'upi' | 'bank'; upiId?: string; accountNumber?: string; ifsc?: string },
  ) {
    const link = await this.requireLink(token);
    const verification = await this.prisma.referralIdentityVerification.findFirst({
      where: { referralId: link.subjectId },
      orderBy: { createdAt: 'desc' },
    });
    if (!verification || verification.status !== 'verified' || verification.nameMatches !== true || verification.isAdult !== true) {
      throw new BadRequestException('A successful ID check is required before entering UPI details');
    }
    if (!(await this.consent.hasConsent('referral', link.subjectId, 'agreement_terms')) || !(await this.consent.hasConsent('referral', link.subjectId, 'call_recording'))) {
      throw new BadRequestException('Referral terms and call-recording consent are required');
    }
    if (!body.otpRequestId) throw new BadRequestException('OTP to the registered mobile is required');
    // On the partner's own link the code they verified on opening it (still within its
    // lifetime) proves the number for the first details, the same as every other step;
    // a fresh code works too.
    // A change to details already given always needs a fresh code (and its waiting time).
    const hasDetails = (await this.prisma.payoutAccount.count({ where: { ownerType: 'referral', ownerId: link.subjectId, status: { not: 'superseded' } } })) > 0;
    const sessionVerified = !body.otpCode && !hasDetails && (await this.otp.isVerified(body.otpRequestId, link.phone ?? ''));
    if (!body.otpCode && !sessionVerified) throw new BadRequestException('OTP to the registered mobile is required');
    // Guide, referral partners: UPI ID preferred, bank account as the alternative. Both are
    // kept encrypted, shown masked, and revealed only to the CEO and Finance (logged).
    const method = body.method ?? 'upi';
    if (method !== 'upi' && method !== 'bank') throw new BadRequestException("method is 'upi' or 'bank'");
    return this.payouts.submitPayoutAccount({
      token,
      otpRequestId: body.otpRequestId,
      otpCode: body.otpCode ?? '',
      method,
      ...(method === 'upi' ? { upiId: body.upiId } : { accountNumber: body.accountNumber, ifsc: body.ifsc }),
    }, undefined, sessionVerified ? { otpVerifiedForPhone: link.phone ?? '' } : {});
  }

  @Get('referrals/:id/registration-status')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo', 'finance')
  async getRegistrationStatus(@Param('id') id: string) {
    return this.status(id);
  }

  private async status(referralId: string, registrationLinkExpiresAt?: Date) {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      include: { identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!referral) throw new BadRequestException('Referral partner not found');
    const [terms, account] = await Promise.all([
      this.prisma.consent.findFirst({ where: { subjectType: 'referral', subjectId: referral.id, purpose: 'agreement_terms', granted: true, withdrawnAt: null }, select: { grantedAt: true } }),
      this.prisma.payoutAccount.findFirst({ where: { ownerType: 'referral', ownerId: referral.id, status: { not: 'superseded' } }, orderBy: { createdAt: 'desc' }, select: { status: true, nameMatches: true, createdAt: true } }),
    ]);
    const identity = referral.identityVerifications[0];
    const steps = {
      terms: { state: terms ? 'done' : 'not_started', time: terms?.grantedAt ?? null },
      selfie: { state: referral.photoStoragePath ? 'done' : terms ? 'not_started' : 'stuck', time: referral.photoTakenAt },
      id: { state: identity?.status === 'verified' && identity.nameMatches === true && identity.isAdult === true ? 'done' : identity ? 'stuck' : 'not_started', time: identity?.verifiedAt ?? identity?.createdAt ?? null, reason: identity?.failureReason ?? (identity?.nameMatches !== true ? 'ID name did not match the referral profile' : identity?.isAdult !== true ? 'Adult status could not be confirmed' : null) },
      upi: { state: account?.status === 'verified' ? 'done' : account ? 'in_progress' : 'not_started', time: account?.createdAt ?? null, reason: account?.nameMatches === false ? 'UPI or bank account name did not match the verified identity' : null },
    };
    const currentStep = steps.terms.state !== 'done'
      ? 'terms'
      : steps.selfie.state !== 'done'
        ? 'selfie'
        : steps.id.state !== 'done'
          ? 'id_check'
          : steps.upi.state !== 'done'
            ? 'upi'
            : 'complete';
    return {
      referralId: referral.id,
      steps,
      currentStep,
      ...(registrationLinkExpiresAt ? { registrationLinkExpiresAt } : {}),
    };
  }

  /** The open status for the partner's own page: steps plus what each page needs (masked, no ID numbers). */
  private async publicStatus(link: Awaited<ReturnType<PublicLinkStoreService['findByToken']>>) {
    const [base, referral, identity, account, idServiceDown] = await Promise.all([
      this.status(link.subjectId, link.expiresAt),
      this.prisma.referral.findUnique({ where: { id: link.subjectId }, select: { code: true, name: true, type: true, language: true } }),
      this.prisma.referralIdentityVerification.findFirst({ where: { referralId: link.subjectId }, orderBy: { createdAt: 'desc' }, select: { status: true, nameMatches: true, isAdult: true } }),
      this.prisma.payoutAccount.findFirst({
        where: { ownerType: 'referral', ownerId: link.subjectId, status: { not: 'superseded' } },
        orderBy: { createdAt: 'desc' },
        select: { method: true, maskedValue: true, status: true, nameMatches: true },
      }),
      this.kyc.isDown().catch(() => false),
    ]);
    if (!referral) throw new BadRequestException('Referral partner not found');
    const lastResult = !identity
      ? 'none'
      : identity.status === 'verified' && identity.isAdult === false
        ? 'under_18'
        : identity.nameMatches === false
          ? 'name_mismatch'
          : identity.status === 'verified'
            ? 'verified'
            : 'failed';
    return {
      ...base,
      otpRequired: false,
      maskedPhone: this.maskPhone(link.phone ?? ''),
      language: publicLanguage(link.language ?? referral.language),
      firstName: shortNameOf(referral.name),
      referralCode: referral.code,
      partnerType: referral.type === 'business' ? 'business' : 'individual',
      idCheck: { serviceDown: idServiceDown, lastResult },
      stopped: lastResult === 'under_18' ? 'under_18' : null,
      payout: account
        ? { method: account.method, maskedValue: account.maskedValue, status: account.status, nameMatches: account.nameMatches }
        : null,
    };
  }

  private async requireLink(token: string) {
    const link = await this.links.findByToken(token, this.clock.now());
    if (link.purpose !== 'referral_registration' || link.subjectType !== 'referral' || !link.phone) throw new BadRequestException('A valid referral registration link is required');
    return link;
  }

  private async requireVerifiedLink(token: string, requestId?: string) {
    const link = await this.requireLink(token);
    if (!requestId || !(await this.otp.isVerified(requestId, link.phone ?? ''))) throw new BadRequestException('OTP to the registered mobile is required');
    return link;
  }

  private maskPhone(phone: string) {
    return `******${phone.replace(/\D/g, '').slice(-4)}`;
  }
}

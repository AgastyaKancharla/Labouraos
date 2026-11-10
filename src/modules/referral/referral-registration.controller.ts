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
  ) {}

  @Get('referral-registration/:token/status')
  async getLinkStatus(@Param('token') token: string, @Query('requestId') requestId: string | undefined) {
    const link = await this.requireLink(token);
    if (!requestId || !(await this.otp.isVerified(requestId, link.phone ?? ''))) {
      return { valid: true, otpRequired: true, maskedPhone: this.maskPhone(link.phone ?? '') };
    }
    return this.status(link.subjectId, link.expiresAt);
  }

  @Post('referral-registration/:token/selfie')
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
  async submitUpi(
    @Param('token') token: string,
    @Body() body: { otpRequestId?: string; otpCode?: string; method?: 'upi'; upiId?: string },
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
    if (!body.otpRequestId || !body.otpCode) throw new BadRequestException('OTP to the registered mobile is required');
    if (body.method && body.method !== 'upi') throw new BadRequestException('Referral registration accepts UPI details only');
    return this.payouts.submitPayoutAccount({
      token,
      otpRequestId: body.otpRequestId,
      otpCode: body.otpCode,
      method: 'upi',
      upiId: body.upiId,
    });
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
      upi: { state: account?.status === 'verified' ? 'done' : account ? 'in_progress' : 'not_started', time: account?.createdAt ?? null, reason: account?.nameMatches === false ? 'UPI name did not match the verified identity' : null },
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

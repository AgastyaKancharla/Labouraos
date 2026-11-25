import { otpChannel } from '../../common/otp/otp.controller';
import { LINK_SENDING_ROLES, linkChannel } from '../message/link-channel';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CheckLinkBeforeUpload } from '../../common/public-link-upload.guard';
import { parseOwnerPhotoLocation, parseOwnerPhotoSlot, parseShopVariant } from '../business/business-owner-photo.service';
import { Response } from 'express';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { ConsentLinkService, SubmitConsentDto } from './consent-link.service';
import { ConsentWithdrawalService, AgentConsentWithdrawalDto } from './consent-withdrawal.service';
import { renderReferralTermsPageHtml } from './consent-page.template';
import { publicPageLink, wantsHtml } from '../../common/public-pages';
import { Public } from '../../common/rbac/public.decorator';
import { withoutLinkToken } from '../../common/public-link-response';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('consent')
export class ConsentController {
  constructor(
    private readonly consentLinkService: ConsentLinkService,
    private readonly consentWithdrawalService: ConsentWithdrawalService,
  ) {}

  @Post('withdraw')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  // A Team Lead: only their own team's job seekers (owner rule, 14 Nov).
  @RequirePermission('job_seeker', 'write', { kind: 'job_seeker', from: 'body:jobSeekerId' })
  withdraw(@Body() body: AgentConsentWithdrawalDto, @Req() req: AuthenticatedRequest) {
    return this.consentWithdrawalService.withdraw(
      { id: req.user.sub, role: req.user.role },
      body,
    );
  }

  @Get('withdrawal-eligibility')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('job_seeker', 'read', { kind: 'job_seeker', from: 'query:jobSeekerId' })
  withdrawalEligibility(@Query('jobSeekerId') jobSeekerId: string, @Req() req: AuthenticatedRequest) {
    return this.consentWithdrawalService.eligibility({ id: req.user.sub }, jobSeekerId);
  }

  /**
   * Generates a short-lived, single-use token and dispatches SMS link.
   * Scoped to staff: call_agent, field_agent, team_lead, manager, ceo.
   * Response NEVER returns the candidate's phone number.
   */
  @Post('links')
  @UseGuards(JwtAuthGuard, RbacGuard)
  // Rev 211: only agents press send buttons; Team Leads, Managers and the CEO keep the stuck view.
  @RequireRoles(...LINK_SENDING_ROLES)
  @RequirePermission('job_seeker', 'write', { kind: 'job_seeker', from: 'body:jobSeekerId' })
  async createLink(@Body('jobSeekerId') jobSeekerId: string, @Body('channel') channel: unknown, @Req() req: AuthenticatedRequest) {
    // AC-3: the link goes to the person (WhatsApp first, SMS as backup; or "Send by SMS"); staff never get its token.
    return withoutLinkToken(await this.consentLinkService.createLink(jobSeekerId, { channel: linkChannel(channel), sentByStaffId: req.user.sub }));
  }

  /**
   * Public endpoint to render consent capture page or return token details.
   */
  @Get(':token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async getConsentPage(
    @Param('token') token: string,
    @Query('requestId') requestId: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Links already sent by SMS open the new phone pages (/p/...) in a browser.
    if (wantsHtml(accept)) {
      const page = await this.consentLinkService.publicPageForToken(token);
      if (page) {
        res.redirect(302, publicPageLink(page, token));
        return;
      }
    }
    const details = await this.consentLinkService.getTokenDetails(token, requestId);

    if (wantsHtml(accept) && details.subjectType === 'referral') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // Only reached when the new page could not be chosen; before the code it names nobody.
      return renderReferralTermsPageHtml(
        token,
        details.otpRequired ? '' : details.partnerName,
        details.maskedPhone,
        details.otpRequired ? '' : details.termsHtml,
      );
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return details;
  }

  /** After signing, the used agreement link still shows it was signed (P04b). */
  @Get(':token/signed')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async signedAgreement(@Param('token') token: string) {
    const signed = await this.consentLinkService.signedAgreementForLink(token);
    return {
      signedAt: signed.signedAt,
      signedName: signed.signedName,
      businessName: signed.businessName,
      preferredLanguage: signed.preferredLanguage,
    };
  }

  /** The signed copy, as stored when the owner signed (read-only). */
  @Get(':token/signed/copy')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async signedAgreementCopy(@Param('token') token: string, @Res() res: Response) {
    const copy = await this.consentLinkService.signedAgreementDocumentForLink(token);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="laboura-agreement.html"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.send(copy.body);
  }

  /**
   * Public endpoint to request an OTP to the candidate's registered phone.
   */
  @Post('send-otp')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async sendOtp(@Body('token') token: string, @Body('channel') channel?: unknown) {
    // "Send by SMS" (rev 211) after 30 seconds; otherwise WhatsApp first.
    return this.consentLinkService.sendOtp(token, otpChannel(channel));
  }

  /**
   * Public endpoint to verify OTP and submit consent purposes.
   * Advances job seeker status from lead to consented when all 5 required purposes are granted.
   */
  @Post('submit')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async submitConsent(@Body() body: SubmitConsentDto) {
    return this.consentLinkService.submitConsent(body);
  }

  /**
   * 25 Nov (rev 211, B1): before signing, the owner takes a live selfie (kind=selfie) and a live
   * photo of the shop's name board — for a home business himself holding the FSSAI licence —
   * (kind=shop) on the agreement page. Camera only (captureSource=live_camera); the phone's
   * location goes with the shop photo (latitude, longitude, accuracyMeters, or
   * locationStatus=refused). The link token is checked before the file is read.
   */
  @Post(':token/owner-photo')
  @Public('token page: the business owner proves who he is with the agreement link token')
  @CheckLinkBeforeUpload('business_agreement', 'business', 'A valid business agreement link is required')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async ownerPhoto(
    @Param('token') token: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.consentLinkService.saveAgreementOwnerPhoto(token, {
      slot: parseOwnerPhotoSlot(body?.kind),
      shopVariant: parseShopVariant(body?.shopVariant),
      photo: photo?.buffer ?? Buffer.alloc(0),
      captureSource: typeof body?.captureSource === 'string' ? body.captureSource : undefined,
      location: parseOwnerPhotoLocation(body ?? {}),
    });
  }

  // ---- 25 Nov (rev 212, B9): small businesses with little paperwork, on the agreement link ----

  /** Which small-business steps are done (works before and after signing, until the link expires). */
  @Get(':token/small-business')
  @Public('token page: the business owner proves who he is with the agreement link token')
  async smallBusiness(@Param('token') token: string) {
    return this.consentLinkService.smallBusinessState(token);
  }

  /** (a) The owner's Aadhaar Secure QR text, read on his phone (only the result, last 4 and name are kept). */
  @Post(':token/small-business/aadhaar-qr')
  @Public('token page: the business owner proves who he is with the agreement link token')
  async smallBusinessAadhaar(@Param('token') token: string, @Body() body: { qrText?: unknown }) {
    return this.consentLinkService.smallBusinessAadhaar(token, body?.qrText);
  }

  /** (a) A live photo of PAN, driving licence or voter ID with the number and name typed: the Team Lead checks it. */
  @Post(':token/small-business/other-id')
  @Public('token page: the business owner proves who he is with the agreement link token')
  @CheckLinkBeforeUpload('business_agreement', 'business', 'A valid business agreement link is required', { allowUsed: true })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async smallBusinessOtherId(
    @Param('token') token: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.consentLinkService.smallBusinessOtherId(token, {
      idType: body?.idType, idNumber: body?.idNumber, nameOnId: body?.nameOnId,
      photo: photo?.buffer ?? Buffer.alloc(0), captureSource: typeof body?.captureSource === 'string' ? body.captureSource : undefined,
    });
  }

  /** (d) One address proof photo (bank statement, electricity bill, rent agreement or similar). */
  @Post(':token/small-business/address-proof')
  @Public('token page: the business owner proves who he is with the agreement link token')
  @CheckLinkBeforeUpload('business_agreement', 'business', 'A valid business agreement link is required', { allowUsed: true })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async smallBusinessAddressProof(
    @Param('token') token: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.consentLinkService.smallBusinessAddressProof(token, {
      docType: body?.docType, photo: photo?.buffer ?? Buffer.alloc(0), captureSource: typeof body?.captureSource === 'string' ? body.captureSource : undefined,
    });
  }

  /** (c) One business proof: a registration number, a business bank / UPI account, or a website or listing link. */
  @Post(':token/small-business/business-proof')
  @Public('token page: the business owner proves who he is with the agreement link token')
  async smallBusinessProof(@Param('token') token: string, @Body() body: { kind?: unknown; value?: unknown }) {
    return this.consentLinkService.smallBusinessProof(token, { kind: body?.kind, value: body?.value });
  }

  /** "We've updated our terms": accept the current version on the job seeker's or partner's link (rev 176). */
  @Post('reconsent')
  @Public('token page: the job seeker or partner accepts the updated terms with the link token and their OTP')
  async submitReconsent(@Body() body: SubmitConsentDto) {
    return this.consentLinkService.submitReconsent(body);
  }
}

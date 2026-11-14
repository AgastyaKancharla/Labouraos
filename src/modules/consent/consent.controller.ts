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
  UseGuards,
} from '@nestjs/common';
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
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('job_seeker', 'write', { kind: 'job_seeker', from: 'body:jobSeekerId' })
  async createLink(@Body('jobSeekerId') jobSeekerId: string) {
    return this.consentLinkService.createLink(jobSeekerId);
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
        details.preferredLanguage as 'kn' | 'hi' | 'en',
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
  async sendOtp(@Body('token') token: string) {
    return this.consentLinkService.sendOtp(token);
  }

  @Post('id-check-wait')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async requestIdCheckRecovery(@Body() body: { token: string; requestId: string; code: string }) {
    return this.consentLinkService.requestIdCheckRecovery(body.token, body.requestId, body.code);
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
}

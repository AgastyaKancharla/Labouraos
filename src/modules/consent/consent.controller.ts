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
import {
  renderBusinessAgreementPageHtml,
  renderConsentPageHtml,
} from './consent-page.template';

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
  withdraw(@Body() body: AgentConsentWithdrawalDto, @Req() req: AuthenticatedRequest) {
    return this.consentWithdrawalService.withdraw(
      { id: req.user.sub, role: req.user.role },
      body,
    );
  }

  @Get('withdrawal-eligibility')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
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
  @RequirePermission('job_seeker', 'write')
  async createLink(@Body('jobSeekerId') jobSeekerId: string) {
    return this.consentLinkService.createLink(jobSeekerId);
  }

  /**
   * Public endpoint to render consent capture page or return token details.
   */
  @Get(':token')
  async getConsentPage(
    @Param('token') token: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const details = await this.consentLinkService.getTokenDetails(token);

    if (accept && accept.includes('text/html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (details.subjectType === 'business') {
        return renderBusinessAgreementPageHtml(
          token,
          details.businessName,
          details.maskedPhone,
          details.agreementTermsHtml,
          details.preferredLanguage as 'kn' | 'hi' | 'en',
        );
      }
      return renderConsentPageHtml(
        token,
        details.candidateName,
        details.preferredLanguage as 'kn' | 'hi' | 'en',
      );
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return details;
  }

  /**
   * Public endpoint to request an OTP to the candidate's registered phone.
   */
  @Post('send-otp')
  async sendOtp(@Body('token') token: string) {
    return this.consentLinkService.sendOtp(token);
  }

  /**
   * Public endpoint to verify OTP and submit consent purposes.
   * Advances job seeker status from lead to consented when all 5 required purposes are granted.
   */
  @Post('submit')
  async submitConsent(@Body() body: SubmitConsentDto) {
    return this.consentLinkService.submitConsent(body);
  }
}

import { Controller, Get, Param, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { ScreensCallRegistrationService } from './screens-call-registration.service';

/**
 * Reads for the registration screens of the call agent console (CA08–CA15).
 * The guide's registration form is "used by everyone — call agents, field
 * agents, Team Leads and above", so those roles may read; Finance may not.
 * Phone numbers are masked for everyone except the CEO and money is stripped
 * for Managers by PiiMaskingInterceptor.
 */
const REGISTERING_ROLES = ['call_agent', 'field_agent', 'team_lead', 'manager', 'ceo'] as const;

@Controller('screens/call-registration')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class ScreensCallRegistrationController {
  constructor(private readonly service: ScreensCallRegistrationService) {}

  @Get('options')
  @RequireRoles(...REGISTERING_ROLES)
  options() {
    return this.service.options();
  }

  @Get('job-seekers/:id')
  @RequireRoles(...REGISTERING_ROLES)
  @RequirePermission('job_seeker', 'read')
  jobSeeker(@Param('id') id: string) {
    return this.service.jobSeeker(id);
  }

  @Get('job-seekers/:id/signed-consent')
  @RequireRoles(...REGISTERING_ROLES)
  @RequirePermission('job_seeker', 'read')
  signedConsent(@Param('id') id: string) {
    return this.service.signedConsent(id);
  }

  @Get('records/:code')
  @RequireRoles(...REGISTERING_ROLES)
  record(@Param('code') code: string, @Req() req: Request & { user: JwtPayload }) {
    return this.service.record(code, { id: req.user.sub, role: req.user.role });
  }

  @Get('referral-partners')
  @RequireRoles(...REGISTERING_ROLES)
  @RequirePermission('referral', 'read')
  async findReferralPartner(@Query('q') q: string) {
    return { partner: await this.service.findReferralPartner(q) };
  }

  @Get('businesses')
  @RequireRoles(...REGISTERING_ROLES)
  @RequirePermission('business', 'read')
  searchBusinesses(@Query('q') q: string, @Req() req: Request & { user: JwtPayload }) {
    return this.service.searchBusinesses(q, { id: req.user.sub, role: req.user.role });
  }

  @Get('businesses/:id')
  @RequireRoles(...REGISTERING_ROLES)
  @RequirePermission('business', 'read')
  business(@Param('id') id: string) {
    return this.service.business(id);
  }

  @Get('referrals/:id')
  @RequireRoles(...REGISTERING_ROLES)
  @RequirePermission('referral', 'read')
  referral(@Param('id') id: string) {
    return this.service.referral(id);
  }
}

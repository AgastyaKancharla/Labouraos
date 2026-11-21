import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { Public } from '../../common/rbac/public.decorator';
import { CUSTOMER_API_PREFIX } from '../../common/customer-auth/customer-app.constants';
import { CurrentCustomer, CustomerRoute } from '../../common/customer-auth/customer-auth.decorators';
import { CustomerPrincipal } from '../../common/customer-auth/customer-auth.guard';
import { CustomerScopeService } from '../../common/customer-auth/customer-scope.service';
import { ReferralLeadService } from './referral-lead.service';

type AuthRequest = Request & { user: JwtPayload };
const actorOf = (req: AuthRequest) => ({ id: req.user.sub, role: req.user.role });

/** Staff: a partner's share link and QR, and the agents' list of partners' leads (rev 202). */
@Controller()
export class ReferralLeadStaffController {
  constructor(private readonly leads: ReferralLeadService) {}

  @Get('referrals/:id/share-link')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('referral', 'read')
  shareLink(@Param('id') id: string) {
    return this.leads.shareLink(id);
  }

  @Get('referral-leads')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @UseInterceptors(PiiMaskingInterceptor)
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  list(@Req() req: AuthRequest, @Query('status') status?: string) {
    return this.leads.list(actorOf(req), status);
  }

  @Post('referral-leads/:id/take')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent')
  take(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.leads.take(actorOf(req), id);
  }

  @Post('referral-leads/:id/assign')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('team_lead', 'manager', 'ceo')
  assign(@Req() req: AuthRequest, @Param('id') id: string, @Body('staffId') staffId: unknown) {
    return this.leads.assign(actorOf(req), id, staffId);
  }

  @Post('referral-leads/:id/outcome')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  close(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: { outcome?: unknown; note?: unknown; code?: unknown }) {
    return this.leads.close(actorOf(req), id, body ?? {});
  }
}

/** The public share link page /p/ref/<slug>: the person leaves their own number, checked by a code. */
@Controller('referral-links')
export class ReferralLinkPublicController {
  constructor(private readonly leads: ReferralLeadService) {}

  @Get(':slug')
  @Public('share link page: anyone a referral partner shared the link with')
  page(@Param('slug') slug: string) {
    return this.leads.publicPage(slug);
  }

  @Post(':slug/send-code')
  @HttpCode(200)
  @Public('share link page: the code goes to the number the person typed, limited per link and per number')
  sendCode(@Param('slug') slug: string, @Body('phone') phone: unknown) {
    return this.leads.sendCode(slug, phone);
  }

  @Post(':slug/leads')
  @HttpCode(200)
  @Public('share link page: the person proves their number with the code sent from this page')
  submit(@Param('slug') slug: string, @Body() body: Record<string, unknown>) {
    return this.leads.submitFromLink(slug, body ?? {});
  }
}

/**
 * The Laboura app, referral partner profiles (docs/customer-app-api.md §15):
 * the personal share link and its QR. "Send a lead" is the customer session's
 * own route (§7.3b); the office picks those leads up (referral-lead-sync.ts).
 */
@Controller(CUSTOMER_API_PREFIX)
export class ReferralLeadCustomerController {
  constructor(
    private readonly leads: ReferralLeadService,
    private readonly scope: CustomerScopeService,
  ) {}

  @Get('me/profiles/:profileId/referral/share-link')
  @CustomerRoute()
  async shareLink(@CurrentCustomer() me: CustomerPrincipal, @Param('profileId') profileId: string) {
    const profile = await this.scope.profile(me.accountId, profileId, 'referral');
    return this.leads.shareLink(profile.referralId!);
  }
}

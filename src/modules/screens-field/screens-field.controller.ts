import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { ScreensFieldService } from './screens-field.service';
import { FieldRedesignService } from './field-redesign.service';

type Authed = Request & { user: JwtPayload };

/**
 * Reads for Laboura Field (FA03 Home, FA05 Visits, FA08 Business, FA12
 * Targets, FA13 Map). The day's own work is for field agents only; the
 * business page is also open to their Team Lead and management. Phone
 * numbers are masked (only the CEO sees them in full, audit-logged).
 */
@Controller('field-work')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class ScreensFieldController {
  constructor(
    private readonly screens: ScreensFieldService,
    private readonly redesign: FieldRedesignService,
  ) {}

  /** Today tab (rev 188): attendance, today's numbers, targets bar, Needs you now. */
  @Get('today')
  @RequireRoles('field_agent')
  today(@Req() req: Authed) {
    return this.redesign.today(req.user);
  }

  /** Visits tab "Today's work": everything I did on an IST day (today by default, up to 90 days back). */
  @Get('day')
  @RequireRoles('field_agent')
  day(@Req() req: Authed, @Query('date') date?: string) {
    return this.redesign.day(req.user, date);
  }

  /** Businesses tab: my businesses, each with what it needs next. */
  @Get('businesses')
  @RequireRoles('field_agent')
  myBusinesses(@Req() req: Authed, @Query('q') q?: string) {
    return this.redesign.myBusinesses(req.user, q);
  }

  /** The one business page (rev 188); another agent's business is view-only. */
  @Get('businesses/:ref/page')
  @RequireRoles('field_agent')
  businessPage(@Req() req: Authed, @Param('ref') ref: string) {
    return this.redesign.businessPage(req.user, ref);
  }

  /** Agreement screen: turns green when the owner signs on his own phone. */
  @Get('businesses/:ref/agreement')
  @RequireRoles('field_agent')
  agreement(@Req() req: Authed, @Param('ref') ref: string) {
    return this.redesign.agreementStatus(req.user, ref);
  }

  /** "Resend agreement link" on the agent's own business (rate-limited; a failed SMS is an error). */
  @Post('businesses/:ref/agreement-link')
  @RequireRoles('field_agent')
  resendAgreement(@Req() req: Authed, @Param('ref') ref: string, @Body() body: { language?: string }) {
    return this.redesign.resendAgreement(req.user, ref, body ?? {});
  }

  /** Job seekers tab: the job seekers I registered and where each stands. */
  @Get('job-seekers')
  @RequireRoles('field_agent')
  myJobSeekers(@Req() req: Authed, @Query('q') q?: string) {
    return this.redesign.myJobSeekers(req.user, q);
  }

  @Get('home')
  @RequireRoles('field_agent')
  home(@Req() req: Authed) {
    return this.screens.home(req.user);
  }

  @Get('visits')
  @RequireRoles('field_agent')
  visits(@Req() req: Authed) {
    return this.screens.visits(req.user);
  }

  /** Where I am, shops around me by status, and revisits due nearby (also FA20's "nearby already in Laboura"). */
  @Get('map')
  @RequireRoles('field_agent')
  map(@Req() req: Authed, @Query('lat') lat?: string, @Query('lng') lng?: string, @Query('radius') radius?: string) {
    return this.screens.map(req.user, lat, lng, radius);
  }

  @Get('targets')
  @RequireRoles('field_agent')
  targets(@Req() req: Authed) {
    return this.screens.targets(req.user);
  }

  /**
   * FA08 in Laboura Field: field agents only (owner decision 14 Nov; office screens use /businesses).
   * @deprecated Rev 188: GET /field-work/businesses/:ref/page. Kept until the app switches.
   */
  @Get('businesses/:ref')
  @RequireRoles('field_agent')
  business(@Req() req: Authed, @Param('ref') ref: string) {
    return this.screens.business(req.user, ref);
  }
}

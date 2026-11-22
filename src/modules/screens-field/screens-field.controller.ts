import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { ScreensFieldService } from './screens-field.service';
import { FieldRedesignService } from './field-redesign.service';
import { FieldWorkExtrasService } from './field-work-extras.service';
import { FieldPeopleService } from './field-people.service';

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
    private readonly extras: FieldWorkExtrasService,
    private readonly people: FieldPeopleService,
  ) {}

  /** Me → "Your calling phone" (21 Nov): set or not, last 4 digits (set it with PUT /staff/:id/call-routing-phone). */
  @Get('calling-phone')
  @RequireRoles('field_agent')
  callingPhone(@Req() req: Authed) {
    return this.extras.callingPhone(req.user);
  }

  /** The Field bell (21 Nov): notifications with where each opens; mark read with POST /notifications/:id/seen. */
  @Get('notifications')
  @RequireRoles('field_agent')
  notifications(@Req() req: Authed, @Query('limit') limit?: string) {
    return this.extras.notificationsList(req.user, { limit });
  }

  /** Open verification visits as job cards: address, owner, phone last 4, map pin, last try (21 Nov). */
  @Get('verification-visits')
  @RequireRoles('field_agent')
  verificationVisits(@Req() req: Authed) {
    return this.extras.verificationJobCards(req.user.sub);
  }

  /** "Update the pin" during an open verification visit: GPS + reason, audited (21 Nov). */
  @Post('verification-visits/:assignmentId/pin')
  @RequireRoles('field_agent')
  updatePin(@Req() req: Authed, @Param('assignmentId') assignmentId: string, @Body() body: { latitude?: unknown; longitude?: unknown; accuracy?: unknown; reason?: unknown }) {
    return this.extras.updatePin(req.user, assignmentId, body ?? {});
  }

  /** One follow-up task of mine (repeat business day 30/61…): kind label, owner, answers (21 Nov). */
  @Get('follow-ups/:id')
  @RequireRoles('field_agent')
  followUp(@Req() req: Authed, @Param('id') id: string) {
    return this.extras.followUp(req.user, id);
  }

  /** Before registering a shop: businesses nearby with a similar name (21 Nov). */
  @Get('similar-shops')
  @RequireRoles('field_agent')
  similarShops(@Req() req: Authed, @Query('name') name?: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    return this.extras.similarShops(req.user, { name, lat, lng });
  }

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

  /** My visits → All visits (17 Nov): my whole visit history, search and IST date range, newest first. */
  @Get('visits/all')
  @RequireRoles('field_agent')
  allVisits(
    @Req() req: Authed,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.redesign.allVisits(req.user, { q, from, to, before, limit });
  }

  /** Businesses tab: my businesses, each with what it needs next (Laboura Field lists, 22 Nov: status line, numbers, one button). */
  @Get('businesses')
  @RequireRoles('field_agent')
  myBusinesses(@Req() req: Authed, @Query('q') q?: string) {
    return this.people.businesses(req.user, q);
  }

  /** The one business page (rev 188); another agent's business is view-only. With "Where they're stuck" (22 Nov). */
  @Get('businesses/:ref/page')
  @RequireRoles('field_agent')
  businessPage(@Req() req: Authed, @Param('ref') ref: string) {
    return this.people.businessPage(req.user, ref);
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
    return this.people.jobSeekers(req.user, q);
  }

  /** FA10e (22 Nov): one of my job seekers' profile — photo, trade, where he is stuck, guarantee, interviews, history. */
  @Get('job-seekers/:ref/page')
  @RequireRoles('field_agent')
  jobSeekerPage(@Req() req: Authed, @Param('ref') ref: string) {
    return this.people.jobSeekerPage(req.user, ref);
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

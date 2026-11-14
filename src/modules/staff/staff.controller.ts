import { ForgotPasswordService } from './forgot-password.service';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthThrottlerGuard } from '../../common/auth/auth-throttler.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { AcceptInviteDto, InviteTokenDto } from './dto/accept-invite.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { BootstrapStaffDto } from './dto/bootstrap-staff.dto';
import { Public } from '../../common/rbac/public.decorator';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('staff')
@UseInterceptors(PiiMaskingInterceptor)
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly forgotPasswords: ForgotPasswordService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager')
  create(@Body() dto: CreateStaffDto, @Req() req: AuthenticatedRequest) {
    return this.staffService.createStaff(dto, req.user);
  }

  /**
   * Public by design: creates the very first staff account (CEO) on an empty
   * database.
   *
   * Rationale for hardening (Phase 6.6 Task 4):
   * The repository is public, so this endpoint and its behaviour are documented
   * to anyone. Between initial deployment and the real bootstrap call, whoever
   * reached it first became CEO. Furthermore, issuing the TOTP secret once at
   * creation meant losing that single response bricked the account with no
   * recovery path.
   *
   * Hardened controls:
   * 1. Requires STAFF_BOOTSTRAP_SECRET supplied either in the `x-bootstrap-secret`
   *    header or the request body (`secret` / `bootstrapSecret`), compared in
   *    constant-time against the environment variable.
   * 2. 2FA moves to first-login enrolment: bootstrap creates the CEO with
   *    `totpEnabled: false` and issues no TOTP secret. The CEO logs in with
   *    their password, receives the restricted `totp_setup` scope, and enrols
   *    their authenticator device before accessing any operational endpoints.
   * 3. Table lock, conditional insert, staff.count() === 0, rate limiting, and
   *    audit logging with the sentinel 'bootstrap' actor remain intact.
   */
  @Post('bootstrap')
  @Public('first CEO account on an empty database; needs STAFF_BOOTSTRAP_SECRET')
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  bootstrap(
    @Body() dto: BootstrapStaffDto,
    @Headers('x-bootstrap-secret') headerSecret?: string,
  ) {
    const suppliedSecret = headerSecret || dto?.secret || dto?.bootstrapSecret;
    return this.staffService.bootstrapStaff(dto, suppliedSecret);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'read')
  @RequireRoles('ceo', 'manager', 'team_lead')
  list(@Query() query: QueryStaffDto, @Req() req: AuthenticatedRequest) {
    return this.staffService.listStaff(query, req.user);
  }

  @Get('without-reporting-line')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'read')
  @RequireRoles('ceo')
  withoutReportingLine() {
    return this.staffService.listWithoutReportingLine();
  }

  @Get('reporting-tree')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'read')
  @RequireRoles('ceo', 'manager')
  reportingTree(@Req() req: AuthenticatedRequest) {
    return this.staffService.reportingTree(req.user);
  }

  /** Who reset whose password. CEO: everyone. Manager: their own tree. */
  @Get('password-resets')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'read')
  @RequireRoles('ceo', 'manager')
  passwordResets(@Req() req: AuthenticatedRequest) {
    return this.staffService.listPasswordResets(req.user);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'read')
  @RequireRoles('ceo', 'manager', 'team_lead')
  getById(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.staffService.getStaffById(id, req.user);
  }

  @Post(':id/reporting-line')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager')
  moveReportingLine(
    @Param('id') id: string,
    @Body()
    body: { reportsToId?: string; reason?: string; moveOpenWork?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.staffService.moveReportingLine(id, body, req.user);
  }

  /** The CEO enters or corrects a joining date (payroll starts on it). */
  @Put(':id/joined-on')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo')
  setJoinedOn(@Param('id') id: string, @Body('joinedOn') joinedOn: unknown, @Req() req: AuthenticatedRequest) {
    return this.staffService.setJoinedOn(id, joinedOn, req.user);
  }

  /**
   * The CEO marks or clears an owner account: their work counts in the lists,
   * but not in targets, leaderboard, attendance or salary (owner decision 14 Nov).
   */
  @Put(':id/owner-account')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo')
  setOwnerAccount(@Param('id') id: string, @Body('ownerAccount') ownerAccount: unknown, @Req() req: AuthenticatedRequest) {
    return this.staffService.setOwnerAccount(id, ownerAccount, req.user);
  }

  @Put(':id/call-routing-phone')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  setCallRoutingPhone(
    @Param('id') id: string,
    @Body('phone') phone: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.staffService.setCallRoutingPhone(id, phone, req.user);
  }

  /**
   * Public by design: the new hire has no password or session yet and proves
   * identity with the one-time invite token. Throttled like login.
   */
  /**
   * "Forgot password" for the CEO, Managers and Finance: a one-time link to
   * their company email. Public (they cannot sign in); the same answer for
   * every address; throttled per address and email, and at most 3 links an
   * hour per account.
   */
  @Post('forgot-password')
  @Public('management forgot password: always the same answer, never says whether the email exists')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  forgotPassword(@Body() body: { email?: unknown }) {
    return this.forgotPasswords.request(body?.email).answer;
  }

  @Post('accept-invite/preview')
  @Public('invite page: shows whose invite the one-time token is, before a password exists')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  previewInvite(@Body() dto: InviteTokenDto) {
    return this.staffService.previewInvite(dto);
  }

  @Post('accept-invite/authenticator')
  @Public('invite page: management sets up the authenticator with the one-time invite token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  setupInviteAuthenticator(@Body() dto: InviteTokenDto) {
    return this.staffService.setupInviteAuthenticator(dto);
  }

  @Post('accept-invite')
  @Public('new hire sets a password with the one-time invite token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.staffService.acceptInvite(dto);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager')
  deactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.staffService.deactivateStaff(id, req.user);
  }

  /**
   * Reset: issues a fresh one-time invite so the person sets a new password.
   * The CEO for anyone, a Manager inside their own tree, a Team Lead for
   * their own agents (Master Guide, Passwords and email).
   */
  @Post(':id/reissue-invite')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard, AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager', 'team_lead')
  reissueInvite(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.staffService.reissueInvite(id, req.user);
  }

  /**
   * Reset password: a new one-time link to the invite page where the person
   * sets a new password. The old password works until the link is used. A
   * Team Lead for their own agents, a Manager inside their own tree, the CEO
   * for anyone (Master Guide, Passwords and email).
   */
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard, AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager', 'team_lead')
  resetPassword(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.staffService.issuePasswordReset(id, req.user);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard, AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager')
  reactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.staffService.reactivateStaff(id, req.user);
  }

  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager')
  lock(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.staffService.lockStaff(id, req.user, reason);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager', 'team_lead')
  unlock(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.staffService.unlockStaff(id, req.user, reason);
  }
}

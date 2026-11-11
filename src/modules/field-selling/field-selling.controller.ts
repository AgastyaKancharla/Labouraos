import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { BookBody, FieldSellingService } from './field-selling.service';
import { FieldSellingScreensService } from './field-selling-screens.service';

type Req = Request & { user: JwtPayload };
const actorOf = (req: Req) => ({ id: req.user.sub, role: req.user.role });
const SELLERS = ['field_agent', 'team_lead', 'manager', 'ceo'] as const;

/**
 * Laboura Field: on-the-spot matching and selling (guide, "The field agent
 * app" and "Confirming in the shop", decided 9 Nov). Writes act only on the
 * agent's own account businesses (checked in the service); reads mask phone
 * numbers and strip money for Managers (PiiMaskingInterceptor).
 */
@Controller()
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class FieldSellingController {
  constructor(
    private readonly selling: FieldSellingService,
    private readonly screens: FieldSellingScreensService,
  ) {}

  // ------------------------------------------------------------- reads

  @Get('screens/field-selling/settings')
  @RequireRoles('field_agent', 'team_lead', 'ceo')
  settings() {
    return this.screens.settings();
  }

  @Get('screens/field-selling/businesses')
  @RequireRoles(...SELLERS)
  businesses(@Req() req: Req, @Query('q') q?: string) {
    return this.screens.businesses(actorOf(req), q);
  }

  @Get('screens/field-selling/businesses/:id')
  @RequireRoles(...SELLERS)
  business(@Req() req: Req, @Param('id') id: string) {
    return this.screens.business(actorOf(req), id);
  }

  @Get('screens/field-selling/vacancies/:id/matches')
  @RequireRoles(...SELLERS)
  matches(@Req() req: Req, @Param('id') id: string, @Query('page') page?: string) {
    const n = page === undefined ? 1 : Number(page);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException('page must be a positive integer');
    return this.screens.matches(actorOf(req), id, n);
  }

  @Get('screens/field-selling/vacancies/:id/no-more')
  @RequireRoles(...SELLERS)
  noMore(@Param('id') id: string) {
    return this.screens.noMore(id);
  }

  @Get('screens/field-selling/vacancies/:id/booking')
  @RequireRoles(...SELLERS)
  booking(@Param('id') id: string, @Query('jobSeekerId') jobSeekerId: string) {
    if (!jobSeekerId) throw new BadRequestException('jobSeekerId is required');
    return this.screens.bookingContext(id, jobSeekerId);
  }

  @Get('screens/field-selling/candidates/:id')
  @RequireRoles(...SELLERS)
  candidate(@Req() req: Req, @Param('id') id: string, @Query('vacancyId') vacancyId: string) {
    return this.screens.candidate(actorOf(req), id, vacancyId);
  }

  @Get('screens/field-selling/interviews/:id')
  @RequireRoles(...SELLERS)
  interview(@Req() req: Req, @Param('id') id: string) {
    return this.screens.interview(actorOf(req), id);
  }

  @Get('screens/field-selling/placements/:id')
  @RequireRoles(...SELLERS)
  placement(@Req() req: Req, @Param('id') id: string) {
    return this.screens.placement(actorOf(req), id);
  }

  @Get('screens/field-selling/recent-vacancies')
  @RequireRoles(...SELLERS)
  recentVacancies(@Req() req: Req) {
    return this.screens.recentVacancies(actorOf(req));
  }

  // ------------------------------------------------------------ writes

  @Post('field-selling/calls')
  @RequireRoles(...SELLERS)
  callCandidate(@Req() req: Req, @Body() body: { vacancyId?: string; jobSeekerId?: string }) {
    return this.selling.callCandidate(actorOf(req), body);
  }

  @Post('field-selling/calls/:id/answer')
  @RequireRoles(...SELLERS)
  answer(@Req() req: Req, @Param('id') id: string, @Body() body: { answer?: string; reason?: string }) {
    return this.selling.recordCandidateAnswer(actorOf(req), id, body);
  }

  @Post('field-selling/interviews/:id/hand-over')
  @RequireRoles(...SELLERS)
  handOver(@Req() req: Req, @Param('id') id: string) {
    return this.selling.handOver(actorOf(req), id);
  }

  @Post('field-selling/interviews/:id/owner-otp')
  @RequireRoles(...SELLERS)
  ownerOtp(@Req() req: Req, @Param('id') id: string, @Body() body: Parameters<FieldSellingService['sendDecisionOtp']>[2]) {
    return this.selling.sendDecisionOtp(actorOf(req), id, body);
  }

  @Post('field-selling/interviews/:id/decision')
  @RequireRoles(...SELLERS)
  decision(@Req() req: Req, @Param('id') id: string, @Body() body: Parameters<FieldSellingService['recordDecision']>[2]) {
    return this.selling.recordDecision(actorOf(req), id, body);
  }

  @Post('field-selling/interviews/:id/meet')
  @RequireRoles(...SELLERS)
  meet(@Req() req: Req, @Param('id') id: string, @Body() body: BookBody) {
    return this.selling.wantsToMeet(actorOf(req), id, body);
  }

  @Post('field-selling/interviews')
  @RequireRoles(...SELLERS)
  book(@Req() req: Req, @Body() body: BookBody & { vacancyId?: string; jobSeekerId?: string }) {
    return this.selling.book(actorOf(req), body);
  }

  @Post('field-selling/interviews/:id/arrival')
  @RequireRoles(...SELLERS)
  arrival(@Req() req: Req, @Param('id') id: string, @Body() body: Parameters<FieldSellingService['markArrival']>[2]) {
    return this.selling.markArrival(actorOf(req), id, body);
  }

  @Post('field-selling/vacancies/:id/favourites/:jobSeekerId')
  @RequireRoles(...SELLERS)
  like(@Req() req: Req, @Param('id') id: string, @Param('jobSeekerId') jobSeekerId: string) {
    return this.selling.setFavourite(actorOf(req), id, jobSeekerId, true);
  }

  @Delete('field-selling/vacancies/:id/favourites/:jobSeekerId')
  @RequireRoles(...SELLERS)
  unlike(@Req() req: Req, @Param('id') id: string, @Param('jobSeekerId') jobSeekerId: string) {
    return this.selling.setFavourite(actorOf(req), id, jobSeekerId, false);
  }

  @Post('field-selling/owner-calls/:id/outcome')
  @RequireRoles(...SELLERS)
  ownerCallOutcome(@Req() req: Req, @Param('id') id: string, @Body() body: { outcome?: string; callbackAt?: string; note?: string }) {
    return this.selling.recordOwnerCallOutcome(actorOf(req), id, body);
  }

  @Post('field-selling/placements/:id/owner-says')
  @RequireRoles(...SELLERS)
  ownerSays(@Req() req: Req, @Param('id') id: string, @Body() body: { answer?: string; newJoiningDate?: string }) {
    return this.selling.ownerJoiningAnswer(actorOf(req), id, body);
  }
}

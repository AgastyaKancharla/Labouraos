import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request, Response } from 'express';
import { PublicPage, publicPageLink, wantsHtml } from '../../common/public-pages';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { InterviewService, publicOwnerResult } from './interview.service';
import { Public } from '../../common/rbac/public.decorator';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('interviews')
export class InterviewController {
  constructor(private readonly interviews: InterviewService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @UseInterceptors(PiiMaskingInterceptor)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  list(
    @Req() req: AuthenticatedRequest,
    @Query('vacancyId') vacancyId?: string,
    @Query('agentId') agentId?: string,
    @Query('status') status?: string,
  ) {
    return this.interviews.list(req.user.sub, { vacancyId, agentId, status });
  }

  @Get('vacancies/:vacancyId/slots')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @UseInterceptors(PiiMaskingInterceptor)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  // Scoped like reading the vacancy (RbacGuard): a Team Lead only their own
  // team's vacancies; agents, Managers and the CEO city-wide (role table).
  @RequirePermission('vacancy', 'read', { kind: 'vacancy', from: 'param:vacancyId' })
  slots(@Param('vacancyId') vacancyId: string, @Req() req: AuthenticatedRequest) {
    return this.interviews.listSlots(vacancyId, req.user.sub);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @UseInterceptors(PiiMaskingInterceptor)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  // A Team Lead books only for their own team's job seekers (owner rule, 14 Nov).
  @RequirePermission('job_seeker', 'write', { kind: 'job_seeker', from: 'body:jobSeekerId' })
  book(@Body() body: { vacancyId: string; jobSeekerId: string; slotId: string }, @Req() req: AuthenticatedRequest) {
    return this.interviews.book(body, req.user.sub);
  }

  @Get('reply/:token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async replyPage(
    @Param('token') token: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (wantsHtml(accept)) return this.toPublicPage(res, 'offerReply', token);
    return this.interviews.candidateReplyDetails(token);
  }

  @Post('reply/:token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  reply(@Param('token') token: string, @Body() body: { answer: 'yes' | 'no' }) {
    return this.interviews.respondFromLink(token, body?.answer);
  }

  @Get('result/:token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async ownerResultPage(
    @Param('token') token: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (wantsHtml(accept)) return this.toPublicPage(res, 'interviewResult', token);
    return this.interviews.ownerResultDetails(token);
  }

  @Post('result/:token/otp')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  sendOwnerOtp(@Param('token') token: string) {
    return this.interviews.sendOwnerResultOtp(token);
  }

  @Post('result/:token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  submitOwnerResult(@Param('token') token: string, @Body() body: {
    otpRequestId: string;
    otpCode: string;
    result: 'selected' | 'not_selected' | 'candidate_no_show';
    resultReason?: string;
    selectedSalaryPaise?: number;
    selectedJoiningDate?: string;
  }) {
    return this.interviews.submitOwnerResult(token, body).then(publicOwnerResult);
  }

  @Get('check/:token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async checkPage(
    @Param('token') token: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (wantsHtml(accept)) return this.toPublicPage(res, 'offerCheck', token);
    return this.interviews.candidateCheckDetails(token);
  }

  @Post('check/:token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  check(@Param('token') token: string, @Body() body: { answer: 'yes' | 'no' }) {
    return this.interviews.submitCandidateOfferCheck(token, body?.answer);
  }

  @Post(':id/call-reply')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  recordCallReply(
    @Param('id') id: string,
    @Body() body: { callRecordId: string; answer: 'accepted_offer' | 'rejected_offer'; reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.interviews.respondFromCall(id, body.callRecordId, body.answer, body.reason, req.user.sub);
  }

  /** Links already sent by SMS and WhatsApp open the new phone pages (/p/...). */
  private toPublicPage(res: Response, page: PublicPage, token: string): void {
    res.redirect(302, publicPageLink(page, token));
  }
}

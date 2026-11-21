import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { WhatsAppInboxService } from './whatsapp-inbox.service';

type AuthRequest = Request & { user: JwtPayload };
const actorOf = (req: AuthRequest) => ({ id: req.user.sub, role: req.user.role });

/**
 * The WhatsApp tab (call agent console) and the Team Lead's WhatsApp widget
 * (rev 202). A call agent sees and answers only the conversations assigned to
 * him; a Team Lead or Manager sees their team's and the unassigned ones; the
 * CEO sees all. Phone numbers are masked to the last 4 digits for everyone but
 * the CEO (PiiMaskingInterceptor).
 */
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class WhatsAppInboxController {
  constructor(private readonly inbox: WhatsAppInboxService) {}

  @Get('conversations')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  list(@Req() req: AuthRequest, @Query('status') status?: string) {
    return this.inbox.list(actorOf(req), status);
  }

  @Get('overview')
  @RequireRoles('team_lead', 'manager', 'ceo')
  overview(@Req() req: AuthRequest) {
    return this.inbox.overview(actorOf(req));
  }

  @Get('conversations/:id')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  thread(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.inbox.thread(actorOf(req), id);
  }

  @Post('conversations/:id/reply')
  @HttpCode(200)
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  reply(@Req() req: AuthRequest, @Param('id') id: string, @Body('text') text: unknown) {
    return this.inbox.reply(actorOf(req), id, text);
  }

  @Post('conversations/:id/template')
  @HttpCode(200)
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  template(@Req() req: AuthRequest, @Param('id') id: string, @Body('template') template: unknown) {
    return this.inbox.sendTemplate(actorOf(req), id, template);
  }

  @Post('conversations/:id/send-link')
  @HttpCode(200)
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  sendLink(@Req() req: AuthRequest, @Param('id') id: string, @Body('kind') kind: unknown) {
    return this.inbox.sendLink(actorOf(req), id, kind);
  }

  @Post('conversations/:id/outcome')
  @HttpCode(200)
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  close(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: { outcome?: unknown; note?: unknown }) {
    return this.inbox.close(actorOf(req), id, body?.outcome, body?.note);
  }

  @Post('conversations/:id/link')
  @HttpCode(200)
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  link(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: { code?: unknown; reason?: unknown }) {
    return this.inbox.link(actorOf(req), id, body?.code, body?.reason);
  }

  /** Call a new person from the conversation (the number never reaches the screen). */
  @Post('conversations/:id/call')
  @HttpCode(200)
  @RequireRoles('call_agent')
  call(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.inbox.callConversation(actorOf(req), id);
  }

  /** Register a new person: name, heard from WhatsApp and a prefill reference for the number. */
  @Post('conversations/:id/registration-prefill')
  @HttpCode(200)
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  registrationPrefill(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.inbox.registrationPrefill(actorOf(req), id);
  }

  @Post('conversations/:id/take')
  @HttpCode(200)
  @RequireRoles('call_agent')
  take(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.inbox.take(actorOf(req), id);
  }

  @Post('conversations/:id/assign')
  @HttpCode(200)
  @RequireRoles('team_lead', 'manager', 'ceo')
  assign(@Req() req: AuthRequest, @Param('id') id: string, @Body('staffId') staffId: unknown) {
    return this.inbox.reassign(actorOf(req), id, staffId);
  }

  // ---- "Send on WhatsApp" next to Resend: WhatsApp first, SMS as fallback (same rights as Resend) ----

  @Post('send-link/registration/:jobSeekerId')
  @HttpCode(200)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('job_seeker', 'write', { kind: 'job_seeker', from: 'param:jobSeekerId' })
  async registrationLink(@Req() req: AuthRequest, @Param('jobSeekerId') jobSeekerId: string) {
    return { sentBy: await this.inbox.sendLinkFor('registration', jobSeekerId, req.user.sub) };
  }

  @Post('send-link/agreement/:businessId')
  @HttpCode(200)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write', { kind: 'business', from: 'param:businessId' })
  async agreementLink(@Req() req: AuthRequest, @Param('businessId') businessId: string) {
    return { sentBy: await this.inbox.sendLinkFor('agreement', businessId, req.user.sub) };
  }

  @Post('send-link/referral-terms/:referralId')
  @HttpCode(200)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('referral', 'write', { kind: 'referral', from: 'param:referralId' })
  async referralTermsLink(@Req() req: AuthRequest, @Param('referralId') referralId: string) {
    return { sentBy: await this.inbox.sendLinkFor('referral_terms', referralId, req.user.sub) };
  }
}

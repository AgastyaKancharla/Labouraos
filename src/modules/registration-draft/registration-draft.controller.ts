import { Body, Controller, Delete, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { queryText } from '../../common/http/plain-query';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RegistrationDraftService } from './registration-draft.service';

type Authed = Request & { user: JwtPayload };

/**
 * Unfinished registrations in the call agent console (Master Guide rev 204,
 * 21 Nov). Call agents only, and only their own drafts (by the sign-in, never
 * an id in the request): no other agent, Team Lead, Manager or the CEO can
 * read them.
 */
@Controller('registration-drafts')
@UseGuards(JwtAuthGuard, RbacGuard)
export class RegistrationDraftController {
  constructor(private readonly drafts: RegistrationDraftService) {}

  @Get()
  @RequireRoles('call_agent')
  async mine(@Req() req: Authed) {
    return { drafts: await this.drafts.mine(req.user.sub) };
  }

  @Put()
  @RequireRoles('call_agent')
  save(@Req() req: Authed, @Body() body: { kind?: unknown; data?: unknown; name?: unknown; mobile?: unknown; otpRequestId?: unknown }) {
    return this.drafts.save(req.user.sub, body ?? {});
  }

  @Delete()
  @RequireRoles('call_agent')
  discard(@Req() req: Authed, @Query('kind') kind: unknown) {
    return this.drafts.discard(req.user.sub, queryText(kind, 'kind'));
  }
}

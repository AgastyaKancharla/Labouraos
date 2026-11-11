import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { ALL_STAFF_ROLES } from '../../common/rbac/rbac.types';
import { CallWorkService } from './call-work.service';
import { SearchService } from './search.service';

type AuthedRequest = Request & { user: JwtPayload };

/**
 * The call agent console's daily-work reads (designs CA03 Home, CA04 profile,
 * CA05 on call, CA10 follow-ups, CA11 targets, CA17 incoming call). Call
 * agents only; every answer is about the signed-in agent's own work.
 */
@Controller('call-work')
@UseGuards(JwtAuthGuard, RbacGuard)
export class CallWorkController {
  constructor(private readonly work: CallWorkService) {}

  @Get('home')
  @RequireRoles('call_agent')
  home(@Req() req: AuthedRequest) {
    return this.work.home(req.user);
  }

  @Get('queue')
  @RequireRoles('call_agent')
  async queue(@Req() req: AuthedRequest) {
    const { items, ctx } = await this.work.queue(req.user.sub);
    return { now: ctx.now.toISOString(), inCallingHours: ctx.inCallingHours, items };
  }

  /** "Call next": picks the most urgent person and dials through the calling system. */
  @Post('call-next')
  @RequireRoles('call_agent')
  callNext(@Req() req: AuthedRequest, @Body() body: { skip?: unknown }) {
    const skip = Array.isArray(body?.skip) ? body.skip.filter((v): v is string => typeof v === 'string').slice(0, 200) : [];
    return this.work.callNext(req.user, skip);
  }

  @Get('people/:ref')
  @RequireRoles('call_agent')
  profile(@Req() req: AuthedRequest, @Param('ref') ref: string) {
    return this.work.profile(req.user, ref);
  }

  @Get('people/:ref/jobs')
  @RequireRoles('call_agent')
  jobs(@Param('ref') ref: string, @Query('page') page?: string) {
    return this.work.jobs(ref, page ? Number.parseInt(page, 10) || 1 : 1);
  }

  @Get('calls/:id')
  @RequireRoles('call_agent')
  call(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.work.call(req.user, id);
  }

  @Get('follow-ups')
  @RequireRoles('call_agent')
  followUps(@Req() req: AuthedRequest) {
    return this.work.followUps(req.user);
  }

  @Get('follow-ups/:id')
  @RequireRoles('call_agent')
  followUp(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.work.followUp(req.user, id);
  }

  @Get('incoming/:callbackTaskId')
  @RequireRoles('call_agent')
  incoming(@Req() req: AuthedRequest, @Param('callbackTaskId') id: string) {
    return this.work.incoming(req.user, id);
  }

  @Get('targets')
  @RequireRoles('call_agent')
  targets(@Req() req: AuthedRequest) {
    return this.work.targets(req.user);
  }
}

/**
 * GET /search?q=…&type=… — the search bar on every staff screen. Scoped to
 * what the role may see; phone numbers always as the last 4 digits.
 */
@Controller('search')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @RequireRoles(...ALL_STAFF_ROLES)
  search(@Req() req: AuthedRequest, @Query('q') q?: string, @Query('type') type?: string) {
    return this.searchService.search(req.user, q ?? '', type || undefined);
  }
}

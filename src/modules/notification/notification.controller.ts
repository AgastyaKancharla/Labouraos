import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { NotificationListQuery, NotificationService } from './notification.service';
import { NotificationSourcesService } from './notification-sources.service';

type AuthedRequest = Request & { user: JwtPayload };

/**
 * The bell and the Notifications page (Phase 21 Task 6). Every staff role has
 * one; each person only ever reads their own notifications.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo', 'manager', 'team_lead', 'finance', 'call_agent', 'field_agent')
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly sources: NotificationSourcesService,
  ) {}

  /** The bell: open count, the latest 20 open, and "Done today" with who did it. */
  @Get('bell')
  async bell(@Req() req: AuthedRequest) {
    await this.sources.syncForReader(req.user.role);
    return this.notifications.bell(req.user.sub);
  }

  /** The Notifications page: all of the caller's notifications, filtered by status and kind. */
  @Get()
  async list(@Req() req: AuthedRequest, @Query() query: NotificationListQuery) {
    await this.sources.syncForReader(req.user.role);
    return this.notifications.list(req.user.sub, query);
  }

  /** Marks the given notifications (or every open one) as seen. Seen is not cleared. */
  @Post('seen')
  async seen(@Req() req: AuthedRequest, @Body() body: { ids?: string[] }) {
    return this.notifications.markSeen(req.user.sub, body?.ids);
  }

  @Post(':id/seen')
  async seenOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.notifications.markOneSeen(req.user.sub, id);
  }
}

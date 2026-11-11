import { Controller, Req, Sse, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Observable, interval, map, merge, takeUntil, timer } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequireRoles } from '../rbac/roles.decorator';
import { ALL_STAFF_ROLES } from '../rbac/rbac.types';
import { LiveEventsService } from './live-events.service';

/** Keeps proxies (Render, Cloudflare) from closing a quiet connection. */
export const LIVE_HEARTBEAT_MS = 25_000;

interface SseMessage {
  type?: string;
  id?: string;
  data: Record<string, unknown> | string;
  retry?: number;
}

@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveEventsService) {}

  /**
   * GET /live/events — the signed-in staff member's own events, as
   * Server-Sent Events. The browser sends its Bearer token (fetch streaming,
   * not EventSource, so the token never goes in a URL). The stream ends when
   * the token expires; the screen reconnects with the refreshed token, so a
   * revoked or idle session stops receiving events.
   */
  @Sse('events')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF_ROLES)
  events(@Req() req: Request & { user: JwtPayload & { exp?: number } }): Observable<SseMessage> {
    const staffId = req.user.sub;
    const expiresInMs = req.user.exp ? Math.max(0, req.user.exp * 1000 - Date.now()) : 15 * 60 * 1000;
    const end = timer(expiresInMs);
    const hello: SseMessage = { type: 'ready', data: { staffId }, retry: 3000 };
    return merge(
      timer(0).pipe(map(() => hello)),
      this.live.streamFor(staffId).pipe(map((m): SseMessage => ({ type: m.type, id: m.id, data: m.data }))),
      interval(LIVE_HEARTBEAT_MS).pipe(map((): SseMessage => ({ type: 'ping', data: {} }))),
    ).pipe(takeUntil(end));
  }
}

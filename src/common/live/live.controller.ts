import { Controller, Req, Sse, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Observable, catchError, concatMap, filter, from, interval, map, merge, of, take, takeUntil, timer } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequireRoles } from '../rbac/roles.decorator';
import { ALL_STAFF_ROLES } from '../rbac/rbac.types';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../../modules/pricing/pricing.service';
import { sessionLifetimeEnd } from '../auth/session-lifetime';
import { LiveEventsService } from './live-events.service';

/** Keeps proxies (Render, Cloudflare) from closing a quiet connection. */
export const LIVE_HEARTBEAT_MS = 25_000;

/**
 * How often an open stream checks that its session is still live. A session
 * ended by locking, deactivation, a revoked device or "sign out everywhere"
 * then stops its events within this time even before the token expires; the
 * places in the code that end sessions also ask for a check at once
 * (LiveEventsService.recheckSessions).
 */
export const LIVE_SESSION_CHECK_MS = 15_000;

interface SseMessage {
  type?: string;
  id?: string;
  data: Record<string, unknown> | string;
  retry?: number;
}

@Controller('live')
export class LiveController {
  constructor(
    private readonly live: LiveEventsService,
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * GET /live/events — the signed-in staff member's own events, as
   * Server-Sent Events. The browser sends its Bearer token (fetch streaming,
   * not EventSource, so the token never goes in a URL). The stream ends when
   * the token expires, or as soon as its session is ended (revoked, locked,
   * deactivated, device revoked); the screen reconnects with the refreshed
   * token, which a revoked session cannot get.
   */
  @Sse('events')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF_ROLES)
  events(@Req() req: Request & { user: JwtPayload & { exp?: number } }): Observable<SseMessage> {
    const staffId = req.user.sub;
    const expiresInMs = req.user.exp ? Math.max(0, req.user.exp * 1000 - Date.now()) : 15 * 60 * 1000;
    const sessionEnded = merge(interval(LIVE_SESSION_CHECK_MS), this.live.sessionRechecksFor(staffId)).pipe(
      // One check at a time, in order: a nudge that arrives while a check is
      // running is checked right after it, never dropped.
      concatMap(() => from(this.sessionIsLive(staffId, req.user.sid)).pipe(catchError(() => of(true)))),
      filter((live) => !live),
      take(1),
    );
    const end = merge(timer(expiresInMs), sessionEnded);
    const hello: SseMessage = { type: 'ready', data: { staffId }, retry: 3000 };
    return merge(
      timer(0).pipe(map(() => hello)),
      this.live.streamFor(staffId).pipe(map((m): SseMessage => ({ type: m.type, id: m.id, data: m.data }))),
      interval(LIVE_HEARTBEAT_MS).pipe(map((): SseMessage => ({ type: 'ping', data: {} }))),
    ).pipe(takeUntil(end));
  }

  /**
   * The same checks the token guard makes on every request (JwtStrategy):
   * the session exists and is not revoked, the account is active, and the
   * session is inside its idle and 2-hour limits. A database hiccup keeps the
   * stream (the next check decides).
   */
  private async sessionIsLive(staffId: string, sessionId: string | undefined): Promise<boolean> {
    if (sessionId) {
      const session = await this.prisma.staffSession.findUnique({
        where: { id: sessionId },
        select: {
          revokedAt: true,
          lastActivityAt: true,
          absoluteExpiresAt: true,
          staff: { select: { status: true } },
        },
      });
      if (!session || session.revokedAt || session.staff.status !== 'active') return false;
      const policy = await this.pricing.current();
      return sessionLifetimeEnd(session, new Date(), policy.idleLogoutMinutes) === null;
    }
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { status: true } });
    return staff?.status === 'active';
  }
}

import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PUBLIC_ROUTE_KEY } from '../rbac/public.decorator';

export const DEFAULT_PUBLIC_RATE_LIMIT_PER_MINUTE = 300;
const WINDOW_MS = 60_000;
/** Forget idle addresses so the table never grows without limit. */
const MAX_TRACKED_ADDRESSES = 50_000;

/**
 * M4: one limit per visitor address across every public route (token pages,
 * the payment page, login, bootstrap, set-up and console shells): at most
 * PUBLIC_RATE_LIMIT_PER_MINUTE requests a minute (default 300: high enough for a whole office logging in from one shared address at 9 AM), then 429.
 *
 * Applied globally, but only to routes marked @Public(). Staff routes have
 * their own limits behind the login. Left out: health probes (the uptime
 * monitor and Render) and signed vendor webhooks, which come from a few
 * vendor addresses in bursts and prove themselves with a signature.
 *
 * The address is `req.ip`, which honours TRUST_PROXY_HOPS (common/http/trust-proxy.ts).
 * Counters live in memory, per process. Off in the automated tests
 * (NODE_ENV=test) unless PUBLIC_RATE_LIMIT=on; `PUBLIC_RATE_LIMIT=off` turns it off.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly reflector: Reflector) {}

  /** The clock (tests move it). */
  protected currentTime(): number {
    return Date.now();
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    if (!this.enabled()) return true;
    const reason = this.reflector.getAllAndOverride<string | undefined>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (reason === undefined) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (PublicRateLimitGuard.exempt(request.path ?? '')) return true;

    const address = request.ip || request.socket?.remoteAddress || 'unknown';
    const limit = Number(process.env.PUBLIC_RATE_LIMIT_PER_MINUTE) || DEFAULT_PUBLIC_RATE_LIMIT_PER_MINUTE;
    const now = this.currentTime();
    let window = this.windows.get(address);
    if (!window || now - window.start >= WINDOW_MS) {
      if (!window && this.windows.size >= MAX_TRACKED_ADDRESSES) this.forgetOld(now);
      window = { start: now, count: 0 };
      this.windows.set(address, window);
    }
    window.count += 1;
    if (window.count > limit) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests from this address. Wait a minute and try again.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** Health probes and signed vendor webhooks are not counted. */
  static exempt(path: string): boolean {
    return /^\/health(\/|$)/.test(path) || /webhook/i.test(path) || /^\/telephony\//.test(path);
  }

  private enabled(): boolean {
    const setting = process.env.PUBLIC_RATE_LIMIT?.trim().toLowerCase();
    if (setting === 'off') return false;
    if (process.env.NODE_ENV === 'test') return setting === 'on';
    return true;
  }

  private forgetOld(now: number): void {
    for (const [address, window] of this.windows) {
      if (now - window.start >= WINDOW_MS) this.windows.delete(address);
    }
  }
}

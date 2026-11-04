import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import * as crypto from 'crypto';

/**
 * Named constant: connection-level login rate limit across all staff codes (§11 Task 8).
 * Enforced on POST /auth/login and POST /auth/login/verify-code.
 */
export const LOGIN_CONNECTION_RATE_LIMIT = 60;
export const LOGIN_RATE_LIMIT_PER_CONNECTION = 60;
export const LOGIN_CONNECTION_TTL = 60000;

@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const expressReq = req as unknown as Request;
    // Never read X-Forwarded-For directly: any client can set it. `req.ip` is
    // derived from it only as far as the configured `trust proxy` hop count
    // allows (see common/http/trust-proxy.ts).
    const clientIp =
      expressReq.ip || expressReq.socket?.remoteAddress || '127.0.0.1';

    const body = expressReq.body as Record<string, unknown> | undefined;
    const identity =
      (body?.staffCode as string) ||
      (body?.loginRequestId as string) ||
      (body?.phone as string) ||
      (body?.requestId as string) ||
      'anon';

    return `${identity}:${clientIp}`;
  }

  protected override generateKey(context: ExecutionContext, suffix: string, name: string): string {
    if (name === 'connection') {
      const http = context.switchToHttp();
      const req = http.getRequest<Request>();
      // Uses the request IP as resolved by common/http/trust-proxy.ts (express req.ip)
      const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
      const prefix = `${context.getClass().name}-${context.getHandler().name}-${name}`;
      return crypto.createHash('sha256').update(`${prefix}-${clientIp}`).digest('hex');
    }
    return super.generateKey(context, suffix, name);
  }
}

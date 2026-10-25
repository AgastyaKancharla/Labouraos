import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const expressReq = req as unknown as Request;
    // Never read X-Forwarded-For directly: any client can set it. `req.ip` is
    // derived from it only as far as the configured `trust proxy` hop count
    // allows (see common/http/trust-proxy.ts).
    const clientIp =
      expressReq.ip || expressReq.socket?.remoteAddress || '127.0.0.1';

    const body = expressReq.body as Record<string, unknown> | undefined;
    const identity =
      (body?.email as string) ||
      (body?.phone as string) ||
      (body?.requestId as string) ||
      'anon';

    return `${identity}:${clientIp}`;
  }
}

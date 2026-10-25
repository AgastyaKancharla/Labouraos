import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const expressReq = req as unknown as Request;
    const clientIp =
      (expressReq.headers?.['x-forwarded-for'] as string) ||
      expressReq.ip ||
      expressReq.socket?.remoteAddress ||
      '127.0.0.1';

    const body = expressReq.body as Record<string, unknown> | undefined;
    const identity =
      (body?.email as string) ||
      (body?.phone as string) ||
      (body?.requestId as string) ||
      'anon';

    return `${identity}:${clientIp}`;
  }
}

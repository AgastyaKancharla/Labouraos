import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { CloudflareAccessVerifier } from './cloudflare-access.verifier';

const DENIED = 'Cloudflare Access identity verification required';

/**
 * Gates the office consoles (Admin Dashboard, Call Agent console) behind a
 * verified Cloudflare Access identity. Only the signed JWT counts: the
 * `cf-access-authenticated-user-email` header is trivially forgeable and is
 * deliberately ignored. Off unless CLOUDFLARE_ACCESS_ENFORCED=true.
 */
@Injectable()
export class CloudflareAccessGuard implements CanActivate {
  private readonly logger = new Logger(CloudflareAccessGuard.name);

  constructor(private readonly verifier: CloudflareAccessVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.CLOUDFLARE_ACCESS_ENFORCED !== 'true') {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const assertion = req.headers['cf-access-jwt-assertion'];
    if (typeof assertion !== 'string' || assertion.length === 0) {
      throw new ForbiddenException(DENIED);
    }

    try {
      await this.verifier.verify(assertion);
      return true;
    } catch (err) {
      // Reason stays in the log; the caller only learns that access was denied.
      this.logger.warn(
        `Cloudflare Access assertion rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ForbiddenException(DENIED);
    }
  }
}

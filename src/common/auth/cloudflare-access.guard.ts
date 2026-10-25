import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class CloudflareAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const isEnforced = process.env.CLOUDFLARE_ACCESS_ENFORCED === 'true';
    if (!isEnforced) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const jwtAssertion = req.headers['cf-access-jwt-assertion'];
    const userEmail = req.headers['cf-access-authenticated-user-email'];

    if (!jwtAssertion && !userEmail) {
      throw new ForbiddenException(
        'Cloudflare Access identity verification required',
      );
    }

    return true;
  }
}

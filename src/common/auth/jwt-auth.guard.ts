import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = JwtPayload>(
    err: unknown,
    user: TUser | false,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    const authenticated = super.handleRequest(
      err,
      user,
      info,
      context,
      status,
    ) as TUser;

    // No route takes a limited token any more (the old password-only
    // "totp_setup" token is gone: an authenticator role without an
    // authenticator gets no session). A token that still carries any scope
    // is refused here, at the one guard every authenticated route goes through.
    if ((authenticated as { scope?: unknown }).scope !== undefined) {
      throw new ForbiddenException('This sign-in has ended. Sign in again.');
    }

    return authenticated;
  }
}

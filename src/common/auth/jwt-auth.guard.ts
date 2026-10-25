import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtPayload } from './jwt-payload.interface';
import { TOTP_SETUP_SCOPE_KEY } from './totp-setup-scope.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

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

    // A password-only token from an account that has not enrolled in TOTP is
    // limited to the enrolment endpoints; everything else is refused here, at
    // the one guard every authenticated route goes through.
    if ((authenticated as JwtPayload).scope === 'totp_setup') {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        TOTP_SETUP_SCOPE_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException(
          'Two-factor enrolment required: set up and enable TOTP, then log in again with your code',
        );
      }
    }

    return authenticated;
  }
}

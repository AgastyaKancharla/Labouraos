import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAuthClock } from './customer-auth.clock';
import { CUSTOMER_ERROR_CODES, customerUnauthorized } from './customer-auth.errors';
import { CustomerTokenService } from './customer-token.service';

/** Who is calling, worked out from the customer token. Never from the URL or body. */
export interface CustomerPrincipal {
  accountId: string;
  sessionId: string;
  deviceId: string | null;
}

export type CustomerRequest = Request & { customer?: CustomerPrincipal };

/** lastUsedAt is written at most this often, so reads stay cheap. */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

/**
 * The customer door. Accepts only a customer access token (customer key,
 * audience and realm) whose session is live and whose account is not blocked
 * or deleted. Sets `req.customer`; never touches `req.user`, which belongs to
 * the staff realm, so no staff guard, role check or masking rule ever sees a
 * customer as staff. A staff token fails here (different key and audience).
 */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: CustomerTokenService,
    private readonly clock: CustomerAuthClock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const header = request.headers?.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match) {
      throw customerUnauthorized(CUSTOMER_ERROR_CODES.TOKEN_MISSING, 'Sign in to the Laboura app first');
    }
    const payload = this.tokens.verifyAccess(match[1]);

    const session = await this.prisma.customerSession.findUnique({
      where: { id: payload.sid },
      select: {
        id: true,
        accountId: true,
        deviceId: true,
        revokedAt: true,
        expiresAt: true,
        lastUsedAt: true,
        account: { select: { status: true } },
      },
    });
    const now = this.clock.now();
    if (!session || session.accountId !== payload.sub || session.revokedAt) {
      throw customerUnauthorized(CUSTOMER_ERROR_CODES.SESSION_ENDED, 'You were signed out. Sign in again.');
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.prisma.customerSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now, endedReason: 'expired' },
      });
      throw customerUnauthorized(CUSTOMER_ERROR_CODES.SESSION_ENDED, 'You were signed out. Sign in again.');
    }
    if (session.account.status === 'blocked') {
      throw customerUnauthorized(CUSTOMER_ERROR_CODES.ACCOUNT_BLOCKED, 'This account is blocked. Call Laboura for help.');
    }
    if (session.account.status === 'deleted') {
      throw customerUnauthorized(CUSTOMER_ERROR_CODES.ACCOUNT_DELETED, 'This account was deleted.');
    }

    if (now.getTime() - session.lastUsedAt.getTime() >= TOUCH_EVERY_MS) {
      await this.prisma.customerSession.updateMany({ where: { id: session.id }, data: { lastUsedAt: now } });
      await this.prisma.customerAccount.updateMany({ where: { id: session.accountId }, data: { lastSeenAt: now } });
    }

    request.customer = { accountId: session.accountId, sessionId: session.id, deviceId: session.deviceId };
    return true;
  }
}

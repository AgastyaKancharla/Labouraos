import { ExecutionContext, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getJwtSecret } from '../auth/jwt-secret';
import { CUSTOMER_TOKEN_AUDIENCE, CUSTOMER_TOKEN_ISSUER } from './customer-app.constants';
import { CustomerAuthGuard, CustomerRequest } from './customer-auth.guard';
import { getCustomerJwtSecret } from './customer-jwt-secret';
import { CustomerTokenService } from './customer-token.service';

/**
 * The customer realm is a separate door (customer app proposal 8.1): its own
 * key, audience and realm claim, its own sessions, and a guard that only
 * accepts customer tokens. A staff token never opens it and a customer token
 * never verifies with the staff key.
 */
function codeOf(error: unknown): string | undefined {
  return error instanceof HttpException ? (error.getResponse() as { code?: string }).code : undefined;
}

describe('Customer realm: tokens and keys', () => {
  const tokens = new CustomerTokenService();

  it('uses a key that differs from the staff key, even when CUSTOMER_JWT_SECRET is not set', () => {
    const derived = getCustomerJwtSecret({ ...process.env, CUSTOMER_JWT_SECRET: '' });
    expect(derived).not.toEqual(getJwtSecret());
    expect(derived.length).toBeGreaterThanOrEqual(32);
  });

  it('refuses a CUSTOMER_JWT_SECRET equal to the staff key, or shorter than 32 characters', () => {
    expect(() => getCustomerJwtSecret({ ...process.env, CUSTOMER_JWT_SECRET: getJwtSecret() })).toThrow(/different from JWT_SECRET/);
    expect(() => getCustomerJwtSecret({ ...process.env, CUSTOMER_JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('signs a customer token that verifies as a customer token', () => {
    const { accessToken, expiresInSeconds } = tokens.signAccess('acc-1', 'ses-1');
    expect(expiresInSeconds).toBe(15 * 60);
    expect(tokens.verifyAccess(accessToken)).toEqual({ sub: 'acc-1', sid: 'ses-1', realm: 'customer' });
  });

  it('a customer token does not verify with the staff key (staff routes refuse it)', () => {
    const { accessToken } = tokens.signAccess('acc-1', 'ses-1');
    const staffJwt = new JwtService({ secret: getJwtSecret() });
    expect(() => staffJwt.verify(accessToken)).toThrow();
  });

  it('refuses a staff token, even one carrying the customer audience and realm', () => {
    const staffJwt = new JwtService({ secret: getJwtSecret() });
    const plainStaff = staffJwt.sign({ sub: 'staff-1', role: 'ceo', email: null, code: 'CEO-1' });
    expect(() => tokens.verifyAccess(plainStaff)).toThrow(HttpException);
    const forged = staffJwt.sign(
      { sub: 'acc-1', sid: 'ses-1', realm: 'customer' },
      { audience: CUSTOMER_TOKEN_AUDIENCE, issuer: CUSTOMER_TOKEN_ISSUER },
    );
    try {
      tokens.verifyAccess(forged);
      throw new Error('accepted');
    } catch (error) {
      expect(codeOf(error)).toBe('CUSTOMER_TOKEN_INVALID');
    }
  });

  it('refuses a customer-key token without the customer audience, or with a staff role claim', () => {
    const customerJwt = new JwtService({ secret: getCustomerJwtSecret() });
    const noAudience = customerJwt.sign({ sub: 'acc-1', sid: 'ses-1', realm: 'customer' }, { issuer: CUSTOMER_TOKEN_ISSUER });
    expect(() => tokens.verifyAccess(noAudience)).toThrow(HttpException);
    const withRole = customerJwt.sign(
      { sub: 'acc-1', sid: 'ses-1', realm: 'customer', role: 'ceo' },
      { audience: CUSTOMER_TOKEN_AUDIENCE, issuer: CUSTOMER_TOKEN_ISSUER },
    );
    expect(() => tokens.verifyAccess(withRole)).toThrow(HttpException);
  });

  it('says when a token has expired, so the app renews it', () => {
    const customerJwt = new JwtService({ secret: getCustomerJwtSecret() });
    const old = customerJwt.sign(
      { sub: 'acc-1', sid: 'ses-1', realm: 'customer', exp: Math.floor(Date.now() / 1000) - 10 },
      { audience: CUSTOMER_TOKEN_AUDIENCE, issuer: CUSTOMER_TOKEN_ISSUER },
    );
    try {
      tokens.verifyAccess(old);
      throw new Error('accepted');
    } catch (error) {
      expect(codeOf(error)).toBe('CUSTOMER_TOKEN_EXPIRED');
    }
  });

  it('stores refresh tokens only as a hash', () => {
    const raw = tokens.newRefreshToken();
    expect(raw.length).toBeGreaterThanOrEqual(40);
    expect(tokens.hashRefreshToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.hashRefreshToken(raw)).not.toContain(raw);
  });
});

describe('Customer realm: CustomerAuthGuard', () => {
  const tokens = new CustomerTokenService();
  const now = new Date('2026-11-28T06:00:00.000Z');
  const clock = { now: () => now };
  const prisma = {
    customerSession: { findUnique: jest.fn(), updateMany: jest.fn() },
    customerAccount: { updateMany: jest.fn() },
  };
  const guard = new CustomerAuthGuard(prisma as never, tokens, clock as never);

  function contextFor(request: Partial<CustomerRequest>): ExecutionContext {
    return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  }

  function session(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ses-1',
      accountId: 'acc-1',
      deviceId: 'dev-1',
      revokedAt: null,
      expiresAt: new Date(now.getTime() + 86_400_000),
      lastUsedAt: now,
      account: { status: 'active' },
      ...overrides,
    };
  }

  beforeEach(() => jest.clearAllMocks());

  async function failCode(request: Partial<CustomerRequest>): Promise<string | undefined> {
    try {
      await guard.canActivate(contextFor(request));
    } catch (error) {
      return codeOf(error);
    }
    return 'allowed';
  }

  it('asks for a sign-in when there is no token', async () => {
    expect(await failCode({ headers: {} })).toBe('CUSTOMER_TOKEN_MISSING');
  });

  it('sets req.customer, never req.user, for a live session', async () => {
    prisma.customerSession.findUnique.mockResolvedValue(session());
    const { accessToken } = tokens.signAccess('acc-1', 'ses-1');
    const request = { headers: { authorization: `Bearer ${accessToken}` } } as Partial<CustomerRequest> & { user?: unknown };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.customer).toEqual({ accountId: 'acc-1', sessionId: 'ses-1', deviceId: 'dev-1' });
    expect(request.user).toBeUndefined();
  });

  it('refuses a revoked session, or one that belongs to another account', async () => {
    const { accessToken } = tokens.signAccess('acc-1', 'ses-1');
    prisma.customerSession.findUnique.mockResolvedValue(session({ revokedAt: now }));
    expect(await failCode({ headers: { authorization: `Bearer ${accessToken}` } })).toBe('CUSTOMER_SESSION_ENDED');
    prisma.customerSession.findUnique.mockResolvedValue(session({ accountId: 'acc-2' }));
    expect(await failCode({ headers: { authorization: `Bearer ${accessToken}` } })).toBe('CUSTOMER_SESSION_ENDED');
  });

  it('ends a session past its 90 days', async () => {
    const { accessToken } = tokens.signAccess('acc-1', 'ses-1');
    prisma.customerSession.findUnique.mockResolvedValue(session({ expiresAt: now }));
    expect(await failCode({ headers: { authorization: `Bearer ${accessToken}` } })).toBe('CUSTOMER_SESSION_ENDED');
    expect(prisma.customerSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'ses-1', revokedAt: null },
      data: { revokedAt: now, endedReason: 'expired' },
    });
  });

  it('refuses blocked and deleted accounts', async () => {
    const { accessToken } = tokens.signAccess('acc-1', 'ses-1');
    prisma.customerSession.findUnique.mockResolvedValue(session({ account: { status: 'blocked' } }));
    expect(await failCode({ headers: { authorization: `Bearer ${accessToken}` } })).toBe('CUSTOMER_ACCOUNT_BLOCKED');
    prisma.customerSession.findUnique.mockResolvedValue(session({ account: { status: 'deleted' } }));
    expect(await failCode({ headers: { authorization: `Bearer ${accessToken}` } })).toBe('CUSTOMER_ACCOUNT_DELETED');
  });

  it('refuses a staff token', async () => {
    const staffToken = new JwtService({ secret: getJwtSecret() }).sign({ sub: 'staff-1', role: 'ceo', email: null, code: 'CEO-1' });
    expect(await failCode({ headers: { authorization: `Bearer ${staffToken}` } })).toBe('CUSTOMER_TOKEN_INVALID');
    expect(prisma.customerSession.findUnique).not.toHaveBeenCalled();
  });
});

describe('Customer app values in existing lists', () => {
  it('"Laboura app" is a "how they heard" value on every registration form (C3)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HEARD_FROM_VALUES } = require('../../modules/job-seeker/job-seeker.validator') as { HEARD_FROM_VALUES: readonly string[] };
    expect(HEARD_FROM_VALUES).toContain('laboura_app');
    expect(HEARD_FROM_VALUES).toEqual(expect.arrayContaining(['toll_free_missed_call', 'ad', 'referral_partner', 'field_visit', 'social_media', 'walk_in', 'other']));
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { SESSIONLESS_TEST_TOKENS_ENV, sessionlessTokensAllowed } from './sessionless-tokens';

/**
 * Security check (12 Nov): a token with no session id skipped every session check
 * (revocation, idle logout, the 2-hour limit). It is now refused.
 */
describe('Access tokens must carry a session', () => {
  const prisma = { staffSession: { findUnique: jest.fn(), updateMany: jest.fn() } };
  const clock = { now: () => new Date('2026-11-12T06:00:00.000Z') };
  const pricing = { current: jest.fn().mockResolvedValue({ idleLogoutMinutes: 60 }) };
  const strategy = new JwtStrategy(prisma as never, clock as never, pricing as never);
  const saved = process.env[SESSIONLESS_TEST_TOKENS_ENV];

  afterEach(() => {
    process.env[SESSIONLESS_TEST_TOKENS_ENV] = saved;
  });

  it('refuses a token with no sid', async () => {
    delete process.env[SESSIONLESS_TEST_TOKENS_ENV];
    await expect(strategy.validate({ sub: 'staff-1', role: 'ceo', email: null, code: 'CEO-1' } as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.staffSession.findUnique).not.toHaveBeenCalled();
  });

  it('checks the session of a token that has one', async () => {
    delete process.env[SESSIONLESS_TEST_TOKENS_ENV];
    prisma.staffSession.findUnique.mockResolvedValueOnce(null);
    await expect(strategy.validate({ sub: 'staff-1', role: 'ceo', email: null, code: 'CEO-1', sid: 'gone' } as never)).rejects.toThrow('Session not found');
  });

  it('allows a sessionless token only inside a Jest test run that switched it on', () => {
    expect(sessionlessTokensAllowed({ NODE_ENV: 'production', JEST_WORKER_ID: '1', [SESSIONLESS_TEST_TOKENS_ENV]: '1' })).toBe(false);
    expect(sessionlessTokensAllowed({ NODE_ENV: 'test', [SESSIONLESS_TEST_TOKENS_ENV]: '1' })).toBe(false);
    expect(sessionlessTokensAllowed({ NODE_ENV: 'test', JEST_WORKER_ID: '1' })).toBe(false);
    expect(sessionlessTokensAllowed({ NODE_ENV: 'test', JEST_WORKER_ID: '1', [SESSIONLESS_TEST_TOKENS_ENV]: '1' })).toBe(true);
  });
});

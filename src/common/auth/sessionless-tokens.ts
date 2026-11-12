/**
 * Every real access token carries a session id (`sid`): login and refresh always
 * create a StaffSession first. A token without one is refused, so a token minted
 * with the JWT secret but no session can't skip revocation, idle logout and the
 * 2-hour limit (security check, 12 Nov).
 *
 * The only exception is the Jest test run, where many specs sign a token directly:
 * all three must hold — NODE_ENV is "test", Jest is running (JEST_WORKER_ID), and
 * the test setup file switched it on. None of these is set on Render.
 */
export const SESSIONLESS_TEST_TOKENS_ENV = 'LABOURA_ALLOW_SESSIONLESS_TEST_TOKENS';

export function sessionlessTokensAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' && Boolean(env.JEST_WORKER_ID) && env[SESSIONLESS_TEST_TOKENS_ENV] === '1';
}

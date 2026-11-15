import { SESSIONLESS_TEST_TOKENS_ENV } from '../common/auth/sessionless-tokens';

// Test-only: many specs sign an access token directly instead of logging in, so it
// has no session id. Outside Jest such a token is always refused (jwt.strategy.ts).
process.env[SESSIONLESS_TEST_TOKENS_ENV] = '1';

// INF-3: every process must say which setup it is; the tests are the test setup.
if (process.env.LABOURA_SETUP === undefined) process.env.LABOURA_SETUP = 'test';

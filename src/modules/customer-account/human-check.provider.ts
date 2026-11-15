import { Injectable } from '@nestjs/common';

/**
 * The human check asked for after repeated OTP requests (security review M5):
 * a CAPTCHA or a device attestation (Play Integrity / App Attest). No provider
 * is chosen yet, so the only implementation is a mock, picked the same way as
 * every other vendor (HUMAN_CHECK_PROVIDER_MODE, default mock).
 *
 * The mock accepts the token `mock-human-ok`. It proves nothing: it only lets
 * the app and the tests exercise the step. Replace it with a real provider
 * before the public launch (docs/customer-app-api.md, DEPLOY.md).
 */
export const HUMAN_CHECK_PROVIDER = 'HUMAN_CHECK_PROVIDER';
export const MOCK_HUMAN_CHECK_TOKEN = 'mock-human-ok';

export interface HumanCheckProvider {
  readonly name: string;
  verify(token: unknown, context: { installationId: string | null; ip: string | null }): Promise<boolean>;
}

@Injectable()
export class MockHumanCheckProvider implements HumanCheckProvider {
  readonly name = 'mock';

  async verify(token: unknown): Promise<boolean> {
    return token === MOCK_HUMAN_CHECK_TOKEN;
  }
}

/** Fails closed: a mode with no implementation refuses every check. */
export class UnavailableHumanCheckProvider implements HumanCheckProvider {
  readonly name = 'unavailable';

  async verify(): Promise<boolean> {
    return false;
  }
}

export function humanCheckProviderFactory(env: NodeJS.ProcessEnv = process.env): HumanCheckProvider {
  const mode = env.HUMAN_CHECK_PROVIDER_MODE?.trim().toLowerCase() || 'mock';
  // INF-3: the mock (public token) never answers on the live setup, even if start-up were bypassed.
  if (mode === 'mock' && env.LABOURA_SETUP === 'live') return new UnavailableHumanCheckProvider();
  return mode === 'mock' ? new MockHumanCheckProvider() : new UnavailableHumanCheckProvider();
}

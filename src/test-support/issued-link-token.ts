import { INestApplication } from '@nestjs/common';
import { ConsentLinkService } from '../modules/consent/consent-link.service';

const ISSUERS = ['createLink', 'createAgreementLink', 'createReferralTermsLink'] as const;

/**
 * Test-only. Staff routes never return a public link's token (security AC-3):
 * the person gets it by SMS. This runs `send` (usually a staff request that
 * issues a link) and also returns the token the link service issued during
 * it, as the person's SMS would carry it.
 */
export async function withIssuedLinkToken<T>(
  app: INestApplication,
  send: () => PromiseLike<T>,
): Promise<{ res: T; token: string }> {
  const service = app.get(ConsentLinkService);
  const issued: string[] = [];
  const spies = ISSUERS.map((method) => {
    const original = (service[method] as (...args: unknown[]) => Promise<{ token: string }>).bind(service);
    return jest.spyOn(service, method).mockImplementation((async (...args: unknown[]) => {
      const result = await original(...args);
      issued.push(result.token);
      return result;
    }) as never);
  });
  try {
    const res = await send();
    const token = issued[issued.length - 1];
    if (!token) throw new Error('No public link was issued by this request');
    return { res, token };
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
}

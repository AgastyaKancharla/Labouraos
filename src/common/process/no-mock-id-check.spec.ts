import { assertNoMockIdCheck, RETIRED_ID_CHECK_SETTINGS } from './no-mock-id-check';

describe('Production refuses any mock or outside ID-check setting (rev 154)', () => {
  it('fails to boot in production with KYC_PROVIDER_MODE=mock', () => {
    expect(() => assertNoMockIdCheck({ NODE_ENV: 'production', KYC_PROVIDER_MODE: 'mock' })).toThrow(/KYC_PROVIDER_MODE/);
  });

  it('fails for every retired or mock ID setting, even "real"', () => {
    for (const name of RETIRED_ID_CHECK_SETTINGS) {
      expect(() => assertNoMockIdCheck({ NODE_ENV: 'production', [name]: 'real' })).toThrow(name);
    }
  });

  it('boots in production without them, and never blocks outside production', () => {
    expect(() => assertNoMockIdCheck({ NODE_ENV: 'production', KYC_PROVIDER_MODE: '  ' })).not.toThrow();
    expect(() => assertNoMockIdCheck({ NODE_ENV: 'production' })).not.toThrow();
    expect(() => assertNoMockIdCheck({ NODE_ENV: 'development', KYC_PROVIDER_MODE: 'mock' })).not.toThrow();
  });
});

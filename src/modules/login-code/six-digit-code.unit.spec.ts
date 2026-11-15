import { loginCodeFor, sixDigitCode } from './login-code.crypto';
import { resetCodeFor } from '../password-reset/password-reset.crypto';

/**
 * Security AUTH-1: login and reset codes took the first 6 decimal digits of an
 * HMAC, so they never started with 0 and started with 1 about 23% of the time.
 * They must be uniform over 000000–999999.
 */
describe('AUTH-1: six-digit login and reset codes are uniform', () => {
  const secret = 'auth1_distribution_test_secret_32_characters';
  const N = 20000;

  function leadingDigitCounts(codeFor: (id: string) => string) {
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < N; i += 1) {
      const code = codeFor(`request-${i}`);
      expect(code).toMatch(/^\d{6}$/);
      counts[Number(code[0])] += 1;
    }
    return counts;
  }

  /** Chi-square over 10 equally likely buckets; 9 degrees of freedom, p = 0.001 is 27.88. */
  function chiSquare(counts: number[]) {
    const expected = N / counts.length;
    return counts.reduce((sum, c) => sum + ((c - expected) ** 2) / expected, 0);
  }

  it.each([
    ['login', (id: string) => loginCodeFor(id, secret)],
    ['reset', (id: string) => resetCodeFor(id, secret)],
  ])('%s codes: every leading digit (0 included) about 10%% of the time', (_name, codeFor) => {
    const counts = leadingDigitCounts(codeFor);
    expect(counts[0]).toBeGreaterThan(N * 0.08);
    expect(Math.max(...counts) / N).toBeLessThan(0.12);
    expect(chiSquare(counts)).toBeLessThan(27.88);
  });

  it('each of the six positions is uniform too', () => {
    const counts = Array.from({ length: 6 }, () => new Array<number>(10).fill(0));
    for (let i = 0; i < N; i += 1) {
      const code = loginCodeFor(`position-${i}`, secret);
      for (let p = 0; p < 6; p += 1) counts[p][Number(code[p])] += 1;
    }
    for (const position of counts) expect(chiSquare(position)).toBeLessThan(27.88);
  });

  it('pads small values and reduces modulo one million', () => {
    expect(sixDigitCode('0')).toBe('000000');
    expect(sixDigitCode((1_000_007).toString(16))).toBe('000007');
    expect(sixDigitCode('f'.repeat(64))).toMatch(/^\d{6}$/);
  });

  it('login and reset codes for the same request id differ (own labels)', () => {
    const same = Array.from({ length: 200 }, (_, i) => `r-${i}`).filter((id) => loginCodeFor(id, secret) === resetCodeFor(id, secret));
    expect(same.length).toBeLessThan(3);
  });
});

import { securityHeaders } from './security-headers';

function run(env: NodeJS.ProcessEnv) {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    getHeader: (k: string) => headers[k],
  };
  const next = jest.fn();
  securityHeaders(env)({} as never, res as never, next);
  return { headers, next };
}

describe('L5: security headers', () => {
  it('sends HSTS in production with nosniff, a referrer policy and same-origin framing', () => {
    const { headers, next } = run({ NODE_ENV: 'production' });
    expect(headers['Strict-Transport-Security']).toBe('max-age=15552000; includeSubDomains');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(next).toHaveBeenCalled();
  });

  it('leaves HSTS out outside production (plain http on a laptop)', () => {
    expect(run({ NODE_ENV: 'development' }).headers['Strict-Transport-Security']).toBeUndefined();
  });
});

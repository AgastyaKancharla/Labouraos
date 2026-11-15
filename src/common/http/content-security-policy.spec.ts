import { contentSecurityPolicy, contentSecurityPolicyHeader } from './content-security-policy';
import { securityHeaders } from './security-headers';

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('Content-Security-Policy (IN-6 / INF-12)', () => {
  const env = { NODE_ENV: 'production', SUPABASE_URL: 'https://abcdefghijkl.supabase.co/' } as NodeJS.ProcessEnv;

  it('runs only the app\'s own scripts: no inline script, no eval, no other site', () => {
    for (const app of ['web', 'field'] as const) {
      const csp = contentSecurityPolicy(app, env);
      expect(directive(csp, 'script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'");
      expect(directive(csp, 'default-src')).toBe("default-src 'self'");
      expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
      expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
      expect(directive(csp, 'form-action')).toBe("form-action 'self'");
      expect(csp).toContain('upgrade-insecure-requests');
    }
  });

  it('lets in exactly what the screens load: Supabase signed links, Google Fonts (web), map tiles (Field)', () => {
    const web = contentSecurityPolicy('web', env);
    const field = contentSecurityPolicy('field', env);
    for (const csp of [web, field]) {
      expect(directive(csp, 'img-src')).toContain('https://abcdefghijkl.supabase.co');
      expect(directive(csp, 'media-src')).toContain('https://abcdefghijkl.supabase.co');
      expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://abcdefghijkl.supabase.co");
      expect(directive(csp, 'worker-src')).toBe("worker-src 'self' blob:");
    }
    expect(directive(web, 'style-src')).toBe("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(directive(web, 'font-src')).toBe("font-src 'self' data: https://fonts.gstatic.com");
    expect(directive(web, 'img-src')).not.toContain('openstreetmap');
    expect(directive(field, 'img-src')).toContain('https://tile.openstreetmap.org');
    expect(directive(field, 'style-src')).not.toContain('googleapis');
  });

  it('without SUPABASE_URL (development) the storage origin is simply left out', () => {
    expect(directive(contentSecurityPolicy('web', {} as NodeJS.ProcessEnv), 'connect-src')).toBe("connect-src 'self'");
    expect(contentSecurityPolicy('web', {} as NodeJS.ProcessEnv)).not.toContain('upgrade-insecure-requests');
  });

  it('enforced by default; report-only and off by CONTENT_SECURITY_POLICY', () => {
    expect(contentSecurityPolicyHeader('web', env)?.[0]).toBe('Content-Security-Policy');
    const reportOnly = contentSecurityPolicyHeader('web', { ...env, CONTENT_SECURITY_POLICY: 'report-only' });
    expect(reportOnly?.[0]).toBe('Content-Security-Policy-Report-Only');
    expect(reportOnly?.[1]).not.toContain('upgrade-insecure-requests');
    expect(contentSecurityPolicyHeader('web', { ...env, CONTENT_SECURITY_POLICY: 'off' })).toBeNull();
  });

  it('every answer drops X-Powered-By', () => {
    const removed: string[] = [];
    const res = { setHeader: jest.fn(), getHeader: jest.fn(), removeHeader: (name: string) => removed.push(name) };
    securityHeaders({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)({} as never, res as never, jest.fn());
    expect(removed).toContain('X-Powered-By');
  });
});

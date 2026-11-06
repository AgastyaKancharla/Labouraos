import { getPublicAppUrl, publicLink } from './public-link';

describe('PUBLIC_APP_URL configuration and public links', () => {
  const originalUrl = process.env.PUBLIC_APP_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = originalUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('fails closed when PUBLIC_APP_URL is missing or empty', () => {
    delete process.env.PUBLIC_APP_URL;
    expect(() => getPublicAppUrl()).toThrow(/PUBLIC_APP_URL environment variable is missing or empty/);
    process.env.PUBLIC_APP_URL = '  ';
    expect(() => getPublicAppUrl()).toThrow(/PUBLIC_APP_URL environment variable is missing or empty/);
  });

  it('rejects relative and non-web URLs', () => {
    process.env.PUBLIC_APP_URL = '/app';
    expect(() => getPublicAppUrl()).toThrow(/absolute URL/);
    process.env.PUBLIC_APP_URL = 'ftp://app.laboura.in';
    expect(() => getPublicAppUrl()).toThrow(/HTTP or HTTPS/);
  });

  it('requires HTTPS in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_APP_URL = 'http://app.laboura.in';
    expect(() => getPublicAppUrl()).toThrow(/must use HTTPS in production/);
  });

  it('constructs an absolute URL and preserves an app path prefix', () => {
    process.env.NODE_ENV = 'test';
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in/';
    expect(publicLink('/consent/token')).toBe('https://app.laboura.in/consent/token');
    process.env.PUBLIC_APP_URL = 'https://example.test/laboura';
    expect(publicLink('/candidate-introductions/token')).toBe('https://example.test/laboura/candidate-introductions/token');
  });
});

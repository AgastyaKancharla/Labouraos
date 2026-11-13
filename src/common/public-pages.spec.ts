import { PUBLIC_PAGE_PATHS, publicPageLink, publicPagePath, wantsHtml } from './public-pages';

describe('Public phone page links (/p/...)', () => {
  const originalUrl = process.env.PUBLIC_APP_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = originalUrl;
  });

  it('builds every page under /p with the web app route names', () => {
    expect(publicPagePath('registration', 'abc')).toBe('/p/register/abc');
    expect(publicPagePath('paymentOnly', 'abc')).toBe('/p/pay/abc');
    expect(publicPagePath('offerReply', 'abc')).toBe('/p/offer/abc');
    expect(publicPagePath('businessAgreement', 'abc')).toBe('/p/agreement/abc');
    expect(publicPagePath('interviewResult', 'abc')).toBe('/p/interview-result/abc');
    expect(publicPagePath('payment', 'PAY-00001-ab12')).toBe('/p/fee/PAY-00001-ab12');
    expect(publicPagePath('offerCheck', 'abc')).toBe('/p/did-they-offer/abc');
    expect(publicPagePath('referralRegistration', 'abc')).toBe('/p/partner/abc');
    expect(Object.keys(PUBLIC_PAGE_PATHS)).toHaveLength(8);
  });

  it('makes absolute links from PUBLIC_APP_URL, keeping a path prefix, and encodes the token', () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    expect(publicPageLink('registration', 'tok')).toBe('https://app.laboura.in/p/register/tok');
    expect(publicPageLink('payment', 'a/b')).toBe('https://app.laboura.in/p/fee/a%2Fb');
    process.env.PUBLIC_APP_URL = 'https://example.test/laboura/';
    expect(publicPageLink('offerReply', 'tok')).toBe('https://example.test/laboura/p/offer/tok');
  });

  it('refuses an empty token', () => {
    expect(() => publicPagePath('registration', '')).toThrow(/needs a token/);
  });

  it('tells a browser from an API client', () => {
    expect(wantsHtml('text/html,application/xhtml+xml')).toBe(true);
    expect(wantsHtml('application/json')).toBe(false);
    expect(wantsHtml(undefined)).toBe(false);
  });
});

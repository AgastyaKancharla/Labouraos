import { describe, expect, it } from 'vitest';
import { detectUpiPlatform, upiAppLink, upiQuery, UPI_APPS } from './upiApps';

const URI = 'upi://pay?pa=laboura%40icici&pn=Laboura+Staffing+Pvt+Ltd&am=499.00&tn=PAY-01042&tr=PAY-1042-K7Q2&cu=INR';

describe('"Or pay with" UPI app links (21 Nov, rev 204)', () => {
  it('keeps exactly the request’s payee, name, amount, note, reference and currency', () => {
    expect(upiQuery(URI)).toBe('pa=laboura%40icici&pn=Laboura+Staffing+Pvt+Ltd&am=499.00&tn=PAY-01042&tr=PAY-1042-K7Q2&cu=INR');
    // Anything else in the link is not passed on; a link that is not upi://pay gives nothing.
    expect(upiQuery(`${URI}&url=https://evil.example`)).not.toContain('evil');
    expect(upiQuery('https://pay.example/?pa=x&am=1')).toBeNull();
    expect(upiQuery('upi://pay?pn=NoPayee')).toBeNull();
  });

  it('Android: an intent link naming each app (fallback upi://pay); other app: the plain UPI link', () => {
    expect(upiAppLink('phonepe', URI, 'android')).toBe(
      `intent://pay?${upiQuery(URI)}#Intent;scheme=upi;package=com.phonepe.app;S.browser_fallback_url=${encodeURIComponent(`upi://pay?${upiQuery(URI)}`)};end`,
    );
    expect(upiAppLink('gpay', URI, 'android')).toContain('package=com.google.android.apps.nbu.paisa.user;');
    expect(upiAppLink('paytm', URI, 'android')).toContain('package=net.one97.paytm;');
    expect(upiAppLink('bhim', URI, 'android')).toContain('package=in.org.npci.upiapp;');
    expect(upiAppLink('other', URI, 'android')).toBe(`upi://pay?${upiQuery(URI)}`);
  });

  it('iPhone: the app schemes that work (PhonePe, Google Pay, Paytm); BHIM and others use upi://pay', () => {
    expect(upiAppLink('phonepe', URI, 'ios')).toBe(`phonepe://pay?${upiQuery(URI)}`);
    expect(upiAppLink('gpay', URI, 'ios')).toBe(`tez://upi/pay?${upiQuery(URI)}`);
    expect(upiAppLink('paytm', URI, 'ios')).toBe(`paytmmp://pay?${upiQuery(URI)}`);
    expect(upiAppLink('bhim', URI, 'ios')).toBe(`upi://pay?${upiQuery(URI)}`);
  });

  it('a laptop gets no app links (only the QR)', () => {
    for (const app of UPI_APPS) expect(upiAppLink(app, URI, 'desktop')).toBeNull();
  });

  it('tells phones from laptops', () => {
    expect(detectUpiPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile' })).toBe('android');
    expect(detectUpiPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe('ios');
    expect(detectUpiPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe('ios');
    expect(detectUpiPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129' })).toBe('desktop');
    expect(detectUpiPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe('desktop');
  });
});

import { consentMethodFor } from './consent-link.service';

/** Security review M3: consent given on a link opened inside the Laboura app is recorded as in_app. */
describe('consent method by link', () => {
  it('in_app for links issued to a customer account, sms_link otherwise', () => {
    expect(consentMethodFor({ issuedTo: 'customer:acc-1' })).toBe('in_app');
    expect(consentMethodFor({ issuedTo: null })).toBe('sms_link');
    expect(consentMethodFor({})).toBe('sms_link');
    expect(consentMethodFor({ issuedTo: 'staff:1' })).toBe('sms_link');
  });
});

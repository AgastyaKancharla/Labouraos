import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { account, jsProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import { htmlToText, UpdatedTerms } from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const doc = {
  version: '1.1',
  title: 'Job Seeker Terms',
  summary: ['You pay <strong>₹499</strong> once.'],
  bodyHtml: '<section><h3>1. What Laboura does</h3><p>Full terms text.</p></section>',
  hash: 'a'.repeat(64),
  consents: [
    { purpose: 'job_matching', required: true, title: '1. Job matching', description: 'Match my profile.' },
    { purpose: 'promotions', required: false, title: '6. Promotions (optional)', description: 'Offers and news.' },
  ],
};

describe('We have updated our terms (legal documents v1.1)', () => {
  it('shows In short, the full terms on demand, needs the required ticks, then accepts by a fresh OTP', async () => {
    const api = fakeApi({
      legalDocument: async () => doc,
      sendStepUp: async () => ({ requestId: 'acc-1' }),
      acceptTerms: async () => ({ version: '1.1' }),
    });
    await renderWithApp(<UpdatedTerms profileId="p-js" legal={{ documentKey: 'job_seeker_terms', currentVersion: '1.1', acceptedVersion: '1.0', needsReconsent: true }} />, {
      api,
      account: account({ profiles: [jsProfile] }),
    });
    expect(await screen.findByTestId('terms-in-short')).toHaveTextContent(/You pay ₹499 once/);
    expect(screen.getByText(/You accepted version 1.0/)).toBeTruthy();
    expect(screen.queryByTestId('terms-full')).toBeNull();
    await fireEvent.press(screen.getByTestId('terms-read-full'));
    expect(screen.getByTestId('terms-full')).toHaveTextContent(/Full terms text/);
    expect(screen.getByTestId('terms-otp-send')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('terms-tick-job_matching'));
    await fireEvent.press(screen.getByTestId('terms-otp-send'));
    expect(screen.queryByTestId('terms-otp-verify')).toBeNull(); // one button (rev 193): typing the code accepts
    expect(api.sendStepUp).toHaveBeenCalledWith('accept_terms', undefined);
    await fireEvent.changeText(await screen.findByTestId('terms-otp-code'), '123456');
    await waitFor(() =>
      expect(api.acceptTerms).toHaveBeenCalledWith('p-js', { purposes: ['job_matching'], language: 'en', otp: { requestId: 'acc-1', code: '123456' }, textHash: 'a'.repeat(64) }),
    );
  });

  it('a business owner signs the updated agreement on its link instead', async () => {
    const api = fakeApi({ legalDocument: async () => ({ ...doc, consents: [] }) });
    await renderWithApp(<UpdatedTerms profileId="p-biz" legal={{ documentKey: 'business_agreement', currentVersion: '1.1', acceptedVersion: '1.0', needsReconsent: true }} />, {
      api,
      account: account({ profiles: [jsProfile] }),
    });
    expect(await screen.findByTestId('terms-sign-agreement')).toBeTruthy();
    expect(screen.queryByTestId('terms-otp-send')).toBeNull();
  });

  it('turns the server HTML into plain words', () => {
    expect(htmlToText('<p>A &amp; <strong>B</strong></p><ul><li>one</li><li>two</li></ul>')).toBe('A & B\none\ntwo');
  });
});

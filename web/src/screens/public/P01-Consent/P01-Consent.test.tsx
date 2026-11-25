import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import { legalDocument, openStatus, TOKEN, verifiedInThisTab } from '../shared/testData';
import Consent from './index';

const render = () => renderScreen(<Consent />, { portal: 'public', path: `/p/register/${TOKEN}/consent`, route: '/p/register/:token/consent' });

describe('P01-Consent', () => {
  it('never pre-ticks a box, needs all five required ones, and saves each purpose with the language', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus(),
      'GET /legal/documents/job_seeker_terms': legalDocument(),
      'POST /consent/submit': { success: true },
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Your permission' })).toBeInTheDocument();
    // Job Seeker Terms v1.1: "In short" first, the full text behind "Read the full terms" (rev 176).
    expect(screen.getByTestId('legal-in-short')).toHaveTextContent('₹499');
    expect(screen.getByText('Read the full terms')).toBeInTheDocument();
    expect(api.calls('GET /legal/documents/job_seeker_terms')[0]!.query.get('lang')).toBe('en');
    expect(screen.getByText('Step 1 of 4 · Consent')).toBeInTheDocument();
    // Notice 1.3 (rev 211): the line above the ticks, word for word.
    expect(screen.getByTestId('consent-notice')).toHaveTextContent('Your 30 days start only after your government ID is verified. Until then your registration is paused.');
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(6);
    boxes.forEach((box) => expect(box).not.toBeChecked());
    expect(screen.getByRole('checkbox', { name: /Record calls/ })).toBeInTheDocument();
    const agree = screen.getByRole('button', { name: 'I agree — continue' });
    expect(agree).toBeDisabled();
    for (const name of [/Match me to jobs/, /Share my profile/, /Record calls/, /Check my ID/]) {
      await userEvent.click(screen.getByRole('checkbox', { name }));
    }
    expect(agree).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Job updates/ }));
    expect(agree).toBeEnabled();
    await userEvent.click(agree);
    expect(api.calls('POST /consent/submit')[0]!.body).toEqual({
      token: TOKEN,
      otpRequestId: 'req-1',
      purposes: ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'],
      language: 'en',
      // The hash of the terms text the page showed (the server refuses a text that changed meanwhile).
      textHash: 'abc',
    });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('an item he already gave on an earlier link is shown as given and not asked again; only the rest is sent (17 Nov)', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus({ consentGiven: ['job_matching', 'profile_sharing', 'aadhaar_verification', 'job_updates'] }),
      'GET /legal/documents/job_seeker_terms': legalDocument(),
      'POST /consent/submit': { success: true },
    });
    render();
    expect(await screen.findByTestId('consent-given-job_matching')).toHaveTextContent('Already given');
    expect(screen.getByText(/they are not asked again/)).toBeInTheDocument();
    // Only call recording (required) and promotions (optional) are asked.
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: /Match me to jobs/ })).toBeNull();
    const agree = screen.getByRole('button', { name: 'I agree — continue' });
    expect(agree).toBeDisabled();
    expect(screen.getByText('Tick the remaining required boxes to continue.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Record calls/ }));
    expect(agree).toBeEnabled();
    await userEvent.click(agree);
    expect(api.calls('POST /consent/submit')[0]!.body).toMatchObject({ purposes: ['call_recording'] });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('sends him back to the start for a fresh code when his code has lapsed', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: { otpRequired: true, maskedPhone: '******2345', language: null, registrationComplete: false } });
    render();
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
    expect(sessionStorage.getItem(`laboura_reg_otp:${TOKEN}`)).toBeNull();
  });

  it('shows a failed save', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus(),
      'GET /legal/documents/job_seeker_terms': legalDocument(),
      'POST /consent/submit': apiError(500, 'Internal server error'),
    });
    render();
    for (const box of await screen.findAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'I agree — continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
  });

  it('under 18 by his date of birth: registration stops at consent, before any payment (rev 211)', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus({ stopped: 'under_18' }),
      'GET /legal/documents/job_seeker_terms': legalDocument(),
    });
    render();
    expect(await screen.findByText('Registration stops here.')).toBeInTheDocument();
    expect(screen.getByText(/No payment is taken/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I agree — continue' })).not.toBeInTheDocument();
  });
});

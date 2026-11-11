import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import Agreement from './index';

const details = {
  subjectType: 'business', businessName: 'Annapoorna Mess', maskedPhone: '******4321', preferredLanguage: 'en',
  agreementTermsHtml: '<p>Full terms</p>', ownerName: 'Shankar Rao',
  terms: { feePercent: 50, gstPercent: 18, noBypassMonths: 12, noBypassPenaltyPercent: 50 },
  guarantee: { replacementWindowDays: 60, maxFreeReplacements: 2, replacementSearchDays: 15 },
};
const render = () => renderScreen(<Agreement />, { portal: 'public', path: '/p/agreement/atok', route: '/p/agreement/:token' });

describe('P04-Agreement / P04b-Signed', () => {
  it('shows the frozen terms, needs both ticks, the name and the owner OTP, then shows it signed', async () => {
    const api = mockApi({
      'GET /consent/atok': details,
      'POST /consent/send-otp': { requestId: 'areq', phone: '******4321' },
      'POST /consent/submit': { signedAt: '2026-11-09T07:10:00Z' },
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Laboura agreement · Annapoorna Mess' })).toBeInTheDocument();
    expect(screen.getByText("50% of the first month's salary + 18% GST, paid when you select a candidate")).toBeInTheDocument();
    expect(screen.getByText('If they leave within 60 days: up to 2 free replacements, all within the same 60 days')).toBeInTheDocument();
    expect(screen.getByText("If we can't replace in 15 days")).toBeInTheDocument();
    expect(screen.getByText(/within 12 months without paying: full fee \+ 50% \+ GST/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Your full name/ })).toHaveValue('Shankar Rao');
    const terms = screen.getByRole('checkbox', { name: 'I agree to these terms' });
    const recording = screen.getByRole('checkbox', { name: 'I agree my calls with Laboura are recorded' });
    expect(terms).not.toBeChecked();
    expect(recording).not.toBeChecked();
    const sign = screen.getByRole('button', { name: 'Sign agreement' });
    await userEvent.click(terms);
    await userEvent.click(recording);
    await userEvent.click(screen.getByRole('button', { name: 'Send code to ******4321' }));
    expect(sign).toBeDisabled();
    await userEvent.click(screen.getAllByRole('textbox').find((el) => el.getAttribute('inputmode') === 'numeric')!);
    await userEvent.paste('802291');
    await userEvent.click(sign);
    expect(api.calls('POST /consent/submit')[0]!.body).toEqual({
      token: 'atok', otpRequestId: 'areq', otpCode: '802291', signedName: 'Shankar Rao', purposes: ['agreement_terms', 'call_recording'],
    });
    expect(await screen.findByText('Agreement signed, Shankar Rao')).toBeInTheDocument();
    expect(screen.getByText('9 Nov, 12:40 PM')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/consent/atok/signed/copy');
    expect(screen.getByText(/Team Lead will call you/)).toBeInTheDocument();
  });

  it('opening the used link again shows that it is signed', async () => {
    mockApi({
      'GET /consent/atok': apiError(400, 'Consent link has already been used'),
      'GET /consent/atok/signed': { signedAt: '2026-11-09T07:10:00Z', signedName: 'Shankar Rao', businessName: 'Annapoorna Mess', preferredLanguage: 'en' },
    });
    render();
    expect(await screen.findByText('Agreement signed, Shankar Rao')).toBeInTheDocument();
  });

  it('explains an expired link', async () => {
    mockApi({ 'GET /consent/atok': apiError(400, 'Consent link has expired') });
    render();
    expect(await screen.findByText(/This link has expired/)).toBeInTheDocument();
  });
});

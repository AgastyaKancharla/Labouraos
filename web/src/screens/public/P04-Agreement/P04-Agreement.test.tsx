import { screen, waitFor } from '@testing-library/react';
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
  it('shows the frozen terms; after the name and the three ticks one button sends the owner OTP and typing it signs (rev 193)', async () => {
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
    const authority = screen.getByRole('checkbox', { name: /I have authority to agree/ });
    expect(terms).not.toBeChecked();
    expect(recording).not.toBeChecked();
    expect(authority).not.toBeChecked();
    // One button: no "Sign agreement" button; "Send code to sign" waits for the ticks.
    expect(screen.queryByRole('button', { name: 'Sign agreement' })).not.toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send code to sign' });
    expect(send).toBeDisabled();
    expect(screen.getByText('Write your name and tick the three boxes first.')).toBeInTheDocument();
    await userEvent.click(terms);
    await userEvent.click(recording);
    expect(send).toBeDisabled();
    await userEvent.click(authority);
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(api.calls('POST /consent/send-otp')).toHaveLength(1);
    expect(api.calls('POST /consent/submit')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Sign agreement' })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('textbox').find((el) => el.getAttribute('inputmode') === 'numeric')!);
    await userEvent.paste('802291');
    await screen.findByText('Agreement signed, Shankar Rao');
    expect(api.calls('POST /consent/submit')).toHaveLength(1);
    expect(api.calls('POST /consent/submit')[0]!.body).toEqual({
      token: 'atok', otpRequestId: 'areq', otpCode: '802291', signedName: 'Shankar Rao', purposes: ['agreement_terms', 'agreement_authority', 'call_recording'],
    });
    expect(await screen.findByText('Agreement signed, Shankar Rao')).toBeInTheDocument();
    expect(screen.getByText('9 Nov, 12:40 PM')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/consent/atok/signed/copy');
    expect(screen.getByText(/Team Lead will call you/)).toBeInTheDocument();
  });

  it('a wrong code keeps the page; typing the right code then signs', async () => {
    let tries = 0;
    const api = mockApi({
      'GET /consent/atok': details,
      'POST /consent/send-otp': { requestId: 'areq', phone: '******4321' },
      'POST /consent/submit': () => (++tries === 1 ? apiError(400, 'Wrong or expired code') : { signedAt: '2026-11-09T07:10:00Z' }),
    });
    render();
    await screen.findByRole('heading', { name: 'Laboura agreement · Annapoorna Mess' });
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Send code to sign' }));
    const codeBox = () => screen.getAllByRole('textbox').find((el) => el.getAttribute('inputmode') === 'numeric')!;
    await userEvent.click(codeBox());
    await userEvent.paste('111111');
    await waitFor(() => expect(api.calls('POST /consent/submit')).toHaveLength(1));
    expect(await screen.findByText(/That code is wrong or has run out/)).toBeInTheDocument();
    expect(screen.queryByText(/Agreement signed/)).not.toBeInTheDocument();
    await userEvent.click(codeBox());
    await userEvent.paste('802291');
    expect(await screen.findByText('Agreement signed, Shankar Rao')).toBeInTheDocument();
    expect(api.calls('POST /consent/submit')).toHaveLength(2);
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

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
    // 22 Nov: never a silently dead button — pressed too early it says what is missing and marks it.
    expect(send).toBeEnabled();
    expect(screen.getByText('Write your name and tick the three boxes first.')).toBeInTheDocument();
    await userEvent.click(send);
    expect(api.calls('POST /consent/send-otp')).toHaveLength(0);
    expect(screen.getByTestId('send-blocked')).toHaveTextContent('Before the code can be sent: tick the 3 box(es) still empty.');
    expect(terms).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(terms);
    await userEvent.click(recording);
    expect(screen.getByTestId('send-blocked')).toHaveTextContent('tick the 1 box(es) still empty');
    expect(terms).not.toHaveAttribute('aria-invalid');
    await userEvent.click(authority);
    expect(screen.queryByTestId('send-blocked')).toBeNull();
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
    // 21 Nov: true for in-person onboarding too (no "a Team Lead will call you").
    expect(screen.getByText(/Your Laboura agent will take you through the next step/)).toBeInTheDocument();
    expect(screen.queryByText(/Team Lead will call you/)).not.toBeInTheDocument();
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

  it('22 Nov: the contact name is filled in and editable; an empty name is marked; a server refusal is shown', async () => {
    const api = mockApi({
      'GET /consent/atok': details,
      'POST /consent/send-otp': apiError(400, 'This link has no phone number for the code. Ask Laboura for a new link.'),
    });
    render();
    const name = await screen.findByRole('textbox', { name: /Your full name/ });
    expect(name).toHaveValue('Shankar Rao');
    await userEvent.clear(name);
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Send code to sign' }));
    expect(screen.getByTestId('send-blocked')).toHaveTextContent('Before the code can be sent: write your full name.');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls('POST /consent/send-otp')).toHaveLength(0);
    await userEvent.type(name, 'Shankar R');
    await userEvent.click(screen.getByRole('button', { name: 'Send code to sign' }));
    await waitFor(() => expect(api.calls('POST /consent/send-otp')).toHaveLength(1));
    expect(await screen.findByText('This link has no phone number for the code. Ask Laboura for a new link.')).toBeInTheDocument();
  });

  it('25 Nov (B1): before signing the owner takes a live selfie and a second photo — camera only; sending waits for both', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const api = mockApi({
      'GET /consent/atok': { ...details, ownerPhotos: { selfie: false, shop: false, shopKind: 'shop_board', shopKinds: ['shop_board'], smallBusiness: false } },
      'POST /consent/send-otp': { requestId: 'areq', phone: '******4321' },
    });
    const { container } = render();
    expect(await screen.findByText('Before you sign: two live photos')).toBeInTheDocument();
    expect(screen.getByText('Your live selfie')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Send code to sign' }));
    expect(screen.getByTestId('send-blocked')).toHaveTextContent('take both photos');
    expect(api.calls('POST /consent/send-otp')).toHaveLength(0);
  });

  it('25 Nov (B1/B9): with the selfie taken, a small business picks the workspace or the name board for the second photo', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    mockApi({
      'GET /consent/atok': { ...details, ownerPhotos: { selfie: true, shop: false, shopKind: 'shop_board', shopKinds: ['shop_board', 'workspace'], smallBusiness: true } },
    });
    render();
    expect(await screen.findByText(/Your business has fewer than 2 documents/)).toBeInTheDocument();
    const kinds = screen.getByTestId('shop-photo-kind');
    expect(kinds).toHaveTextContent("The shop's name board");
    expect(kinds).toHaveTextContent('The place you work from');
    await userEvent.click(screen.getByRole('radio', { name: /The place you work from/ }));
    expect(screen.getByRole('heading', { name: /The place you work from/ })).toBeInTheDocument();
  });

  it('25 Nov (B9): a signed small business finishes its checks on the same link (business proof saved)', async () => {
    const state = {
      required: true,
      ownerId: { method: null, type: null, result: null, last4: null, failureReason: null },
      businessProof: { given: false, kind: null, fromProofs: false },
      addressProof: { submitted: false, docType: null, result: null },
      videoCall: { done: false, at: null },
      photos: { selfie: true, workspace: true },
      missing: [],
    };
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const api = mockApi({
      'GET /consent/atok': apiError(400, 'Consent link has already been used'),
      'GET /consent/atok/signed': { signedAt: '2026-11-09T07:10:00Z', signedName: 'Shankar Rao', businessName: 'Annapoorna Mess', preferredLanguage: 'en' },
      'GET /consent/atok/small-business': state,
      'POST /consent/atok/small-business/business-proof': { ...state, businessProof: { given: true, kind: 'bank_upi', fromProofs: false } },
    });
    render();
    expect(await screen.findByText('A few more checks for your business')).toBeInTheDocument();
    expect(screen.getByText('Your government ID')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /Number, UPI ID or link/ }), 'shankar@upi');
    await userEvent.click(screen.getByRole('button', { name: 'Save business proof' }));
    expect(await screen.findByText('Business proof saved')).toBeInTheDocument();
    expect(api.calls('POST /consent/atok/small-business/business-proof')[0]!.body).toEqual({ kind: 'bank_upi', value: 'shankar@upi' });
  });
});

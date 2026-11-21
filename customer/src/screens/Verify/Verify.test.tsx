import { Linking } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { ApiError } from '@/api/errors';
import { openSecureSheet } from '@/sheet/openSheet';
import { searchParams } from '@/test/expo-router-mock';
import { account, bizProfile, jsProfile, refProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import { mockStepsApi } from '@/verify/mockSteps';
import type { StepsApi } from '@/verify/stepsApi';
import { StepsApiProvider } from '@/verify/StepsApiProvider';
import VerifyScreen from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
jest.mock('@/sheet/openSheet', () => ({ openSecureSheet: jest.fn(async () => 'returned') }));

const TOKEN = 'a'.repeat(64);

/** The pretend link endpoints (src/verify/mockSteps.ts) with every call spied on. */
function spiedSteps(): jest.Mocked<StepsApi> {
  const steps = mockStepsApi(0);
  for (const key of Object.keys(steps) as (keyof StepsApi)[]) jest.spyOn(steps, key);
  return steps as jest.Mocked<StepsApi>;
}

async function renderVerify(purpose: string, profileId: string, steps: StepsApi, sheetLink?: () => Promise<{ url: string }>) {
  searchParams.current = { purpose, profileId };
  const path = purpose === 'registration' ? 'register' : purpose === 'referral_registration' ? 'partner' : 'agreement';
  const api = fakeApi({ sheetLink: sheetLink ?? (async () => ({ url: `https://app.test/p/${path}/${TOKEN}` })), home: async () => { throw new Error('not needed'); } });
  const profile = purpose === 'registration' ? jsProfile : purpose === 'referral_registration' ? refProfile : bizProfile;
  const result = await renderWithApp(
    <StepsApiProvider api={steps}>
      <VerifyScreen />
    </StepsApiProvider>,
    { api, account: account({ profiles: [profile] }), activeProfileId: profile.id },
  );
  return { ...result, api };
}

/** "Send code" → type the 6 digits → Continue. */
async function openWithCode(testID: string) {
  await fireEvent.press(await screen.findByTestId(`${testID}-otp-send`));
  await fireEvent.changeText(await screen.findByTestId(`${testID}-otp-code`), '123456');
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Job seeker steps in the app', () => {
  it('code → consent → live selfie → Aadhaar QR → terms and ₹499 → "Paid — confirming", all through his own link', async () => {
    const steps = spiedSteps();
    const { api } = await renderVerify('registration', 'p-js', steps);
    await waitFor(() => expect(api.sheetLink).toHaveBeenCalledWith('p-js', 'registration'));

    // Nothing about him shows until the code to his own number is typed.
    expect(await screen.findByTestId('reg-code')).toBeTruthy();
    expect(screen.queryByText(/Ravi/)).toBeNull();
    await openWithCode('reg-code');
    await waitFor(() => expect(steps.verifyRegistrationOtp).toHaveBeenCalledWith(TOKEN, expect.stringMatching(/^otp-/), '123456'));
    const requestId = steps.verifyRegistrationOtp.mock.calls[0]![1];

    // Consent: the required ticks, never pre-ticked; the optional one may stay empty.
    expect(await screen.findByTestId('reg-consent')).toBeTruthy();
    expect(screen.getByTestId('reg-consent-agree')).toBeDisabled();
    for (const p of ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'agreement_terms']) {
      await fireEvent.press(screen.getByTestId(`reg-consent-tick-${p}`));
    }
    await fireEvent.press(screen.getByTestId('reg-consent-agree'));
    await waitFor(() =>
      expect(steps.submitConsent).toHaveBeenCalledWith(TOKEN, requestId, ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'agreement_terms'], 'mock-hash'),
    );

    // Selfie: a live camera picture, re-saved as JPEG, sent with the same code.
    await fireEvent.press(await screen.findByTestId('reg-selfie-camera-take'));
    await fireEvent.press(await screen.findByTestId('reg-selfie-camera-use'));
    await waitFor(() =>
      expect(steps.registrationSelfie).toHaveBeenCalledWith(TOKEN, requestId, { uri: 'file:///cache/prepared.jpg', name: 'selfie.jpg', type: 'image/jpeg' }),
    );

    // ID: the Aadhaar QR's text only.
    await fireEvent.press(await screen.findByTestId('id-scan'));
    await screen.findByTestId('qr-scanner');
    await act(async () => {
      (globalThis as unknown as { __scanQr: (text: string) => void }).__scanQr('<qr text>');
    });
    await waitFor(() => expect(steps.registrationAadhaarQr).toHaveBeenCalledWith(TOKEN, requestId, '<qr text>'));
    const verified = await screen.findByTestId('id-verified');
    expect(verified).toHaveTextContent(/Aadhaar verified by UIDAI/);
    expect(verified).toHaveTextContent(/15-08-1998/);
    await fireEvent.press(screen.getByTestId('id-continue'));

    // Terms and ₹499: the QR and the UPI button only after the box is ticked.
    expect(await screen.findByTestId('reg-pay')).toHaveTextContent(/within 5 km of BTM Layout/);
    expect(screen.queryByTestId('reg-pay-upi')).toBeNull();
    await fireEvent.press(screen.getByTestId('reg-pay-agree'));
    await waitFor(() => expect(steps.acceptRegistrationTerms).toHaveBeenCalledWith(TOKEN, requestId));
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await fireEvent.press(await screen.findByTestId('reg-pay-upi'));
    expect(openURL).toHaveBeenCalledWith('upi://pay?pa=laboura@bank&pn=Laboura&am=499.00&tr=LB49900');
    expect(steps.paymentSummary).toHaveBeenCalledWith('mock-pay');

    // Never "done" on tapping Pay: it waits for the bank.
    expect(await screen.findByTestId('reg-confirming')).toHaveTextContent(/Paid — confirming/);
    expect(openSecureSheet).not.toHaveBeenCalled();
  });

  it('a code that ran out goes back to the code step; finished steps stay finished', async () => {
    const steps = spiedSteps();
    steps.submitConsent.mockRejectedValueOnce(new ApiError({ status: 400, messages: ['OTP to the registered mobile is required'] }));
    await renderVerify('registration', 'p-js', steps);
    await openWithCode('reg-code');
    await screen.findByTestId('reg-consent');
    for (const p of ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'agreement_terms']) {
      await fireEvent.press(screen.getByTestId(`reg-consent-tick-${p}`));
    }
    await fireEvent.press(screen.getByTestId('reg-consent-agree'));
    expect(await screen.findByTestId('reg-code-ran-out')).toBeTruthy();
  });

  it('another ID: the number, then a live photo of the card with its one-time capture token; then "Sent to a Team Lead"', async () => {
    const steps = spiedSteps();
    await renderVerify('registration', 'p-js', steps);
    await openWithCode('reg-code');
    await screen.findByTestId('reg-consent');
    for (const p of ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'agreement_terms']) {
      await fireEvent.press(screen.getByTestId(`reg-consent-tick-${p}`));
    }
    await fireEvent.press(screen.getByTestId('reg-consent-agree'));
    await fireEvent.press(await screen.findByTestId('reg-selfie-camera-take'));
    await fireEvent.press(await screen.findByTestId('reg-selfie-camera-use'));

    await fireEvent.press(await screen.findByTestId('id-other'));
    await fireEvent.press(screen.getByTestId('id-type-pan'));
    await fireEvent.changeText(screen.getByTestId('id-number'), 'abcde1234');
    expect(screen.getByTestId('id-next')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('id-number'), 'abcde 1234f');
    await fireEvent.press(screen.getByTestId('id-next'));
    await waitFor(() => expect(steps.registrationCaptureNonce).toHaveBeenCalled());
    await fireEvent.press(await screen.findByTestId('id-card-camera-take'));
    await fireEvent.press(await screen.findByTestId('id-card-camera-use'));
    await waitFor(() =>
      expect(steps.registrationOtherId).toHaveBeenCalledWith(TOKEN, expect.any(String), 'pan', 'ABCDE1234F', { uri: 'file:///cache/prepared.jpg', name: 'id-card.jpg', type: 'image/jpeg' }, 'nonce'),
    );
    expect(await screen.findByTestId('id-pending')).toHaveTextContent(/Sent to a Team Lead/);
  });

  it('the e-Aadhaar PDF opens the same step on the Laboura page in the browser sheet', async () => {
    const steps = spiedSteps();
    await renderVerify('registration', 'p-js', steps);
    await openWithCode('reg-code');
    await screen.findByTestId('reg-consent');
    for (const p of ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'agreement_terms']) {
      await fireEvent.press(screen.getByTestId(`reg-consent-tick-${p}`));
    }
    await fireEvent.press(screen.getByTestId('reg-consent-agree'));
    await fireEvent.press(await screen.findByTestId('reg-selfie-camera-take'));
    await fireEvent.press(await screen.findByTestId('reg-selfie-camera-use'));
    await fireEvent.press(await screen.findByTestId('id-pdf'));
    await waitFor(() => expect(openSecureSheet).toHaveBeenCalledWith(`https://app.test/p/register/${TOKEN}`));
  });

  it('under 18: registration stops at the ID step, before any payment', async () => {
    const steps = spiedSteps();
    const stopped = {
      otpRequired: false, maskedPhone: '+91 ••••• •4321', firstName: 'Ravi', jobSeekerCode: 'JS-1', currentStep: 'id_check',
            steps: { consent: true, selfie: true, idCheck: false, payment: false }, idCheck: { waitingForTeamLead: false, lastResult: 'under_18' }, stopped: 'under_18',
            waitingForTrade: false, termsAcceptedAt: null, payment: { state: 'not_started', amountPaise: 49900, upiReference: null, confirmedAt: null, guaranteeEndsAt: null, paymentId: null }, receiptToken: null,
    } as const;
    steps.registrationStatus.mockImplementation(async (_token, requestId) => (requestId ? stopped : { otpRequired: true, maskedPhone: '+91 ••••• •4321', registrationComplete: false }));
    steps.verifyRegistrationOtp.mockImplementation(async () => stopped);
    await renderVerify('registration', 'p-js', steps);
    await openWithCode('reg-code');
    await fireEvent.press(await screen.findByTestId('reg-resume-continue'));
    expect(await screen.findByTestId('reg-id-stopped')).toHaveTextContent(/Registration stops here/);
    expect(screen.queryByTestId('id-scan')).toBeNull();
  });

  it('the link could not be made: says so, with Try again', async () => {
    const steps = spiedSteps();
    await renderVerify('registration', 'p-js', steps, async () => {
      throw new ApiError({ status: 409, messages: ['Too many links'] });
    });
    expect(await screen.findByTestId('verify-link-failed')).toBeTruthy();
    expect(steps.registrationStatus).not.toHaveBeenCalled();
  });
});

describe('Referral partner steps in the app', () => {
  it('three ticks, selfie, Aadhaar QR, then UPI in their own name; only the masked value is shown', async () => {
    const steps = spiedSteps();
    await renderVerify('referral_registration', 'p-ref', steps);
    await openWithCode('rp-code');
    const terms = await screen.findByTestId('rp-terms');
    expect(terms).toHaveTextContent(/You earn ₹200 when a job seeker you referred joins a job/);
    await fireEvent.press(screen.getByTestId('rp-terms-tick-terms'));
    await fireEvent.press(screen.getByTestId('rp-terms-tick-recording'));
    expect(screen.getByTestId('rp-terms-agree')).toBeDisabled(); // the separate ID-check consent (S2) too
    await fireEvent.press(screen.getByTestId('rp-terms-tick-id'));
    await fireEvent.press(screen.getByTestId('rp-terms-agree'));
    await waitFor(() => expect(steps.acceptPartnerTerms).toHaveBeenCalledWith(TOKEN, expect.stringMatching(/^otp-/)));

    await fireEvent.press(await screen.findByTestId('rp-selfie-camera-take'));
    await fireEvent.press(await screen.findByTestId('rp-selfie-camera-use'));
    await waitFor(() => expect(steps.partnerSelfie).toHaveBeenCalled());

    await fireEvent.press(await screen.findByTestId('id-scan'));
    await screen.findByTestId('qr-scanner');
    await act(async () => {
      (globalThis as unknown as { __scanQr: (text: string) => void }).__scanQr('<partner qr>');
    });
    await fireEvent.press(await screen.findByTestId('id-continue'));

    await fireEvent.changeText(await screen.findByTestId('rp-upi-id'), 'suma');
    expect(screen.getByTestId('rp-upi-save')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('rp-upi-id'), 'suma@okaxis');
    await fireEvent.press(screen.getByTestId('rp-upi-save'));
    await waitFor(() => expect(steps.partnerPayout).toHaveBeenCalledWith(TOKEN, expect.any(String), { method: 'upi', upiId: 'suma@okaxis' }));
    const done = await screen.findByTestId('rp-done');
    expect(within(done).queryByText('suma@okaxis')).toBeNull();
    expect(done).toHaveTextContent(/RF-00001/);
  });
});

describe('Business agreement in the app', () => {
  it('name prefilled, three ticks first, then the code signs; the signed view follows', async () => {
    const steps = spiedSteps();
    await renderVerify('business_agreement', 'p-biz', steps);
    const page = await screen.findByTestId('agree');
    expect(page).toHaveTextContent(/50% of the first month’s salary \+ 18% GST/);
    expect(screen.getByTestId('agree-otp-send')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('agree-tick-terms'));
    await fireEvent.press(screen.getByTestId('agree-tick-authority'));
    await fireEvent.press(screen.getByTestId('agree-tick-recording'));
    await fireEvent.press(screen.getByTestId('agree-otp-send'));
    await waitFor(() => expect(steps.sendLinkOtp).toHaveBeenCalledWith(TOKEN));
    expect(screen.queryByTestId('agree-otp-verify')).toBeNull(); // one button: typing the code signs
    await fireEvent.changeText(await screen.findByTestId('agree-otp-code'), '123456');
    await waitFor(() => expect(steps.signAgreement).toHaveBeenCalledWith(TOKEN, expect.stringMatching(/^otp-/), '123456', 'Manjunath'));
    expect(await screen.findByTestId('agree-signed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('agree-home'));
    expect(router.replace).toHaveBeenCalledWith('/home');
  });
});

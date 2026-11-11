import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import { openStatus, TOKEN, verifiedInThisTab } from '../shared/testData';
import IdCheck from './index';

const atId = (extra: Partial<ReturnType<typeof openStatus>> = {}) =>
  openStatus({ currentStep: 'id_check', steps: { consent: true, selfie: true, idCheck: false, payment: false }, ...extra });
const render = () => renderScreen(<IdCheck />, { portal: 'public', path: `/p/register/${TOKEN}/id-check`, route: '/p/register/:token/id-check' });

describe('P01d-IDCheck / P01e-IDBusy', () => {
  it('checks Aadhaar through DigiLocker and moves on when verified', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/id-check`]: { status: 'verified', method: 'digilocker', nameMatches: true, isAdult: true, failureReason: null },
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Verify with Aadhaar (DigiLocker)' }));
    expect(api.calls(`POST /registration/${TOKEN}/id-check`)[0]!.body).toEqual({ requestId: 'req-1', method: 'digilocker' });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('on a name mismatch offers another government ID with its number', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/id-check`]: ({ body }: { body: { method: string } }) =>
        body.method === 'digilocker'
          ? { status: 'failed', method: 'digilocker', nameMatches: false, isAdult: true, failureReason: 'Name mismatch' }
          : { status: 'pending', method: body.method, nameMatches: null, isAdult: null, failureReason: null },
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Verify with Aadhaar (DigiLocker)' }));
    expect(await screen.findByText(/name on the ID doesn't match/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'PAN card' }));
    const check = screen.getByRole('button', { name: 'Check this ID' });
    await userEvent.type(screen.getByLabelText(/PAN number/), 'abcde1234');
    expect(check).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/PAN number/), 'f');
    await userEvent.click(check);
    expect(api.calls(`POST /registration/${TOKEN}/id-check`)[1]!.body).toEqual({ requestId: 'req-1', method: 'pan', documentNumber: 'ABCDE1234F' });
  });

  it('stops before payment for someone under 18', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: atId({ stopped: 'under_18' }) });
    render();
    expect(await screen.findByText('Registration stops here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aadhaar/ })).not.toBeInTheDocument();
  });

  it('when the ID service is down, offers another ID or an SMS when it is back', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: atId({ idCheck: { serviceDown: true, waitingForService: false, lastResult: 'none' } }),
      [`POST /registration/${TOKEN}/id-check-wait`]: { waitingForRecovery: true },
    });
    render();
    expect(await screen.findByText('Aadhaar checks are busy right now.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "I'll wait — SMS me when it's back" }));
    expect(api.calls(`POST /registration/${TOKEN}/id-check-wait`)[0]!.body).toEqual({ requestId: 'req-1' });
    expect(await screen.findByText(/we'll send you an SMS when it's back/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use another ID instead' }));
    expect(screen.getByRole('button', { name: 'PAN card' })).toBeInTheDocument();
  });

  it('shows a failed check', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/id-check`]: apiError(400, 'Consent for aadhaar_verification is required'),
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Verify with Aadhaar (DigiLocker)' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

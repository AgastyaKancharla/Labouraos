import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderScreen } from '../../../test/utils';
import { DONE, partnerStatus, partnerVerifiedInThisTab, TOKEN } from '../shared/testData';
import PartnerIdCheckPage from './index';

const atId = (extra: Parameters<typeof partnerStatus>[0] = {}) =>
  partnerStatus({ currentStep: 'id_check', steps: { terms: DONE, selfie: DONE, id: { state: 'not_started' }, upi: { state: 'not_started' } }, ...extra });
const render = () => renderScreen(<PartnerIdCheckPage />, { portal: 'public', path: `/p/partner/${TOKEN}/id-check`, route: '/p/partner/:token/id-check' });

describe('P-PartnerIDCheck (step 3)', () => {
  it('checks Aadhaar through DigiLocker (no number typed or sent) and moves on when verified', async () => {
    partnerVerifiedInThisTab();
    const api = mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: atId(),
      [`POST /referral-registration/${TOKEN}/id-check`]: { status: 'verified', method: 'digilocker', nameMatches: true, isAdult: true, failureReason: null, nextStep: 'upi' },
    });
    render();
    expect(await screen.findByText('Step 3 of 4 · ID check')).toBeInTheDocument();
    expect(screen.getByText(/Never your Aadhaar number/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Verify with Aadhaar (DigiLocker)' }));
    expect(api.calls(`POST /referral-registration/${TOKEN}/id-check`)[0]!.body).toEqual({ requestId: 'req-1', method: 'digilocker' });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('on a name mismatch offers another government ID with its number', async () => {
    partnerVerifiedInThisTab();
    const api = mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: atId(),
      [`POST /referral-registration/${TOKEN}/id-check`]: ({ body }: { body: { method: string } }) =>
        body.method === 'digilocker'
          ? { status: 'verified', method: 'digilocker', nameMatches: false, isAdult: true, failureReason: null, nextStep: 'id_check' }
          : { status: 'verified', method: body.method, nameMatches: true, isAdult: true, failureReason: null, nextStep: 'upi' },
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Verify with Aadhaar (DigiLocker)' }));
    expect(await screen.findByText(/name on the ID doesn't match/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voter ID' }));
    await userEvent.type(screen.getByLabelText(/Voter ID number/), 'abc1234567');
    await userEvent.click(screen.getByRole('button', { name: 'Check this ID' }));
    expect(api.calls(`POST /referral-registration/${TOKEN}/id-check`)[1]!.body).toEqual({ requestId: 'req-1', method: 'voter_id', documentNumber: 'ABC1234567' });
  });

  it('stops under 18', async () => {
    partnerVerifiedInThisTab();
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: atId({ stopped: 'under_18', idCheck: { serviceDown: false, lastResult: 'under_18' } }) });
    render();
    expect(await screen.findByText(/only register referral partners who are 18 or older/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aadhaar/ })).not.toBeInTheDocument();
  });

  it('when the ID service is down offers another ID now', async () => {
    partnerVerifiedInThisTab();
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: atId({ idCheck: { serviceDown: true, lastResult: 'none' } }) });
    render();
    expect(await screen.findByText(/Aadhaar checks are busy right now/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use another ID instead' }));
    expect(screen.getByRole('button', { name: 'PAN card' })).toBeInTheDocument();
  });
});

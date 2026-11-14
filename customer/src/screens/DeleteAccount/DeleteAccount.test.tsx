import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { account, bizProfile, jsProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import Help from '../Help';
import Privacy from '../Privacy';
import DeleteAccount from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => jest.clearAllMocks());

describe('Delete my account', () => {
  it('while the ₹499 guarantee may be running: big warning and a tick before the OTP', async () => {
    const api = fakeApi({
      sendDeletionOtp: async () => ({ requestId: 'del-1' }),
      requestDeletion: async () => ({ status: 'requested' as const, kept: ['Payment receipts and invoices'] }),
    });
    const { store } = await renderWithApp(<DeleteAccount />, { api, account: account({ profiles: [{ ...jsProfile, stage: 'active' }] }) });
    expect(await screen.findByTestId('delete-guarantee-warning')).toHaveTextContent(/ends your refund/);
    expect(screen.getByTestId('delete-send-otp')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('delete-accept'));
    await fireEvent.press(screen.getByTestId('delete-send-otp'));
    await fireEvent.changeText(await screen.findByTestId('delete-code'), '123456');
    await fireEvent.press(screen.getByTestId('delete-confirm'));
    await waitFor(() => expect(api.requestDeletion).toHaveBeenCalledWith({ requestId: 'del-1', code: '123456', acceptGuaranteeLoss: true }));
    expect(await screen.findByText(/Payment receipts and invoices/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('delete-close'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/sign-in'));
    expect(store.token()).toBeNull();
  });

  it('no running guarantee: no warning, the OTP can be sent straight away', async () => {
    await renderWithApp(<DeleteAccount />, { account: account({ profiles: [bizProfile] }) });
    expect(await screen.findByTestId('delete-send-otp')).not.toBeDisabled();
    expect(screen.queryByTestId('delete-guarantee-warning')).toBeNull();
  });

  it('privacy screen links to it and shows the grievance contact from the server', async () => {
    await renderWithApp(<Privacy />, { account: account({ grievanceContact: 'Grievance officer (test)' }) });
    expect(await screen.findByTestId('privacy-grievance')).toHaveTextContent('Grievance officer (test)');
    await fireEvent.press(screen.getByTestId('privacy-delete'));
    expect(router.push).toHaveBeenCalledWith('/delete-account');
  });
});

describe('Help: Call me back', () => {
  it('asks for a topic, then sends the request for the profile on Home', async () => {
    const api = fakeApi({ requestCallback: async () => ({ id: 'cb-1' }) });
    await renderWithApp(<Help />, { api, account: account({ profiles: [jsProfile] }) });
    await fireEvent.press(await screen.findByTestId('help-submit'));
    expect(screen.getByTestId('help-problem')).toBeTruthy();
    expect(api.requestCallback).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('help-topic'));
    await fireEvent.press(screen.getByTestId('help-topic-option-payment'));
    await fireEvent.press(screen.getByTestId('help-submit'));
    await waitFor(() => expect(api.requestCallback).toHaveBeenCalledWith({ profileId: 'p-js', topic: 'payment', when: 'now', date: null, time: null }));
    expect(await screen.findByTestId('help-done')).toHaveTextContent(/call you soon/);
  });
});

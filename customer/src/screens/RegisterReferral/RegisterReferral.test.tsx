import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { account, refProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import { emptyReferral, validateReferral } from './form';
import RegisterReferral from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
jest.mock('@/sheet/openSheet', () => ({ openSecureSheet: jest.fn(async () => 'returned') }));

describe('Referral partner registration', () => {
  it('asks what kind of individual, or the business type and name', () => {
    expect(validateReferral({ ...emptyReferral('en', 'Asha'), partnerType: 'individual' }).individualKind).toBe('form.required');
    const biz = validateReferral({ ...emptyReferral('en', 'Asha'), partnerType: 'business' });
    expect(biz.businessType).toBe('form.required');
    expect(biz.businessName).toBe('form.required');
  });

  it('sends the details, then terms, selfie, ID and UPI open in the secure sheet', async () => {
    const api = fakeApi({ registerReferralPartner: async () => ({ profile: refProfile, existing: false }) });
    await renderWithApp(<RegisterReferral />, { api, account: account({ name: 'Asha K' }) });
    expect(await screen.findByText(/You earn ₹200 when someone you refer joins a job/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ref-submit'));
    expect(screen.getByTestId('ref-type-error')).toBeTruthy();
    expect(api.registerReferralPartner).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('ref-type-individual'));
    await fireEvent.press(screen.getByTestId('ref-kind'));
    await fireEvent.press(screen.getByTestId('ref-kind-option-auto_driver'));
    await fireEvent.press(screen.getByTestId('ref-area'));
    await fireEvent.press(screen.getByTestId('ref-area-option-BTM Layout'));
    await fireEvent.press(screen.getByTestId('ref-submit'));
    await waitFor(() =>
      expect(api.registerReferralPartner).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Asha K', partnerType: 'individual', individualKind: 'auto_driver', area: 'BTM Layout', pincode: '560076', businessName: null }),
      ),
    );
    expect(await screen.findByTestId('ref-saved')).toHaveTextContent(/UPI ID/);
  });
});

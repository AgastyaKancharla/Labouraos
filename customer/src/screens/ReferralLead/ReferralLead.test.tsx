import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReferralLeadsAnswer } from '@/api/types';
import { account, refProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import ReferralLeadScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const answer = (over: Partial<ReferralLeadsAnswer> = {}): ReferralLeadsAnswer => ({
  open: true,
  perDay: 20,
  leads: [{ id: 'l-1', firstName: 'Suma', kind: 'job_seeker', stage: 'registered', sentAt: '2026-11-20T06:00:00Z' }],
  ...over,
});

const opts = (api: ReturnType<typeof fakeApi>) => ({ api, account: account({ profiles: [refProfile] }), activeProfileId: 'p-ref' });

describe('Send a lead (contract 7.3b)', () => {
  it('needs who, name, number, area and the person’s agreement; then our team calls them', async () => {
    const api = fakeApi({ referralLeads: jest.fn(async () => answer()), sendReferralLead: jest.fn(async () => ({ leadId: 'l-2', stage: 'with_team' })) });
    await renderWithApp(<ReferralLeadScreen />, opts(api));
    await waitFor(() => screen.getByTestId('leads-form'));
    expect(screen.getByTestId('leads-row-l-1')).toHaveTextContent(/Suma.*Needs a job.*Registered/);
    await fireEvent.press(screen.getByTestId('leads-submit'));
    expect(screen.getByTestId('leads-problem')).toBeTruthy();
    expect(api.sendReferralLead).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('leads-kind-job_seeker'));
    await fireEvent.changeText(screen.getByTestId('leads-name'), 'Manju Nath');
    await fireEvent.changeText(screen.getByTestId('leads-phone'), '9876543210');
    await fireEvent.press(screen.getByTestId('leads-area'));
    await fireEvent.press(screen.getByTestId('leads-area-option-BTM Layout'));
    // Without the agreement tick nothing is sent.
    await fireEvent.press(screen.getByTestId('leads-submit'));
    expect(api.sendReferralLead).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('leads-agreed'));
    await fireEvent.press(screen.getByTestId('leads-submit'));
    await waitFor(() => screen.getByTestId('leads-sent'));
    expect(api.sendReferralLead).toHaveBeenCalledWith('p-ref', { kind: 'job_seeker', name: 'Manju Nath', phone: '9876543210', area: 'BTM Layout', personAgreed: true });
  });

  it('switched off on the server: no form, the list still shows', async () => {
    const api = fakeApi({ referralLeads: jest.fn(async () => answer({ open: false })) });
    await renderWithApp(<ReferralLeadScreen />, opts(api));
    await waitFor(() => screen.getByTestId('leads-closed'));
    expect(screen.queryByTestId('leads-form')).toBeNull();
    expect(screen.getByTestId('leads-row-l-1')).toBeTruthy();
  });
});

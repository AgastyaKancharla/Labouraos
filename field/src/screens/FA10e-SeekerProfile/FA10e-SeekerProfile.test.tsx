import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable, seekerStatus as status } from '@/test/selling-fixtures';
import type { SeekerPage } from '@/api/endpoints';
import SeekerProfile from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const mockPermission = { granted: true };
jest.mock('expo-camera', () => {
  const { Pressable } = require('react-native');
  const CameraView = () => <Pressable testID="fake-camera" />;
  return { CameraView, useCameraPermissions: () => [mockPermission, jest.fn()] };
});

const page = (over: Partial<SeekerPage> = {}): SeekerPage => ({
  id: 'js-uuid', code: 'JS-00004', name: 'Ramesh', phoneLast4: '5436', photoUrl: 'https://storage.test/selfie.jpg?sig=1', status: 'consented',
  registeredAt: '2026-11-22T05:24:00Z', registeredByMe: true, trade: 'Cook', yearsExperience: 1, otherTrades: ['Helper'], locality: 'Bommanahalli',
  details: { gender: 'male', age: 27, languages: ['Kannada', 'Telugu'], shift: 'day', jobType: 'full_time', travelDistanceKm: 8, lastRole: 'Cook', lastEmployer: 'Udupi Hotel', availableFrom: null },
  stuck: { step: 'id_check', state: 'in_progress', reason: "Waiting for the Team Lead's ID check", waitingForTeamLead: true, actions: [] },
  row: { status: 'waiting_tl', action: null, vacancyId: null, waiting: true, done: false, group: 'waiting_tl' },
  hits: 0, guarantee: null, nextInterviewAt: null, interviews: [], placements: [],
  history: [
    { at: '2026-11-22T05:40:00Z', kind: 'id_sent', detail: 'pan' },
    { at: '2026-11-22T05:30:00Z', kind: 'consent', detail: null },
    { at: '2026-11-22T05:25:00Z', kind: 'link_sent', detail: null },
    { at: '2026-11-22T05:24:00Z', kind: 'registered', detail: null },
  ],
  ...over,
});

const registration = status({
  stage: 'in_progress', nextStep: 'id_check',
  steps: { phone: { state: 'done' }, consent: { state: 'done' }, selfie: { state: 'done' }, idCheck: { state: 'in_progress', reason: "Waiting for the Team Lead's ID check" }, payment: { state: 'not_started' } },
});

function render(p: SeekerPage, params: Record<string, string> = { id: 'js-uuid' }) {
  (useLocalSearchParams as jest.Mock).mockReturnValue(params);
  const table = routeTable({
    '/field-work/job-seekers/js-uuid/page': p,
    '/screens/call-registration/job-seekers/js-uuid': registration,
    'POST /consent/links': { expiresAt: '2026-11-24T00:00:00Z' },
    'POST /job-seekers/js-uuid/resend-payment': { paymentId: 'p-1' },
  });
  return renderWithApp(<SeekerProfile />, { signedInAs: kiran, route: table.route }).then((r) => ({ ...r, calls: table.calls }));
}

describe('FA10e the job seeker profile (Laboura Field lists, 22 Nov evening)', () => {
  it('photo and name on top; where he is stuck (Waiting, no resend); steps ✓ / …; details; history', async () => {
    await render(page());
    await waitFor(() => screen.getByTestId('fa10e-top'));
    expect(screen.getByTestId('fa10e-top')).toHaveTextContent(/Ramesh.*Cook · Bommanahalli · 1 yr.*JS-00004 · \*\*\*\*\*\*5436/);
    expect(screen.getByTestId('fa10e-photo').props.source).toEqual({ uri: 'https://storage.test/selfie.jpg?sig=1' });
    expect(screen.getByTestId('fa10e-stuck')).toHaveTextContent(/Where they’re stuck.*ID check.*Waiting for the Team Lead’s ID check.*Waiting/);
    expect(screen.queryByTestId('fa10e-resend')).toBeNull();
    expect(screen.queryByTestId('fa10e-scan')).toBeNull();
    expect(screen.getByTestId('fa10e-continue')).toHaveTextContent('Continue registration');
    await waitFor(() => screen.getByTestId('fa10e-steps'));
    expect(screen.getByTestId('fa10e-step-consent')).toHaveTextContent(/^✓Consent/);
    expect(screen.getByTestId('fa10e-step-idCheck')).toHaveTextContent(/^…ID check/);
    expect(screen.getByTestId('fa10e-details')).toHaveTextContent(/Also.*Helper.*Age.*27.*Speaks.*Kannada, Telugu.*Last job.*Cook · Udupi Hotel.*by you/);
    expect(screen.getByTestId('fa10e-guarantee')).toHaveTextContent(/Starts when he has paid and his ID is verified/);
    expect(screen.getByTestId('fa10e-history')).toHaveTextContent(/ID sent for checking.*Consent given.*Registration link sent.*Registered/);
    // No rupee amounts on the profile.
    expect(screen.queryByText(/₹/)).toBeNull();
    await fireEvent.press(screen.getByTestId('fa10e-continue'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/js-uuid/registration');
  });

  it('at the ID step: Scan Aadhaar QR, Photo of another ID and Resend link are buttons on the profile; ?open=scan opens the scanner', async () => {
    const atId = page({
      stuck: { step: 'id_check', state: 'not_started', reason: null, waitingForTeamLead: false, actions: ['registration_link'] },
      row: { status: 'id_check_needed', action: 'scan_aadhaar', vacancyId: null, waiting: false, done: false, group: 'needs_action' },
    });
    const { calls } = await render(atId);
    await waitFor(() => screen.getByTestId('fa10e-scan'));
    expect(screen.getByTestId('fa10e-other-id')).toHaveTextContent('Photo of another ID');
    await fireEvent.press(screen.getByTestId('fa10e-resend'));
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/consent/links', body: { jobSeekerId: 'js-uuid' } }));
    await fireEvent.press(screen.getByTestId('fa10e-scan'));
    await waitFor(() => screen.getByTestId('aadhaar-scan'));
  });

  it('the list’s Scan Aadhaar QR (?open=scan) opens the scanner at once', async () => {
    const atId = page({
      stuck: { step: 'id_check', state: 'not_started', reason: null, waitingForTeamLead: false, actions: ['registration_link'] },
      row: { status: 'id_check_needed', action: 'scan_aadhaar', vacancyId: null, waiting: false, done: false, group: 'needs_action' },
    });
    await render(atId, { id: 'js-uuid', open: 'scan' });
    await waitFor(() => screen.getByTestId('aadhaar-scan'));
  });

  it('stuck at payment: Send payment link works from the profile', async () => {
    const atPayment = page({
      stuck: { step: 'payment', state: 'not_started', reason: null, waitingForTeamLead: false, actions: ['payment_link', 'someone_else_pays'] },
      row: { status: 'stuck_payment', action: 'payment_link', vacancyId: null, waiting: false, done: false, group: 'needs_action' },
    });
    const { calls } = await render(atPayment);
    await waitFor(() => screen.getByTestId('fa10e-payment-link'));
    expect(screen.getByTestId('fa10e-stuck')).toHaveTextContent(/Stuck at payment/);
    await fireEvent.press(screen.getByTestId('fa10e-payment-link'));
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/job-seekers/js-uuid/resend-payment', body: {} }));
    await waitFor(() => expect(screen.getByTestId('fa10e-payment-link')).toHaveTextContent('Sent ✓'));
  });

  it('paid and placed: "All done", Day X of 30, hits, interviews and placements; no registration buttons', async () => {
    const placed = page({
      status: 'active',
      stuck: { step: 'complete', state: 'done', reason: null, waitingForTeamLead: false, actions: [] },
      row: { status: 'placed', action: null, vacancyId: null, waiting: false, done: true, group: 'done' },
      guarantee: { day: 12, days: 30, endsAt: '2026-12-10T00:00:00Z' }, hits: 1,
      interviews: [{ id: 'iv-1', code: 'IV-00031', startsAt: '2026-11-20T05:30:00Z', status: 'completed', result: 'selected', businessName: 'Udupi Grand', trade: 'Cook' }],
      placements: [{ id: 'pl-1', code: 'PL-00009', status: 'active', joiningDate: '2026-11-21', businessName: 'Udupi Grand', trade: 'Cook' }],
    });
    await render(placed);
    await waitFor(() => screen.getByTestId('fa10e-all-done'));
    expect(screen.getByTestId('fa10e-all-done')).toHaveTextContent(/All done.*Placed/);
    expect(screen.queryByTestId('fa10e-continue')).toBeNull();
    expect(screen.getByTestId('fa10e-guarantee')).toHaveTextContent(/Day 12 of 30.*Hits.*1/);
    expect(screen.getByTestId('fa10e-placement-pl-1')).toHaveTextContent(/Udupi Grand · Cook.*Placement · PL-00009.*Working/);
    expect(screen.getByTestId('fa10e-interview-iv-1')).toHaveTextContent(/Udupi Grand · Cook.*Selected/);
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import MyJobSeekersScreen from '.';
import type { MyJobSeekerRow, SeekerRowState } from '@/api/endpoints';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const state = (over: Partial<SeekerRowState>): SeekerRowState => ({ status: 'active', action: null, vacancyId: null, waiting: false, done: false, group: 'active', ...over });

const seeker = (id: string, name: string, row: SeekerRowState, over: Partial<MyJobSeekerRow> = {}): MyJobSeekerRow => ({
  id, code: `JS-0000${id}`, name, phoneLast4: '5436', status: 'lead', registeredAt: '2026-11-14T06:00:00Z', stage: 'registered',
  steps: { linkSentAt: null, consentGivenAt: null, paidAt: null, idCheckedAt: null, idCheckPending: false, interviews: 0, placed: false },
  photoUrl: null, trade: 'Cook', yearsExperience: 1, locality: 'Bommanahalli', hits: 0, guarantee: null, nextInterviewAt: null,
  row, ...over,
});

const rows = [
  // The owner's Ramesh: link sent, consent given, ID photo sent, NOT paid — waiting for the Team Lead.
  seeker('4', 'Ramesh', state({ status: 'waiting_tl', waiting: true, group: 'waiting_tl' }), {
    photoUrl: 'https://storage.test/selfie.jpg?sig=1', stage: 'consent_given',
    steps: { linkSentAt: 'x', consentGivenAt: 'x', paidAt: null, idCheckedAt: null, idCheckPending: true, interviews: 0, placed: false },
  }),
  seeker('5', 'Suresh', state({ status: 'stuck_payment', action: 'payment_link', group: 'needs_action' })),
  seeker('6', 'Manju', state({ status: 'link_not_finished', action: 'registration_link', group: 'needs_action' })),
  seeker('7', 'Kavya', state({ status: 'interview_booked', done: true, group: 'active' }), {
    status: 'active', guarantee: { day: 5, days: 30, endsAt: '2026-12-10T00:00:00Z' }, hits: 2, nextInterviewAt: '2026-11-24T05:30:00Z', yearsExperience: 3,
  }),
  seeker('8', 'Raju', state({ status: 'id_check_needed', action: 'scan_aadhaar', group: 'needs_action' })),
  seeker('9', 'Lakshmi', state({ status: 'active', action: 'book_interview', vacancyId: 'vac-3', group: 'needs_action' }), { status: 'active', guarantee: { day: 2, days: 30, endsAt: 'x' } }),
  seeker('10', 'Anil', state({ status: 'placed', done: true, group: 'done' }), { status: 'active' }),
];

function api() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const route = (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? 'GET', path: u.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (u.pathname === '/field-work/job-seekers') return { status: 200, body: { query: '', results: rows } };
    if (u.pathname === '/consent/links') return { status: 200, body: { expiresAt: '2026-11-24T00:00:00Z' } };
    if (u.pathname.endsWith('/resend-payment')) return { status: 200, body: { paymentId: 'p-1' } };
    return undefined;
  };
  return { calls, route };
}

describe('FA10d My job seekers (Laboura Field lists, 22 Nov evening)', () => {
  it('each row: selfie, name in bold first, one plain status line (never "Paid" for an unpaid one), trade · area · experience, code and masked phone small', async () => {
    const { route } = api();
    await renderWithApp(<MyJobSeekersScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa10d-seeker-4'));
    const ramesh = screen.getByTestId('fa10d-seeker-4');
    expect(ramesh).toHaveTextContent(/^Ramesh/);
    expect(screen.getByTestId('fa10d-seeker-4-status')).toHaveTextContent('Waiting for the Team Lead’s ID check');
    expect(ramesh).toHaveTextContent(/Cook · Bommanahalli · 1 yr/);
    expect(screen.getByTestId('fa10d-seeker-4-small')).toHaveTextContent('JS-00004 · ******5436');
    expect(ramesh).not.toHaveTextContent(/Paid/);
    expect(screen.queryByText(/Link sent ✓/)).toBeNull();
    expect(screen.getByTestId('fa10d-photo-4').props.source).toEqual({ uri: 'https://storage.test/selfie.jpg?sig=1' });
    // No selfie: the first letters of the name.
    expect(screen.getByTestId('fa10d-photo-5-initials')).toHaveTextContent('SU');
    // Once paid: "Day X of 30 · N hits" and the next interview.
    expect(screen.getByTestId('fa10d-seeker-7')).toHaveTextContent(/Interview booked.*Cook · Bommanahalli · 3 yrs.*Day 5 of 30 · 2 hits · Interview Tue 24 Nov 11:00 AM/);
  });

  it('on the right: Waiting for the Team Lead (no button), ONE next-step button, or Done', async () => {
    const { route } = api();
    await renderWithApp(<MyJobSeekersScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa10d-seeker-4'));
    expect(screen.getByTestId('fa10d-waiting-4')).toHaveTextContent('Waiting');
    expect(within(screen.getByTestId('fa10d-seeker-4')).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('fa10d-action-5')).toHaveTextContent('Send payment link');
    expect(screen.getByTestId('fa10d-action-6')).toHaveTextContent('Resend link');
    expect(screen.getByTestId('fa10d-action-8')).toHaveTextContent('Scan Aadhaar QR');
    expect(screen.getByTestId('fa10d-action-9')).toHaveTextContent('Book interview');
    expect(screen.getByTestId('fa10d-done-7')).toHaveTextContent('Done');
    expect(screen.getByTestId('fa10d-done-10')).toHaveTextContent('Done');
  });

  it('the buttons work right there; tapping the row opens his profile, not the registration screen', async () => {
    const { calls, route } = api();
    await renderWithApp(<MyJobSeekersScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa10d-action-5'));
    await fireEvent.press(screen.getByTestId('fa10d-action-5'));
    await waitFor(() => expect(screen.getByTestId('fa10d-action-5')).toHaveTextContent('Sent ✓'));
    // Rev 211: the row's button sends on WhatsApp first; the small "Send by SMS" sends by SMS only.
    expect(calls).toContainEqual({ method: 'POST', path: '/job-seekers/5/resend-payment', body: { channel: 'whatsapp' } });
    await fireEvent.press(screen.getByTestId('fa10d-action-6-sms'));
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/consent/links', body: { jobSeekerId: '6', channel: 'sms' } }));
    await fireEvent.press(screen.getByTestId('fa10d-action-8'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/8?open=scan');
    await fireEvent.press(screen.getByTestId('fa10d-action-9'));
    expect(router.push).toHaveBeenCalledWith('/businesses/book?vacancyId=vac-3&jobSeekerId=9');
    await fireEvent.press(screen.getByTestId('fa10d-seeker-4'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/4');
    expect(router.push).not.toHaveBeenCalledWith('/job-seekers/4/registration');
    await fireEvent.press(screen.getByTestId('fa10d-add'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/new');
    await fireEvent.press(screen.getByTestId('fa10d-referral'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/referral-partner/new');
  });

  it('filter chips: Needs action, Waiting for Team Lead, Active, Done', async () => {
    const { route } = api();
    await renderWithApp(<MyJobSeekersScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa10d-seeker-4'));
    expect(screen.getByTestId('fa10d-chips')).toHaveTextContent(/Needs action · 4.*Waiting for Team Lead · 1.*Active · 1.*Done · 1/);
    await fireEvent.press(screen.getByTestId('fa10d-chips-needs_action'));
    expect(screen.queryByTestId('fa10d-seeker-4')).toBeNull();
    expect(screen.getByTestId('fa10d-seeker-5')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fa10d-chips-waiting_tl'));
    expect(screen.getByTestId('fa10d-seeker-4')).toBeTruthy();
    expect(screen.queryByTestId('fa10d-seeker-5')).toBeNull();
  });

  it('26 Nov: one search box, and sorts by Newest, Oldest and A–Z', async () => {
    const { route } = api();
    await renderWithApp(<MyJobSeekersScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa10d-seeker-4'));
    expect(screen.queryByTestId('search-bar')).toBeNull();
    const order = () => screen.getAllByTestId(/^fa10d-seeker-\d+$/).map((el) => String(el.props.testID).replace('fa10d-seeker-', ''));
    await fireEvent.press(screen.getByTestId('fa10d-sort-az'));
    // Anil, Kavya, Lakshmi, Manju, Raju, Ramesh, Suresh.
    expect(order()).toEqual(['10', '7', '9', '6', '8', '4', '5']);
  });
});

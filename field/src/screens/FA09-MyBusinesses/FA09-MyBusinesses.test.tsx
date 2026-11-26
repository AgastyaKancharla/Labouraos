import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import MyBusinessesScreen, { businessBadge, visitedText } from '.';
import { translate } from '@/i18n';
import type { BusinessRowState, MyBusinessRow } from '@/api/endpoints';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const state = (over: Partial<BusinessRowState>): BusinessRowState => ({ status: 'all_good', action: null, vacancyId: null, waiting: false, done: false, group: 'active', ...over });
const NOW = Date.now();
const DAY = 86_400_000;

const rows: MyBusinessRow[] = [
  {
    id: 'b-1', createdAt: '2026-11-20T05:00:00.000Z', code: 'BZ-00012', name: 'Sri Sai Bakery', locality: 'JP Nagar', verificationStatus: 'lead', agreementSigned: false, openVacancies: 0,
    nextStep: { kind: 'agreement_waiting', agreementState: 'link_expired' }, businessType: 'bakery', candidatesShown: 0, interviewsToday: 0,
    lastVisitAt: new Date(NOW - 2 * DAY).toISOString(), revisitOverdue: true, canAct: true,
    row: state({ status: 'agreement_expired', action: 'agreement_link', group: 'needs_action' }),
  },
  {
    id: 'b-2', createdAt: '2026-11-24T05:00:00.000Z', code: 'BZ-00013', name: 'Green Leaf Café', locality: 'Koramangala', verificationStatus: 'verified', agreementSigned: true, openVacancies: 2,
    nextStep: { kind: 'ready_show_candidates', vacancyId: 'vac-9' }, businessType: 'restaurant_hotel', candidatesShown: 5, interviewsToday: 1,
    lastVisitAt: new Date(NOW).toISOString(), revisitOverdue: false, canAct: true,
    row: state({ status: 'ready', action: 'show_candidates', vacancyId: 'vac-9', group: 'needs_action' }),
  },
  {
    id: 'b-3', createdAt: '2026-11-18T05:00:00.000Z', code: 'BZ-00014', name: 'Nandini Sweets', locality: 'Bellandur', verificationStatus: 'pending_tl_check', agreementSigned: true, openVacancies: 0,
    nextStep: { kind: 'waiting_tl_check' }, businessType: 'bakery', candidatesShown: 0, interviewsToday: 0, lastVisitAt: null, revisitOverdue: false, canAct: true,
    row: state({ status: 'waiting_tl', waiting: true, group: 'waiting_tl' }),
  },
  {
    id: 'b-4', createdAt: '2026-11-25T05:00:00.000Z', code: 'BZ-00015', name: 'Mourya Inn', locality: 'Electronic City', verificationStatus: 'verified', agreementSigned: true, openVacancies: 0,
    nextStep: { kind: 'add_vacancy' }, businessType: 'restaurant_hotel', candidatesShown: 0, interviewsToday: 0, lastVisitAt: null, revisitOverdue: false, canAct: true,
    row: state({ status: 'no_shifts', action: 'add_shifts', group: 'needs_action' }),
  },
  {
    id: 'b-5', createdAt: '2026-11-10T05:00:00.000Z', code: 'BZ-00016', name: 'Andhra Ruchulu', locality: 'Kumaraswamy Layout', verificationStatus: 'verified', agreementSigned: true, openVacancies: 0,
    nextStep: { kind: 'none' }, businessType: 'restaurant_hotel', candidatesShown: 3, interviewsToday: 0, lastVisitAt: null, revisitOverdue: false, canAct: true,
    row: state({ status: 'all_good', done: true, group: 'done' }),
  },
];

function api(extra?: (url: string, init: RequestInit) => { status: number; body?: unknown } | undefined) {
  const asked: string[] = [];
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const route = (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? 'GET', path: u.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const more = extra?.(url, init);
    if (more) return more;
    if (u.pathname === '/field-work/businesses') {
      const q = u.searchParams.get('q') ?? '';
      asked.push(q);
      return { status: 200, body: { query: q, results: q ? rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : rows } };
    }
    return undefined;
  };
  return { asked, calls, route };
}

describe('FA09 My businesses (Laboura Field lists, 22 Nov evening)', () => {
  it('each row: name in bold first, one plain status line, type · area, numbers, last visit, code small; tap opens the business page', async () => {
    const { asked, route } = api();
    await renderWithApp(<MyBusinessesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa09-business-b-1'));
    const first = screen.getByTestId('fa09-business-b-1');
    expect(first).toHaveTextContent(/^Sri Sai Bakery/);
    expect(screen.getByTestId('fa09-business-b-1-status')).toHaveTextContent('Agreement not signed · link expired');
    expect(first).toHaveTextContent(/Bakery · JP Nagar/);
    expect(first).toHaveTextContent(/0 vacancies · 0 candidates shown · 0 interviews today/);
    expect(first).toHaveTextContent(/Visited 2 days ago · revisit overdue/);
    expect(screen.getByTestId('fa09-business-b-1-small')).toHaveTextContent('BZ-00012');
    expect(screen.getByTestId('fa09-business-b-2')).toHaveTextContent(/Green Leaf Café.*Ready to show candidates.*2 vacancies · 5 candidates shown · 1 interviews today.*Visited today/);
    // The old checklist string is gone.
    expect(screen.queryByText(/Link sent ✓/)).toBeNull();
    expect(screen.queryByTestId('header-back')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('fa09-filter'), 'green');
    await waitFor(() => {
      expect(screen.getByTestId('fa09-business-b-2')).toBeTruthy();
      expect(screen.queryByTestId('fa09-business-b-1')).toBeNull();
    });
    expect(asked).toContain('green');
    await fireEvent.press(screen.getByTestId('fa09-business-b-2'));
    expect(router.push).toHaveBeenCalledWith('/businesses/b-2');
    // 26 Nov: one search box only (the second "search everyone" bar is gone).
    expect(screen.queryByTestId('search-bar')).toBeNull();
  });

  it('26 Nov: sorts by Newest, Oldest and A–Z', async () => {
    const { route } = api();
    await renderWithApp(<MyBusinessesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa09-business-b-1'));
    // Off at first: no sort chip is selected.
    for (const id of ['newest', 'oldest', 'az']) expect(screen.getByTestId(`fa09-sort-${id}`).props.accessibilityState).toEqual({ selected: false });
    const order = () => screen.getAllByTestId(/^fa09-business-b-\d+$/).map((el) => String(el.props.testID).replace('fa09-business-', ''));
    await fireEvent.press(screen.getByTestId('fa09-sort-az'));
    expect(order()).toEqual(['b-5', 'b-2', 'b-4', 'b-3', 'b-1']);
    await fireEvent.press(screen.getByTestId('fa09-sort-newest'));
    expect(order()).toEqual(['b-4', 'b-2', 'b-1', 'b-3', 'b-5']);
    await fireEvent.press(screen.getByTestId('fa09-sort-oldest'));
    expect(order()).toEqual(['b-5', 'b-3', 'b-1', 'b-2', 'b-4']);
    // Tapping it again turns the sort off: the usual order is back and nothing is selected.
    await fireEvent.press(screen.getByTestId('fa09-sort-oldest'));
    expect(screen.getByTestId('fa09-sort-oldest').props.accessibilityState).toEqual({ selected: false });
  });

  it('on the right: ONE button, "Waiting" for the Team Lead (no button), or a green Done', async () => {
    const { route } = api();
    await renderWithApp(<MyBusinessesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa09-business-b-1'));
    expect(screen.getByTestId('fa09-action-b-1')).toHaveTextContent('Send agreement link');
    expect(screen.getByTestId('fa09-action-b-2')).toHaveTextContent('Show candidates');
    expect(screen.getByTestId('fa09-action-b-4')).toHaveTextContent('Add shifts');
    expect(screen.getByTestId('fa09-waiting-b-3')).toHaveTextContent('Waiting');
    expect(screen.queryByTestId('fa09-action-b-3')).toBeNull();
    expect(screen.getByTestId('fa09-done-b-5')).toHaveTextContent('Done');
    expect(screen.queryByTestId('fa09-action-b-5')).toBeNull();
    // Each row has at most one button.
    for (const id of ['b-1', 'b-2', 'b-3', 'b-4', 'b-5']) {
      // ONE next step; a link's button sends on WhatsApp and has its small "Send by SMS" (rev 211).
      expect(within(screen.getByTestId(`fa09-business-${id}`)).queryAllByRole('button').length).toBeLessThanOrEqual(2);
    }
  });

  it('the buttons work right there: Send agreement link sends it; Show candidates opens them; Add shifts opens the shift form', async () => {
    const { calls, route } = api((url, init) =>
      url.includes('/agreement-link') && init.method === 'POST' ? { status: 200, body: { success: true, linkSentAt: 'x', linkExpiresAt: 'y', sentToLast4: '1234' } } : undefined,
    );
    await renderWithApp(<MyBusinessesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa09-action-b-1'));
    await fireEvent.press(screen.getByTestId('fa09-action-b-1'));
    await waitFor(() => expect(screen.getByTestId('fa09-action-b-1')).toHaveTextContent('Sent ✓'));
    expect(calls).toContainEqual({ method: 'POST', path: '/field-work/businesses/b-1/agreement-link', body: { channel: 'whatsapp' } });
    expect(router.push).not.toHaveBeenCalledWith('/businesses/b-1');
    await fireEvent.press(screen.getByTestId('fa09-action-b-2'));
    expect(router.push).toHaveBeenCalledWith('/businesses/candidates/b-2?vacancyId=vac-9');
    await fireEvent.press(screen.getByTestId('fa09-action-b-4'));
    await waitFor(() => screen.getByTestId('fa09-action-b-4-form'));
  });

  it('filter chips: All · Needs action · Waiting for Team Lead · Active · Done; needs-action rows first (the server order)', async () => {
    const { route } = api();
    await renderWithApp(<MyBusinessesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa09-business-b-1'));
    expect(screen.getByTestId('fa09-chips')).toHaveTextContent(/All.*Needs action · 3.*Waiting for Team Lead · 1.*Active.*Done · 1/);
    await fireEvent.press(screen.getByTestId('fa09-chips-waiting_tl'));
    expect(screen.getByTestId('fa09-business-b-3')).toBeTruthy();
    expect(screen.queryByTestId('fa09-business-b-1')).toBeNull();
    await fireEvent.press(screen.getByTestId('fa09-chips-done'));
    expect(screen.getByTestId('fa09-business-b-5')).toBeTruthy();
    expect(screen.queryByTestId('fa09-business-b-3')).toBeNull();
    await fireEvent.press(screen.getByTestId('fa09-chips-active'));
    expect(screen.getByText('Nothing under this filter.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fa09-chips-all'));
    expect(screen.getByTestId('fa09-business-b-1')).toBeTruthy();
  });

  it('last visit in IST days', () => {
    const t = ((key: string, params?: Record<string, string | number>) => translate('en', key as never, params)) as never;
    const now = Date.parse('2026-11-22T10:00:00Z');
    expect(visitedText(null, t, now)).toBe('Not visited yet');
    expect(visitedText('2026-11-22T01:00:00Z', t, now)).toBe('Visited today');
    expect(visitedText('2026-11-21T05:00:00Z', t, now)).toBe('Visited yesterday');
    expect(visitedText('2026-11-19T05:00:00Z', t, now)).toBe('Visited 3 days ago');
  });

  it('22 Nov (rev 208): the older badge still says where a business is stuck', () => {
    const t = ((key: string, params?: Record<string, string | number>) => translate('en', key as never, params)) as never;
    const row = (nextStep: unknown, extra: Partial<MyBusinessRow> = {}) => ({ ...rows[0], nextStep, ...extra }) as MyBusinessRow;
    const label = (r: MyBusinessRow) => businessBadge(r, t).label;
    expect(label(row({ kind: 'agreement_waiting', agreementState: 'link_sent' }))).toBe('Agreement not signed');
    expect(label(row({ kind: 'waiting_tl_check' }))).toBe('Team Lead check');
    expect(label(row({ kind: 'none' }, { interviewsToday: 2 }))).toBe('Interviews today');
  });
});

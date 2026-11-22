import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import MyBusinessesScreen, { businessBadge } from '.';
import { translate } from '@/i18n';
import type { MyBusinessRow } from '@/api/endpoints';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const rows = [
  { id: 'b-1', code: 'BZ-00012', name: 'Sri Sai Bakery', locality: 'JP Nagar', verificationStatus: 'lead', agreementSigned: false, openVacancies: 0, nextStep: { kind: 'agreement_waiting', agreementState: 'link_expired' } },
  { id: 'b-2', code: 'BZ-00013', name: 'Green Leaf Café', locality: 'Koramangala', verificationStatus: 'verified', agreementSigned: true, openVacancies: 2, nextStep: { kind: 'ready_show_candidates', vacancyId: 'vac-9' } },
];

describe('FA09 My businesses', () => {
  it('lists my businesses, each with one line saying what it needs next; the filter searches them; tap opens the business page', async () => {
    const asked: string[] = [];
    await renderWithApp(<MyBusinessesScreen />, {
      signedInAs: kiran,
      route: (url) => {
        if (!url.includes('/field-work/businesses')) return undefined;
        const q = new URL(url).searchParams.get('q') ?? '';
        asked.push(q);
        return { status: 200, body: { query: q, results: q ? rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : rows } };
      },
    });
    await waitFor(() => screen.getByTestId('fa09-business-b-1'));
    expect(screen.getByTestId('fa09-business-b-1')).toHaveTextContent(/Sri Sai Bakery.*JP Nagar · BZ-00012.*Agreement link expired · resend it.*Agreement not signed/);
    expect(screen.getByTestId('fa09-business-b-2')).toHaveTextContent(/Green Leaf Café.*Ready to show candidates.*2 open/);
    expect(screen.queryByTestId('header-back')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('fa09-filter'), 'green');
    await waitFor(() => {
      expect(screen.getByTestId('fa09-business-b-2')).toBeTruthy();
      expect(screen.queryByTestId('fa09-business-b-1')).toBeNull();
    });
    expect(asked).toContain('green');
    await fireEvent.press(screen.getByTestId('fa09-business-b-2'));
    expect(router.push).toHaveBeenCalledWith('/businesses/b-2');
    await fireEvent.press(screen.getByTestId('search-bar'));
    expect(router.push).toHaveBeenCalledWith('/businesses/search');
  });

  it('22 Nov (rev 208): each row shows where the business is stuck', () => {
    const t = ((key: string, params?: Record<string, string | number>) => translate('en', key as never, params)) as never;
    const row = (nextStep: unknown, extra: Partial<MyBusinessRow> = {}) => ({ ...rows[0], nextStep, ...extra }) as MyBusinessRow;
    const label = (r: MyBusinessRow) => businessBadge(r, t).label;
    expect(label(row({ kind: 'agreement_waiting', agreementState: 'link_sent' }))).toBe('Agreement not signed');
    expect(label(row({ kind: 'waiting_tl_check' }))).toBe('Team Lead check');
    expect(label(row({ kind: 'add_vacancy' }))).toBe('No vacancy');
    expect(label(row({ kind: 'ready_show_candidates', vacancyId: 'v' }))).toBe('Ready to show candidates');
    expect(label(row({ kind: 'none' }, { interviewsToday: 2 }))).toBe('Interviews today');
    expect(label(row({ kind: 'none' }))).toBe('All good');
  });
});

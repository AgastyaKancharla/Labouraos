import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import MyBusinessesScreen from '.';

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
    expect(screen.getByTestId('fa09-business-b-1')).toHaveTextContent(/Sri Sai Bakery.*BZ-00012 · JP Nagar.*Agreement link expired · resend it.*No vacancy/);
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
});

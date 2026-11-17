import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, segments } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable, settings } from '@/test/selling-fixtures';
import PitchScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA14 Pitch and fee calculator', () => {
  it('₹15,000 → ₹7,500 + ₹1,350 GST = ₹8,850, using the percentages from Settings', async () => {
    const { route } = routeTable({ '/screens/field-selling/settings': settings });
    await renderWithApp(<PitchScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('pitch'));
    await fireEvent.changeText(screen.getByTestId('salary'), '15000');
    expect(screen.getByTestId('fee')).toHaveTextContent('Laboura fee (50%)₹7,500');
    expect(screen.getByTestId('gst')).toHaveTextContent('GST 18%₹1,350');
    expect(screen.getByTestId('total')).toHaveTextContent('₹8,850');
  });

  it('changes with Settings (never hard-coded) and shows the pitch in English (rev 193)', async () => {
    const { route } = routeTable({ '/screens/field-selling/settings': { ...settings, feePercent: 40 } });
    await renderWithApp(<PitchScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('pitch'));
    await fireEvent.changeText(screen.getByTestId('salary'), '15000');
    expect(screen.getByTestId('fee')).toHaveTextContent('Laboura fee (40%)₹6,000');
    expect(screen.getByTestId('pitch')).toHaveTextContent(/40% of their first month’s salary \+ 18% GST/);
    expect(screen.getByTestId('pitch')).toHaveTextContent(/We send you verified staff/);
    expect(screen.queryByTestId('pitch-language')).toBeNull();
  });

  it('opened during a visit, it goes back to the visit instead of starting a second one', async () => {
    segments.current = ['(app)', '(tabs)', '(visits)', 'visit', 'pitch'];
    const { route } = routeTable({ '/screens/field-selling/settings': settings });
    await renderWithApp(<PitchScreen />, { signedInAs: kiran, route });
    expect(screen.queryByTestId('register-business')).toBeNull();
    await fireEvent.press(screen.getByTestId('back-to-visit'));
    expect(router.back).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    segments.current = [];
  });
});

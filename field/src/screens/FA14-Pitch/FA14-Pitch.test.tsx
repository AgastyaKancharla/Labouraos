import { fireEvent, screen, waitFor } from '@testing-library/react-native';
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

  it('changes with Settings (never hard-coded) and shows the pitch in the owner\'s language', async () => {
    const { route } = routeTable({ '/screens/field-selling/settings': { ...settings, feePercent: 40 } });
    await renderWithApp(<PitchScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('pitch'));
    await fireEvent.changeText(screen.getByTestId('salary'), '15000');
    expect(screen.getByTestId('fee')).toHaveTextContent('Laboura fee (40%)₹6,000');
    expect(screen.getByTestId('pitch')).toHaveTextContent(/40% of their first month’s salary \+ 18% GST/);
    await fireEvent.press(screen.getByTestId('pitch-language-hi'));
    expect(screen.getByTestId('pitch')).toHaveTextContent(/हम आपको जाँचे हुए कर्मचारी भेजते हैं/);
    await fireEvent.press(screen.getByTestId('pitch-language-kn'));
    expect(screen.getByTestId('pitch')).toHaveTextContent(/ಪರಿಶೀಲಿಸಿದ ಸಿಬ್ಬಂದಿ/);
  });
});

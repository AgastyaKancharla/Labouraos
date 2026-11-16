import { fireEvent, screen } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { renderWithApp } from '@/test/render';
import { TopBar } from './TopBar';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

/** Decided 16 Nov: the Laboura logo in the header goes Home once signed in. */
describe('TopBar logo', () => {
  it('opens Home when the signed-in person taps the logo', async () => {
    await renderWithApp(<TopBar title="Visits" personName="Kiran Kumar" onLogout={() => undefined} />);
    await fireEvent.press(screen.getByTestId('logo-home'));
    expect(router.navigate).toHaveBeenCalledWith('/');
  });

  it('is a plain logo on the sign-in screens', async () => {
    await renderWithApp(<TopBar title="Sign in" />);
    expect(screen.queryByTestId('logo-home')).toBeNull();
  });
});

import { fireEvent, screen } from '@testing-library/react-native';
import { router, segments } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { AppHeader } from './AppHeader';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => jest.clearAllMocks());

describe('the back arrow (redesign, 16 Nov)', () => {
  it('a tab’s main page has no back arrow', async () => {
    await renderWithApp(<AppHeader title="Today" root />, { signedInAs: kiran });
    expect(screen.queryByTestId('header-back')).toBeNull();
    expect(screen.getByTestId('logo-home')).toBeTruthy();
  });

  it('every inner screen has one: it goes one step back inside the tab', async () => {
    segments.current = ['(app)', '(tabs)', 'businesses', 'vacancy', '[id]'];
    await renderWithApp(<AppHeader title="Vacancy" />, { signedInAs: kiran });
    expect(screen.getByLabelText('Back')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('header-back'));
    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('with nothing to go back to (opened from a link), it goes to the tab’s main page', async () => {
    (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
    segments.current = ['(app)', '(tabs)', '(visits)', 'visit', 'agreement'];
    await renderWithApp(<AppHeader title="Agreement" />, { signedInAs: kiran });
    await fireEvent.press(screen.getByTestId('header-back'));
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/visits');
  });
});

import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { MOCK_SHEET_URL } from '@/api/mock';
import { isSheetUrlAllowed, openSecureSheet, SheetBlockedError, withReturnParams } from './openSheet';

jest.mock('expo-linking', () => ({ createURL: (path: string) => `laboura://${path}` }));

const setOS = (os: 'ios' | 'android') => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });

beforeEach(() => jest.clearAllMocks());

describe('the secure browser sheet', () => {
  it('opens only https link pages on the Laboura link-pages address', () => {
    expect(isSheetUrlAllowed('https://app.test/p/register/tok')).toBe(true);
    expect(isSheetUrlAllowed('http://app.test/p/register/tok')).toBe(false);
    expect(isSheetUrlAllowed('https://evil.example/p/register/tok')).toBe(false);
    expect(isSheetUrlAllowed('not a url')).toBe(false);
  });

  it('adds the way back to the app to every link', () => {
    expect(withReturnParams('https://app.test/p/register/tok?lang=kn', 'laboura://sheet-done')).toBe(
      'https://app.test/p/register/tok?lang=kn&app=1&returnTo=laboura%3A%2F%2Fsheet-done',
    );
  });

  it('Android: Chrome Custom Tabs, returns when the page sends the person back', async () => {
    setOS('android');
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({ type: 'success', url: 'laboura://sheet-done' });
    await expect(openSecureSheet('https://app.test/p/register/tok')).resolves.toBe('returned');
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://app.test/p/register/tok?app=1&returnTo=laboura%3A%2F%2Fsheet-done',
      'laboura://sheet-done',
      expect.objectContaining({ showInRecents: false }),
    );
  });

  it('iPhone: the Safari sheet (no sign-in prompt); closing it counts as closed', async () => {
    setOS('ios');
    await expect(openSecureSheet('https://app.test/p/agreement/tok')).resolves.toBe('closed');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalled();
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('no in-app browser on the phone: falls back to the phone browser', async () => {
    setOS('android');
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockRejectedValueOnce(new Error('No matching browser activity found'));
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await expect(openSecureSheet('https://app.test/p/register/tok')).resolves.toBe('opened_in_browser');
    expect(openURL).toHaveBeenCalledWith('https://app.test/p/register/tok?app=1&returnTo=laboura%3A%2F%2Fsheet-done');
  });

  it('refuses anything else, and does nothing for pretend data', async () => {
    await expect(openSecureSheet('https://evil.example/x')).rejects.toBeInstanceOf(SheetBlockedError);
    await expect(openSecureSheet(MOCK_SHEET_URL)).resolves.toBe('mock');
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});

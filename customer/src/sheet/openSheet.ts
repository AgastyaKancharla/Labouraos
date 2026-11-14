import { Linking, Platform } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { linkPagesBaseUrl } from '@/api/config';
import { MOCK_SHEET_URL } from '@/api/mock';
import { colors } from '@/theme';

/**
 * The secure browser sheet (proposal 8.2, decision 4): consent, selfie, ID
 * check, ₹499 payment, the business agreement and the partner's terms/UPI
 * are the existing link pages (app.laboura.com/p/...), opened INSIDE the app
 * in the phone's own browser engine, then the app takes over again.
 *
 * Why the system browser sheet and not a WebView:
 * - The camera works: Android Chrome Custom Tabs and iPhone
 *   SFSafariViewController run the page in the real browser, which asks for
 *   camera permission itself and supports the live selfie and the Aadhaar QR
 *   scan (getUserMedia). A WebView needs extra native permission plumbing on
 *   both platforms and is the usual reason "camera inside the app" fails.
 * - UPI payment links (upi://…) open the person's UPI app from the browser;
 *   a WebView swallows them unless every scheme is handled by hand.
 * - The app cannot read or change what the person types on the payment,
 *   Aadhaar and agreement pages — the pages stay as trustworthy as by SMS.
 *
 * Android: Custom Tabs via openAuthSessionAsync — returns when the page
 *   sends the person to `laboura://sheet-done` or when they close the tab.
 * iPhone: SFSafariViewController via openBrowserAsync (no "wants to use
 *   app.laboura.com to sign in" prompt that the auth session would show);
 *   returns when they tap Done or the page opens `laboura://sheet-done`
 *   (app/sheet-done.tsx closes the sheet).
 * Fallback: if the phone has no in-app browser, the page opens in the
 *   phone's browser. `returnTo=laboura://sheet-done` is added to every link
 *   so the page can offer "Back to the Laboura app"; Home also refreshes
 *   whenever the app comes back to the front.
 */
export type SheetOutcome = 'returned' | 'closed' | 'opened_in_browser' | 'mock';

export const SHEET_RETURN_PATH = 'sheet-done';

export function sheetReturnUrl(): string {
  return ExpoLinking.createURL(SHEET_RETURN_PATH);
}

/** Only https links on the link-pages address open in the sheet. */
export function isSheetUrlAllowed(url: string, base: string = linkPagesBaseUrl()): boolean {
  try {
    const target = new URL(url);
    const allowed = new URL(base);
    return target.protocol === 'https:' && target.host === allowed.host;
  } catch {
    return false;
  }
}

export function withReturnParams(url: string, returnTo: string): string {
  const u = new URL(url);
  u.searchParams.set('app', '1');
  u.searchParams.set('returnTo', returnTo);
  return u.toString();
}

export class SheetBlockedError extends Error {
  constructor() {
    super('This link cannot be opened in the app.');
    this.name = 'SheetBlockedError';
  }
}

export async function openSecureSheet(url: string): Promise<SheetOutcome> {
  if (url === MOCK_SHEET_URL) return 'mock';
  if (!isSheetUrlAllowed(url)) throw new SheetBlockedError();
  const returnTo = sheetReturnUrl();
  const target = withReturnParams(url, returnTo);
  try {
    if (Platform.OS === 'android') {
      const result = await WebBrowser.openAuthSessionAsync(target, returnTo, { showInRecents: false, toolbarColor: colors.blue });
      return result.type === 'success' ? 'returned' : 'closed';
    }
    const result = await WebBrowser.openBrowserAsync(target, {
      dismissButtonStyle: 'done',
      controlsColor: colors.blue,
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    });
    return result.type === 'dismiss' || result.type === 'cancel' ? 'closed' : 'returned';
  } catch {
    await Linking.openURL(target);
    return 'opened_in_browser';
  }
}

/** Called by app/sheet-done.tsx when the page sends the person back. */
export async function closeSecureSheet(): Promise<void> {
  if (Platform.OS === 'ios') {
    try {
      await WebBrowser.dismissBrowser();
    } catch {
      /* already closed */
    }
  }
}

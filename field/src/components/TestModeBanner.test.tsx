import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createApiClient } from '@/api/client';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { TestModeBanner } from './TestModeBanner';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
}

function apiAnswering(body: unknown) {
  return createApiClient({
    baseUrl: 'https://api.test',
    getToken: () => 'tok',
    onUnauthorized: jest.fn(),
    fetchImpl: async () => jsonResponse(body),
  });
}

function renderBanner() {
  return render(
    <I18nProvider storage={createMemoryStore()} initialLanguage="en">
      <TestModeBanner />
    </I18nProvider>,
  );
}

describe('OTP test mode banner (Laboura Field)', () => {
  it('shows the test code from a send-OTP answer, and closes', async () => {
    const api = apiAnswering({ otpRequestId: 'r1', sentToLast4: '3210', testModeCode: '123456', testModeBanner: 'Test mode code: 123456' });
    const screen = await renderBanner();
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
    await act(async () => {
      await api.post('/vacancies/VC-00001/confirmation/send', {});
    });
    expect(screen.getByText('Test mode code: 123456')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
  });

  it('shows nothing when the answer has no test code (live vendors)', async () => {
    const api = apiAnswering({ otpRequestId: 'r2', sentToLast4: '3210' });
    const screen = await renderBanner();
    await act(async () => {
      await api.post('/vacancies/VC-00001/confirmation/send', {});
    });
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
  });
});

describe('Test mode link banner (Laboura Field, pretend SMS)', () => {
  it('shows "Open link" for a testModeLink and opens the link', async () => {
    const link = 'https://field.test/vacancy-confirm/tok-1';
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const api = apiAnswering({ success: true, sentToLast4: '3210', testModeLink: link });
    const screen = await renderBanner();
    await act(async () => {
      await api.post('/vacancies/VC-00001/confirmation/link', {});
    });
    expect(screen.getByText('Test mode link')).toBeTruthy();
    await fireEvent.press(screen.getByText('Open link'));
    expect(open).toHaveBeenCalledWith(link);
    open.mockRestore();
  });

  it('shows no link when the answer has none (live system)', async () => {
    const api = apiAnswering({ success: true, sentToLast4: '3210' });
    const screen = await renderBanner();
    await act(async () => {
      await api.post('/vacancies/VC-00001/confirmation/link', {});
    });
    expect(screen.queryByTestId('test-mode-link')).toBeNull();
  });
});

/** A stand-in for a screen's header: shows the top inset it gets and keeps a tap count (lost if it remounts). */
function Header() {
  const insets = useSafeAreaInsets();
  const [taps, setTaps] = useState(0);
  return (
    <Pressable testID="header-back" onPress={() => setTaps((n) => n + 1)}>
      <Text testID="header-inset">{`top ${insets.top} · taps ${taps}`}</Text>
    </Pressable>
  );
}

describe('the banner takes its own space above the header (A7)', () => {
  const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

  async function renderAround() {
    return render(
      <SafeAreaProvider initialMetrics={metrics}>
        <I18nProvider storage={createMemoryStore()} initialLanguage="en">
          <TestModeBanner>
            <Header />
          </TestModeBanner>
        </I18nProvider>
      </SafeAreaProvider>,
    );
  }

  it('pushes the app down instead of covering it, and the header stays tappable', async () => {
    const api = apiAnswering({ otpRequestId: 'r1', sentToLast4: '3210', testModeCode: '123456', testModeBanner: 'Test mode code: 123456' });
    await renderAround();
    expect(screen.getByTestId('header-inset')).toHaveTextContent('top 24 · taps 0');
    await fireEvent.press(screen.getByTestId('header-back'));
    await act(async () => {
      await api.post('/otp/send', {});
    });
    const banner = screen.getByTestId('test-mode-banner');
    // In the layout, not floating over it.
    let node = banner.parent;
    while (node) {
      expect(StyleSheet.flatten(node.props.style ?? {}).position).not.toBe('absolute');
      if (node.props.testID === 'test-mode-area') break;
      node = node.parent;
    }
    // The strip comes first; the app below it no longer adds the status-bar inset (the strip does).
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('Test mode code: 123456')).toBeGreaterThan(-1);
    expect(tree.indexOf('Test mode code: 123456')).toBeLessThan(tree.indexOf('header-inset'));
    expect(screen.getByTestId('header-inset')).toHaveTextContent('top 0 · taps 1');
    // Same screen, not remounted: the header still works and kept its state.
    await fireEvent.press(screen.getByTestId('header-back'));
    expect(screen.getByTestId('header-inset')).toHaveTextContent('top 0 · taps 2');
    await fireEvent.press(screen.getByTestId('test-mode-close'));
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
    expect(screen.getByTestId('header-inset')).toHaveTextContent('top 24 · taps 2');
  });
});

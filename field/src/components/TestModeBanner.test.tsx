import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
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

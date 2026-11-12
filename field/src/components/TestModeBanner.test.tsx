import { act, fireEvent, render } from '@testing-library/react-native';
import { createApiClient } from '@/api/client';
import { TestModeBanner } from './TestModeBanner';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
}

describe('OTP test mode banner (Laboura Field)', () => {
  it('shows the test code from a send-OTP answer, and closes', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'tok',
      onUnauthorized: jest.fn(),
      fetchImpl: async () => jsonResponse({ otpRequestId: 'r1', sentToLast4: '3210', testModeCode: '123456', testModeBanner: 'Test mode code: 123456' }),
    });
    const screen = await render(<TestModeBanner />);
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
    await act(async () => {
      await api.post('/vacancies/VC-00001/confirmation/send', {});
    });
    expect(screen.getByText('Test mode code: 123456')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
  });

  it('shows nothing when the answer has no test code (live vendors)', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'tok',
      onUnauthorized: jest.fn(),
      fetchImpl: async () => jsonResponse({ otpRequestId: 'r2', sentToLast4: '3210' }),
    });
    const screen = await render(<TestModeBanner />);
    await act(async () => {
      await api.post('/vacancies/VC-00001/confirmation/send', {});
    });
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
  });
});

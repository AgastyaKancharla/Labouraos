import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { api } from '../lib/api/client';
import { mockApi, renderScreen } from '../test/utils';

function SendButton({ path }: { path: string }) {
  return (
    <button type="button" onClick={() => void api.post(path, {}, { auth: false }).catch(() => undefined)}>
      Send OTP
    </button>
  );
}

describe('OTP test mode banner', () => {
  it('shows "Test mode code: 123456" when the server answers a send with a test code', async () => {
    mockApi({ 'POST /consent/send-otp': { success: true, requestId: 'r1', phone: '******3210', testModeCode: '123456', testModeBanner: 'Test mode code: 123456' } });
    renderScreen(<SendButton path="/consent/send-otp" />);
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await waitFor(() => expect(screen.getByTestId('test-mode-banner')).toHaveTextContent('Test mode code: 123456'));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
  });

  it('shows nothing for a live answer (no test code in it)', async () => {
    const calls = mockApi({ 'POST /consent/send-otp': { success: true, requestId: 'r2', phone: '******3210' } });
    renderScreen(<SendButton path="/consent/send-otp" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await waitFor(() => expect(calls.calls('POST /consent/send-otp')).toHaveLength(1));
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
  });
});

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

describe('Test mode link banner (pretend SMS)', () => {
  it('shows "Open link" for a testModeLink and opens it in a new tab', async () => {
    const link = 'https://laboura-test.onrender.com/p/register/tok123';
    mockApi({ 'POST /consent/links': { success: true, linkId: 'l1', expiresAt: '2026-11-18T10:00:00.000Z', testModeLink: link } });
    renderScreen(<SendButton path="/consent/links" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await waitFor(() => expect(screen.getByTestId('test-mode-banner')).toHaveTextContent('Test mode link'));
    const open = screen.getByRole('link', { name: 'Open link' });
    expect(open).toHaveAttribute('href', link);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
  });

  it('numbers the links when one request sent several', async () => {
    mockApi({
      'POST /placements/p1/joined': {
        ok: true,
        testModeLink: 'https://x.test/payout-accounts/link/a',
        testModeLinks: [
          { template: 'payout_details_link', url: 'https://x.test/payout-accounts/link/a' },
          { template: 'payout_details_link', url: 'https://x.test/payout-accounts/link/b' },
        ],
      },
    });
    renderScreen(<SendButton path="/placements/p1/joined" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open link 2' })).toHaveAttribute('href', 'https://x.test/payout-accounts/link/b'));
    expect(screen.getByRole('link', { name: 'Open link 1' })).toHaveAttribute('href', 'https://x.test/payout-accounts/link/a');
  });

  it('shows no link banner for a live answer (no testModeLink) or a non-web link', async () => {
    const calls = mockApi({ 'POST /consent/links': { success: true, linkId: 'l2', expiresAt: '2026-11-18T10:00:00.000Z', testModeLink: 'javascript:alert(1)' } });
    renderScreen(<SendButton path="/consent/links" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await waitFor(() => expect(calls.calls('POST /consent/links')).toHaveLength(1));
    expect(screen.queryByTestId('test-mode-banner')).toBeNull();
  });
});

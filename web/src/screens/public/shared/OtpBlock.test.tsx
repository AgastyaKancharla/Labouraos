import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '../../../test/utils';
import { OtpBlock } from './ui';

function Harness({ send }: { send: (channel?: 'sms') => Promise<{ requestId: string; phone?: string }> }) {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  return <OtpBlock maskedPhone="******3210" send={send as never} requestId={requestId} onRequestId={setRequestId} code={code} onCode={setCode} />;
}

/** Public pages: codes go on WhatsApp first; "Send by SMS" with Resend after 30 seconds (rev 211). */
describe('the public code box', () => {
  it('offers "Send by SMS" 30 seconds after the code went and asks for a fresh code by SMS', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const send = vi.fn(async (channel?: 'sms') => ({ requestId: channel ? 'r-sms' : 'wa_otp_1', phone: '******3210' }));
      renderScreen(<Harness send={send} />, { portal: 'public', path: '/p/test' });
      fireEvent.click(screen.getByRole('button', { name: 'Send code to ******3210' }));
      await screen.findByText('Code sent to ******3210');
      expect(screen.queryByRole('button', { name: 'Send by SMS' })).not.toBeInTheDocument();
      for (let i = 0; i < 31; i += 1) {
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
      }
      fireEvent.click(await screen.findByRole('button', { name: 'Send by SMS' }));
      await waitFor(() => expect(send).toHaveBeenLastCalledWith('sms'));
      expect(await screen.findByText(/A new code was sent by SMS/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

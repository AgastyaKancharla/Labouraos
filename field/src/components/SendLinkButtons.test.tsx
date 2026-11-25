import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { SendBySms, SEND_BY_SMS_AFTER_MS } from './SendBySms';
import { SendLinkButtons, sentResultKey } from './SendLinkButtons';
import { OtpStep } from '@/screens/_selling/OtpStep';
import { kiran, renderWithApp } from '@/test/render';

function wrap(ui: React.ReactElement) {
  return render(
    <I18nProvider storage={createMemoryStore()} initialLanguage="en">
      {ui}
    </I18nProvider>,
  );
}

/** WhatsApp first, SMS as backup (Master Guide rev 211). */
describe('Send on WhatsApp, with a small Send by SMS', () => {
  it('says which channel carried it', () => {
    expect(sentResultKey('whatsapp', { sentBy: 'whatsapp' })).toBe('send.result.whatsapp');
    expect(sentResultKey('whatsapp', { sentBy: 'sms' })).toBe('send.result.smsFallback');
    expect(sentResultKey('sms', { sentBy: 'sms' })).toBe('send.result.sms');
    expect(sentResultKey('whatsapp', { sentBy: null })).toBe('send.result.none');
    expect(sentResultKey('sms', {})).toBe('send.result.sms');
  });

  it('sends on WhatsApp by default and by SMS from the small button, and shows the carrier', async () => {
    const run = jest.fn(async (_channel: string) => ({ sentBy: 'sms' }));
    const screen = await wrap(<SendLinkButtons label="Resend link" run={run} testID="send" />);
    expect(screen.getByTestId('send')).toHaveTextContent(/Resend link/);
    await fireEvent.press(screen.getByTestId('send-whatsapp'));
    await waitFor(() => expect(screen.getByTestId('send-result')).toHaveTextContent('WhatsApp could not take it, so it went by SMS.'));
    expect(run).toHaveBeenLastCalledWith('whatsapp');
    await fireEvent.press(screen.getByTestId('send-sms'));
    await waitFor(() => expect(run).toHaveBeenLastCalledWith('sms'));
    await waitFor(() => expect(screen.getByTestId('send-result')).toHaveTextContent('Sent by SMS.'));
  });

  it('a code screen offers Send by SMS only 30 seconds after the code went', async () => {
    jest.useFakeTimers();
    try {
      const onPress = jest.fn();
      const screen = await wrap(<SendBySms sentAt={Date.now()} onPress={onPress} testID="sms" />);
      expect(screen.queryByTestId('sms')).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(SEND_BY_SMS_AFTER_MS + 1000);
      });
      await fireEvent.press(screen.getByTestId('sms'));
      expect(onPress).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the owner\'s code step: after 30 seconds "Send by SMS" asks for the code by SMS on the same request', async () => {
    jest.useFakeTimers();
    try {
      const send = jest.fn(async (_prev?: string, _channel?: 'sms') => ({ otpRequestId: 'wa_otp_1', sentToLast4: '3210' }));
      const screen = await renderWithApp(
        <OtpStep send={send as never} verify={jest.fn()} intro={() => 'Code sent'} sendLabel="Send code" verifyLabel="Verify" testID="otp" />,
        { signedInAs: kiran },
      );
      await fireEvent.press(screen.getByTestId('otp-send'));
      await waitFor(() => screen.getByTestId('otp-sent'));
      expect(screen.queryByTestId('otp-sms')).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(31_000);
      });
      await fireEvent.press(screen.getByTestId('otp-sms'));
      await waitFor(() => expect(send).toHaveBeenLastCalledWith('wa_otp_1', 'sms'));
      await waitFor(() => screen.getByTestId('otp-by-sms'));
    } finally {
      jest.useRealTimers();
    }
  });
});

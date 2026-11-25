/**
 * Test doubles of MessagingService built on a `send` mock (rev 211, WhatsApp
 * first). The sending rules call sendPreferWhatsApp / sendOn / sendBySms /
 * sendBoth; a double that only had `send` gets those added here, each going
 * through the same `send` mock (with `channel: 'whatsapp'` first, then `'sms'`
 * when the WhatsApp answer is `failed`), so a spec can keep asserting on
 * `send` calls.
 */
type SendMock = (input: Record<string, unknown>) => Promise<unknown>;
type Row = { id?: string | null; status?: string } | null | undefined;

export function withSendingRules<T extends { send: SendMock }>(double: T) {
  const send = (input: Record<string, unknown>, channel: 'whatsapp' | 'sms') => Promise.resolve(double.send({ ...input, channel })) as Promise<Row>;
  const result = (channel: 'whatsapp' | 'sms' | null, row: Row, whatsapp: Row) => ({
    channel,
    status: channel ? 'sent' : row?.status === 'blocked' ? 'blocked' : 'failed',
    id: row?.id ?? null,
    whatsappMessageId: whatsapp?.id ?? null,
    smsMessageId: channel === 'whatsapp' ? null : row?.id ?? null,
  });
  const bySms = async (input: Record<string, unknown>) => {
    const sms = await send(input, 'sms');
    const ok = !sms || (sms.status !== 'failed' && sms.status !== 'blocked');
    return result(ok ? 'sms' : null, sms, null);
  };
  const prefer = async (input: Record<string, unknown>) => {
    const wa = await send(input, 'whatsapp');
    if (!wa || (wa.status !== 'failed' && wa.status !== 'blocked')) return result('whatsapp', wa, wa);
    if (wa.status === 'blocked') return result(null, wa, wa);
    const sms = await send(input, 'sms');
    const ok = !sms || (sms.status !== 'failed' && sms.status !== 'blocked');
    return { ...result(ok ? 'sms' : null, sms, wa), whatsappMessageId: wa.id ?? null };
  };
  return Object.assign(double, {
    sendPreferWhatsApp: jest.fn(prefer),
    sendBySms: jest.fn(bySms),
    sendOn: jest.fn((channel: 'whatsapp' | 'sms' | undefined, input: Record<string, unknown>) => (channel === 'sms' ? bySms(input) : prefer(input))),
    sendBoth: jest.fn(async (input: Record<string, unknown>) => {
      const sms = await send(input, 'sms');
      const whatsapp = await send(input, 'whatsapp');
      return { sms, whatsapp };
    }),
  });
}

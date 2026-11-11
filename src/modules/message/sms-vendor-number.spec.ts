import { RealSmsProvider } from './sms.provider';

/** Phones are stored as +91XXXXXXXXXX; the DLT SMS gateway gets 91XXXXXXXXXX. */
describe('RealSmsProvider sends the number the way the vendor expects', () => {
  const saved = { url: process.env.SMS_API_URL, key: process.env.SMS_API_KEY };
  const realFetch = global.fetch;

  afterEach(() => {
    process.env.SMS_API_URL = saved.url;
    process.env.SMS_API_KEY = saved.key;
    global.fetch = realFetch;
  });

  it('country code, no plus, whatever spelling was stored', async () => {
    process.env.SMS_API_URL = 'https://sms.vendor.test/send';
    process.env.SMS_API_KEY = 'key';
    const bodies: Array<{ to: string }> = [];
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, json: async () => ({ messageId: 'm-1' }) } as Response;
    }) as unknown as typeof fetch;

    const provider = new RealSmsProvider();
    for (const phone of ['+919876543210', '9876543210']) {
      const result = await provider.sendTemplate(phone, 'consent_link', '1007000000000000001', { link: 'x' });
      expect(result.status).toBe('sent');
    }
    expect(bodies.map((b) => b.to)).toEqual(['919876543210', '919876543210']);
  });
});

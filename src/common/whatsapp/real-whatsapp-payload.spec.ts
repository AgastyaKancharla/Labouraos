import { RealWhatsAppProvider } from './real-whatsapp.provider';

/** 21 Nov review S5: the Cloud API payload carries only the template's declared variables, in order. */
describe('Real WhatsApp provider: template payload shape', () => {
  function capture() {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchFn = jest.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.X' }] }) };
    });
    const provider = new RealWhatsAppProvider({ apiUrl: 'https://graph.example/v21.0', accessToken: 't', phoneNumberId: '123', fetchFn: fetchFn as unknown as typeof fetch });
    return { provider, calls };
  }

  it('sends a link template with only {link}: the raw token never leaves', async () => {
    const { provider, calls } = capture();
    const res = await provider.sendTemplateMessage('9876543210', 'consent_link', { token: 'tok_secret_123', link: 'https://app.laboura.in/p/register/tok_secret_123' });
    expect(res.status).toBe('sent');
    const template = calls[0].body.template as { name: string; language: { code: string }; components: Array<{ type: string; parameters: Array<Record<string, string>> }> };
    expect(calls[0].body).toMatchObject({ messaging_product: 'whatsapp', to: '919876543210', type: 'template' });
    expect(template.name).toBe('consent_link');
    expect(template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'https://app.laboura.in/p/register/tok_secret_123', parameter_name: 'link' }] },
    ]);
    expect(JSON.stringify(template.components)).not.toContain('"token"');
  });

  it('keeps the declared order and fills a missing variable with empty text', async () => {
    const { provider, calls } = capture();
    await provider.sendTemplateMessage('+919876543210', 'referral_terms_link', { referralCode: 'RF-00007', link: 'https://x/p/partner/t', extra: 'nope' });
    const params = (calls[0].body.template as { components: Array<{ parameters: Array<{ parameter_name: string; text: string }> }> }).components[0].parameters;
    expect(params.map((p) => p.parameter_name)).toEqual(['link', 'referralCode']);
    await provider.sendTemplateMessage('+919876543210', 'registration_stopped', { firstName: 'Ravi' });
    const second = (calls[1].body.template as { components: Array<{ parameters: Array<{ parameter_name: string; text: string }> }> }).components[0].parameters;
    expect(second).toEqual([
      { type: 'text', text: 'Ravi', parameter_name: 'firstName' },
      { type: 'text', text: '', parameter_name: 'step' },
      { type: 'text', text: '', parameter_name: 'link' },
    ]);
  });

  it('a template with no variables sends no body component', async () => {
    const { provider, calls } = capture();
    await provider.sendTemplateMessage('+919876543210', 'whatsapp_off_shift_reply', { anything: 'x' });
    expect((calls[0].body.template as { components: unknown[] }).components).toEqual([]);
  });
});

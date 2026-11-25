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
    expect(params.map((p) => p.parameter_name)).toEqual(['referral_code', 'link']);
    await provider.sendTemplateMessage('+919876543210', 'registration_stopped', { firstName: 'Ravi' });
    const second = (calls[1].body.template as { components: Array<{ parameters: Array<{ parameter_name: string; text: string }> }> }).components[0].parameters;
    expect(second).toEqual([
      { type: 'text', text: 'Ravi', parameter_name: 'first_name' },
      { type: 'text', text: '', parameter_name: 'step' },
      { type: 'text', text: '', parameter_name: 'link' },
    ]);
  });

  it('a template with no variables sends no body component', async () => {
    const { provider, calls } = capture();
    await provider.sendTemplateMessage('+919876543210', 'whatsapp_off_shift_reply', { anything: 'x' });
    expect((calls[0].body.template as { components: unknown[] }).components).toEqual([]);
  });

  it('rev 211: camelCase keys go to Meta as lowercase_underscore names, language en', async () => {
    const { provider, calls } = capture();
    await provider.sendTemplateMessage('+919876543210', 'joining_date_moved', { candidateFirstName: 'Ravi', joiningDate: '1 Dec 2026' });
    const template = calls[0].body.template as { language: { code: string }; components: Array<{ parameters: Array<{ parameter_name: string; text: string }> }> };
    expect(template.language).toEqual({ code: 'en' });
    expect(template.components[0].parameters.map((p) => p.parameter_name)).toEqual(['candidate_first_name', 'joining_date']);
    await provider.sendTemplateMessage('+919876543210', 'phone_number_changed', { code: 'LB-1', newLast4: '3210' });
    expect((calls[1].body.template as typeof template).components[0].parameters.map((p) => p.parameter_name)).toEqual(['code', 'new_last4']);
  });

  it('rev 211: a code goes with the Authentication template: the code in the body and on the copy-code button', async () => {
    const { provider, calls } = capture();
    const res = await provider.sendTemplateMessage('+919876543210', 'verification_code', { code: '482913', extra: 'x' });
    expect(res.status).toBe('sent');
    expect(calls[0].body.template).toEqual({
      name: 'verification_code',
      language: { code: 'en' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
      ],
    });
  });

  it('rev 211: a refusal carries Meta\'s error code (131026: the number cannot get WhatsApp)', async () => {
    const fetchFn = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Message undeliverable', code: 131026 } }) }));
    const provider = new RealWhatsAppProvider({ apiUrl: 'https://graph.example/v21.0', accessToken: 't', phoneNumberId: '123', fetchFn: fetchFn as unknown as typeof fetch });
    const res = await provider.sendTemplateMessage('+919876543210', 'consent_link', { link: 'https://x' });
    expect(res).toMatchObject({ status: 'failed', errorCode: '131026' });
  });

  it('rev 211: reads the templates\' review state from the business account (WHATSAPP_BUSINESS_ACCOUNT_ID), page by page', async () => {
    const urls: string[] = [];
    const pages = [
      { data: [{ name: 'verification_code', status: 'APPROVED', category: 'AUTHENTICATION' }], paging: { next: 'https://graph.example/v21.0/next-page' } },
      { data: [{ name: 'payment_receipt', status: 'PENDING', category: 'UTILITY' }] },
    ];
    const fetchFn = jest.fn(async (url: string, init: { headers: Record<string, string> }) => {
      urls.push(url);
      expect(init.headers.Authorization).toBe('Bearer t');
      return { ok: true, status: 200, json: async () => pages[urls.length - 1] };
    });
    const provider = new RealWhatsAppProvider({ apiUrl: 'https://graph.example/v21.0', accessToken: 't', phoneNumberId: '123', businessAccountId: 'waba-9', fetchFn: fetchFn as unknown as typeof fetch });
    expect(await provider.templateStatuses()).toEqual([
      { name: 'verification_code', status: 'APPROVED', category: 'AUTHENTICATION' },
      { name: 'payment_receipt', status: 'PENDING', category: 'UTILITY' },
    ]);
    expect(urls).toEqual(['https://graph.example/v21.0/waba-9/message_templates?fields=name,status,category&limit=200', 'https://graph.example/v21.0/next-page']);
    const unset = new RealWhatsAppProvider({ apiUrl: 'https://graph.example/v21.0', accessToken: 't', businessAccountId: '', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(unset.templateStatuses()).rejects.toThrow('WHATSAPP_BUSINESS_ACCOUNT_ID is not set');
  });
});

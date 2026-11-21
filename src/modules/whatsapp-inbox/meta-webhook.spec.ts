import { createHmac } from 'crypto';
import { parseWhatsAppWebhook, verifyChallenge, whatsappSignatureMatches } from './meta-webhook';
import { LeadAgent, pickLeadAgent } from './lead-assignment';
import { agentTemplates, renderTemplate, whatsappTemplate, WHATSAPP_TEMPLATES } from '../message/whatsapp-templates';
import { APPROVED_TEMPLATES } from '../../common/whatsapp/real-whatsapp.provider';

const SECRET = 'whatsapp_app_secret_for_tests_32_chars!';

function envelope(value: Record<string, unknown>) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '918000000000', phone_number_id: '1' }, ...value } }] }] };
}

describe('WhatsApp Cloud API webhook format (rev 202)', () => {
  it('reads an inbound text with the sender name, number and time', () => {
    const parsed = parseWhatsAppWebhook(envelope({
      contacts: [{ profile: { name: 'Ravi Kumar' }, wa_id: '919876543210' }],
      messages: [{ from: '919876543210', id: 'wamid.A1', timestamp: '1795000000', type: 'text', text: { body: 'Hi, I need a job' } }],
    }));
    expect(parsed.messages).toEqual([
      { providerMessageId: 'wamid.A1', waId: '919876543210', phone: '+919876543210', profileName: 'Ravi Kumar', receivedAt: new Date(1795000000 * 1000), kind: 'text', body: 'Hi, I need a job' },
    ]);
    expect(parsed.statuses).toEqual([]);
  });

  it('reads button and list replies as text, and media as a short note (nothing downloaded)', () => {
    const parsed = parseWhatsAppWebhook(envelope({
      messages: [
        { from: '919876543210', id: 'b1', timestamp: '1', type: 'button', button: { text: 'Call me' } },
        { from: '919876543210', id: 'b2', timestamp: '1', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: 'Cook' } } },
        { from: '919876543210', id: 'b3', timestamp: '1', type: 'image', image: { id: 'media1', caption: 'my card' } },
      ],
    }));
    expect(parsed.messages.map((m) => [m.kind, m.body])).toEqual([['text', 'Call me'], ['text', 'Cook'], ['other', '[image] my card']]);
  });

  it('reads delivery statuses and skips anything else', () => {
    const parsed = parseWhatsAppWebhook(envelope({
      statuses: [
        { id: 'wamid.S1', status: 'delivered', timestamp: '1', recipient_id: '919876543210' },
        { id: 'wamid.S2', status: 'deleted', timestamp: '1' },
        { status: 'read' },
      ],
    }));
    expect(parsed.statuses).toEqual([{ providerMessageId: 'wamid.S1', status: 'delivered' }]);
    expect(parseWhatsAppWebhook({ object: 'page', entry: [] })).toEqual({ messages: [], statuses: [] });
    expect(parseWhatsAppWebhook('garbage')).toEqual({ messages: [], statuses: [] });
    expect(parseWhatsAppWebhook(envelope({ messages: [{ id: 'no-sender' }, 'x'] })).messages).toEqual([]);
  });

  it('keeps a non-Indian sender with its own digits and cuts very long text', () => {
    const parsed = parseWhatsAppWebhook(envelope({ messages: [{ from: '447700900123', id: 'u1', timestamp: '1', type: 'text', text: { body: 'x'.repeat(5000) } }] }));
    expect(parsed.messages[0].phone).toBe('+447700900123');
    expect(parsed.messages[0].body).toHaveLength(4096);
  });

  it('checks X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret), failing closed', () => {
    const body = Buffer.from(JSON.stringify(envelope({})));
    const good = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
    expect(whatsappSignatureMatches(body, good, SECRET)).toBe(true);
    expect(whatsappSignatureMatches(body, good.replace(/.$/, '0'), SECRET)).toBe(false);
    expect(whatsappSignatureMatches(body, good.replace('sha256=', ''), SECRET)).toBe(false);
    expect(whatsappSignatureMatches(body, undefined, SECRET)).toBe(false);
    expect(whatsappSignatureMatches(body, good, '')).toBe(false);
    expect(whatsappSignatureMatches(undefined, good, SECRET)).toBe(false);
  });

  it('answers the verification GET only with the right verify token', () => {
    const token = 'verify-token-for-tests-123';
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1158201444' }, token)).toBe('1158201444');
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }, token)).toBeNull();
    expect(verifyChallenge({ 'hub.mode': 'unsubscribe', 'hub.verify_token': token, 'hub.challenge': '1' }, token)).toBeNull();
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }, '')).toBeNull();
  });
});

describe('Who gets a WhatsApp conversation or a partner lead (like missed calls)', () => {
  const agent = (id: string, onShift: boolean, openItems: number, last: string | null = null): LeadAgent => ({
    id, code: `CA-${id}`, teamLeadId: null, onShift, openItems, lastAssignedAt: last ? new Date(last) : null,
  });

  it('the person\'s own agent when on shift', () => {
    expect(pickLeadAgent([agent('a', true, 9), agent('b', true, 0)], ['a'])).toEqual({ staffId: 'a', reason: 'own_agent' });
  });

  it('otherwise the on-shift agent with the fewest open items, then the one given one least recently, then by code', () => {
    expect(pickLeadAgent([agent('a', false, 0), agent('b', true, 3), agent('c', true, 1)], ['a'])).toEqual({ staffId: 'c', reason: 'fair_share' });
    expect(pickLeadAgent([agent('b', true, 1, '2026-12-02T05:00:00Z'), agent('c', true, 1, '2026-12-02T04:00:00Z')], [])).toEqual({ staffId: 'c', reason: 'fair_share' });
    expect(pickLeadAgent([agent('d', true, 0), agent('c', true, 0)], [null, undefined])).toEqual({ staffId: 'c', reason: 'fair_share' });
  });

  it('nobody when nobody is on shift (it waits for the next shift)', () => {
    expect(pickLeadAgent([agent('a', false, 0)], ['a'])).toBeNull();
    expect(pickLeadAgent([], [])).toBeNull();
  });
});

describe('WhatsApp templates as config (English, Meta-approved names)', () => {
  it('every template is on the real provider\'s approved list, so it can actually be sent', () => {
    for (const name of Object.keys(WHATSAPP_TEMPLATES)) expect(APPROVED_TEMPLATES).toContain(name);
  });

  it('declares every variable its text uses, and fills them', () => {
    for (const def of Object.values(WHATSAPP_TEMPLATES)) {
      const used = [...def.text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
      expect([...def.variables].sort()).toEqual(used);
    }
    expect(renderTemplate('registration_stopped', { firstName: 'Ravi', step: 'selfie', link: 'https://x/p/register/t' }))
      .toBe('Hi Ravi, your Laboura registration is waiting at the selfie step. Continue where you stopped: https://x/p/register/t Reply here if you need help.');
    expect(renderTemplate('whatsapp_off_shift_reply')).toBe('Thanks for your message! Our team is away right now. An agent will call you when our next shift starts.');
    expect(renderTemplate('no_such_template')).toBe('');
    expect(whatsappTemplate('nope')).toBeNull();
  });

  it('agents pick only the conversation templates', () => {
    expect(agentTemplates().map((t) => t.name).sort()).toEqual(['whatsapp_follow_up', 'whatsapp_missed_you']);
  });
});

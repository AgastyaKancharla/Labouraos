import { validateWebhookHmac } from '../../common/webhook/webhook-signature';
import { parseIndianMobile } from '../../common/phone/indian-mobile';

/**
 * The WhatsApp Cloud API (Meta) webhook (21 Nov, rev 202).
 *
 * Meta posts `{ object: 'whatsapp_business_account', entry: [{ changes: [{ field:
 * 'messages', value: { metadata, contacts: [{ profile: { name }, wa_id }],
 * messages: [{ from, id, timestamp, type, text: { body } }], statuses: [{ id,
 * status, timestamp, recipient_id }] } }] }] }` and signs the raw body in
 * `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the body with the app secret>`.
 * The endpoint is verified once with a GET carrying `hub.mode=subscribe`,
 * `hub.verify_token` and `hub.challenge` (answered with the challenge).
 */
export interface InboundWhatsAppMessage {
  providerMessageId: string;
  /** +91 and 10 digits for an Indian mobile, otherwise + and the digits Meta gave. */
  phone: string;
  /** The sender as Meta gave it (digits, country code first). */
  waId: string;
  profileName: string | null;
  receivedAt: Date;
  kind: 'text' | 'other';
  /** The text, a button's or list reply's title, or a short note for media ("[image]"). */
  body: string;
}

export interface WhatsAppStatusUpdate {
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface ParsedWhatsAppWebhook {
  messages: InboundWhatsAppMessage[];
  statuses: WhatsAppStatusUpdate[];
}

/** Longest text kept from one message (WhatsApp's own limit is 4096). */
export const MAX_INBOUND_TEXT = 4096;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The text of one message, whatever its type. */
function textOf(message: Obj): { kind: 'text' | 'other'; body: string } {
  const type = str(message.type);
  if (type === 'text' && isObj(message.text)) return { kind: 'text', body: str(message.text.body) };
  if (type === 'button' && isObj(message.button)) return { kind: 'text', body: str(message.button.text) };
  if (type === 'interactive' && isObj(message.interactive)) {
    const reply = isObj(message.interactive.button_reply) ? message.interactive.button_reply : isObj(message.interactive.list_reply) ? message.interactive.list_reply : null;
    if (reply) return { kind: 'text', body: str(reply.title) };
  }
  // Media, location, contacts…: nothing is downloaded; the agent sees that something came.
  const caption = isObj(message[type]) ? str((message[type] as Obj).caption) : '';
  return { kind: 'other', body: `[${type || 'message'}]${caption ? ` ${caption}` : ''}` };
}

/** Reads a Cloud API webhook body. Anything unexpected is skipped, never thrown. */
export function parseWhatsAppWebhook(payload: unknown): ParsedWhatsAppWebhook {
  const out: ParsedWhatsAppWebhook = { messages: [], statuses: [] };
  if (!isObj(payload) || payload.object !== 'whatsapp_business_account') return out;
  for (const entry of arr(payload.entry)) {
    if (!isObj(entry)) continue;
    for (const change of arr(entry.changes)) {
      if (!isObj(change) || change.field !== 'messages' || !isObj(change.value)) continue;
      const value = change.value;
      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        if (isObj(c) && isObj(c.profile)) names.set(str(c.wa_id), str(c.profile.name));
      }
      for (const m of arr(value.messages)) {
        if (!isObj(m)) continue;
        const id = str(m.id);
        const from = str(m.from);
        if (!id || !from) continue;
        const seconds = Number(str(m.timestamp));
        const { kind, body } = textOf(m);
        out.messages.push({
          providerMessageId: id,
          waId: from,
          phone: parseIndianMobile(from) ?? `+${from.replace(/\D/g, '')}`,
          profileName: names.get(from)?.slice(0, 100) || null,
          receivedAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
          kind,
          body: body.slice(0, MAX_INBOUND_TEXT),
        });
      }
      for (const s of arr(value.statuses)) {
        if (!isObj(s)) continue;
        const id = str(s.id);
        const status = str(s.status);
        if (id && (status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed')) {
          out.statuses.push({ providerMessageId: id, status });
        }
      }
    }
  }
  return out;
}

/** The app secret Meta signs with (WHATSAPP_APP_SECRET). Fails closed when unset. */
export function whatsappSignatureMatches(rawBody: Buffer | undefined, signature: string | undefined, secret = process.env.WHATSAPP_APP_SECRET ?? ''): boolean {
  if (!signature || !/^sha256=/i.test(signature.trim())) return false;
  return validateWebhookHmac(rawBody, signature, secret).isValid;
}

/** The GET Meta sends once to check the endpoint: the challenge back when the token matches, else null. */
export function verifyChallenge(query: Record<string, unknown>, token = process.env.WHATSAPP_VERIFY_TOKEN ?? ''): string | null {
  const mode = str(query['hub.mode']);
  const given = str(query['hub.verify_token']);
  const challenge = str(query['hub.challenge']);
  if (mode !== 'subscribe' || !token || token.length < 16 || given !== token || !challenge) return null;
  return challenge;
}

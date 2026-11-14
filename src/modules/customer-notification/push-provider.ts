import { Logger } from '@nestjs/common';

/**
 * Sending customer app pushes. Bound through NestJS DI like every other
 * vendor (AGENTS.md section 3): CUSTOMER_PUSH_PROVIDER_MODE = mock (default,
 * logs instead of sending; tests and the test setup) or real (Expo's push
 * service, which hands Android pushes to Google FCM and iPhone pushes to
 * Apple APNs). EXPO_ACCESS_TOKEN is optional: set it only if "enhanced push
 * security" is switched on in the Expo account.
 */
export const CUSTOMER_PUSH_PROVIDER = 'CUSTOMER_PUSH_PROVIDER';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  /** Android channel id (service, job-updates, promotions). */
  channelId: string;
  priority: 'high' | 'normal';
  sound: 'default' | null;
}

export type PushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; error?: string };

export type PushReceipt =
  | { status: 'ok' }
  | { status: 'error'; message: string; error?: string };

export interface CustomerPushProvider {
  readonly mode: 'mock' | 'real';
  /** One ticket per message, in the same order. Throws only when the whole request failed. */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  /** Receipts for ticket ids; ids Expo has not processed yet are absent. */
  getReceipts(ids: string[]): Promise<Record<string, PushReceipt>>;
}

/** Expo's per-request limits. */
export const EXPO_SEND_BATCH = 100;
export const EXPO_RECEIPT_BATCH = 1000;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Logs each push instead of sending it (never the token in full, never the
 * text: the log is not the place for a customer's messages). Every ticket is
 * ok, except a token containing "DeviceNotRegistered", which answers like
 * Expo does for an uninstalled app, so the clean-up path can be exercised on
 * the test setup.
 */
export class MockCustomerPushProvider implements CustomerPushProvider {
  readonly mode = 'mock' as const;
  private readonly logger = new Logger('MockCustomerPush');
  private counter = 0;
  /** Every message "sent" (tests read it). */
  readonly sent: PushMessage[] = [];

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    return messages.map((message) => {
      this.sent.push(message);
      if (message.to.includes('DeviceNotRegistered')) {
        return { status: 'error', message: 'The recipient device is not registered with FCM.', error: 'DeviceNotRegistered' };
      }
      this.counter += 1;
      const id = `mock-ticket-${Date.now()}-${this.counter}`;
      this.logger.log(`push (mock) to …${message.to.slice(-6)} channel=${message.channelId} ticket=${id}`);
      return { status: 'ok', id };
    });
  }

  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ids.map((id) => [id, { status: 'ok' as const }]));
  }
}

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const EXPO_TIMEOUT_MS = 15_000;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface ExpoTicketJson {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/). */
export class ExpoCustomerPushProvider implements CustomerPushProvider {
  readonly mode = 'real' as const;

  constructor(
    private readonly accessToken: string | undefined = process.env.EXPO_ACCESS_TOKEN || undefined,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    return headers;
  }

  private async post(url: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXPO_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Expo push service answered HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (const batch of chunk(messages, EXPO_SEND_BATCH)) {
      const json = (await this.post(
        EXPO_SEND_URL,
        batch.map((m) => ({
          to: m.to,
          title: m.title,
          body: m.body,
          data: m.data,
          channelId: m.channelId,
          priority: m.priority,
          sound: m.sound ?? undefined,
        })),
      )) as { data?: ExpoTicketJson[]; errors?: { message?: string }[] };
      if (!Array.isArray(json?.data) || json.data.length !== batch.length) {
        const reason = json?.errors?.[0]?.message ?? 'unexpected answer';
        throw new Error(`Expo push service refused the batch: ${reason}`);
      }
      for (const ticket of json.data) {
        if (ticket.status === 'ok' && typeof ticket.id === 'string') {
          tickets.push({ status: 'ok', id: ticket.id });
        } else {
          tickets.push({ status: 'error', message: ticket.message ?? 'error', error: ticket.details?.error });
        }
      }
    }
    return tickets;
  }

  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    const out: Record<string, PushReceipt> = {};
    for (const batch of chunk(ids, EXPO_RECEIPT_BATCH)) {
      const json = (await this.post(EXPO_RECEIPTS_URL, { ids: batch })) as { data?: Record<string, ExpoTicketJson> };
      for (const [id, receipt] of Object.entries(json?.data ?? {})) {
        out[id] =
          receipt.status === 'ok'
            ? { status: 'ok' }
            : { status: 'error', message: receipt.message ?? 'error', error: receipt.details?.error };
      }
    }
    return out;
  }
}

/** CUSTOMER_PUSH_PROVIDER_MODE: mock (default) or real (also accepted: expo). */
export function createCustomerPushProvider(env: NodeJS.ProcessEnv = process.env): CustomerPushProvider {
  const raw = env.CUSTOMER_PUSH_PROVIDER_MODE;
  const mode = raw && raw !== 'undefined' ? raw.trim().toLowerCase() : 'mock';
  if (mode === 'mock') return new MockCustomerPushProvider();
  if (mode === 'real' || mode === 'expo') return new ExpoCustomerPushProvider(env.EXPO_ACCESS_TOKEN || undefined);
  throw new Error(`Unsupported customer push provider: ${raw}`);
}

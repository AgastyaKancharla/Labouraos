/**
 * The notification routes of the customer API (docs/customer-app-api.md,
 * section 9), on the app's own HTTP client. Kept in Agent C's folder so the
 * app's CustomerApi (Agent B) is not edited. In pretend-data mode
 * (EXPO_PUBLIC_API_MODE=mock) a small in-memory inbox answers instead.
 */
import { httpClient, type ApiClient } from '@/api';
import { apiMode } from '@/api/config';

export type NotificationCategory = 'service' | 'job_updates' | 'promotions';

export interface InboxMessage {
  id: string;
  profileId: string | null;
  kind: string;
  category: NotificationCategory;
  priority: 'normal' | 'urgent';
  title: string;
  body: string;
  deepLink: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface InboxPage {
  items: InboxMessage[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface NotificationSettings {
  service: boolean;
  jobUpdates: boolean;
  promotions: boolean;
  quietStart: string;
  quietEnd: string;
  dailyCap: number;
  serviceLocked: boolean;
}

export interface DeviceReport {
  installationId: string;
  platform: string;
  appVersion: string;
  pushToken: string | null;
  pushPermission: 'granted' | 'denied' | 'undetermined';
}

export interface PushApi {
  inbox(cursor?: string | null, limit?: number): Promise<InboxPage>;
  markRead(messageId: string): Promise<void>;
  markAllRead(): Promise<void>;
  putDevice(report: DeviceReport): Promise<void>;
  removePushToken(): Promise<void>;
  settings(): Promise<NotificationSettings>;
  updateSettings(change: Partial<Pick<NotificationSettings, 'service' | 'jobUpdates' | 'promotions'>>): Promise<NotificationSettings>;
}

export function livePushApi(client: ApiClient): PushApi {
  return {
    inbox: (cursor, limit = 20) => client.get<InboxPage>('/me/inbox', { query: { cursor: cursor ?? undefined, limit } }),
    markRead: async (id) => {
      await client.post(`/me/inbox/${encodeURIComponent(id)}/read`);
    },
    markAllRead: async () => {
      await client.post('/me/inbox/read-all');
    },
    putDevice: async (report) => {
      await client.put('/me/device', report);
    },
    removePushToken: async () => {
      await client.delete('/me/device/push-token');
    },
    settings: () => client.get<NotificationSettings>('/me/notification-settings'),
    updateSettings: (change) => client.put<NotificationSettings>('/me/notification-settings', change),
  };
}

/** Pretend data: two messages, settings kept in memory. */
export function mockPushApi(): PushApi {
  const now = Date.now();
  const items: InboxMessage[] = [
    {
      id: 'm-2', profileId: null, kind: 'interview_booked', category: 'service', priority: 'urgent',
      title: 'You have an interview offer', body: 'Reply within 48 hours. Open Laboura for the details.',
      deepLink: '/home', data: {}, createdAt: new Date(now - 3_600_000).toISOString(), readAt: null,
    },
    {
      id: 'm-1', profileId: null, kind: 'payment_confirmed', category: 'service', priority: 'normal',
      title: 'Payment received', body: 'Your 30-day guarantee has started. Your receipt is in Laboura.',
      deepLink: '/home', data: {}, createdAt: new Date(now - 86_400_000).toISOString(), readAt: new Date(now - 80_000_000).toISOString(),
    },
  ];
  let settings: NotificationSettings = { service: true, jobUpdates: true, promotions: false, quietStart: '21:00', quietEnd: '09:00', dailyCap: 3, serviceLocked: true };
  return {
    inbox: async () => ({ items: items.map((m) => ({ ...m })), nextCursor: null, unreadCount: items.filter((m) => !m.readAt).length }),
    markRead: async (id) => {
      const m = items.find((x) => x.id === id);
      if (m && !m.readAt) m.readAt = new Date().toISOString();
    },
    markAllRead: async () => {
      for (const m of items) m.readAt ??= new Date().toISOString();
    },
    putDevice: async () => undefined,
    removePushToken: async () => undefined,
    settings: async () => ({ ...settings }),
    updateSettings: async (change) => {
      settings = { ...settings, ...change };
      return { ...settings };
    },
  };
}

let defaultApi: PushApi | null = null;

/** The app's push API (live, or pretend data in mock mode). Tests pass their own. */
export function defaultPushApi(): PushApi {
  defaultApi ??= apiMode() === 'mock' ? mockPushApi() : livePushApi(httpClient);
  return defaultApi;
}

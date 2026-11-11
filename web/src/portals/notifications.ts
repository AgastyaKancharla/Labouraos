import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionStore } from '../auth/session';
import { useT } from '../i18n/I18nProvider';
import { api } from '../lib/api/client';
import { formatDateTimeIST } from '../lib/format/date';
import type { PortalKey } from './index';

/**
 * Items for the notification bell in the top bar (designs: "Notifications ·
 * 8 new" popover), from `GET /notifications/bell` (Phase 21 Task 6). Every
 * portal's bell fills in from here; it refreshes every 30 seconds. Each item
 * links to the screen where its work is done; done items show struck through
 * with who did them.
 */
export interface NotificationItem {
  id: string;
  title: string;
  detail?: string;
  /** "Money · 2 days" */
  meta?: string;
  /** In-app path to open. */
  to?: string;
  /** 'open' items count toward the badge; 'cleared' ones show struck through. */
  state: 'open' | 'cleared';
}

/** One notification as the API sends it. */
export interface ApiNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  subjectType: string;
  subjectId: string;
  status: 'open' | 'cleared';
  seen: boolean;
  createdAt: string;
  seenAt: string | null;
  clearedAt: string | null;
  clearedReason: string | null;
  clearedBy: { id: string; code: string; name: string; role: string } | null;
}

export interface NotificationBellData {
  openCount: number;
  unseenCount: number;
  latest: ApiNotification[];
  doneToday: ApiNotification[];
  asOf: string;
}

export const NOTIFICATIONS_POLL_MS = 30_000;
export const notificationKeys = {
  all: ['notifications'] as const,
  bell: ['notifications', 'bell'] as const,
};

export function toBellItems(data: NotificationBellData | undefined, doneBy: (name: string) => string): NotificationItem[] {
  if (!data) return [];
  const open = data.latest.map<NotificationItem>((n) => ({
    id: n.id,
    title: n.title,
    detail: n.body ?? undefined,
    meta: formatDateTimeIST(n.createdAt),
    to: n.link ?? undefined,
    state: 'open',
  }));
  const done = data.doneToday.map<NotificationItem>((n) => ({
    id: n.id,
    title: n.title,
    detail: n.clearedBy ? doneBy(n.clearedBy.name) : (n.body ?? undefined),
    meta: n.clearedAt ? formatDateTimeIST(n.clearedAt) : undefined,
    to: n.link ?? undefined,
    state: 'cleared',
  }));
  return [...open, ...done];
}

export function usePortalNotifications(portal: PortalKey): {
  items: NotificationItem[];
  count: number;
  onOpen?: () => void;
} {
  const t = useT();
  const queryClient = useQueryClient();
  const signedIn = sessionStore.token() !== null;
  const enabled = portal !== 'public' && signedIn;
  const bell = useQuery({
    queryKey: notificationKeys.bell,
    queryFn: () => api.get<NotificationBellData>('/notifications/bell'),
    enabled,
    refetchInterval: NOTIFICATIONS_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const seen = useMutation({
    mutationFn: () => api.post<{ seen: number; cleared: number }>('/notifications/seen'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
  const { mutate } = seen;
  const unseen = bell.data?.unseenCount ?? 0;
  const onOpen = useCallback(() => {
    if (unseen > 0) mutate();
  }, [unseen, mutate]);
  return {
    items: toBellItems(bell.data, (name) => t('common.notificationDoneBy', { name })),
    count: bell.data?.openCount ?? 0,
    onOpen: enabled ? onOpen : undefined,
  };
}

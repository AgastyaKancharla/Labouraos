import type { PortalKey } from './index';

/**
 * Items for the notification bell in the top bar (designs: "Notifications ·
 * 8 new" popover). There is no notifications endpoint yet; when one exists,
 * fetch it here with TanStack Query and every screen's bell fills in.
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

export function usePortalNotifications(_portal: PortalKey): { items: NotificationItem[]; count: number } {
  return { items: [], count: 0 };
}

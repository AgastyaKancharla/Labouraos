/**
 * Where a tap on a notification (or an inbox row) goes. The server sends the
 * event `kind`, a `deepLink` (/home, /inbox, /settings) and the `profileId`
 * the message is about (docs/customer-app-api.md section 9). Only screens in
 * this list can be opened: a push can never send the app to an arbitrary
 * address.
 */
import { routes } from '@/navigation/routes';

export interface NotificationTarget {
  route: string;
  /** Switch Home to this profile first (one account can hold several). */
  profileId: string | null;
}

/** Server deepLink → app route. */
const ALLOWED: Record<string, string> = {
  '/home': routes.home,
  '/inbox': routes.inbox,
  '/settings': routes.settings,
  '/help': routes.help,
};

/** Event kind → route, for messages that carry no (or an unknown) deepLink. */
const BY_KIND: Record<string, string> = {
  promotion: routes.inbox,
  vacancy_confirmed: routes.home,
  visit_booked: routes.home,
  interview_booked: routes.home,
  payment_confirmed: routes.home,
  fee_paid: routes.home,
  refund_approved: routes.home,
  refund_paid: routes.home,
  payout_approved: routes.home,
  payout_paid: routes.home,
  signup_reminder: routes.home,
};

export function targetFor(data: Record<string, unknown> | null | undefined): NotificationTarget {
  const deepLink = typeof data?.deepLink === 'string' ? data.deepLink : null;
  const kind = typeof data?.kind === 'string' ? data.kind : null;
  const profileId = typeof data?.profileId === 'string' && data.profileId ? data.profileId : null;
  const route = (deepLink && ALLOWED[deepLink]) || (kind && BY_KIND[kind]) || routes.inbox;
  return { route, profileId };
}

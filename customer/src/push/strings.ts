/**
 * Words of the push and inbox screens. English is the source; the other
 * languages are in src/i18n/locales (28 Nov). The notification texts
 * themselves come from the server, in English.
 */
import type { Language } from '@/i18n';
import { hiPush } from '@/i18n/locales/hi';
import { knPush } from '@/i18n/locales/kn';
import { mlPush } from '@/i18n/locales/ml';
import { taPush } from '@/i18n/locales/ta';
import { tePush } from '@/i18n/locales/te';

const en = {
  'inbox.title': 'Messages',
  'inbox.empty': 'No messages yet. Updates about your sign-up, payments and interviews will appear here.',
  'inbox.markAll': 'Mark all as read',
  'inbox.unread': '{count} unread',
  'inbox.new': 'New',
  'inbox.loadMore': 'Show older messages',
  'inbox.urgent': 'Urgent',
  'settings.title': 'Notification settings',
  'settings.service': 'Service updates',
  'settings.serviceHelp': 'Payments, interviews, offers and your status.',
  'settings.serviceLocked': 'Cannot be turned off while your guarantee is running, so that you never miss an offer.',
  'settings.jobUpdates': 'Job updates',
  'settings.jobUpdatesHelp': 'New jobs that suit you.',
  'settings.promotions': 'Offers and promotions',
  'settings.promotionsHelp': 'Only if you want them. You can turn this off any time.',
  'settings.quiet': 'Notifications between 9 PM and 9 AM wait until 9 AM, except sign-in codes and receipts for something you just did. At most 3 a day.',
  'settings.saveError': 'Could not save. Please try again.',
  'prompt.title': 'Get updates from Laboura',
  'prompt.body': 'We will tell you when your payment is received, when you get an interview offer and when your status changes. Between 9 PM and 9 AM, notifications wait until 9 AM, except sign-in codes and receipts for something you just did.',
  'prompt.allow': 'Allow notifications',
  'prompt.later': 'Not now',
  'channel.service': 'Service updates',
  'channel.jobUpdates': 'Job updates',
  'channel.promotions': 'Offers and promotions',
} as const;

export type PushKey = keyof typeof en;

export const PUSH_STRINGS: { en: Record<PushKey, string> } & Record<Exclude<Language, 'en'>, Partial<Record<PushKey, string>>> = { en, kn: knPush, hi: hiPush, te: tePush, ta: taPush, ml: mlPush };

export function pushText(language: Language, key: PushKey, params?: Record<string, string | number>): string {
  const template = PUSH_STRINGS[language]?.[key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

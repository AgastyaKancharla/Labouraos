import type { Language } from '../../../i18n/I18nProvider';
import { formatINR } from '../../../lib/format/money';

/**
 * Dates and money on the phone pages, in the reader's language and always
 * in India time (the API sends UTC). Money arrives as integer paise and is
 * shown in rupees.
 */
const LOCALE: Record<Language, string> = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN' };
const TZ = 'Asia/Kolkata';

function fmt(value: string | Date, language: Language, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(LOCALE[language], { timeZone: TZ, ...options }).format(new Date(value));
}

/** "Tue 10 Nov" */
export function dayLabel(value: string | Date, language: Language): string {
  return fmt(value, language, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "9 Dec" */
export function shortDate(value: string | Date, language: Language): string {
  return fmt(value, language, { day: 'numeric', month: 'short' });
}

/** "10:30 AM" */
export function timeLabel(value: string | Date, language: Language): string {
  const text = fmt(value, language, { hour: 'numeric', minute: '2-digit', hour12: true });
  return language === 'en' ? text.replace(/\b(am|pm)\b/, (m) => m.toUpperCase()) : text;
}

/** "9 Nov, 11:20 AM" */
export function dateTimeLabel(value: string | Date, language: Language): string {
  return `${shortDate(value, language)}, ${timeLabel(value, language)}`;
}

/** "Thu 12 Nov, 10:15 AM" */
export function dayTimeLabel(value: string | Date, language: Language): string {
  return `${dayLabel(value, language)}, ${timeLabel(value, language)}`;
}

export function rupees(paise: number): string {
  return formatINR(paise);
}

/** "₹16,000–18,000" (one ₹ sign) or "₹16,000" when both ends match. */
export function rupeeRange(minPaise: number | null, maxPaise: number | null): string {
  if (minPaise === null) return '';
  if (maxPaise === null || maxPaise === minPaise) return formatINR(minPaise);
  return `${formatINR(minPaise)}–${formatINR(maxPaise).replace('₹', '')}`;
}

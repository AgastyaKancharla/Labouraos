import type { Translate } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { formatDayMonthIST, istDateKey } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import type { WorkItem } from './api';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** "6 PM", "11:30 AM" in IST. */
export function time12(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "09:00" → "9 AM". */
export function clock12(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "Today 6:15 PM", "Tomorrow 10 AM", "12 Nov 10 AM". */
export function whenLabel(iso: string, now: Date, t: Translate): string {
  const key = istDateKey(iso);
  const today = istDateKey(now);
  const tomorrow = istDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const day = key === today ? t('ca.today') : key === tomorrow ? t('ca.tomorrow') : formatDayMonthIST(iso);
  return `${day} ${time12(iso)}`;
}

/** "1h 48m", "12m". */
export function durationHM(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return m === 0 ? `${h}h` : `${h}h ${m}m`;
  return `${m}m`;
}

/** "03:12" */
export function stopwatch(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function salaryRange(minPaise: number, maxPaise: number): string {
  return minPaise === maxPaise ? formatINR(minPaise) : `${formatINR(minPaise)}–${formatINR(maxPaise).replace('₹', '')}`;
}

const FOLLOW_UP_KINDS = [
  'not_selected_day_7',
  'not_selected_day_30',
  'not_selected_day_90',
  'placement_check_in_day_7',
  'placement_check_in_day_30',
  'refund_check',
  'exit_call',
] as const;

export function followUpKindLabel(kind: string, t: Translate): string {
  return (FOLLOW_UP_KINDS as readonly string[]).includes(kind) ? t(`ca.fu.${kind}` as MessageKey) : kind;
}

export type Tone = 'tr' | 'ta' | 'tc' | 'tb' | 'tn' | 'tg' | 'tt';

/** The coloured tag on a work-list row (CA03 design). */
export function reasonTag(item: WorkItem, t: Translate, now: Date): { text: string; tone: Tone } {
  const d = item.detail;
  if (item.priority && item.guaranteeDay && item.guaranteeDays && item.kind === 'close_to_refund') {
    return { text: t('ca.reason.day', { day: item.guaranteeDay, days: item.guaranteeDays }), tone: 'tr' };
  }
  switch (item.kind) {
    case 'close_to_refund':
      return { text: t('ca.reason.day', { day: item.guaranteeDay ?? 0, days: item.guaranteeDays ?? 30 }), tone: 'tr' };
    case 'callback':
      return { text: t('ca.reason.callback', { time: time12(item.dueAt) }), tone: 'tc' };
    case 'missed_call':
      return { text: t('ca.reason.missedCall', { time: time12(item.dueAt) }), tone: 'tc' };
    case 'retry':
      return { text: t('ca.reason.retry', { time: whenLabel(item.dueAt, now, t) }), tone: 'tn' };
    case 'offer_reply':
      return { text: t('ca.reason.offerReply', { time: time12(String(d.replyDueAt)) }), tone: 'ta' };
    case 'interview_today':
      return { text: t('ca.reason.interviewToday', { time: time12(String(d.slotStartsAt)) }), tone: 'ta' };
    case 'refund_check':
      return { text: t('ca.reason.refundCheck'), tone: 'tt' };
    case 'follow_up':
      return { text: t('ca.reason.followUp', { kind: followUpKindLabel(String(d.followUpKind ?? ''), t) }), tone: 'tb' };
    case 'stuck_registration':
      return { text: stuckLabel(String(d.step ?? ''), Number(d.failures ?? 0), t), tone: 'tn' };
    case 'win_back':
      return { text: t('ca.reason.winBack'), tone: 'tg' };
    default:
      return { text: item.kind, tone: 'tn' };
  }
}

const STUCK_STEPS = ['consent', 'selfie', 'id_check', 'id_team_lead_check', 'trade_pending', 'payment', 'payment_failed'] as const;

export function stuckLabel(step: string, failures: number, t: Translate): string {
  if (!(STUCK_STEPS as readonly string[]).includes(step)) return step;
  return t(`ca.stuck.${step}` as MessageKey, { count: failures });
}

export function lockedLabel(item: WorkItem, t: Translate, now: Date, callingHours?: { start: string; end: string }): string | null {
  switch (item.lockedReason) {
    case null:
      return null;
    case 'outside_calling_hours':
      return t('ca.locked.outside_calling_hours', { start: clock12(callingHours?.start ?? '09:00'), end: clock12(callingHours?.end ?? '21:00') });
    case 'outside_his_window':
      return t('ca.locked.outside_his_window', {
        start: clock12(String(item.detail.windowStart ?? '09:00')),
        end: clock12(String(item.detail.windowEnd ?? '21:00')),
      });
    case 'due_later':
      return t('ca.locked.due_later', { time: whenLabel(item.dueAt, now, t) });
    case 'no_call_consent':
      return t('ca.locked.no_call_consent');
    case 'no_matching_consent':
      return t('ca.locked.no_matching_consent');
    default:
      return item.lockedReason;
  }
}

/** Where a person opens: the one profile route, by their ID. */
export function personRef(item: { code: string | null; subjectId: string }): string {
  return item.code ?? item.subjectId;
}

/** "Why he is on your list: …" (CA04). */
export function whyText(item: WorkItem, t: Translate): string {
  const d = item.detail;
  switch (item.kind) {
    case 'close_to_refund':
      return t('ca.why.close_to_refund', { day: item.guaranteeDay ?? 0, days: item.guaranteeDays ?? 30 });
    case 'callback':
      return t('ca.why.callback', { time: time12(item.dueAt) });
    case 'missed_call':
      return t('ca.why.missed_call', { time: time12(item.dueAt) });
    case 'retry':
      return t('ca.why.retry');
    case 'refund_check':
      return t('ca.why.refund_check');
    case 'follow_up':
      return d.businessName
        ? t('ca.why.follow_up', { business: String(d.businessName), kind: followUpKindLabel(String(d.followUpKind), t) })
        : t('ca.why.follow_up_plain', { kind: followUpKindLabel(String(d.followUpKind), t) });
    case 'offer_reply':
      return t('ca.why.offer_reply', { time: time12(String(d.replyDueAt)) });
    case 'interview_today':
      return t('ca.why.interview_today', { time: time12(String(d.slotStartsAt)) });
    case 'stuck_registration':
      return t('ca.why.stuck_registration');
    case 'win_back':
      return t('ca.why.win_back');
    default:
      return '';
  }
}


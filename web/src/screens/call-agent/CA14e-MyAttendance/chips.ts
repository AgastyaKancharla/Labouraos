import type { AttendanceDayRow, MyRequest } from '../../../attendance/api';
import { dateRange, dayLabel, hhmm, span } from '../../../attendance/format';
import type { Translate } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';

/** Tag colour classes of the CA14 designs (.tg green, .ta amber, .tc cyan, .tr crit, .tb blue, .tn grey, .tt tomato). */
export type TagTone = 'tg' | 'ta' | 'tc' | 'tr' | 'tb' | 'tn' | 'tt';

export interface Chip {
  key: MessageKey;
  vars?: Record<string, string | number>;
  tone: TagTone;
}

/** "Counts as" for one day: the day type, plus late / short / make-up where they apply. */
export function dayChips(day: AttendanceDayRow): Chip[] {
  const extras: Chip[] = [];
  if (day.lateMinutes > 0 && day.dayType !== 'leave' && day.dayType !== 'absent') extras.push({ key: 'att.day.late', vars: { minutes: day.lateMinutes }, tone: 'ta' });
  if (day.shortfallSeconds > 0 && day.dayType !== 'open') extras.push({ key: 'att.day.short', vars: { time: span(day.shortfallSeconds) }, tone: 'ta' });
  if (day.makeUpSeconds > 0) extras.push({ key: 'att.day.makeUp', vars: { time: span(day.makeUpSeconds) }, tone: 'tg' });
  if (day.change) extras.push({ key: 'att.day.changed', tone: 'tn' });
  switch (day.dayType) {
    case 'open':
      return [{ key: 'att.day.today', tone: 'tb' }, ...extras.filter((c) => c.key === 'att.day.late')];
    case 'full': {
      // As in the design: a late or short full day reads "Late · 40m short"; a clean one "Full day · +40m make-up".
      const warned = extras.filter((c) => c.tone === 'ta');
      return warned.length ? [...warned, ...extras.filter((c) => c.tone !== 'ta')] : [{ key: 'att.day.full', tone: 'tg' }, ...extras];
    }
    case 'half':
      return [{ key: 'att.day.half', tone: 'tr' }, ...extras];
    case 'absent':
      return [{ key: 'att.day.absent', tone: 'tt' }];
    case 'leave':
      if (day.leaveUnpaid) return [{ key: 'att.day.unpaid', tone: 'tn' }];
      return [{ key: day.leaveKind === 'emergency' ? 'att.day.emergency' : 'att.day.casual', tone: 'tc' }];
    case 'off':
      return [{ key: 'att.day.off', tone: 'tn' }, ...extras];
    default:
      return [{ key: 'att.day.open', tone: 'tn' }, ...extras];
  }
}

/** Where a request is, or who decided it ("Waiting for your Team Lead", "Approved by Ravi"). */
export function requestChip(r: MyRequest): Chip {
  if (r.status === 'pending') {
    if (r.where === 'with_manager') return { key: 'att.req.withManager', tone: 'ta' };
    if (r.where === 'with_ceo') return { key: 'att.req.withCeo', tone: 'ta' };
    return { key: 'att.req.withTeamLead', tone: 'ta' };
  }
  const by = r.decided?.by?.name?.split(/\s+/)[0] ?? '';
  if (r.status === 'approved') {
    if (r.kind === 'leave' && r.approvedDays && r.days && r.approvedDays < r.days) return { key: 'att.req.approvedPart', vars: { approved: r.approvedDays, days: r.days }, tone: 'tg' };
    return by ? { key: 'att.req.approvedBy', vars: { name: by }, tone: 'tg' } : { key: 'att.req.approved', tone: 'tg' };
  }
  return by ? { key: 'att.req.rejectedBy', vars: { name: by }, tone: 'tt' } : { key: 'att.req.rejected', tone: 'tt' };
}

/** "Emergency leave · Fri 13 Nov", "Correction · Fri 6 Nov, 9:30–9:52". */
export function requestTitle(t: Translate, r: MyRequest): string {
  if (r.kind === 'correction') {
    return t('att.req.correction', { date: r.date ? dayLabel(r.date) : '', from: r.startAt ? hhmm(r.startAt) : '', to: r.endAt ? hhmm(r.endAt) : '' });
  }
  const dates = r.fromDate ? dateRange(r.fromDate, r.toDate) : '';
  return t(r.leaveKind === 'emergency' ? 'att.req.emergency' : 'att.req.casual', { dates });
}

/** Days the person was expected to work so far: worked, half, absent or today (not leave or days off). */
export function expectedDays(days: AttendanceDayRow[]): number {
  return days.filter((d) => d.dayType === 'full' || d.dayType === 'half' || d.dayType === 'absent' || d.dayType === 'open').length;
}

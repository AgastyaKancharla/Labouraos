import { BadRequestException } from '@nestjs/common';

/**
 * Small, pure helpers shared by the CEO portal read endpoints. Everything
 * here is deterministic (time is always passed in) so it is unit-tested
 * without a database.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** A payment counts as received only once the bank or gateway confirmed it. */
export const RECEIVED_STATUSES = ['succeeded', 'completed'];
/** Money going out that is owed but not yet paid. */
export const PAYOUT_DUE_STATUSES = ['pending', 'approved', 'processing'];
export const PAYOUT_TYPES = ['referral_payout', 'joining_reward'];
export const REFUND_TYPES = ['refund', 'duplicate_refund'];

export interface DateRange {
  from: Date;
  to: Date;
}

export interface PageRequest {
  page: number;
  pageSize: number;
  skip: number;
}

export interface Paged<Row, Summary = unknown> {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  summary: Summary;
}

/** The IST calendar day (yyyy-mm-dd) an instant falls on. */
export function istDayKey(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 IST of the given day key, as a UTC instant. */
export function istStartOfDay(dayKey: string): Date {
  return new Date(new Date(`${dayKey}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

/** 00:00 IST on the 1st of the month `date` falls in. */
export function istStartOfMonth(date: Date): Date {
  return istStartOfDay(`${istDayKey(date).slice(0, 8)}01`);
}

function parseInstant(value: unknown, name: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be a date`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${name} must be a valid date`);
  return date;
}

/**
 * The period a CEO screen asks about. Defaults to this month so far (IST),
 * matching the screens' default "This month".
 */
export function parseRange(fromValue: unknown, toValue: unknown, now: Date): DateRange {
  const from = parseInstant(fromValue, 'fromDate') ?? istStartOfMonth(now);
  const to = parseInstant(toValue, 'toDate') ?? now;
  if (from.getTime() > to.getTime()) throw new BadRequestException('fromDate must be before toDate');
  return { from, to };
}

/** An optional period for list screens: no dates means "any date". */
export function parseOptionalRange(fromValue: unknown, toValue: unknown): Partial<DateRange> {
  const from = parseInstant(fromValue, 'fromDate');
  const to = parseInstant(toValue, 'toDate');
  if (from && to && from.getTime() > to.getTime()) throw new BadRequestException('fromDate must be before toDate');
  return { from, to };
}

export const MAX_PAGE_SIZE = 5000;

/** page is 1-based; pageSize up to 5,000 rows so a download gets the whole filtered list. */
export function parsePage(pageValue: unknown, pageSizeValue: unknown, defaultSize = 25): PageRequest {
  const page = Math.max(1, Math.floor(Number(pageValue) || 1));
  const rawSize = Math.floor(Number(pageSizeValue) || defaultSize);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function dateFilter(range: Partial<DateRange>): { gte?: Date; lte?: Date } | undefined {
  if (!range.from && !range.to) return undefined;
  return { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) };
}

export function inRange(value: Date | null | undefined, range: Partial<DateRange>): boolean {
  if (!value) return false;
  const t = value.getTime();
  if (range.from && t < range.from.getTime()) return false;
  if (range.to && t > range.to.getTime()) return false;
  return true;
}

/** The period of the same length just before this one (for "↑ 18% vs last month"). */
export function previousRange(range: DateRange): DateRange {
  const length = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - length - 1), to: new Date(range.from.getTime() - 1) };
}

/** Whole percent, never NaN. */
export function percent(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part * 100) / whole);
}

/** Change from `before` to `now` in whole percent; null when there is nothing to compare with. */
export function changePercent(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) * 100) / Math.abs(before));
}

export function sumPaise(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isInteger(v)) throw new TypeError(`amount must be integer paise; got ${v}`);
    total += v;
  }
  return total;
}

/** Whole days between two instants, rounded down, never negative. */
export function daysSince(start: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / DAY_MS));
}

/**
 * Days left until `start + windowDays`. Rounded up, so a deadline later today
 * is "0 days left" only once it is under a day away, matching "2 days left".
 * Negative once the deadline has passed.
 */
export function daysLeft(start: Date, windowDays: number, now: Date): number {
  const deadline = start.getTime() + windowDays * DAY_MS;
  return Math.ceil((deadline - now.getTime()) / DAY_MS);
}

export type RefundBucket = '0-5' | '6-10' | '11-15';

/** The close-to-a-refund groups on the Command Center (0–5, 6–10, 11–15 days). */
export function refundBucket(days: number, windowDays: number): RefundBucket | null {
  if (days < 0 || days > windowDays) return null;
  if (days <= 5) return '0-5';
  if (days <= 10) return '6-10';
  return '11-15';
}

export interface WeekBucket {
  /** IST day key of the first day of the week. */
  start: string;
  from: Date;
  to: Date;
}

/** `count` consecutive 7-day weeks ending on the IST day `end` falls on (oldest first). */
export function weekBuckets(end: Date, count: number): WeekBucket[] {
  const endKey = istDayKey(end);
  const endOfLast = istStartOfDay(endKey).getTime() + DAY_MS - 1;
  const out: WeekBucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const to = new Date(endOfLast - i * 7 * DAY_MS);
    const from = new Date(to.getTime() - 7 * DAY_MS + 1);
    out.push({ start: istDayKey(from), from, to });
  }
  return out;
}

export interface MonthBucket {
  /** yyyy-mm */
  month: string;
  from: Date;
  to: Date;
}

/** `count` calendar months (IST) ending with the month `end` falls in (oldest first). */
export function monthBuckets(end: Date, count: number): MonthBucket[] {
  const [y, m] = istDayKey(end).split('-').map(Number);
  const out: MonthBucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const idx = y * 12 + (m - 1) - i;
    const yy = Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    const key = `${yy}-${String(mm).padStart(2, '0')}`;
    const nextIdx = idx + 1;
    const nextKey = `${Math.floor(nextIdx / 12)}-${String((nextIdx % 12) + 1).padStart(2, '0')}`;
    out.push({
      month: key,
      from: istStartOfDay(`${key}-01`),
      to: new Date(istStartOfDay(`${nextKey}-01`).getTime() - 1),
    });
  }
  return out;
}

/** Case-insensitive "contains" for Prisma string filters. */
export function contains(search: string): { contains: string; mode: 'insensitive' } {
  return { contains: search, mode: 'insensitive' };
}

/** A trimmed search string, or undefined when empty. */
export function cleanSearch(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s ? s.slice(0, 100) : undefined;
}

export function cleanOption(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s && s !== 'all' ? s : undefined;
}

/** Counts by key, highest first, ties by name. */
export function countBy<T>(items: readonly T[], key: (item: T) => string | null | undefined): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Median of whole numbers (rounded), or null for an empty list. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function average(values: readonly number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, Icon, IconTile, ListRow, LoadingState, StatusChip, Text, type IconName } from '@/components';
import { addDays, DateField, todayKeyIst } from '@/components/form';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { DayItem, DayItemType, DayView } from '@/api/endpoints';
import { useI18n, type MessageKey } from '@/i18n';
import { formatTimeIst } from '@/lib/format';
import { pageRoutes, routes, sellingRoutes } from '@/navigation/routes';
import { type Accent, colors } from '@/theme';
import { ChipChoices } from './ChoiceList';
import { outcomeKey } from './labels';

/**
 * What Today's work is filtered on: one row type, or "onboarded" — the
 * Onboarded number on Today counts businesses registered from a visit and
 * visits marked onboarded (docs/api/field-redesign.md §1).
 */
export type DayKind = DayItemType | 'onboarded';

export function matchesKind(item: DayItem, kind: DayKind | null | undefined): boolean {
  if (!kind) return true;
  if (kind === 'onboarded') {
    // The server marks the row each business is counted on (rev 189: once per business).
    if (item.countsAsOnboarded !== undefined) return item.countsAsOnboarded;
    return item.type === 'business_registered' || (item.type === 'visit' && item.status === 'onboarded');
  }
  return item.type === kind;
}

/** How far back Today's work goes (server rule, DATE_TOO_OLD). */
export const DAY_WORK_MAX_DAYS_BACK = 90;

export const DAY_TYPES: DayItemType[] = [
  'visit',
  'business_registered',
  'job_seeker_registered',
  'referral_registered',
  'candidates_shown',
  'interview_booked',
  'interview_attended',
];

const TYPE_LOOK: Record<DayItemType, { icon: IconName; accent: Accent }> = {
  visit: { icon: 'store', accent: 'royal' },
  business_registered: { icon: 'check-circle', accent: 'green' },
  job_seeker_registered: { icon: 'user-plus', accent: 'cyan' },
  referral_registered: { icon: 'users', accent: 'orange' },
  candidates_shown: { icon: 'users', accent: 'cyan' },
  interview_booked: { icon: 'calendar', accent: 'royal' },
  interview_attended: { icon: 'calendar', accent: 'green' },
};

/** Where a row of Today's work opens. Visits stay in the Visits tab; the rest open their own page. */
export function dayItemHref(item: DayItem): string | null {
  const tg = item.target;
  switch (tg.type) {
    case 'visit':
      return pageRoutes.visitDetails(tg.id, '/visit');
    case 'business':
      return item.type === 'candidates_shown' && tg.vacancyId ? sellingRoutes.matches(tg.id, tg.vacancyId) : pageRoutes.business(tg.id);
    case 'job_seeker':
      return pageRoutes.seekerProfile(tg.id);
    case 'referral':
      return pageRoutes.referralSaved(tg.id);
    case 'vacancy':
      return sellingRoutes.confirmVacancy(tg.id);
    case 'interview':
      return item.type === 'interview_attended' ? sellingRoutes.interviewDay(tg.id) : sellingRoutes.booked(tg.id);
    default:
      return null;
  }
}

/** The words for a row's status: a visit's result, else the record's status as it comes. */
function statusText(item: DayItem, t: (key: MessageKey, params?: Record<string, string | number>) => string): string | null {
  if (item.type === 'visit') return item.status === 'unfinished' ? t('work.unfinished') : t(outcomeKey(item.status));
  if (item.type === 'candidates_shown') return t('work.shownCount', { count: item.count ?? 0 });
  if (item.type === 'interview_attended') return item.status === 'no_show' ? t('work.noShow') : t('work.arrived');
  return null;
}

/**
 * Today / Yesterday / All visits (17 Nov) / a picked day: the date the agent
 * is looking at. "All visits" opens the whole visit history (FA05c).
 */
export function DaySwitcher({ date, onDate, testID = 'day' }: { date: string; onDate: (date: string) => void; testID?: string }) {
  const { t } = useI18n();
  const today = todayKeyIst();
  const yesterday = addDays(today, -1);
  const which = date === today ? 'today' : date === yesterday ? 'yesterday' : 'other';
  return (
    <View style={styles.switcher}>
      <ChipChoices
        choices={[
          { value: 'today', label: t('date.today') },
          { value: 'yesterday', label: t('work.yesterday') },
          { value: 'all', label: t('visits.allVisits') },
        ]}
        value={which === 'other' ? null : which}
        onChange={(v) => (v === 'all' ? router.push(routes.allVisits) : onDate(v === 'today' ? today : yesterday))}
        testID={testID}
      />
      <DateField label={t('work.pickDay')} value={date} onChange={onDate} max={today} min={addDays(today, -DAY_WORK_MAX_DAYS_BACK)} testID={`${testID}-pick`} />
    </View>
  );
}

export function useDayWork(date: string) {
  const { redesign } = useEndpoints();
  return useQuery<DayView>({ queryKey: queryKeys.day(date), queryFn: () => redesign.day(date) });
}

/**
 * Today's work (redesign, 16 Nov): every visit with its result, businesses
 * onboarded, job seekers and referral partners registered, candidates shown
 * and interviews attended, for one IST day. Adding or confirming a vacancy is
 * not a row (17 Nov): both show on the business's history.
 * Data: GET /field-work/day?date=.
 */
export function DayWork({ date, kind, limit, onMore, testID = 'day-work' }: {
  date: string;
  kind?: DayKind | null;
  /** Show at most this many rows, then "See all". */
  limit?: number;
  onMore?: () => void;
  testID?: string;
}) {
  const { t } = useI18n();
  const q = useDayWork(date);
  if (q.isPending) return <LoadingState compact />;
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.items.filter((i) => matchesKind(i, kind));
  // 22 Nov (rev 207): one row per business or job seeker; tapping a business opens its day's timeline.
  // A list filtered on one kind (a Today number) stays one row per item.
  const groups = kind ? items.map((i) => ({ key: i.id, title: i.title, subtitle: i.subtitle, items: [i] })) : groupDayItems(items);
  const shown = limit ? groups.slice(0, limit) : groups;
  return (
    <View testID={testID}>
      {items.length === 0 ? <EmptyState compact emoji="👟" message={q.data.isToday ? t('work.emptyToday') : t('work.empty')} /> : null}
      {shown.map((group, i) => {
        if (group.items.length > 1) return <DayGroupRow key={group.key} group={group} last={i === shown.length - 1} />;
        const item = group.items[0];
        const href = dayItemHref(item);
        const status = statusText(item, t);
        const look = TYPE_LOOK[item.type];
        return (
          <ListRow
            key={item.id}
            title={item.title}
            subtitle={[t(`work.type.${item.type}` as MessageKey), formatTimeIst(item.at), item.subtitle].filter(Boolean).join(' · ')}
            leading={<IconTile icon={look.icon} accent={look.accent} size={34} />}
            trailing={status ? <StatusChip tone={item.status === 'unfinished' ? 'amber' : item.status === 'onboarded' ? 'green' : item.status === 'already_onboarded' ? 'blue' : 'neutral'} label={status} /> : undefined}
            onPress={href ? () => router.push(href) : undefined}
            last={i === shown.length - 1}
            testID={`work-${item.id}`}
          />
        );
      })}
      {limit && groups.length > limit && onMore ? (
        <Button label={t('work.seeAll', { count: groups.length })} variant="secondary" onPress={onMore} testID={`${testID}-more`} />
      ) : null}
    </View>
  );
}

/** One business (or shop, or person) in Today's work with everything done there that day (22 Nov). */
export interface DayGroup {
  key: string;
  title: string;
  subtitle: string | null;
  /** Newest first, as the server sends them. */
  items: DayItem[];
}

const shopKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The business (or shop, or person) a row of Today's work is about. */
export function dayGroupKey(item: DayItem): string {
  const tg = item.target;
  if (tg.type === 'business') return `b:${tg.id}`;
  if (tg.businessId) return `b:${tg.businessId}`;
  if (tg.type === 'visit') return `shop:${shopKey(item.title)}`;
  return `${tg.type}:${tg.id}`;
}

/**
 * My visits (Master Guide rev 207, owner's field test 22 Nov, screenshot
 * 7f9884ca): one row per business or job seeker — "Nandini sweets" once, not
 * a visit row and an onboarded row. A group sits where its newest item was.
 */
export function groupDayItems(items: DayItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const item of items) {
    const key = dayGroupKey(item);
    let group = byKey.get(key);
    if (!group) {
      group = { key, title: item.title, subtitle: null, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
    if (!group.subtitle && item.subtitle && item.type !== 'candidates_shown' && !item.type.startsWith('interview')) group.subtitle = item.subtitle;
  }
  return groups;
}

/** The group's state badge: Onboarded when anything onboarded it that day, else its newest row's state. */
function groupState(group: DayGroup, t: (key: MessageKey, params?: Record<string, string | number>) => string): { label: string; tone: 'green' | 'amber' | 'blue' | 'neutral' } | null {
  if (group.items.some((i) => i.countsAsOnboarded || (i.type === 'visit' && i.status === 'onboarded') || i.type === 'business_registered')) {
    return { label: t('outcome.onboarded'), tone: 'green' };
  }
  for (const item of group.items) {
    const text = statusText(item, t);
    if (text) return { label: text, tone: item.status === 'unfinished' ? 'amber' : item.status === 'already_onboarded' ? 'blue' : 'neutral' };
  }
  return null;
}

function DayGroupRow({ group, last }: { group: DayGroup; last: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const newest = group.items[0];
  const look = TYPE_LOOK[newest.type];
  const state = groupState(group, t);
  const timeline = [...group.items].reverse();
  return (
    <View testID={`work-group-${group.key}`}>
      <ListRow
        title={group.title}
        subtitle={[t('work.steps', { count: group.items.length }), formatTimeIst(newest.at), group.subtitle].filter(Boolean).join(' · ')}
        leading={<IconTile icon={look.icon} accent={look.accent} size={34} />}
        trailing={state ? <StatusChip tone={state.tone} label={state.label} /> : <Icon name="chevron-right" size={16} />}
        onPress={() => setOpen((o) => !o)}
        last={last && !open}
        testID={`work-group-${group.key}-toggle`}
      />
      {open ? (
        <View style={[styles.timeline, last ? null : styles.divider]} testID={`work-group-${group.key}-timeline`}>
          {timeline.map((item) => {
            const href = dayItemHref(item);
            const status = item.type === 'visit' ? statusText(item, t) : null;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={href ? () => router.push(href) : undefined}
                style={styles.step}
                testID={`work-${item.id}`}
              >
                <View style={styles.dot} />
                <Text variant="small" style={styles.flex1}>
                  {[t(`work.step.${item.type}` as MessageKey), formatTimeIst(item.at), status].filter(Boolean).join(' · ')}
                </Text>
                {href ? <Icon name="chevron-right" size={14} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** The type filter: All and each type that has something that day. */
export function DayKindFilter({ counts, kind, onKind }: { counts: Record<DayItemType, number> | undefined; kind: DayKind | null; onKind: (k: DayKind | null) => void }) {
  const { t } = useI18n();
  const types = DAY_TYPES.filter((ty) => (counts?.[ty] ?? 0) > 0 || ty === kind);
  return (
    <ChipChoices
      choices={[
        { value: 'all', label: t('work.all') },
        ...(kind === 'onboarded' ? [{ value: 'onboarded', label: t('work.onboarded') }] : []),
        ...types.map((ty) => ({ value: ty, label: `${t(`work.type.${ty}` as MessageKey)} · ${counts?.[ty] ?? 0}` })),
      ]}
      value={kind ?? 'all'}
      onChange={(v) => onKind(v === 'all' ? null : (v as DayKind))}
      testID="work-kind"
    />
  );
}

export function DayHeading({ date }: { date: string }) {
  const { t } = useI18n();
  return <Text variant="label">{date === todayKeyIst() ? t('date.today') : date}</Text>;
}

const styles = StyleSheet.create({
  switcher: { gap: 8, marginBottom: 6 },
  flex1: { flex: 1 },
  timeline: { paddingLeft: 46, paddingBottom: 6 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.blue },
});

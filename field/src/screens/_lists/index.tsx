import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from '@/components';
import type { ListGroup } from '@/api/endpoints';
import { useI18n, type MessageKey } from '@/i18n';
import { initials } from '@/lib/format';
import { colors, fonts, radius, touch } from '@/theme';

/**
 * Laboura Field lists (Master Guide, "Laboura Field lists, decided 22 Nov
 * evening"): the pieces the Businesses and Job seekers lists share — the
 * filter chips (All · Needs action · Waiting for Team Lead · Active · Done),
 * the row (name in bold first, one plain status line, a few small lines) and
 * its right side: a green "Done", "Waiting" (the Team Lead), or ONE button.
 */
export type ListFilter = 'all' | ListGroup;
export const LIST_FILTERS: ListFilter[] = ['all', 'needs_action', 'waiting_tl', 'active', 'done'];

/** The filter chips, wrapping onto a second line rather than scrolling sideways (360 px). */
export function FilterChips({ value, onChange, counts, testID }: {
  value: ListFilter;
  onChange: (f: ListFilter) => void;
  counts: Record<ListFilter, number>;
  testID: string;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.chips} accessibilityRole="tablist" testID={testID}>
      {LIST_FILTERS.map((f) => {
        const on = f === value;
        return (
          <Pressable
            key={f}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(f)}
            style={[styles.chip, on && styles.chipOn]}
            testID={`${testID}-${f}`}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>
              {t(`lists.filter.${f}` as MessageKey)}
              {f !== 'all' && counts[f] > 0 ? ` · ${counts[f]}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 26 Nov (owner testing): how the list is ordered. "Needs action first" is the
 * server's order (as before); Newest / Oldest go by when it was registered;
 * A–Z by name.
 */
export type ListSort = 'action' | 'newest' | 'oldest' | 'az';
export const LIST_SORTS: ListSort[] = ['action', 'newest', 'oldest', 'az'];

export function sortList<T extends { name: string }>(rows: T[], sort: ListSort, createdAt: (row: T) => string | null | undefined): T[] {
  if (sort === 'action') return rows;
  const copy = [...rows];
  if (sort === 'az') return copy.sort((a, b) => a.name.localeCompare(b.name, 'en-IN', { sensitivity: 'base' }));
  const time = (row: T) => {
    const at = createdAt(row);
    return at ? Date.parse(at) : 0;
  };
  return copy.sort((a, b) => (sort === 'newest' ? time(b) - time(a) : time(a) - time(b)));
}

export function useListSort() {
  return useState<ListSort>('action');
}

/** "Sort: Needs action first · Newest · Oldest · A–Z", as small chips that wrap. */
export function SortChips({ value, onChange, testID }: { value: ListSort; onChange: (s: ListSort) => void; testID: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" testID={testID}>
      <Text style={styles.sortLabel}>{t('lists.sort')}</Text>
      {LIST_SORTS.map((s) => {
        const on = s === value;
        return (
          <Pressable
            key={s}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(s)}
            style={[styles.chip, on && styles.chipOn]}
            testID={`${testID}-${s}`}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`lists.sort.${s}` as MessageKey)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** How many rows each chip holds. */
export function countGroups(rows: { row?: { group: ListGroup } }[]): Record<ListFilter, number> {
  const counts: Record<ListFilter, number> = { all: rows.length, needs_action: 0, waiting_tl: 0, active: 0, done: 0 };
  for (const r of rows) if (r.row) counts[r.row.group] += 1;
  return counts;
}

/** The rows under a chip. */
export function filterRows<T extends { row?: { group: ListGroup } }>(rows: T[], filter: ListFilter): T[] {
  return filter === 'all' ? rows : rows.filter((r) => r.row?.group === filter);
}

export function useListFilter() {
  return useState<ListFilter>('all');
}

/** The green "Done" mark. */
export function DoneMark({ testID }: { testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={[styles.mark, styles.done]} testID={testID}>
      <Icon name="check" size={14} color={colors.greenText} strokeWidth={2.6} />
      <Text style={[styles.markText, { color: colors.greenText }]}>{t('lists.done')}</Text>
    </View>
  );
}

/** "Waiting": the Team Lead (or the office) has it; nothing to send. */
export function WaitingMark({ testID }: { testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={[styles.mark, styles.waiting]} testID={testID}>
      <Icon name="clock" size={14} color={colors.amber} strokeWidth={2.4} />
      <Text style={[styles.markText, { color: colors.amber }]}>{t('lists.waiting')}</Text>
    </View>
  );
}

/** The ONE next-step button on a row: small, at least 48 px tall, works right there. */
export function RowButton({ label, onPress, loading, disabled, testID }: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, off && styles.buttonOff]}
      testID={testID}
    >
      <Text style={styles.buttonText} numberOfLines={2}>
        {loading ? '…' : label}
      </Text>
    </Pressable>
  );
}

/** The selfie in a small round frame, or the first letters of the name. */
export function Avatar({ name, photoUrl, size = 44, testID }: { name: string; photoUrl?: string | null; size?: number; testID?: string }) {
  const [failed, setFailed] = useState(false);
  const frame = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl && !failed) {
    return <Image source={{ uri: photoUrl }} style={[styles.avatar, frame]} onError={() => setFailed(true)} accessibilityIgnoresInvertColors testID={testID} />;
  }
  return (
    <View style={[styles.avatar, styles.initials, frame]} testID={testID ? `${testID}-initials` : undefined}>
      <Text style={[styles.initialsText, { fontSize: Math.round(size * 0.36) }]}>{initials(name)}</Text>
    </View>
  );
}

/**
 * One row: name in bold and larger first, the plain status line under it,
 * then small lines (numbers, area, code and masked phone); on the right the
 * Done / Waiting / button. Tapping the row opens the profile.
 */
export function PersonRow({ leading, name, status, statusTone = 'ink', lines, small, trailing, onPress, last, testID }: {
  leading: ReactNode;
  name: string;
  status: string;
  statusTone?: 'ink' | 'red' | 'green' | 'amber';
  lines?: { text: string; tone?: 'red' }[];
  small?: string;
  trailing?: ReactNode;
  onPress: () => void;
  last?: boolean;
  testID?: string;
}) {
  const statusColor = statusTone === 'red' ? colors.tomato : statusTone === 'green' ? colors.greenText : statusTone === 'amber' ? colors.amber : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}
      testID={testID}
    >
      {leading}
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.status, { color: statusColor }]} testID={testID ? `${testID}-status` : undefined}>
          {status}
        </Text>
        {(lines ?? []).filter((l) => l.text).map((l, i) => (
          <Text key={i} variant="small" color={l.tone === 'red' ? colors.tomato : colors.soft}>
            {l.text}
          </Text>
        ))}
        {small ? (
          <Text variant="tiny" testID={testID ? `${testID}-small` : undefined}>
            {small}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sortLabel: { fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink, alignSelf: 'center', marginRight: 2 },
  chip: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { fontFamily: fonts.body700, fontSize: 12.5, color: colors.blue },
  chipTextOn: { color: colors.white },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  done: { backgroundColor: colors.green100 },
  waiting: { backgroundColor: colors.amber100 },
  markText: { fontFamily: fonts.body700, fontSize: 12 },
  button: {
    minHeight: touch.min,
    maxWidth: 124,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: colors.blue,
  },
  buttonPressed: { backgroundColor: colors.bluePressed },
  buttonOff: { opacity: 0.5 },
  buttonText: { fontFamily: fonts.body700, fontSize: 12.5, color: colors.white, textAlign: 'center' },
  avatar: { backgroundColor: colors.navy100 },
  initials: { alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontFamily: fonts.display700, color: colors.navy },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: touch.min, paddingVertical: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { opacity: 0.6 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: fonts.display700, fontSize: 16, color: colors.navy, lineHeight: 21 },
  status: { fontFamily: fonts.body500, fontSize: 13.5, lineHeight: 19 },
  trailing: { alignItems: 'flex-end', flexShrink: 0 },
});

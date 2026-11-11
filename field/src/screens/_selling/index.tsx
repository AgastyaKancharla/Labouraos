import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import type { BusinessHit } from '@/api/endpoints';
import { Banner, Card, EmptyState, ErrorState, ListRow, LoadingState, StatusChip, Text, TextField } from '@/components';
import { isNeedsSignalError } from '@/device/offline-queue';
import { useI18n, type MessageKey } from '@/i18n';
import { colors, fonts, radius } from '@/theme';

/** "₹17,000" from 1700000 paise (Indian grouping: 1,00,000). */
export function formatRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  const rupees = Math.round(paise / 100);
  const s = String(Math.abs(rupees));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rupees < 0 ? '-' : ''}₹${rest ? `${rest},${last3}` : last3}`;
}

/** "₹16–20k" for vacancy chips. */
export function formatRangeK(minPaise: number | null, maxPaise: number | null): string {
  if (minPaise === null) return '';
  const k = (p: number) => {
    const v = p / 100_000;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };
  return maxPaise && maxPaise !== minPaise ? `₹${k(minPaise)}–${k(maxPaise)}k` : `₹${k(minPaise)}k`;
}

/** Fee + GST from the percentages in Settings (integer paise, rounded like the server). */
export function feeBreakdown(salaryPaise: number, feePercent: number, gstPercent: number) {
  const fee = Math.round((salaryPaise * feePercent) / 100);
  const gst = Math.round((fee * gstPercent) / 100);
  return { fee, gst, total: fee + gst };
}

/** The current time, refreshed every `everyMs` (renders stay pure). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** One string route param (expo-router may give an array). */
export function useParam(name: string): string {
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;
  const v = params[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export function useSellingSettings() {
  const { selling } = useEndpoints();
  return useQuery({ queryKey: queryKeys.sellingSettings, queryFn: () => selling.settings(), staleTime: 10 * 60_000 });
}

/** An error whose message is already a sentence for the agent (in his language). */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** Turns an error from a write into the sentence the agent sees. */
export function useErrorText() {
  const { t } = useI18n();
  return (error: unknown): string | null => {
    if (!error) return null;
    if (isNeedsSignalError(error)) return t('common.needsSignal');
    if (error instanceof UserFacingError) return error.message;
    if (isApiError(error)) return error.isNetworkError ? t('common.networkError') : error.message;
    return t('common.error');
  };
}

export const SHIFT_KEYS: Record<string, MessageKey> = {
  day: 'selling.shift.day',
  night: 'selling.shift.night',
  rotational: 'selling.shift.rotational',
  any: 'selling.shift.any',
};

export const REASON_KEYS: Record<string, MessageKey> = {
  skills: 'selling.reason.skills',
  experience: 'selling.reason.experience',
  communication: 'selling.reason.communication',
  salary_expectation: 'selling.reason.salary_expectation',
  not_suitable: 'selling.reason.not_suitable',
  other: 'selling.reason.other',
};

/** Round letter avatar on candidate cards. */
export function Avatar({ name, tone = 0, size = 48, label }: { name: string; tone?: number; size?: number; label?: string }) {
  const bgs = [colors.cyan100, colors.amber100, colors.green100];
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bgs[tone % 3] }]} accessibilityLabel={label}>
      <Text style={styles.avatarText}>{(name[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
}

/** A small "label · value" line in a card (`.kv`). */
export function KeyValue({ label, value, strong, last, testID, trailing }: {
  label: string;
  value?: string;
  strong?: boolean;
  last?: boolean;
  testID?: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={[styles.kv, !last && styles.kvLine]} testID={testID}>
      <Text style={styles.kvLabel}>{label}</Text>
      {trailing ?? <Text style={strong ? styles.kvStrong : styles.kvValue}>{value}</Text>}
    </View>
  );
}

/** A step in a "what happens next" list: text on the left, a status chip on the right. */
export function StepRow({ label, chip, tone = 'neutral', last, testID }: {
  label: string;
  chip: string;
  tone?: 'green' | 'amber' | 'neutral' | 'blue' | 'tomato';
  last?: boolean;
  testID?: string;
}) {
  return <ListRow title={label} trailing={<StatusChip label={chip} tone={tone} />} last={last} testID={testID} />;
}

/** Shows a query's loading / error state, or the content. */
export function QueryView<T>({ query, children }: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState />;
  if (query.isError || query.data === undefined) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

export function ErrorBanner({ error }: { error: unknown }) {
  const text = useErrorText()(error);
  return text ? <Banner tone="error" message={text} testID="error-banner" /> : null;
}

/** Wait this long after the last letter before searching (the agent types fast, signal is slow). */
const SEARCH_DELAY_MS = 250;

/**
 * The business type-ahead (FA15, FA19): two letters show matching registered
 * businesses as he types; none → "Register this business".
 */
export function BusinessTypeAhead({ onPick, onRegister, hintKey, testID = 'business-search' }: {
  onPick: (business: BusinessHit) => void;
  onRegister: () => void;
  hintKey: MessageKey;
  testID?: string;
}) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [text]);
  const search = useQuery({
    queryKey: queryKeys.sellingBusinesses(q),
    queryFn: () => selling.businesses(q),
    enabled: q.length >= 2,
  });
  return (
    <Card>
      <TextField
        label={t('selling.searchBusiness')}
        value={text}
        onChangeText={setText}
        placeholder={t('selling.searchPlaceholder')}
        autoCorrect={false}
        testID={testID}
      />
      {q.length >= 2 ? (
        <View style={styles.results} testID={`${testID}-results`}>
          {search.isPending ? <LoadingState compact /> : search.isError ? <ErrorState compact error={search.error} onRetry={() => void search.refetch()} /> : null}
          {search.data?.results.map((b) => (
            <BusinessRow key={b.id} business={b} query={q} onPress={() => onPick(b)} />
          ))}
          {search.data && search.data.results.length === 0 ? <Text variant="muted">{t('selling.noBusinessFound')}</Text> : null}
          <Pressable accessibilityRole="button" onPress={onRegister} style={styles.register} testID={`${testID}-register`}>
            <Text style={styles.registerText}>{t('selling.registerThisBusiness')}</Text>
          </Pressable>
        </View>
      ) : null}
      <Text variant="muted" style={styles.hint}>
        {t(hintKey)}
      </Text>
    </Card>
  );
}

/** One business in a list: bold matching letters, BZ- code, area, open vacancies. */
export function BusinessRow({ business, query, onPress, last, subtitle, chip }: {
  business: BusinessHit;
  query?: string;
  onPress: () => void;
  last?: boolean;
  subtitle?: string;
  chip?: { label: string; tone: 'green' | 'amber' | 'neutral' | 'blue' | 'tomato' };
}) {
  const { t, tn } = useI18n();
  const lower = business.name.toLowerCase();
  const at = query ? lower.indexOf(query.toLowerCase()) : -1;
  const defaultChip = business.openVacancies > 0
    ? { label: tn('selling.openCount', business.openVacancies), tone: 'green' as const }
    : { label: t('selling.noVacancy'), tone: 'neutral' as const };
  const c = chip ?? defaultChip;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.bizRow, !last && styles.bizLine, pressed && styles.pressed]}
      testID={`business-${business.code}`}
    >
      <View style={styles.flex}>
        <Text style={styles.bizName}>
          {at >= 0 && query ? (
            <>
              {business.name.slice(0, at)}
              <Text style={styles.bizMatch}>{business.name.slice(at, at + query.length)}</Text>
              {business.name.slice(at + query.length)}
            </>
          ) : (
            business.name
          )}
        </Text>
        <Text variant="muted">
          {subtitle ?? [business.code, business.locality, business.signedToday ? t('selling.signedToday') : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <StatusChip label={c.label} tone={c.tone} />
    </Pressable>
  );
}

/** "Annapoorna Mess / BTM Layout · signed today / Change" header (FA15b, FA17). */
export function BusinessHeader({ name, sub, onChange, testID }: { name: string; sub: string; onChange?: () => void; testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.header} testID={testID}>
      <View style={styles.flex}>
        <Text variant="h2" style={styles.headerName}>
          {name}
        </Text>
        <Text variant="muted">{sub}</Text>
      </View>
      {onChange ? (
        <Pressable accessibilityRole="button" onPress={onChange} hitSlop={12} testID="change-business">
          <Text style={styles.change}>{t('selling.change')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Empty({ message }: { message: string }) {
  return <EmptyState compact message={message} />;
}

/** The blue quoted script box (`.say`) agents read aloud. */
export function Script({ children, testID }: { children: string; testID?: string }) {
  return (
    <View style={styles.script} testID={testID}>
      <Text style={styles.scriptText}>{children}</Text>
    </View>
  );
}

/** Small note under a button. */
export function Note({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text variant="muted" align="center" testID={testID}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.display700, color: colors.navy, fontSize: 15 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 8 },
  kvLine: { borderBottomWidth: 1, borderBottomColor: colors.border },
  kvLabel: { color: colors.ink, flexShrink: 1 },
  kvValue: { color: colors.ink, textAlign: 'right', flexShrink: 1 },
  kvStrong: { fontFamily: fonts.body700, color: colors.ink, textAlign: 'right', flexShrink: 1 },
  results: { marginTop: 8 },
  register: { minHeight: 44, justifyContent: 'center' },
  registerText: { color: colors.blue, fontFamily: fonts.body700 },
  hint: { marginTop: 8 },
  bizRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8 },
  bizLine: { borderBottomWidth: 1, borderBottomColor: colors.border },
  bizName: { fontFamily: fonts.body600, color: colors.ink },
  bizMatch: { fontFamily: fonts.body700, color: colors.blue },
  pressed: { opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headerName: { fontSize: 17 },
  change: { color: colors.blue, fontFamily: fonts.body700 },
  script: { backgroundColor: colors.blue100, borderRadius: radius.lg, borderWidth: 1, borderColor: '#C7DAF5', padding: 14 },
  scriptText: { color: colors.ink, fontSize: 14, lineHeight: 21 },
});

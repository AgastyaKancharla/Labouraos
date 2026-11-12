import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isSearchable, type SearchResult, type SearchRow, type SearchType } from '@/api/endpoints';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, StatusChip, Text, TextField } from '@/components';
import { useI18n, type MessageKey } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors, fonts, radius, touch, type Tone } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { useParam } from '../_selling';
import { ChipChoices } from '../_visits/ChoiceList';

/** Wait this long after the last letter before searching (the agent types fast, signal is slow). */
const SEARCH_DELAY_MS = 300;

type Tab = 'all' | SearchType;
const TABS: Tab[] = ['all', 'job_seeker', 'business', 'referral', 'vacancy', 'placement'];
/** Always shown, as in the design; vacancies and placements only when something matched. */
const ALWAYS: Tab[] = ['all', 'job_seeker', 'business', 'referral'];

const TAB_KEY: Record<Tab, MessageKey> = {
  all: 'search.tab.all',
  job_seeker: 'search.tab.job_seeker',
  business: 'search.tab.business',
  referral: 'search.tab.referral',
  vacancy: 'search.tab.vacancy',
  placement: 'search.tab.placement',
};
const TYPE_KEY: Record<SearchType, MessageKey> = {
  job_seeker: 'search.type.job_seeker',
  business: 'search.type.business',
  referral: 'search.type.referral',
  vacancy: 'search.type.vacancy',
  placement: 'search.type.placement',
};
const SEEKER_STATUS: Record<string, [MessageKey, Tone]> = {
  lead: ['search.js.lead', 'amber'],
  consented: ['search.js.consented', 'amber'],
  pending_activation: ['search.js.pending_activation', 'amber'],
  active: ['search.js.active', 'green'],
  paused: ['search.js.paused', 'neutral'],
  deactivated: ['search.js.deactivated', 'tomato'],
  placed: ['search.js.placed', 'blue'],
  closed: ['search.js.closed', 'neutral'],
};
const BUSINESS_STATUS: Record<string, MessageKey> = {
  verified: 'vstatus.verified',
  lead: 'vstatus.lead',
  pending_visit: 'vstatus.pending_visit',
  pending_tl_check: 'vstatus.pending_tl_check',
  rejected: 'vstatus.rejected',
  paused: 'vstatus.paused',
};
const VACANCY_STATUS: Record<string, MessageKey> = {
  open: 'search.vc.open',
  filled: 'search.vc.filled',
  cancelled: 'search.vc.cancelled',
  draft: 'search.vc.draft',
  awaiting_confirmation: 'search.vc.awaiting_confirmation',
};
const PLACEMENT_STATUS: Record<string, MessageKey> = {
  awaiting_payment: 'search.pl.awaiting_payment',
  confirmed: 'search.pl.confirmed',
  active: 'search.pl.active',
  completed: 'search.pl.completed',
  dropped_out: 'search.pl.dropped_out',
  replaced: 'search.pl.replaced',
  cancelled: 'search.pl.cancelled',
  guarantee_ended: 'search.pl.guarantee_ended',
};

/** Where a result opens in Laboura Field, or null when the app has no screen for it. */
export function resultHref(row: SearchRow): string | null {
  const businessCode = typeof row.extra.businessCode === 'string' ? row.extra.businessCode : null;
  switch (row.type) {
    case 'job_seeker':
      return `/job-seeker/${encodeURIComponent(row.id)}`; // FA10c
    case 'business':
      return `${routes.business}/${encodeURIComponent(row.id)}`; // FA08
    case 'vacancy':
    case 'placement':
      return businessCode ? `${routes.business}/${encodeURIComponent(businessCode)}` : null; // FA08 of its business
    default:
      return null; // referral partners have no screen in the field app
  }
}

/**
 * Search — the call agent's CA16-Search adapted to the phone (guide: "Search
 * on every screen"). Finds anyone by name, mobile (full or last 4 digits) or
 * ID (JS-, BZ-, RF-, VC-, PL-) with the same GET /search the office uses. For
 * a field agent the server searches city-wide (AGENTS.md §7) and phone
 * numbers always come back as the last 4 digits. No result offers to
 * register the person: a job seeker (FA10) or a business (the visit flow).
 */
export default function SearchScreen() {
  const { t } = useI18n();
  const { search } = useEndpoints();
  const initial = useParam('q');
  const [text, setText] = useState(initial);
  const [q, setQ] = useState(initial.trim());
  const [tab, setTab] = useState<Tab>('all');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [text]);
  const type = tab === 'all' ? null : tab;
  const result = useQuery({
    queryKey: queryKeys.search(q, tab),
    queryFn: ({ signal }) => search.search(q, type, signal),
    enabled: isSearchable(q),
    staleTime: 15_000,
  });

  return (
    <View style={styles.flex} testID="screen-Search">
      <AppHeader title={t('search.title')} />
      <Screen>
        <View style={styles.bar}>
          <View style={styles.input}>
            <TextField
              label={t('search.label')}
              value={text}
              onChangeText={setText}
              placeholder={t('common.search')}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => setQ(text.trim())}
              testID="search-input"
            />
          </View>
          <Button label={t('search.go')} onPress={() => setQ(text.trim())} style={styles.go} testID="search-go" />
        </View>

        {!isSearchable(q) ? (
          <EmptyState title={t('search.typeMore')} message={t('search.help')} />
        ) : result.isPending ? (
          <LoadingState />
        ) : result.isError ? (
          <ErrorState error={result.error} onRetry={() => void result.refetch()} />
        ) : (
          <Results data={result.data} tab={tab} onTab={setTab} />
        )}
      </Screen>
    </View>
  );
}

function Results({ data, tab, onTab }: { data: SearchResult; tab: Tab; onTab: (tab: Tab) => void }) {
  const { t } = useI18n();
  const choices = TABS.filter((k) => ALWAYS.includes(k) || data.counts[k] > 0 || k === tab).map((k) => ({
    value: k,
    label: t(TAB_KEY[k], { count: data.counts[k] }),
  }));
  return (
    <>
      <ChipChoices choices={choices} value={tab} onChange={onTab} testID="search-tab" />
      {data.results.length === 0 ? (
        <Text variant="muted" testID="search-none">
          {t('search.none', { q: data.query })}
        </Text>
      ) : (
        <View style={styles.list} testID="search-results">
          {data.results.map((row) => (
            <ResultRow key={`${row.type}-${row.id}`} row={row} />
          ))}
        </View>
      )}
      <Card testID="search-register">
        <Text variant="muted">{data.results.length ? t('search.notRight') : t('search.register')}</Text>
        <View style={styles.registerRow}>
          <Button label={t('search.registerSeeker')} variant="secondary" style={styles.half} onPress={() => router.push(routes.jobSeekerNew)} testID="search-register-seeker" />
          <Button label={t('search.registerBusiness')} variant="secondary" style={styles.half} onPress={() => router.push(routes.visitStart)} testID="search-register-business" />
        </View>
      </Card>
      <Text variant="muted">{t('search.help')}</Text>
    </>
  );
}

function ResultRow({ row }: { row: SearchRow }) {
  const { t, tn } = useI18n();
  const href = resultHref(row);
  const detail = row.type === 'business' ? row.locality : row.trade ?? row.locality;
  const sub = [t(TYPE_KEY[row.type]), row.code, row.maskedPhone, detail].filter(Boolean).join(' · ');
  let chip: { label: string; tone: Tone } | null = null;
  if (row.type === 'job_seeker') {
    const [key, tone] = SEEKER_STATUS[row.status ?? ''] ?? [null, 'neutral'];
    chip = { label: key ? t(key) : (row.status ?? '').replace(/_/g, ' '), tone };
  } else if (row.type === 'business') {
    const open = Number(row.extra.openVacancies ?? 0);
    const status = BUSINESS_STATUS[row.status ?? ''];
    chip = {
      label: [status ? t(status) : row.status, open > 0 ? tn('selling.openCount', open) : t('selling.noVacancy')].filter(Boolean).join(' · '),
      tone: row.status === 'verified' ? 'green' : 'amber',
    };
  } else if (row.type === 'referral') {
    chip = { label: t('search.referred', { referred: Number(row.extra.referred ?? 0), joined: Number(row.extra.joined ?? 0) }), tone: 'blue' };
  } else if (row.type === 'vacancy') {
    const key = VACANCY_STATUS[row.status ?? ''];
    chip = { label: key ? t(key) : (row.status ?? '').replace(/_/g, ' '), tone: row.status === 'open' ? 'green' : 'neutral' };
  } else {
    const key = PLACEMENT_STATUS[row.status ?? ''];
    chip = { label: key ? t(key) : (row.status ?? '').replace(/_/g, ' '), tone: row.status === 'active' || row.status === 'confirmed' ? 'green' : 'neutral' };
  }
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={styles.name}>{row.name}</Text>
        <Text variant="muted">{sub}</Text>
      </View>
      {chip.label ? <StatusChip label={chip.label} tone={chip.tone} /> : null}
    </>
  );
  if (!href) {
    return (
      <View style={styles.row} testID={`search-row-${row.code}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`search-row-${row.code}`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1 },
  go: { minWidth: 88 },
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: touch.min,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { borderColor: colors.cyanRaw },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: fonts.body600, fontSize: 13.5, color: colors.ink },
  registerRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  half: { flex: 1 },
});

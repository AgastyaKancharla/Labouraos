import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { BusinessDetail, MatchCard, MatchesPage } from '@/api/endpoints';
import { Banner, Button, Card, ErrorState, LoadingState, Screen, StatusChip, Text } from '@/components';
import { Segmented } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { sellingRoutes } from '@/navigation/routes';
import { colors, fonts, radius } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { Avatar, BusinessHeader, formatRangeK, formatRupees, Note, QueryView, useParam } from '../_selling';
import { MatchesMap } from '../FA15c-MapView/MatchesMap';

/**
 * FA15b — Matches (list) and FA15c (map). The business with its vacancy
 * chips; the matching engine's best 3 for the chosen vacancy, Show next 3;
 * List / Map. Each card: first name, age, trade and years, distance,
 * expected salary, languages and why he matches — never a phone number. The
 * heart marks the owner's favourite. Each page shown is recorded as an
 * in-person introduction (12-month no-bypass).
 */
export default function MatchesScreen({ initialView }: { initialView?: 'list' | 'map' }) {
  const { t } = useI18n();
  const businessId = useParam('businessId');
  const viewParam = useParam('view');
  const { selling } = useEndpoints();
  const business = useQuery({ queryKey: queryKeys.sellingBusiness(businessId), queryFn: () => selling.business(businessId), enabled: !!businessId });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('tabs.jobSeekers')} />
      <Screen testID="screen-FA15b">
        <QueryView query={business}>
          {(b) => <Matches business={b} initialView={initialView ?? (viewParam === 'map' ? 'map' : 'list')} />}
        </QueryView>
      </Screen>
    </View>
  );
}

function Matches({ business, initialView }: { business: BusinessDetail; initialView: 'list' | 'map' }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const vacancyParam = useParam('vacancyId');
  const open = business.vacancies.filter((v) => v.status === 'open');
  const [vacancyId, setVacancyId] = useState(vacancyParam || open[0]?.id || '');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'list' | 'map'>(initialView);
  const allowed = business.canShowCandidates && !!vacancyId;
  const matches = useQuery({
    queryKey: queryKeys.sellingMatches(vacancyId, page),
    queryFn: () => selling.matches(vacancyId, page),
    enabled: allowed,
  });

  // Showing a page to the owner is an introduction (12-month no-bypass): record it once.
  const recorded = useRef(new Set<string>());
  useEffect(() => {
    const data = matches.data;
    if (!data || data.matches.length === 0) return;
    const key = `${vacancyId}:${page}`;
    if (recorded.current.has(key)) return;
    recorded.current.add(key);
    void selling.showInPerson(vacancyId, data.matches.map((m) => m.jobSeekerId)).catch(() => recorded.current.delete(key));
  }, [matches.data, vacancyId, page, selling]);

  const like = useMutation({
    mutationFn: async (m: MatchCard) => {
      const path = `/field-selling/vacancies/${encodeURIComponent(vacancyId)}/favourites/${encodeURIComponent(m.jobSeekerId)}`;
      return queue.submit(t('fa15b.likeQueued', { name: m.card.firstName }), { method: 'POST', path, json: { liked: !m.liked } });
    },
    onMutate: (m) => {
      client.setQueryData<MatchesPage>(queryKeys.sellingMatches(vacancyId, page), (old) =>
        old ? { ...old, matches: old.matches.map((x) => (x.jobSeekerId === m.jobSeekerId ? { ...x, liked: !x.liked } : x)) } : old,
      );
    },
  });

  const sub = [business.locality, business.signedToday ? t('selling.signedToday') : null].filter(Boolean).join(' · ');
  const data = matches.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const first = data && data.total > 0 ? (page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(page * data.pageSize, data.total) : 0;
  const callTarget = data?.matches.find((m) => m.liked) ?? data?.matches[0];
  const openCard = (m: MatchCard) => router.push(sellingRoutes.candidate(m.jobSeekerId, vacancyId));
  const next = () => {
    if (!data) return;
    if (page >= pageCount) router.push(sellingRoutes.noMore(vacancyId, business.id));
    else setPage(page + 1);
  };

  return (
    <>
      <BusinessHeader name={business.name} sub={sub} onChange={() => router.back()} testID="business-header" />
      <View style={styles.chips}>
        {business.vacancies.map((v) => {
          const on = v.id === vacancyId;
          const label = `${v.headcount > 1 ? `${v.trade} × ${v.headcount}` : v.trade}${on && v.salaryMinPaise ? ` · ${formatRangeK(v.salaryMinPaise, v.salaryMaxPaise)}` : ''}`;
          return (
            <Pressable
              key={v.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => {
                if (v.status !== 'open') router.push(sellingRoutes.confirmVacancy(v.id));
                else {
                  setVacancyId(v.id);
                  setPage(1);
                }
              }}
              style={[styles.chip, on && styles.chipOn]}
              testID={`vacancy-chip-${v.code}`}
            >
              <Text style={on ? styles.chipTextOn : styles.chipText}>{label}</Text>
              {v.status !== 'open' ? <StatusChip label={t('fa15b.waitingOtp')} tone="amber" /> : null}
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" onPress={() => router.push(sellingRoutes.addVacancy(business.id))} style={styles.chipAdd} testID="add-vacancy">
          <Text style={styles.chipAddText}>{t('fa15b.addVacancy')}</Text>
        </Pressable>
      </View>

      {!business.agreementSigned ? (
        <Banner tone="warn" title={t('fa15.signFirst')} message={t('fa15b.signFirstBody')} testID="sign-first" />
      ) : business.paused ? (
        <Banner tone="error" message={t('fa15b.paused')} testID="paused" />
      ) : !business.canShowCandidates ? (
        <Banner tone="warn" message={t('fa15b.notVerified')} testID="not-verified" />
      ) : open.length === 0 ? (
        <Banner tone="info" message={t('fa15b.noOpenVacancy')} testID="no-open-vacancy" />
      ) : null}

      {allowed ? (
        matches.isPending ? (
          <LoadingState />
        ) : matches.isError ? (
          <ErrorState error={matches.error} onRetry={() => void matches.refetch()} />
        ) : data && data.total === 0 ? (
          <Card testID="no-matches">
            <Text variant="h2">{t('fa15b.noneYet')}</Text>
            <Text variant="muted">{t('fa15b.noneYetBody')}</Text>
            <Button label={t('fa15b.whyNone')} variant="secondary" onPress={() => router.push(sellingRoutes.noMore(vacancyId, business.id))} testID="why-none" />
          </Card>
        ) : data ? (
          <>
            <View style={styles.bar}>
              <Text variant="muted" testID="match-count">
                {t('fa15b.count', { first, last, total: data.total })}
              </Text>
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'list', label: t('fa15b.list') },
                  { value: 'map', label: t('fa15b.map') },
                ]}
                testID="view"
              />
            </View>
            {view === 'list' ? (
              data.matches.map((m, i) => (
                <MatchRow
                  key={m.jobSeekerId}
                  match={m}
                  tone={i}
                  onOpen={() => openCard(m)}
                  onLike={() => like.mutate(m)}
                  likeLabel={m.liked ? t('fa15b.unlike', { name: m.card.firstName }) : t('fa15b.like', { name: m.card.firstName })}
                  speaks={t('fa15b.speaks', { languages: m.card.languages.join(', ') })}
                  line={t('fa15b.cardLine', {
                    trade: m.card.trade,
                    years: m.card.yearsExperience,
                    km: m.card.distanceKm,
                    salary: formatRupees(m.card.expectedSalary.minPaise),
                  })}
                />
              ))
            ) : (
              <>
                <MatchesMap business={data.business} matches={data.matches} onOpen={openCard} />
                <Text variant="muted">{t('fa15c.explain')}</Text>
              </>
            )}
            {pageCount > 1 ? (
              <View style={styles.dots} accessibilityLabel={t('fa15b.pageOf', { page, pages: pageCount })}>
                {Array.from({ length: Math.min(pageCount, 6) }, (_, i) => (
                  <View key={i} style={[styles.dot, i === Math.min(page - 1, 5) && styles.dotOn]} />
                ))}
              </View>
            ) : null}
            <View style={styles.actions}>
              <Button label={t('fa15b.showNext')} variant="secondary" style={styles.action} onPress={next} testID="show-next" />
              {view === 'list' && callTarget ? (
                <Button
                  label={t('fa15b.call', { name: callTarget.card.firstName })}
                  style={styles.action}
                  onPress={() => router.push(sellingRoutes.call(vacancyId, callTarget.jobSeekerId))}
                  testID="call-candidate"
                />
              ) : null}
            </View>
            <Note>{t('fa15b.note')}</Note>
          </>
        ) : null
      ) : null}
    </>
  );
}

function MatchRow({ match, tone, onOpen, onLike, likeLabel, line, speaks }: {
  match: MatchCard;
  tone: number;
  onOpen: () => void;
  onLike: () => void;
  likeLabel: string;
  line: string;
  speaks: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.card, match.liked && styles.cardLiked, pressed && styles.pressed]}
      testID={`match-${match.jobSeekerId}`}
    >
      <Avatar name={match.card.firstName} tone={tone} size={52} />
      <View style={styles.flexBody}>
        <Text style={styles.name}>{`${match.card.firstName}, ${match.card.age}`}</Text>
        <Text variant="muted">{line}</Text>
        <Text variant="muted">{speaks}</Text>
        <Text style={styles.reasons}>{match.matchReasons.join(' · ')}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={likeLabel}
        accessibilityState={{ selected: match.liked }}
        onPress={onLike}
        hitSlop={12}
        style={styles.heart}
        testID={`like-${match.jobSeekerId}`}
      >
        <Text style={[styles.heartText, match.liked && styles.heartOn]}>♥</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flexBody: { flex: 1, gap: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.neutral100,
  },
  chipOn: { backgroundColor: colors.blue100 },
  chipText: { fontFamily: fonts.body700, color: colors.ink, fontSize: 13 },
  chipTextOn: { fontFamily: fonts.body700, color: colors.blue, fontSize: 13 },
  chipAdd: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.blue },
  chipAddText: { fontFamily: fonts.body700, color: colors.blue, fontSize: 13 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  cardLiked: { borderColor: '#F2A68F' },
  pressed: { opacity: 0.7 },
  name: { fontFamily: fonts.display700, color: colors.navy, fontSize: 15 },
  reasons: { color: colors.green, fontFamily: fonts.body700, fontSize: 12.5 },
  heart: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'flex-start' },
  heartText: { fontSize: 24, color: '#B7C3DD' },
  heartOn: { color: colors.tomato },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.blue },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});

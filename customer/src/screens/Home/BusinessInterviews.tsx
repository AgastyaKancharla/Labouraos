import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { BusinessInterview } from '@/api/types';
import { Button, Card, StatusChip, Text } from '@/components';
import { useI18n, type MessageKey } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';

const REASON: Record<string, MessageKey> = {
  skills: 'ivResult.reason.skills',
  experience: 'ivResult.reason.experience',
  communication: 'ivResult.reason.communication',
  salary_expectation: 'ivResult.reason.salary_expectation',
  not_suitable: 'ivResult.reason.not_suitable',
  other: 'ivResult.reason.other',
};

/**
 * 26 Nov (owner): the interview card on the business Home. Our team shares a
 * shortlist on WhatsApp; once the owner picks someone and the interview is
 * booked it shows here — who (first name, age, trade, years, languages,
 * photo; never a surname or phone number) and when. An hour after the start
 * "Give the result" opens: did it happen, selected or not, and why.
 */
export function BusinessInterviews({ profileId, interviews }: { profileId: string; interviews: BusinessInterview[] }) {
  const { t } = useI18n();
  if (interviews.length === 0) return null;
  return (
    <Card title={t('ivCard.title')} accent="cyan" testID="biz-interviews">
      <View style={styles.list}>
        {interviews.map((iv, i) => {
          const c = iv.candidate;
          const facts = [c.age ? t('ivCard.age', { age: c.age }) : null, c.trade, c.yearsExperience !== null ? t('ivCard.years', { years: c.yearsExperience }) : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <View key={iv.id} style={[styles.item, i > 0 && styles.divider]} testID={`biz-interview-${iv.state}`}>
              <View style={styles.row}>
                {c.photoUrl ? (
                  <Image source={{ uri: c.photoUrl }} style={styles.photo} accessibilityLabel={t('ivCard.photoOf', { name: c.firstName })} />
                ) : (
                  <View style={[styles.photo, styles.initial]}>
                    <Text style={styles.initialText}>{c.firstName.slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{t('ivCard.shortlisted', { name: c.firstName })}</Text>
                  {facts ? <Text variant="muted">{facts}</Text> : null}
                  {c.languages.length ? <Text variant="muted">{t('ivCard.speaks', { languages: c.languages.join(', ') })}</Text> : null}
                </View>
              </View>
              <Text testID={`biz-interview-${iv.id}-when`}>
                {t('ivCard.when', { job: iv.trade, day: formatDayIst(iv.startsAt), time: formatTimeIst(iv.startsAt) })}
              </Text>
              {iv.state === 'waiting_for_candidate' ? <StatusChip label={t('ivCard.waitingCandidate', { name: c.firstName })} tone="amber" dot /> : null}
              {iv.state === 'upcoming' ? (
                <Text variant="muted">{t('ivCard.resultLater', { time: formatTimeIst(iv.resultOpensAt) })}</Text>
              ) : null}
              {iv.state === 'result_due' ? (
                <Button label={t('ivCard.giveResult')} onPress={() => router.push(routes.interviewResult(profileId, iv.id))} testID={`biz-interview-${iv.id}-result`} />
              ) : null}
              {iv.state === 'result_sent' ? (
                <StatusChip
                  label={
                    iv.result === 'selected'
                      ? t('ivCard.sentSelected')
                      : iv.result === 'candidate_no_show'
                        ? t('ivCard.sentNoShow')
                        : t('ivCard.sentNotSelected', { reason: iv.resultReason && REASON[iv.resultReason] ? t(REASON[iv.resultReason]!) : '—' })
                  }
                  tone={iv.result === 'selected' ? 'green' : 'neutral'}
                  icon="check"
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  item: { gap: 10, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  flex: { flex: 1, gap: 2 },
  photo: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.blue100 },
  initial: { alignItems: 'center', justifyContent: 'center' },
  initialText: { fontFamily: fonts.display800, fontSize: 22, color: colors.blue },
});

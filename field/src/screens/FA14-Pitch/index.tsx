import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, LoadingState, Screen, Text } from '@/components';
import { MoneyField, Segmented } from '@/components/form';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { useCurrentTab } from '@/navigation/useFlow';
import { type Accent, accents, colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, feeBreakdown, formatRupees, KeyValue, useSellingSettings } from '../_selling';
import { pitchLines, SCRIPT_LANGUAGES, type ScriptLanguage } from '../_selling/scripts';

/**
 * FA14 — Pitch and fee calculator. Three lines to explain Laboura in the
 * owner's language (ಕನ್ನಡ / हिंदी / English, whatever the app language), and
 * the fee: salary → fee + GST (₹15,000 → ₹7,500 + ₹1,350). The percentages
 * come from Settings, never from the app.
 */
export default function PitchScreen() {
  const { t, language } = useI18n();
  const settings = useSellingSettings();
  // Opened during a visit (Visits tab): back to the talk, never a second visit.
  const inVisit = useCurrentTab() === '(visits)';
  const [lang, setLang] = useState<ScriptLanguage>(language);
  const [salary, setSalary] = useState<number | null>(null);
  const s = settings.data;
  const fee = s && salary ? feeBreakdown(salary, s.feePercent, s.gstPercent) : null;
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa14.subtitle')} />
      <Screen testID="screen-FA14">
        <Card title={t('fa14.explain')} icon="chat" accent="cyan">
          <Segmented value={lang} options={SCRIPT_LANGUAGES} onChange={setLang} testID="pitch-language" />
          {s ? (
            <View style={styles.lines} testID="pitch">
              {pitchLines(lang, s.feePercent, s.gstPercent, s.maxFreeReplacements, s.replacementWindowDays).map((line, i) => (
                <View key={i} style={styles.lineRow}>
                  <View style={[styles.lineBar, { backgroundColor: accents[LINE_ACCENTS[i % LINE_ACCENTS.length]].raw }]} />
                  <Text style={styles.line}>{`${i + 1}. ${line}`}</Text>
                </View>
              ))}
            </View>
          ) : settings.isPending ? (
            <LoadingState compact />
          ) : (
            <ErrorBanner error={settings.error} />
          )}
        </Card>
        <Card title={t('fa14.calculator')} icon="rupee" accent="gold">
          <MoneyField label={t('fa14.salary')} required valuePaise={salary} onChange={setSalary} testID="salary" />
          <View style={styles.result}>
            <KeyValue label={t('fa14.fee', { percent: s?.feePercent ?? '' })} value={fee ? formatRupees(fee.fee) : '—'} testID="fee" />
            <KeyValue label={t('fa14.gst', { percent: s?.gstPercent ?? '' })} value={fee ? formatRupees(fee.gst) : '—'} testID="gst" />
            <KeyValue label={t('fa14.total')} last trailing={<Text style={styles.total} testID="total">{fee ? formatRupees(fee.total) : '—'}</Text>} />
          </View>
        </Card>
        {inVisit ? (
          <Button label={t('fa14.backToVisit')} onPress={() => router.back()} testID="back-to-visit" />
        ) : (
          <Button label={t('fa14.register')} onPress={() => router.push(routes.visitStart)} testID="register-business" />
        )}
      </Screen>
    </View>
  );
}

/** The pitch points get a short bar each, in mixed brand colours. */
const LINE_ACCENTS: Accent[] = ['royal', 'cyan', 'gold', 'orange', 'green'];

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  lines: { gap: 8, marginTop: 12 },
  lineRow: { flexDirection: 'row', gap: 10 },
  lineBar: { width: 4, borderRadius: 2 },
  line: { flex: 1, fontSize: 14, lineHeight: 21 },
  result: { marginTop: 8 },
  total: { fontFamily: fonts.display700, color: colors.blue, fontSize: 16 },
});

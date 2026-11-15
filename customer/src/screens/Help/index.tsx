import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomerApi } from '@/api/ApiProvider';
import { errorText } from '@/api/errorText';
import type { CallbackTopic } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, IconTile, Screen, Text, type IconName } from '@/components';
import { RadioGroup, SelectField, TimeField, formatClock } from '@/components/form';
import { useI18n, type MessageKey } from '@/i18n';
import type { Accent } from '@/theme';

const TOPICS: CallbackTopic[] = ['registration', 'payment', 'interview', 'refund', 'business', 'referral', 'other'];
/** Each short answer gets its own colour and drawn icon (the words carry the meaning). */
const FAQ: [MessageKey, MessageKey, IconName, Accent][] = [
  ['help.faq1q', 'help.faq1a', 'rupee', 'good'],
  ['help.faq2q', 'help.faq2a', 'refund', 'royal'],
  ['help.faq3q', 'help.faq3a', 'briefcase', 'orange'],
  ['help.faq4q', 'help.faq4a', 'shield', 'cyan'],
];

/**
 * Help with "Call me back" (proposal section 6, idea 2): turns a confused
 * person into a call task for an agent instead of a lost sign-up. Calls are
 * made 9 AM to 9 PM only (guide, calling hours).
 */
export default function Help() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { activeProfile } = useAuth();
  const [topic, setTopic] = useState<CallbackTopic | ''>('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!topic || (when === 'later' && (!from || !to || to <= from))) {
      setProblem(t('form.fixMarked'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.requestCallback({ profileId: activeProfile?.id ?? null, topic, when, from: when === 'later' ? from : null, to: when === 'later' ? to : null });
      setDone(true);
    } catch (e) {
      setProblem(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex} testID="help">
      <AppHeader title={t('help.title')} onBack={() => router.back()} showAccountActions />
      <Screen>
        <Card title={t('help.callMeBack')} accent="royal" emoji="📞">
          {done ? (
            <Banner
              tone="ok"
              title={t('help.doneTitle')}
              message={when === 'later' ? t('help.doneLater', { from: formatClock(from), to: formatClock(to) }) : t('help.doneNow')}
              testID="help-done"
            />
          ) : (
            <View style={styles.gap}>
              <Text variant="muted">{t('help.callHours')}</Text>
              <SelectField label={t('help.topic')} value={topic} choices={TOPICS.map((v) => ({ value: v, label: t(`topic.${v}`) }))} onChange={setTopic} required testID="help-topic" />
              <RadioGroup
                value={when}
                onChange={setWhen}
                options={[
                  { value: 'now', label: t('help.whenNow') },
                  { value: 'later', label: t('help.whenLater') },
                ]}
                testID="help-when"
              />
              {when === 'later' ? (
                <>
                  <TimeField label={t('help.from')} value={from} onChange={setFrom} from="09:00" to="20:30" step={30} required testID="help-from" />
                  <TimeField label={t('help.to')} value={to} onChange={setTo} from="09:30" to="21:00" step={30} required testID="help-to" />
                </>
              ) : null}
              {problem ? <Banner tone="error" message={problem} testID="help-problem" /> : null}
              <Button label={t('help.submit')} onPress={() => void submit()} loading={busy} testID="help-submit" />
            </View>
          )}
        </Card>
        <Card title={t('help.faqTitle')} accent="gold" emoji="💬">
          <View style={styles.gap}>
            {FAQ.map(([q, a, icon, accent]) => (
              <View key={q} style={styles.faqRow}>
                <IconTile icon={icon} accent={accent} size={32} round />
                <View style={styles.faq}>
                  <Text variant="bodyStrong">{t(q)}</Text>
                  <Text>{t(a)}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 14 }, faqRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, faq: { flex: 1, gap: 4 } });

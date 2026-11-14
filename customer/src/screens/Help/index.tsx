import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import type { CallbackTopic } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, Screen, Text } from '@/components';
import { DateField, RadioGroup, SelectField, TimeField, addDays, formatClock, formatDateKey, todayKeyIst } from '@/components/form';
import { useI18n, type MessageKey } from '@/i18n';

const TOPICS: CallbackTopic[] = ['registration', 'payment', 'interview', 'refund', 'business', 'referral', 'other'];
const FAQ: [MessageKey, MessageKey][] = [
  ['help.faq1q', 'help.faq1a'],
  ['help.faq2q', 'help.faq2a'],
  ['help.faq3q', 'help.faq3a'],
  ['help.faq4q', 'help.faq4a'],
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
  const today = todayKeyIst();
  const [topic, setTopic] = useState<CallbackTopic | ''>('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!topic || (when === 'later' && (!date || !time))) {
      setProblem(t('form.fixMarked'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.requestCallback({ profileId: activeProfile?.id ?? null, topic, when, date: when === 'later' ? date : null, time: when === 'later' ? time : null });
      setDone(true);
    } catch (e) {
      setProblem(isApiError(e) && e.isNetworkError ? t('common.networkError') : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex} testID="help">
      <AppHeader title={t('help.title')} onBack={() => router.back()} showAccountActions />
      <Screen>
        <Card title={t('help.callMeBack')}>
          {done ? (
            <Banner
              tone="ok"
              title={t('help.doneTitle')}
              message={when === 'later' ? t('help.doneLater', { date: formatDateKey(date), time: formatClock(time) }) : t('help.doneNow')}
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
                  <DateField label={t('help.date')} value={date} onChange={setDate} min={today} max={addDays(today, 7)} required testID="help-date" />
                  <TimeField label={t('help.time')} value={time} onChange={setTime} from="09:00" to="20:30" step={30} required testID="help-time" />
                </>
              ) : null}
              {problem ? <Banner tone="error" message={problem} testID="help-problem" /> : null}
              <Button label={t('help.submit')} onPress={() => void submit()} loading={busy} testID="help-submit" />
            </View>
          )}
        </Card>
        <Card title={t('help.faqTitle')}>
          <View style={styles.gap}>
            {FAQ.map(([q, a]) => (
              <View key={q} style={styles.faq}>
                <Text variant="bodyStrong">{t(q)}</Text>
                <Text>{t(a)}</Text>
              </View>
            ))}
          </View>
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 14 }, faq: { gap: 4 } });

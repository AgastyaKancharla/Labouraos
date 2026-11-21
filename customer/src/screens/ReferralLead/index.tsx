import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { errorText } from '@/api/errorText';
import { queryKeys } from '@/api/queryClient';
import type { LeadKind, ReferralLead } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, EmptyState, ErrorState, ListRow, LoadingState, Screen, StatusChip, Text, TextField } from '@/components';
import { Checkbox, MobileField, RadioGroup, SelectField } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatDayIst } from '@/lib/format';
import type { Tone } from '@/theme';

const STAGE_TONE: Record<ReferralLead['stage'], Tone> = { with_team: 'amber', registered: 'green', closed: 'neutral' };

/**
 * Referral partner: "Send a lead" (Master Guide, 21 Nov; contract 7.3b).
 * Someone who wants a job, or a business that needs staff, who agreed to be
 * called. Our call team calls them; if they register, "referred by" is this
 * partner. The partner sees first names and a stage only.
 */
export default function ReferralLeadScreen() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const client = useQueryClient();
  const { activeProfile } = useAuth();
  const profileId = activeProfile?.kind === 'referral_partner' ? activeProfile.id : null;
  const leads = useQuery({ queryKey: queryKeys.referralLeads(profileId ?? ''), queryFn: () => api.referralLeads(profileId!), enabled: Boolean(profileId) });
  const options = useQuery({ queryKey: queryKeys.formOptions, queryFn: () => api.formOptions(), staleTime: 60 * 60_000 });
  const [kind, setKind] = useState<LeadKind | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [area, setArea] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!profileId) return;
    if (!kind || name.trim().length < 2 || phone.length !== 10 || !area || !agreed) {
      setProblem(t('form.fixMarked'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.sendReferralLead(profileId, { kind, name: name.trim(), phone, area, personAgreed: true });
      setSent(true);
      setKind(null);
      setName('');
      setPhone('');
      setArea('');
      setAgreed(false);
      await client.invalidateQueries({ queryKey: queryKeys.referralLeads(profileId) });
    } catch (e) {
      setProblem(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const header = <AppHeader title={t('leads.title')} onBack={() => router.back()} showAccountActions />;
  if (!profileId) {
    return (
      <View style={styles.flex} testID="leads">
        {header}
        <Screen>
          <EmptyState message={t('leads.partnerOnly')} />
        </Screen>
      </View>
    );
  }
  if (leads.isLoading || options.isLoading) {
    return (
      <View style={styles.flex} testID="leads">
        {header}
        <LoadingState />
      </View>
    );
  }
  if (leads.isError || !leads.data || options.isError || !options.data) {
    return (
      <View style={styles.flex} testID="leads">
        {header}
        <ErrorState error={leads.error ?? options.error} onRetry={() => void Promise.all([leads.refetch(), options.refetch()])} />
      </View>
    );
  }
  const data = leads.data;

  return (
    <View style={styles.flex} testID="leads">
      {header}
      <Screen>
        {sent ? <Banner tone="ok" title={t('leads.sentTitle')} message={t('leads.sent')} testID="leads-sent" /> : null}
        {data.open ? (
          <Card title={t('leads.formTitle')} accent="gold" emoji="🤝" testID="leads-form">
            <View style={styles.gap}>
              <Text variant="muted">{t('leads.intro')}</Text>
              <RadioGroup
                label={t('leads.kind')}
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'job_seeker', label: t('leads.kindJob') },
                  { value: 'business', label: t('leads.kindStaff') },
                ]}
                testID="leads-kind"
              />
              <TextField label={kind === 'business' ? t('leads.nameBusiness') : t('leads.name')} value={name} onChangeText={setName} maxLength={80} testID="leads-name" />
              <MobileField label={t('leads.phone')} value={phone} onChange={setPhone} required testID="leads-phone" />
              <SelectField label={t('leads.area')} value={area} choices={options.data.areas.map((a) => ({ value: a.name, label: a.name }))} onChange={setArea} required testID="leads-area" />
              <Checkbox label={t('leads.agreed')} checked={agreed} onChange={setAgreed} testID="leads-agreed" />
              <Text variant="muted">{t('leads.reward')}</Text>
              {problem ? <Banner tone="error" message={problem} testID="leads-problem" /> : null}
              <Button label={t('leads.submit')} onPress={() => void submit()} loading={busy} testID="leads-submit" />
            </View>
          </Card>
        ) : (
          <Banner tone="info" message={t('leads.notOpen')} testID="leads-closed" />
        )}

        <Card title={t('leads.listTitle')} accent="royal" emoji="📋" testID="leads-list">
          {data.leads.length === 0 ? <EmptyState compact emoji="🙂" message={t('leads.none')} /> : null}
          {data.leads.map((l, i) => (
            <ListRow
              key={l.id}
              title={l.firstName ?? '—'}
              subtitle={`${l.kind === 'business' ? t('leads.kindStaffShort') : t('leads.kindJobShort')} · ${formatDayIst(l.sentAt)}`}
              trailing={<StatusChip label={t(`leads.stage.${l.stage}`)} tone={STAGE_TONE[l.stage]} />}
              last={i === data.leads.length - 1}
              testID={`leads-row-${l.id}`}
            />
          ))}
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 14 } });

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { RegisterResult } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, ErrorState, LoadingState, Screen, Text, TextField } from '@/components';
import { Checkbox, DateField, MoneyField, NumberField, PinField, SelectField, TimeField, addDays, todayKeyIst, type Choice } from '@/components/form';
import { useI18n } from '@/i18n';
import { colors } from '@/theme';
import { clearDraft, useDraft } from '@/lib/drafts';
import { RegisterOtpStep } from '../shared/RegisterOtpStep';
import { SavedNextSteps } from '../shared/SavedNextSteps';
import { businessTypeChoices, contactRoleChoices, heardFromChoices, shiftChoices } from '../shared/choices';
import { emptyBusiness, emptyStaffRow, toBusinessForm, validateBusiness, type BusinessErrors } from './form';

/**
 * Business registration, native (proposal 2.2): contact person, the
 * business, address and pin, optional documents, staff needed (each row
 * becomes a draft vacancy) and billing email. The contact person's phone is
 * the verified sign-in number. Then the agreement opens in the secure sheet,
 * signed by OTP. A business sees no candidate until the verification visit
 * and the Team Lead's approval — the app says so plainly.
 */
export default function RegisterBusiness() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { refreshAccount, setActiveProfileId } = useAuth();
  const [draft, setDraft, ready] = useDraft('business', emptyBusiness());
  const [errors, setErrors] = useState<BusinessErrors>({});
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [saved, setSaved] = useState<RegisterResult | null>(null);
  const options = useQuery({ queryKey: queryKeys.formOptions, queryFn: () => api.formOptions(), staleTime: 60 * 60_000 });
  const today = todayKeyIst();
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const err = (key: string) => (errors[key] ? t(errors[key]!) : null);
  const header = <AppHeader title={t('business.title')} onBack={() => router.back()} />;

  if (saved) {
    return (
      <View style={styles.flex}>
        {header}
        <Screen>
          <SavedNextSteps result={saved} purpose="business_agreement" nextSteps={t('business.nextSteps')} testID="biz-saved" />
          <Banner tone="info" message={t('business.visitNote')} />
        </Screen>
      </View>
    );
  }
  if (!ready || options.isLoading) {
    return (
      <View style={styles.flex}>
        {header}
        <LoadingState />
      </View>
    );
  }
  if (options.isError || !options.data) {
    return (
      <View style={styles.flex}>
        {header}
        <ErrorState error={options.error} onRetry={() => void options.refetch()} />
      </View>
    );
  }

  const { areas, trades } = options.data;
  const tradeChoices: Choice[] = trades.map((tr) => ({ value: tr.name, label: tr.name }));
  const areaChoices: Choice[] = areas.map((a) => ({ value: a.name, label: a.name }));
  const setRow = (i: number, patch: Partial<(typeof draft.staffNeeded)[number]>) =>
    setDraft((d) => ({ ...d, staffNeeded: d.staffNeeded.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const review = () => {
    const found = validateBusiness(draft);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep('otp');
  };

  if (step === 'otp') {
    return (
      <View style={styles.flex}>
        {header}
        <Screen>
          <RegisterOtpStep
            testID="biz-register"
            onBack={() => setStep('form')}
            submit={async (otp) => {
              const result = await api.registerBusiness(toBusinessForm(draft, areas), otp);
              await clearDraft('business');
              await refreshAccount();
              setActiveProfileId(result.profile.id);
              setSaved(result);
            }}
          />
        </Screen>
      </View>
    );
  }

  return (
    <View style={styles.flex} testID="biz-form">
      {header}
      <Screen>
        <Banner tone="info" message={t('business.howItWorks')} />
        <Text variant="muted">{t('form.autosaved')}</Text>

        <Card title={t('business.sectionContact')}>
          <View style={styles.gap}>
            <TextField label={t('business.contactName')} value={draft.contactName} onChangeText={(v) => set('contactName', v)} error={err('contactName')} testID="biz-contact-name" />
            <SelectField label={t('business.contactRole')} value={draft.contactRole} choices={contactRoleChoices(t)} onChange={(v) => set('contactRole', v)} required error={err('contactRole')} testID="biz-contact-role" />
            <Text variant="muted">{t('business.contactPhoneNote')}</Text>
          </View>
        </Card>

        <Card title={t('business.sectionBusiness')}>
          <View style={styles.gap}>
            <TextField label={t('business.boardName')} value={draft.boardName} onChangeText={(v) => set('boardName', v)} error={err('boardName')} testID="biz-board-name" />
            <TextField label={t('business.legalName')} value={draft.legalName} onChangeText={(v) => set('legalName', v)} hint={t('business.legalNameHint')} testID="biz-legal-name" />
            <SelectField label={t('business.type')} value={draft.businessType} choices={businessTypeChoices(t)} onChange={(v) => set('businessType', v)} required error={err('businessType')} testID="biz-type" />
            <SelectField
              label={t('business.employeesNow')}
              value={draft.employeeBand}
              choices={(['1-5', '6-20', '21-50', '51-200', '200+'] as const).map((v) => ({ value: v, label: t('business.peopleBand', { band: v }) }))}
              onChange={(v) => set('employeeBand', v)}
              required
              error={err('employeeBand')}
              testID="biz-employees"
            />
            <SelectField
              label={t('business.yearsRunning')}
              value={draft.yearsBand}
              choices={(['under_1', '1_3', '3_10', '10_plus'] as const).map((v) => ({ value: v, label: t(`yearsBand.${v}`) }))}
              onChange={(v) => set('yearsBand', v)}
              testID="biz-years"
            />
            <TimeField label={t('business.openingTime')} value={draft.openingTime} onChange={(v) => set('openingTime', v)} from="05:00" to="12:00" step={30} testID="biz-opens" />
            <TimeField label={t('business.closingTime')} value={draft.closingTime} onChange={(v) => set('closingTime', v)} from="12:00" to="23:30" step={30} testID="biz-closes" />
          </View>
        </Card>

        <Card title={t('business.sectionAddress')}>
          <View style={styles.gap}>
            <TextField label={t('business.shopNumber')} value={draft.shopNumber} onChangeText={(v) => set('shopNumber', v)} testID="biz-shop-no" />
            <TextField label={t('business.street')} value={draft.street} onChangeText={(v) => set('street', v)} error={err('street')} testID="biz-street" />
            <TextField label={t('business.landmark')} value={draft.landmark} onChangeText={(v) => set('landmark', v)} testID="biz-landmark" />
            <SelectField
              label={t('form.area')}
              value={draft.area}
              choices={areaChoices}
              onChange={(v) => {
                const area = areas.find((a) => a.name === v);
                setDraft((d) => ({ ...d, area: v, pincode: d.pincode || area?.pincode || '' }));
              }}
              required
              error={err('area')}
              testID="biz-area"
            />
            <TextField label={t('form.pincode')} value={draft.pincode} onChangeText={(v) => set('pincode', v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" error={err('pincode')} testID="biz-pincode" />
            <PinField label={t('business.shopPin')} value={draft.pin} onChange={(v) => set('pin', v)} testID="biz-pin" />
          </View>
        </Card>

        <Card title={t('business.sectionDocuments')}>
          <View style={styles.gap}>
            <Text variant="muted">{t('business.documentsOptional')}</Text>
            <Checkbox label={t('business.noDocuments')} checked={draft.noDocuments} onChange={(v) => set('noDocuments', v)} testID="biz-no-docs" />
            {!draft.noDocuments ? (
              <>
                <TextField label={t('business.gstin')} value={draft.gstin} onChangeText={(v) => set('gstin', v.toUpperCase().slice(0, 15))} autoCapitalize="characters" error={err('gstin')} testID="biz-gstin" />
                <TextField label={t('business.fssai')} value={draft.fssai} onChangeText={(v) => set('fssai', v.replace(/\D/g, '').slice(0, 14))} keyboardType="number-pad" testID="biz-fssai" />
                <TextField label={t('business.shopEstablishment')} value={draft.shopEstablishment} onChangeText={(v) => set('shopEstablishment', v)} testID="biz-se" />
                <TextField label={t('business.udyam')} value={draft.udyamOrTradeLicence} onChangeText={(v) => set('udyamOrTradeLicence', v)} testID="biz-udyam" />
                <TextField label={t('business.pan')} value={draft.pan} onChangeText={(v) => set('pan', v.toUpperCase().slice(0, 10))} autoCapitalize="characters" testID="biz-pan" />
              </>
            ) : null}
          </View>
        </Card>

        <Card title={t('business.sectionStaff')}>
          <View style={styles.gap}>
            <Text variant="muted">{t('business.staffNote')}</Text>
            {draft.staffNeeded.map((row, i) => (
              <View key={i} style={styles.row}>
                <Text variant="label">{t('business.staffRow', { n: i + 1 })}</Text>
                <SelectField label={t('vacancy.trade')} value={row.trade} choices={tradeChoices} onChange={(v) => setRow(i, { trade: v })} required error={err(`staffTrade${i}`)} testID={`biz-staff-trade-${i}`} />
                <NumberField label={t('business.howMany')} value={row.count} onChange={(v) => setRow(i, { count: v })} required max={99} error={err(`staffCount${i}`)} testID={`biz-staff-count-${i}`} />
                <MoneyField label={t('vacancy.salaryMin')} valuePaise={row.salaryMinPaise} onChange={(v) => setRow(i, { salaryMinPaise: v })} required error={err(`staffMin${i}`)} testID={`biz-staff-min-${i}`} />
                <MoneyField label={t('vacancy.salaryMax')} valuePaise={row.salaryMaxPaise} onChange={(v) => setRow(i, { salaryMaxPaise: v })} required error={err(`staffSalary${i}`)} testID={`biz-staff-max-${i}`} />
                <SelectField label={t('form.shift')} value={row.shift} choices={shiftChoices(t)} onChange={(v) => setRow(i, { shift: v })} testID={`biz-staff-shift-${i}`} />
                <DateField label={t('vacancy.startDate')} value={row.startDate} onChange={(v) => setRow(i, { startDate: v })} min={today} max={addDays(today, 180)} required error={err(`staffStart${i}`)} testID={`biz-staff-start-${i}`} />
                {draft.staffNeeded.length > 1 ? (
                  <Button label={t('form.remove')} variant="danger" onPress={() => setDraft((d) => ({ ...d, staffNeeded: d.staffNeeded.filter((_, j) => j !== i) }))} testID={`biz-staff-remove-${i}`} />
                ) : null}
              </View>
            ))}
            {errors.staff ? <Banner tone="error" message={t(errors.staff)} /> : null}
            <Button label={t('business.addStaffRow')} variant="secondary" onPress={() => setDraft((d) => ({ ...d, staffNeeded: [...d.staffNeeded, emptyStaffRow()] }))} testID="biz-staff-add" />
          </View>
        </Card>

        <Card title={t('business.sectionBilling')}>
          <View style={styles.gap}>
            <TextField
              label={t('business.billingEmail')}
              value={draft.billingEmail}
              onChangeText={(v) => set('billingEmail', v.trim())}
              keyboardType="email-address"
              autoCapitalize="none"
              hint={t('business.billingEmailHint')}
              error={err('billingEmail')}
              testID="biz-email"
            />
            <SelectField label={t('form.heardFrom')} value={draft.heardFrom} choices={heardFromChoices(t)} onChange={(v) => set('heardFrom', v)} required testID="biz-heard" />
          </View>
        </Card>

        <Card title={t('business.sectionVisit')}>
          <View style={styles.gap}>
            <Text variant="muted">{t('business.visitWhy')}</Text>
            <DateField label={t('business.visitDate')} value={draft.visitDate} onChange={(v) => set('visitDate', v)} min={addDays(today, 1)} max={addDays(today, 14)} testID="biz-visit-date" />
            <TimeField label={t('business.visitTime')} value={draft.visitTime} onChange={(v) => set('visitTime', v)} from="10:00" to="18:00" step={30} error={err('visitTime')} testID="biz-visit-time" />
          </View>
        </Card>

        {Object.keys(errors).length > 0 ? <Banner tone="error" message={t('form.fixMarked')} testID="biz-errors" /> : null}
        <Button label={t('business.save')} onPress={review} testID="biz-submit" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 14 },
  row: { gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
});

import { Linking, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useState } from 'react';
import type { ReferralHome, ReferralPerson } from '@/api/types';
import { Banner, Button, Card, EmptyState, ListRow, StatusChip, StepList, Text } from '@/components';
import { formatDateKey } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatDayIst } from '@/lib/format';
import { rupees } from '@/lib/money';
import { colors, type Tone } from '@/theme';
import { useSecureSheet } from '../shared/useSecureSheet';

const STAGE_TONE: Record<ReferralPerson['stage'], Tone> = { registered: 'neutral', paid: 'cyan', interview: 'amber', joined: 'green', closed: 'neutral' };
/** Near the yearly limit where tax may be deducted (CA to confirm). */
const TAX_NOTE_FROM_PAISE = 1_500_000;

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Referral partner Home: share link + QR + ready WhatsApp text; people
 * referred by FIRST NAME AND STAGE ONLY (no phone, no workplace); money
 * due / approved / paid as a payout statement (a partner gets paid, so no
 * invoice); signed terms and consent copies.
 */
export function ReferralHomeView({ profileId, home }: { profileId: string; home: ReferralHome }) {
  const { t } = useI18n();
  const sheet = useSecureSheet();
  const [copied, setCopied] = useState(false);
  const stepsDone = Object.values(home.steps).every((s) => s === 'done');
  const shareText = home.shareLink ? t('refHome.shareText', { link: home.shareLink }) : '';

  return (
    <View style={styles.gap} testID="ref-home">
      {home.paused ? <Banner tone="warn" title={t('refHome.pausedTitle')} message={home.pausedReason ?? t('refHome.paused')} testID="ref-home-paused" /> : null}

      {!stepsDone ? (
        <Card title={t('refHome.finishTitle')} testID="ref-home-steps">
          <View style={styles.gap}>
            <StepList
              testID="ref-step"
              steps={[
                { key: 'terms', label: t('refHome.stepTerms'), state: home.steps.terms },
                { key: 'selfie', label: t('jsHome.stepSelfie'), state: home.steps.selfie },
                { key: 'idCheck', label: t('jsHome.stepId'), state: home.steps.idCheck },
                { key: 'upi', label: t('refHome.stepUpi'), state: home.steps.upi },
              ]}
            />
            {home.stuckReason ? <Banner tone="warn" message={home.stuckReason} /> : null}
            <Button label={t('jsHome.continue')} loading={sheet.busy} onPress={() => void sheet.open(profileId, 'registration')} testID="ref-home-continue" />
          </View>
        </Card>
      ) : null}

      {home.shareLink && !home.paused ? (
        <Card title={t('refHome.shareTitle')} testID="ref-home-share">
          <View style={styles.gap}>
            <Text>{t('refHome.shareExplain', { amount: rupees(home.money.rewardPaise) })}</Text>
            <View style={styles.qr} testID="ref-home-qr">
              <QRCode value={home.shareLink} size={180} color={colors.navy} backgroundColor={colors.white} />
            </View>
            <Text variant="small" align="center" selectable testID="ref-home-link">
              {home.shareLink}
            </Text>
            <Button label={t('refHome.whatsapp')} variant="success" onPress={() => void Linking.openURL(whatsappUrl(shareText))} testID="ref-home-whatsapp" />
            <Button label={t('refHome.share')} variant="secondary" onPress={() => void Share.share({ message: shareText })} testID="ref-home-share-button" />
            <Button
              label={copied ? t('refHome.copied') : t('refHome.copy')}
              variant="secondary"
              onPress={async () => {
                await Clipboard.setStringAsync(home.shareLink ?? '');
                setCopied(true);
              }}
              testID="ref-home-copy"
            />
          </View>
        </Card>
      ) : null}

      <Card title={t('refHome.referredTitle')} testID="ref-home-referred">
        {home.referrals.length === 0 ? <EmptyState compact message={t('refHome.noneYet')} /> : null}
        {home.referrals.map((p, i) => (
          <ListRow
            key={p.id}
            title={p.firstName}
            subtitle={t('refHome.referredOn', { date: formatDateKey(p.referredOn.slice(0, 10)) })}
            trailing={<StatusChip label={t(`refStage.${p.stage}`)} tone={STAGE_TONE[p.stage]} />}
            last={i === home.referrals.length - 1}
            testID={`ref-home-person-${p.id}`}
          />
        ))}
      </Card>

      <Card title={t('refHome.moneyTitle')} testID="ref-home-money">
        <View style={styles.gap}>
          <Text variant="muted">{t('refHome.moneyRule', { amount: rupees(home.money.rewardPaise) })}</Text>
          <View style={styles.totals}>
            {(
              [
                ['refHome.due', home.money.duePaise, 'ref-home-due'],
                ['refHome.approved', home.money.approvedPaise, 'ref-home-approved'],
                ['refHome.paid', home.money.paidPaise, 'ref-home-paid'],
              ] as const
            ).map(([key, paise, id]) => (
              <View key={key} style={styles.total} testID={id}>
                <Text variant="label">{t(key)}</Text>
                <Text variant="stat">{rupees(paise)}</Text>
              </View>
            ))}
          </View>
          {home.money.payouts.map((line, i) => (
            <ListRow
              key={line.id}
              title={`${line.firstName} · ${rupees(line.amountPaise)}`}
              subtitle={line.status === 'paid' ? t('refHome.paidLine', { date: line.paidOn ? formatDayIst(line.paidOn) : '—', ref: line.upiRef ?? '—' }) : undefined}
              trailing={<StatusChip label={t(`payout.${line.status}`)} tone={line.status === 'paid' ? 'green' : line.status === 'approved' ? 'cyan' : 'amber'} />}
              last={i === home.money.payouts.length - 1}
              testID={`ref-home-payout-${line.id}`}
            />
          ))}
          <Text variant="small">{t('refHome.yearTotal', { amount: rupees(home.money.yearTotalPaise) })}</Text>
          {home.money.yearTotalPaise >= TAX_NOTE_FROM_PAISE ? <Banner tone="info" message={t('refHome.taxNote')} testID="ref-home-tax" /> : null}
        </View>
      </Card>

      {home.documents.length > 0 ? (
        <Card title={t('refHome.documentsTitle')} testID="ref-home-documents">
          <View style={styles.gap}>
            {home.documents.map((doc) => (
              <Button
                key={doc.id}
                label={t(doc.kind === 'terms' ? 'refHome.viewTerms' : 'refHome.viewConsent', { date: formatDayIst(doc.signedAt) })}
                variant="secondary"
                onPress={() => void sheet.open(profileId, 'document', doc.id)}
                testID={`ref-home-doc-${doc.kind}`}
              />
            ))}
          </View>
        </Card>
      ) : null}
      {sheet.error ? <Banner tone="error" message={sheet.error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  qr: { alignItems: 'center', padding: 12, backgroundColor: colors.white },
  totals: { flexDirection: 'row', gap: 8 },
  total: { flex: 1, gap: 4, padding: 10, borderRadius: 10, backgroundColor: colors.neutral100 },
});

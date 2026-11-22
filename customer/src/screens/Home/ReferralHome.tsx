import type { ReactNode } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useState } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { routes } from '@/navigation/routes';
import type { ReferralHome, ReferralPerson } from '@/api/types';
import { Banner, Button, Card, EmptyState, HeroCard, heroText, ListRow, ProgressBar, StatGrid, StatTile, StatusChip, StepList, Text, type StepItem } from '@/components';
import { formatDateKey } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatDayIst } from '@/lib/format';
import { rupees } from '@/lib/money';
import { colors, radius, type Tone } from '@/theme';
import type { HeroInfo } from './hero';
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
export function ReferralHomeView({ profileId, home, hero, belowHero }: { profileId: string; home: ReferralHome; hero: HeroInfo; belowHero?: ReactNode }) {
  const { t } = useI18n();
  const sheet = useSecureSheet();
  const api = useCustomerApi();
  // "Send a lead" shows only once the server switches it on (contract 7.3b).
  const config = useQuery({ queryKey: queryKeys.config, queryFn: () => api.config(), staleTime: 10 * 60_000 });
  const [copied, setCopied] = useState(false);
  const stepsDone = Object.values(home.steps).every((s) => s === 'done');
  const shareText = home.shareText || (home.shareLink ? t('refHome.shareText', { link: home.shareLink }) : '');
  const steps: StepItem[] = [
    { key: 'terms', label: t('refHome.stepTerms'), state: home.steps.terms, icon: 'doc', accent: 'navy' },
    { key: 'selfie', label: t('jsHome.stepSelfie'), state: home.steps.selfie, icon: 'camera', accent: 'gold' },
    { key: 'idCheck', label: t('jsHome.stepId'), state: home.steps.idCheck, icon: 'id-card', accent: 'orange' },
    { key: 'upi', label: t('refHome.stepUpi'), state: home.steps.upi, icon: 'rupee', accent: 'good' },
  ];
  const nextStep = steps.find((s) => s.state !== 'done');
  const doneCount = steps.filter((s) => s.state === 'done').length;

  return (
    <View style={styles.gap} testID="ref-home">
      <HeroCard eyebrow={hero.eyebrow} title={hero.title} emoji={home.paused ? '⏸️' : stepsDone ? '🤝' : '📝'} testID="ref-home-hero">
        {!stepsDone ? (
          <View style={styles.heroBlock} testID="ref-home-hero-next">
            <Text style={heroText.label}>{t('refHome.finishTitle')}</Text>
            {nextStep ? <Text style={heroText.big}>{nextStep.label}</Text> : null}
            <ProgressBar value={doneCount / steps.length} color={colors.goldRaw} trackColor={colors.heroTrack} />
          </View>
        ) : null}
      </HeroCard>
      {belowHero}

      {home.paused ? <Banner tone="warn" title={t('refHome.pausedTitle')} message={home.pausedReason ?? t('refHome.paused')} testID="ref-home-paused" /> : null}

      <StatGrid columns={2}>
        <StatTile label={t('refHome.referredTitle')} value={home.referrals.length} accent="cyan" icon="users" testID="ref-home-referred-count" />
        <StatTile label={t('refHome.due')} value={rupees(home.money.duePaise)} accent="gold" icon="clock" testID="ref-home-due" />
        <StatTile label={t('refHome.approved')} value={rupees(home.money.approvedPaise)} accent="royal" icon="check" testID="ref-home-approved" />
        <StatTile label={t('refHome.paid')} value={rupees(home.money.paidPaise)} accent="good" icon="rupee" testID="ref-home-paid" />
      </StatGrid>

      {!stepsDone ? (
        <Card title={t('refHome.finishTitle')} accent="royal" testID="ref-home-steps">
          <View style={styles.gap}>
            <StepList testID="ref-step" steps={steps} />
            {home.stuckReason ? <Banner tone="warn" message={home.stuckReason} /> : null}
            <Button label={t('jsHome.continue')} onPress={() => router.push(routes.verify('referral_registration', profileId))} testID="ref-home-continue" />
          </View>
        </Card>
      ) : null}

      {config.data?.referralLeads && stepsDone && !home.paused ? (
        <Card title={t('refHome.leadTitle')} accent="orange" emoji="🤝" testID="ref-home-lead">
          <View style={styles.gap}>
            <Text>{t('refHome.leadIntro')}</Text>
            <Button label={t('refHome.leadButton')} variant="secondary" onPress={() => router.push(routes.referralLead)} testID="ref-home-send-lead" />
          </View>
        </Card>
      ) : null}

      {home.shareLink && !home.paused ? (
        <Card title={t('refHome.shareTitle')} accent="gold" emoji="🔗" style={styles.shareCard} testID="ref-home-share">
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

      <Card title={t('refHome.referredTitle')} accent="cyan" testID="ref-home-referred">
        {home.referrals.length === 0 ? <EmptyState compact emoji="👋" message={t('refHome.noneYet')} /> : null}
        {home.referrals.map((p, i) => (
          <ListRow
            key={p.id}
            title={p.firstName}
            subtitle={p.referredOn ? t('refHome.referredOn', { date: formatDateKey(p.referredOn.slice(0, 10)) }) : undefined}
            trailing={<StatusChip label={t(`refStage.${p.stage}`)} tone={STAGE_TONE[p.stage]} />}
            last={i === home.referrals.length - 1}
            testID={`ref-home-person-${p.id}`}
          />
        ))}
      </Card>

      <Card title={t('refHome.moneyTitle')} accent="good" emoji="💰" testID="ref-home-money">
        <View style={styles.gap}>
          <Text variant="muted">{t('refHome.moneyRule', { amount: rupees(home.money.rewardPaise) })}</Text>
          {home.money.payouts.map((line, i) => (
            <ListRow
              key={line.id}
              title={line.firstName ? `${line.firstName} · ${rupees(line.amountPaise)}` : rupees(line.amountPaise)}
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
        <Card title={t('refHome.documentsTitle')} accent="navy" emoji="📄" testID="ref-home-documents">
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
  heroBlock: { gap: 8 },
  shareCard: { borderColor: colors.amberBorder },
  qr: { alignSelf: 'center', padding: 12, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.goldRaw },
});

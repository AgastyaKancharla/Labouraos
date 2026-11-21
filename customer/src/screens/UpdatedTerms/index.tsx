import { htmlToText } from '@/lib/html';
import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import type { LegalHomeStatus, OtpProof } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Card, HeroCard, LoadingState, Text } from '@/components';
import { Checkbox } from '@/components/form';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { OtpCodeCard } from '../shared/OtpCodeCard';

export { htmlToText };

/**
 * "We've updated our terms" (legal documents v1.1, rev 176) — blocking: the
 * person who accepted an older version reads the "In short", can open the
 * full terms, ticks each permission and accepts by a fresh OTP (step-up
 * "accept_terms"). A business owner signs the new agreement on its link.
 * A running guarantee keeps the terms it was paid under.
 */
export function UpdatedTerms({ profileId, legal }: { profileId: string; legal: LegalHomeStatus }) {
  const { t, language } = useI18n();
  const api = useCustomerApi();
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const doc = useQuery({ queryKey: ['legal-document', profileId, language], queryFn: () => api.legalDocument(profileId, language) });
  const [showFull, setShowFull] = useState(false);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const isBusiness = legal.documentKey === 'business_agreement';
  const d = doc.data;
  const allRequired = !!d && d.consents.filter((c) => c.required).every((c) => ticked[c.purpose]);

  const accept = async (otp: OtpProof) => {
    if (!d) return;
    setProblem(null);
    try {
      await api.acceptTerms(profileId, { purposes: d.consents.filter((c) => ticked[c.purpose]).map((c) => c.purpose), language, otp, textHash: d.hash });
      await queryClient.invalidateQueries({ queryKey: queryKeys.home(profileId) });
    } catch (e) {
      setProblem(isApiError(e) ? e.message : t('terms.failed'));
      throw e;
    }
  };

  return (
    <View style={styles.gap} testID="updated-terms">
      <HeroCard eyebrow={t('terms.eyebrow')} title={t('terms.title')} />
      <Text>{legal.acceptedVersion ? t('terms.intro', { old: legal.acceptedVersion, version: legal.currentVersion }) : t('terms.introNew', { version: legal.currentVersion })}</Text>
      {doc.isLoading ? <LoadingState /> : null}
      {d ? (
        <>
          <Card title={t('terms.inShort')} accent="royal" testID="terms-in-short">
            <View style={styles.gap}>
              {d.summary.map((line, i) => (
                <Text key={i}>• {htmlToText(line)}</Text>
              ))}
            </View>
          </Card>
          <Pressable accessibilityRole="button" onPress={() => setShowFull((v) => !v)} testID="terms-read-full">
            <Text style={styles.link}>{t('terms.readFull')}</Text>
          </Pressable>
          {showFull ? (
            <Card testID="terms-full">
              <Text variant="muted">{htmlToText(d.bodyHtml)}</Text>
            </Card>
          ) : null}
          <Text variant="muted">{t('terms.version', { version: d.version })}</Text>
          {isBusiness ? (
            <Button label={t('terms.signAgreement')} onPress={() => router.push(routes.verify('business_agreement', profileId))} testID="terms-sign-agreement" />
          ) : (
            <>
              {d.consents.map((c) => (
                <Checkbox
                  key={c.purpose}
                  label={`${c.title} — ${c.description}`}
                  checked={!!ticked[c.purpose]}
                  onChange={(v) => setTicked((prev) => ({ ...prev, [c.purpose]: v }))}
                  testID={`terms-tick-${c.purpose}`}
                />
              ))}
              {!allRequired ? <Text variant="muted">{t('terms.needAll')}</Text> : null}
              <OtpCodeCard
                testID="terms-otp"
                disabled={!allRequired}
                send={(resendOf) => api.sendStepUp('accept_terms', resendOf)}
                submit={accept}
                sendLabel={t('terms.sendOtp', { last4: account?.phoneLast4 ?? '' })}
                submitLabel={t('terms.accept')}
                codeSubmits
                sentText={t('otp.sentTo', { last4: account?.phoneLast4 ?? '' })}
              />
            </>
          )}
        </>
      ) : null}
      {problem ? <Banner tone="error" message={problem} testID="terms-problem" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 }, link: { color: colors.blue, fontWeight: '700', minHeight: 44, textAlignVertical: 'center' } });

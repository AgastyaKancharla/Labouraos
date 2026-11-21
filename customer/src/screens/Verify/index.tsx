import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { MOCK_SHEET_URL } from '@/api/mock';
import { queryKeys } from '@/api/queryClient';
import type { SheetPurpose } from '@/api/types';
import { AppHeader, Banner, Button, ErrorState, LoadingState, Screen } from '@/components';
import { useI18n, type MessageKey } from '@/i18n';
import { routes } from '@/navigation/routes';
import { openSecureSheet } from '@/sheet/openSheet';
import { mockLinkToken } from '@/verify/mockSteps';
import { tokenFromLink } from '@/verify/stepsApi';
import { AgreementSteps } from './AgreementSteps';
import { JobSeekerSteps } from './JobSeekerSteps';
import { PartnerSteps } from './PartnerSteps';

export type VerifyPurpose = Exclude<SheetPurpose, 'document'>;
const PURPOSES: VerifyPurpose[] = ['registration', 'referral_registration', 'business_agreement'];
const TITLE: Record<VerifyPurpose, MessageKey> = { registration: 'reg.title', referral_registration: 'rp.title', business_agreement: 'bizHome.signAgreement' };

/**
 * The verification steps in the app's own screens (decided 21 Nov: native
 * screens instead of the browser sheet). The server issues this person's own
 * link for the profile (POST /me/profiles/:id/links — the same link an agent
 * sends by SMS), and every step calls that link's endpoints with its token,
 * so each check stays on the server exactly as on the link page. Only the
 * e-Aadhaar PDF still opens the page in the browser sheet.
 */
export default function VerifyScreen() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ purpose?: string; profileId?: string }>();
  const purpose = PURPOSES.find((p) => p === params.purpose) ?? null;
  const profileId = params.profileId ?? null;
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserProblem, setBrowserProblem] = useState(false);

  const link = useQuery({
    queryKey: ['verify', 'link', profileId, purpose],
    queryFn: () => api.sheetLink(profileId!, purpose!),
    enabled: Boolean(profileId && purpose),
    // One link per visit: the server allows 10 links an hour per profile.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const finish = useCallback(() => {
    if (profileId) void client.invalidateQueries({ queryKey: queryKeys.home(profileId) });
    router.replace(routes.home);
  }, [client, profileId]);

  // Home shows the new step state when the person comes back by the header's back arrow too.
  useEffect(
    () => () => {
      if (profileId) void client.invalidateQueries({ queryKey: queryKeys.home(profileId) });
    },
    [client, profileId],
  );

  const url = link.data?.url ?? null;
  const token = url ? (url === MOCK_SHEET_URL ? mockLinkToken(profileId ?? '') : tokenFromLink(url)) : null;

  const openInBrowser = async () => {
    if (!url) return;
    setBrowserBusy(true);
    setBrowserProblem(false);
    try {
      await openSecureSheet(url);
      await client.invalidateQueries({ queryKey: ['verify'], predicate: (q) => q.queryKey[1] !== 'link' });
    } catch {
      setBrowserProblem(true);
    } finally {
      setBrowserBusy(false);
    }
  };

  const header = <AppHeader title={purpose ? t(TITLE[purpose]) : t('verify.loading')} onBack={() => router.back()} />;
  let body;
  if (!purpose || !profileId) body = <ErrorState />;
  else if (link.isLoading) body = <LoadingState label={t('verify.loading')} />;
  else if (link.isError || !token) {
    body = (
      <View style={styles.gap}>
        <Banner tone="error" message={t('verify.linkFailed')} testID="verify-link-failed" />
        <Button label={t('verify.retry')} onPress={() => void link.refetch()} testID="verify-retry" />
      </View>
    );
  } else {
    const flow = { token, openInBrowser: () => void openInBrowser(), browserBusy, onFinished: finish };
    body =
      purpose === 'registration' ? <JobSeekerSteps {...flow} /> : purpose === 'referral_registration' ? <PartnerSteps {...flow} /> : <AgreementSteps {...flow} />;
  }

  return (
    <View style={styles.flex} testID="verify">
      {header}
      <Screen>
        {browserProblem ? <Banner tone="error" message={t('sheet.failed')} /> : null}
        {body}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 14 } });

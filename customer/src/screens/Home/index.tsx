import { useEffect } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthProvider';
import { AdSlot, AppHeader, BottomBar, ErrorState, LoadingState, QuickActions, Screen, SwooshCurve, Text, type QuickAction } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors, fonts, radius } from '@/theme';
import { BusinessHomeView } from './BusinessHome';
import { JobSeekerHomeView } from './JobSeekerHome';
import { ReferralHomeView } from './ReferralHome';
import { UpdatedTerms } from '../UpdatedTerms';

/**
 * Home for the profile picked on "My profiles" (remembered on the phone).
 * Each kind has its own status view (proposal section 9, phase 1). It
 * refreshes when the person comes back to the app — after the secure sheet,
 * or after the phone's browser in the fallback — and on pull-down.
 *
 * Version 2: the navy header carries on behind the hero card and ends in the
 * swoosh curve; under the hero sit quick actions and (test app only) the ad
 * space; a bottom bar replaces the text links, with a round button in the
 * middle for a business's or referral partner's main action.
 */
export default function Home() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { account, activeProfile } = useAuth();
  const profileId = activeProfile?.id ?? '';
  const home = useQuery({ queryKey: queryKeys.home(profileId), queryFn: () => api.home(profileId), enabled: !!profileId });
  const { refetch } = home;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && profileId) void refetch();
    });
    return () => sub.remove();
  }, [profileId, refetch]);

  if (!activeProfile) return <Redirect href={routes.role} />;

  const count = account?.profiles.length ?? 0;
  const roleLine = `${t(`kind.${activeProfile.kind}`)}${activeProfile.code ? ` · ${activeProfile.code}` : ''}`;
  const hero = { eyebrow: roleLine, title: activeProfile.displayName };
  const kind = activeProfile.kind;
  const hasPartner = (account?.profiles ?? []).some((p) => p.kind === 'referral_partner');
  const quick: QuickAction[] = [
    kind === 'business'
      ? { key: 'add-vacancy', label: t('quick.addVacancy'), icon: 'plus', accent: 'royal', onPress: () => router.push(routes.addVacancy) }
      : kind === 'referral_partner'
        ? { key: 'send-lead', label: t('quick.sendLead'), icon: 'users', accent: 'orange', onPress: () => router.push(routes.referralLead) }
        : { key: 'refer', label: t('quick.refer'), icon: 'users', accent: 'orange', onPress: () => router.push(hasPartner ? routes.profiles : routes.registerReferral) },
    { key: 'messages', label: t('quick.messages'), icon: 'chat', accent: 'royal', onPress: () => router.push(routes.inbox) },
    { key: 'help', label: t('quick.help'), icon: 'help', accent: 'good', onPress: () => router.push(routes.help) },
    { key: 'settings', label: t('quick.settings'), icon: 'shield', accent: 'navy', onPress: () => router.push(routes.settings) },
  ];
  const belowHero = (
    <>
      <QuickActions actions={quick} testID="home-quick" />
      <AdSlot testID="home-ad" />
    </>
  );
  const centre =
    kind === 'business'
      ? { label: t('nav.addVacancy'), icon: 'plus' as const, onPress: () => router.push(routes.addVacancy), testID: 'home-bar-add-vacancy' }
      : kind === 'referral_partner'
        ? { label: t('nav.sendLead'), icon: 'share' as const, onPress: () => router.push(routes.referralLead), testID: 'home-bar-send-lead' }
        : undefined;
  const showData = !!home.data;
  return (
    <View style={styles.flex} testID="home">
      <AppHeader title={activeProfile.displayName} subtitle={roleLine} showAccountActions flat />
      <Screen onRefresh={() => void refetch()} refreshing={home.isRefetching}>
        <View style={[styles.tail, showData && styles.tailOverlap]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(routes.profiles)}
            style={({ pressed }) => [styles.switcher, pressed && styles.pressed]}
            testID="home-switch-profile"
          >
            <Text style={styles.switcherText}>{count > 1 ? t('home.switchProfile', { count }) : t('home.addProfile')}</Text>
          </Pressable>
          <SwooshCurve />
        </View>
        {home.isLoading ? <LoadingState /> : null}
        {home.isError ? <ErrorState error={home.error} onRetry={() => void refetch()} /> : null}
        {/* Legal documents v1.1 (rev 176): an older version accepted → this blocks Home until accepted. */}
        {home.data?.legal?.needsReconsent ? <UpdatedTerms profileId={profileId} legal={home.data.legal} /> : null}
        {!home.data?.legal?.needsReconsent && home.data?.kind === 'job_seeker' ? <JobSeekerHomeView profileId={profileId} home={home.data} hero={hero} belowHero={belowHero} /> : null}
        {!home.data?.legal?.needsReconsent && home.data?.kind === 'business' ? <BusinessHomeView profileId={profileId} home={home.data} hero={hero} belowHero={belowHero} /> : null}
        {!home.data?.legal?.needsReconsent && home.data?.kind === 'referral_partner' ? <ReferralHomeView profileId={profileId} home={home.data} hero={hero} belowHero={belowHero} /> : null}
      </Screen>
      <BottomBar
        testID="home-bar"
        centre={centre}
        items={[
          { key: 'home', label: t('nav.home'), icon: 'home', active: true, onPress: () => void refetch() },
          { key: 'messages', label: t('nav.messages'), icon: 'chat', onPress: () => router.push(routes.inbox) },
          { key: 'profiles', label: t('nav.profiles'), icon: 'user', onPress: () => router.push(routes.profiles) },
          { key: 'help', label: t('nav.help'), icon: 'help', onPress: () => router.push(routes.help) },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // The navy carries on from the header behind the top of the hero card.
  tail: { backgroundColor: colors.navy, marginHorizontal: -16, marginTop: -16, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 40 },
  tailOverlap: { height: 124, marginBottom: -74 },
  switcher: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  switcherText: { fontFamily: fonts.body700, color: colors.white },
  pressed: { opacity: 0.7 },
});

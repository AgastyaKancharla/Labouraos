import { useEffect } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, ErrorState, LoadingState, Screen, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors, fonts, radius, touch } from '@/theme';
import { BusinessHomeView } from './BusinessHome';
import { JobSeekerHomeView } from './JobSeekerHome';
import { ReferralHomeView } from './ReferralHome';

/**
 * Home for the profile picked on "My profiles" (remembered on the phone).
 * Each kind has its own status view (proposal section 9, phase 1). It
 * refreshes when the person comes back to the app — after the secure sheet,
 * or after the phone's browser in the fallback — and on pull-down.
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
  return (
    <View style={styles.flex} testID="home">
      <AppHeader title={activeProfile.displayName} subtitle={`${t(`kind.${activeProfile.kind}`)}${activeProfile.code ? ` · ${activeProfile.code}` : ''}`} showAccountActions />
      <Screen onRefresh={() => void refetch()} refreshing={home.isRefetching}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(routes.profiles)}
          style={({ pressed }) => [styles.switcher, pressed && styles.pressed]}
          testID="home-switch-profile"
        >
          <Text style={styles.switcherText}>{count > 1 ? t('home.switchProfile', { count }) : t('home.addProfile')}</Text>
        </Pressable>
        {home.isLoading ? <LoadingState /> : null}
        {home.isError ? <ErrorState error={home.error} onRetry={() => void refetch()} /> : null}
        {home.data?.kind === 'job_seeker' ? <JobSeekerHomeView profileId={profileId} home={home.data} /> : null}
        {home.data?.kind === 'business' ? <BusinessHomeView profileId={profileId} home={home.data} /> : null}
        {home.data?.kind === 'referral_partner' ? <ReferralHomeView profileId={profileId} home={home.data} /> : null}
        <View style={styles.links}>
          {(
            [
              ['home.help', routes.help, 'home-help'],
              ['home.privacy', routes.privacy, 'home-privacy'],
              ['home.settings', routes.settings, 'home-settings'],
            ] as const
          ).map(([key, href, id]) => (
            <Pressable key={href} accessibilityRole="link" onPress={() => router.push(href)} style={styles.link} testID={id}>
              <Text style={styles.linkText}>{t(key)}</Text>
            </Pressable>
          ))}
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  switcher: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  switcherText: { fontFamily: fonts.body700, color: colors.blue },
  pressed: { opacity: 0.7 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingTop: 8 },
  link: { minHeight: touch.min, paddingHorizontal: 12, justifyContent: 'center' },
  linkText: { fontFamily: fonts.body700, color: colors.blue, textDecorationLine: 'underline' },
});

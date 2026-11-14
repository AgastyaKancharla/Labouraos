import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomerApi } from '@/api/ApiProvider';
import type { ProfileKind } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Screen, StatusChip, Text } from '@/components';
import { useI18n, type MessageKey } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors, fonts, radius, shadow } from '@/theme';

const ROLES: { kind: ProfileKind; title: MessageKey; body: MessageKey; emoji: string; href: string }[] = [
  { kind: 'job_seeker', title: 'role.jobSeeker', body: 'role.jobSeekerBody', emoji: '🧑‍🍳', href: routes.registerJobSeeker },
  { kind: 'business', title: 'role.business', body: 'role.businessBody', emoji: '🏪', href: routes.registerBusiness },
  { kind: 'referral_partner', title: 'role.referral', body: 'role.referralBody', emoji: '🤝', href: routes.registerReferral },
];

/**
 * The role picker (proposal 3.3): three large picture cards. Shown at the
 * first sign-in and from "+ Add another" on My profiles. One mobile number
 * is one job seeker and one referral partner, so those cards say "Already
 * added" once held; a person may manage several businesses.
 */
export default function RolePicker() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { account, refreshAccount, setActiveProfileId } = useAuth();
  const [busy, setBusy] = useState<ProfileKind | null>(null);
  /**
   * POST /me/signups starts the sign-up tracker (stage A) so an agent can help
   * if the person stops. If I already have that kind of profile, open it.
   */
  const pick = async (kind: ProfileKind, href: string) => {
    setBusy(kind);
    try {
      const { existingProfileId } = await api.startSignup(kind);
      if (existingProfileId) {
        await refreshAccount();
        setActiveProfileId(existingProfileId);
        router.replace(routes.home);
        return;
      }
    } catch {
      /* the registration itself still works; the tracker row is made then */
    } finally {
      setBusy(null);
    }
    router.push(href);
  };
  const held = new Set((account?.profiles ?? []).map((p) => p.kind));
  const first = held.size === 0;
  return (
    <View style={styles.flex} testID="role-picker">
      <AppHeader title={first ? t('role.titleFirst') : t('role.titleAdd')} onBack={first ? undefined : () => router.back()} showAccountActions={!first} />
      <Screen>
        <Text variant="h2">{t('role.question')}</Text>
        {ROLES.map((role) => {
          const already = role.kind !== 'business' && held.has(role.kind);
          return (
            <Pressable
              key={role.kind}
              accessibilityRole="button"
              accessibilityState={{ disabled: already }}
              accessibilityLabel={`${t(role.title)}. ${t(role.body)}`}
              disabled={already || busy !== null}
              onPress={() => void pick(role.kind, role.href)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed, already && styles.off]}
              testID={`role-${role.kind}`}
            >
              <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">
                {role.emoji}
              </Text>
              <View style={styles.text}>
                <Text style={styles.title}>{t(role.title)}</Text>
                <Text variant="muted">{t(role.body)}</Text>
                {already ? <StatusChip label={t('role.alreadyAdded')} tone="green" /> : null}
              </View>
            </Pressable>
          );
        })}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    minHeight: 112,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  pressed: { backgroundColor: colors.blue100 },
  off: { opacity: 0.6 },
  emoji: { fontSize: 44 },
  text: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.display700, fontSize: 20, color: colors.navy },
});

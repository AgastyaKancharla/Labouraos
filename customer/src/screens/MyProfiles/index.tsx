import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { ProfileKind, ProfileSummary } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Button, Card, EmptyState, ListRow, Screen, StatusChip, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { accents, type Accent, type Tone } from '@/theme';

const STAGE_TONE: Record<NonNullable<ProfileSummary['stage']>, Tone> = {
  details: 'neutral',
  verifying: 'amber',
  payment: 'amber',
  active: 'green',
  paused: 'tomato',
  closed: 'neutral',
};

/** A friendly picture for each kind of profile (the words below say the kind too). */
const KIND_EMOJI: Record<ProfileKind, string> = { job_seeker: '🧑‍🍳', business: '🏪', referral_partner: '🤝' };
/** Mixed palette colours for the picture circles, one after another down the list. */
const ROW_ACCENTS: Accent[] = ['cyan', 'gold', 'good', 'orange', 'royal', 'navy'];

/**
 * "My profiles" (proposal 3.3): every profile this account can act for —
 * job seeker, business (one or more), referral partner — and "+ Add
 * another". Tapping one makes it the profile Home shows.
 */
export default function MyProfiles() {
  const { t } = useI18n();
  const { account, activeProfile, setActiveProfileId } = useAuth();
  const profiles = account?.profiles ?? [];
  return (
    <View style={styles.flex} testID="my-profiles">
      <AppHeader title={t('profiles.title')} onBack={() => router.back()} showAccountActions />
      <Screen>
        <Card>
          {profiles.length === 0 ? <EmptyState compact emoji="🙂" message={t('profiles.empty')} /> : null}
          {profiles.map((p, i) => (
            <ListRow
              key={p.id}
              leading={
                <View
                  style={[styles.picture, { backgroundColor: accents[ROW_ACCENTS[i % ROW_ACCENTS.length]].bg, borderColor: accents[ROW_ACCENTS[i % ROW_ACCENTS.length]].raw }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <Text style={styles.emoji}>{KIND_EMOJI[p.kind]}</Text>
                </View>
              }
              title={`${p.displayName}${p.code ? ` · ${p.code}` : ''}`}
              subtitle={[
                t(`kind.${p.kind}`),
                p.businessRole ? t(`contactRole.${p.businessRole}`) : null,
                p.branchName,
                p.id === activeProfile?.id ? t('profiles.showing') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              trailing={p.stage ? <StatusChip label={t(`stage.${p.stage}`)} tone={STAGE_TONE[p.stage]} /> : undefined}
              last={i === profiles.length - 1}
              onPress={() => {
                setActiveProfileId(p.id);
                router.replace(routes.home);
              }}
              testID={`profile-${p.id}`}
            />
          ))}
        </Card>
        <Button label={t('profiles.addAnother')} variant="secondary" onPress={() => router.push(routes.role)} testID="profiles-add" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  picture: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 22, lineHeight: 28 },
});

import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useI18n } from '@/i18n';
import { Button, Card, HeroCard, Icon, IconTile, ListRow, ProgressBar, Screen, SearchBar, Text, type IconName } from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { routes } from '@/navigation/routes';
import { type Accent, colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { placementsProgress, useTargetDashboard } from '../FA03-Home/useHome';

const LINKS: { key: string; title: 'me.targets' | 'me.today' | 'me.attendance' | 'me.leave' | 'me.corrections' | 'me.payslips'; href: string; icon: IconName; accent: Accent }[] = [
  { key: 'targets', title: 'me.targets', href: routes.targets, icon: 'trophy', accent: 'gold' },
  { key: 'today', title: 'me.today', href: routes.myDay, icon: 'clock', accent: 'green' },
  { key: 'attendance', title: 'me.attendance', href: routes.myAttendance, icon: 'calendar', accent: 'royal' },
  { key: 'leave', title: 'me.leave', href: routes.myLeave, icon: 'calendar', accent: 'cyan' },
  { key: 'corrections', title: 'me.corrections', href: routes.myCorrection, icon: 'clipboard', accent: 'orange' },
  { key: 'payslips', title: 'me.payslips', href: routes.myPayslips, icon: 'document', accent: 'navy' },
];

/**
 * FA24 — Me, the fifth tab (redesign, 16 Nov): targets and leaderboard, my
 * attendance, leave, corrections, payslips and log out (English only, rev 193:
 * no language choice). Data: GET /targets/dashboard for the placements bar.
 */
export default function MeScreen() {
  const { t } = useI18n();
  const { session, logout } = useAuth();
  const dashboard = useTargetDashboard();
  const progress = placementsProgress(dashboard.data);
  return (
    <View style={styles.flex} testID="screen-FA24">
      <AppHeader title={t('tabs.me')} root />
      <Screen>
        <SearchBar onPress={() => router.push(routes.meSearch)} />
        <HeroCard title={session?.staff.name ?? ''} subtitle={[session?.staff.code, t('common.fieldAgent')].filter(Boolean).join(' · ')} emoji="🧑‍💼" testID="me-hero">
          {progress ? (
            <View style={styles.progress} testID="me-placements">
              <View style={styles.progressHead}>
                <Text style={styles.onBlue}>{t('fa03.placementsThisMonth')}</Text>
                <Text style={styles.onBlueStrong}>{progress.target !== null ? `${progress.achieved} / ${progress.target}` : String(progress.achieved)}</Text>
              </View>
              <ProgressBar value={progress.ratio} color={colors.gold} onBlue />
            </View>
          ) : null}
        </HeroCard>
        <Card>
          {LINKS.map((l, i) => (
            <ListRow
              key={l.key}
              title={t(l.title)}
              leading={<IconTile icon={l.icon} accent={l.accent} size={34} />}
              trailing={<Icon name="chevron-right" size={16} />}
              onPress={() => router.push(l.href)}
              last={i === LINKS.length - 1}
              testID={`me-${l.key}`}
            />
          ))}
        </Card>
        <Button label={t('common.logout')} variant="danger" icon={<Icon name="logout" color={colors.white} />} onPress={() => void logout()} testID="me-logout" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  progress: { gap: 8, paddingTop: 4 },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  onBlue: { fontFamily: fonts.body700, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.onBlueSoft, flex: 1 },
  onBlueStrong: { fontFamily: fonts.display700, fontSize: 18, color: colors.white },
});

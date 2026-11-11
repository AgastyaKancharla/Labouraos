import { StyleSheet, View } from 'react-native';
import { Screen } from '@/components';
import { useI18n } from '@/i18n';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { useParam } from '../_selling';
import { RegistrationPanel } from '../_selling/RegistrationPanel';

/**
 * FA10b-SeekerSaved — the registration status panel (just saved: send the one registration link).
 * The same panel and endpoints as the call agent's (CA08b/CA08c).
 */
export default function ScreenFA10B() {
  const { t } = useI18n();
  const id = useParam('id');
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa10.subtitle')} />
      <Screen testID="screen-FA10b">
        <RegistrationPanel jobSeekerId={id} variant="saved" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});

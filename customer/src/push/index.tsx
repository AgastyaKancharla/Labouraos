/**
 * PLACEHOLDER — owned by Agent C (notifications). Agent C replaces this whole
 * folder (customer/src/push/), including this file. On a merge conflict here,
 * take Agent C's version.
 *
 * The contract the rest of the app relies on (see customer/README.md,
 * "Hand-off to Agent C"):
 *   - `InboxScreen`  default-exported by app/(app)/inbox.tsx — the in-app inbox.
 *   - `PushBridge`   rendered once inside the signed-in layout
 *                    (app/(app)/_layout.tsx). It may ask for notification
 *                    permission, register the push token with the server and
 *                    route taps to screens. It renders nothing visible.
 * Both may use `useCustomerApi()`/`httpClient` from '@/api', `useAuth()` from
 * '@/auth/AuthProvider', `useI18n()` from '@/i18n' and `routes` from
 * '@/navigation/routes'.
 */
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppHeader, EmptyState, Screen } from '@/components';
import { useI18n } from '@/i18n';

export function InboxScreen() {
  const { t } = useI18n();
  return (
    <View style={styles.flex} testID="inbox-placeholder">
      <AppHeader title={t('menu.inbox')} onBack={() => router.back()} />
      <Screen>
        <EmptyState message={t('inbox.placeholder')} />
      </Screen>
    </View>
  );
}

export function PushBridge() {
  return null;
}

const styles = StyleSheet.create({ flex: { flex: 1 } });

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createQueryClient } from '@/api/queryClient';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { OfflineQueueProvider } from '@/device/offline-queue';
import { I18nProvider } from '@/i18n';
import { colors, useAppFonts } from '@/theme';
import { TestModeBanner } from '@/components/TestModeBanner';

/** Records taps for the 1-hour idle limit, without stealing them. */
function ActivityTracker({ children }: { children: React.ReactNode }) {
  const { touch } = useAuth();
  return (
    <View style={styles.flex} onTouchStart={touch}>
      {children}
    </View>
  );
}

export default function RootLayout() {
  const fontsReady = useAppFonts();
  const [queryClient] = useState(createQueryClient);
  if (!fontsReady) return <View style={styles.flex} />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <AuthProvider>
            <OfflineQueueProvider>
              <ActivityTracker>
                <StatusBar style="light" />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
                <TestModeBanner />
              </ActivityTracker>
            </OfflineQueueProvider>
          </AuthProvider>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});

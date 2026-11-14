import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createQueryClient } from '@/api/queryClient';
import { AuthProvider } from '@/auth/AuthProvider';
import { TestModeBanner } from '@/components/TestModeBanner';
import { I18nProvider } from '@/i18n';
import { colors, useAppFonts } from '@/theme';

/** Providers for every screen: safe area, data cache, language, sign-in. */
export default function RootLayout() {
  const fontsReady = useAppFonts();
  const [queryClient] = useState(createQueryClient);
  if (!fontsReady) return <View style={styles.flex} />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <AuthProvider>
            <View style={styles.flex}>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
              <TestModeBanner />
            </View>
          </AuthProvider>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1, backgroundColor: colors.bg } });

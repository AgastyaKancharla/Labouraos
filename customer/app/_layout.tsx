import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createQueryClient } from '@/api/queryClient';
import { AuthProvider } from '@/auth/AuthProvider';
import { TestModeBanner } from '@/components/TestModeBanner';
import { I18nProvider, useI18n } from '@/i18n';
import { LanguagePicker } from '@/screens/Language';
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
              <LanguageGate>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
                <TestModeBanner />
              </LanguageGate>
            </View>
          </AuthProvider>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** 28 Nov: until a language is picked, the language screen is the whole app (the first screen after installing). */
function LanguageGate({ children }: { children: ReactNode }) {
  const { ready, chosen } = useI18n();
  if (!ready) return <View style={styles.navy} />;
  if (!chosen) return <LanguagePicker mode="first" />;
  return <>{children}</>;
}

const styles = StyleSheet.create({ flex: { flex: 1, backgroundColor: colors.bg }, navy: { flex: 1, backgroundColor: colors.navy } });

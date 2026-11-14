import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swoosh, Text } from '@/components';
import { LANGUAGES, useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors, fonts, radius, space, touch } from '@/theme';

const logo = require('../../../assets/logo-mark.png');

/**
 * Step 1 for everyone (proposal 2.1): pick Kannada, Hindi or English with
 * three large buttons, before anything else. The choice is remembered on
 * the phone and can be changed any time from the header.
 */
export default function Welcome() {
  const { t, setLanguage } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, { paddingTop: insets.top + space.xxl }]} testID="welcome">
      <View style={styles.brand}>
        <Image source={logo} style={styles.logo} accessibilityLabel={t('common.brand')} />
        <Text variant="h1" align="center">
          {t('common.brand')}
        </Text>
        <Text variant="muted" align="center">
          {t('welcome.tagline')}
        </Text>
      </View>
      <Swoosh />
      <View style={styles.body}>
        <Text variant="h2" align="center">
          {t('welcome.chooseLanguage')}
        </Text>
        {LANGUAGES.map((lang) => (
          <Pressable
            key={lang.code}
            accessibilityRole="button"
            accessibilityLabel={lang.name}
            onPress={() => {
              setLanguage(lang.code);
              router.push(routes.signIn);
            }}
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
            testID={`welcome-language-${lang.code}`}
          >
            <Text style={styles.choiceText}>{lang.label === 'EN' ? 'English' : lang.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  brand: { alignItems: 'center', gap: 8, paddingHorizontal: space.lg, paddingBottom: space.xl },
  logo: { width: 72, height: 72, borderRadius: radius.lg },
  body: { padding: space.lg, gap: 14 },
  choice: {
    minHeight: touch.min + 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontFamily: fonts.body700, fontSize: 22, color: colors.navy },
  pressed: { backgroundColor: colors.blue100 },
});

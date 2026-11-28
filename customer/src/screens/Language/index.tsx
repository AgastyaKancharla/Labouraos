import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Text } from '@/components';
import { LANGUAGES, translate, useI18n, type Language } from '@/i18n';
import { colors, fonts, shadow, space } from '@/theme';

const logo = require('../../../assets/logo-mark.png');

/**
 * "Choose your language" in every language of the app, since the person has
 * not picked one yet. In the same order as the buttons.
 */
const CHOOSE: Record<Language, string> = {
  kn: 'ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆಮಾಡಿ',
  hi: 'अपनी भाषा चुनें',
  te: 'మీ భాషను ఎంచుకోండి',
  ta: 'உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்',
  ml: 'നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക',
  en: 'Choose your language',
};

interface Props {
  /** "first": the first screen after installing. "change": opened from Settings. */
  mode: 'first' | 'change';
  onDone?: () => void;
}

/**
 * 28 Nov (Agastya): the moment the app is installed, the first screen is the
 * language. Six big buttons, each in its own script with the English name
 * under it; the Continue button already speaks the chosen language. The
 * choice is kept on the phone and can be changed in Settings.
 */
export function LanguagePicker({ mode, onDone }: Props) {
  const { language, chosen, setLanguage } = useI18n();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<Language | null>(chosen ? language : null);

  const confirm = async () => {
    if (!picked) return;
    await setLanguage(picked);
    onDone?.();
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg }]} testID={`language-${mode}`}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.brand}>
          <View style={styles.logoTile}>
            <Image source={logo} style={styles.logo} accessibilityLabel="Laboura" />
          </View>
          <Text style={styles.brandName}>Laboura</Text>
        </View>
        <View style={styles.titles} accessibilityRole="header">
          <Text style={styles.title}>{CHOOSE[picked ?? 'kn']}</Text>
          <Text style={styles.subtitle}>
            {LANGUAGES.filter((l) => l.code !== (picked ?? 'kn'))
              .map((l) => CHOOSE[l.code])
              .join('  ·  ')}
          </Text>
        </View>
        <View style={styles.grid} accessibilityRole="radiogroup">
          {LANGUAGES.map((l) => {
            const on = picked === l.code;
            return (
              <Pressable
                key={l.code}
                onPress={() => setPicked(l.code)}
                style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${l.name}, ${l.english}`}
                testID={`language-${l.code}`}
              >
                <View style={styles.flex}>
                  <Text style={[styles.name, on && styles.nameOn]}>{l.name}</Text>
                  {l.code === 'en' ? null : <Text style={[styles.english, on && styles.englishOn]}>{l.english}</Text>}
                </View>
                <View style={[styles.tick, on && styles.tickOn]}>{on ? <Icon name="check" size={18} color={colors.navy} /> : null}</View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.actions}>
        <Button
          label={translate(picked ?? 'en', 'language.continue')}
          variant="light"
          arrow
          disabled={!picked}
          onPress={() => void confirm()}
          testID="language-continue"
        />
      </View>
    </View>
  );
}

/** Settings → Language. */
export default function LanguageScreen() {
  return <LanguagePicker mode="change" onDone={() => router.back()} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.navy },
  scroll: { paddingHorizontal: 20, paddingBottom: 16, gap: 18 },
  flex: { flex: 1 },
  brand: { alignItems: 'center', gap: 6, paddingTop: 16 },
  logoTile: { width: 76, height: 76, borderRadius: 24, backgroundColor: colors.white, padding: 6, ...shadow.light },
  logo: { width: 64, height: 64, borderRadius: 19 },
  brandName: { fontFamily: fonts.display800, fontSize: 28, color: colors.white },
  titles: { alignItems: 'center', gap: 6 },
  title: { fontSize: 22, fontWeight: '700', color: colors.white, textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 20, color: colors.navSoft, textAlign: 'center' },
  grid: { gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  optionOn: { backgroundColor: colors.white, borderColor: colors.goldRaw },
  pressed: { opacity: 0.85 },
  name: { fontSize: 21, fontWeight: '700', color: colors.white },
  nameOn: { color: colors.navy },
  english: { fontSize: 13, color: colors.navSoft },
  englishOn: { color: colors.soft },
  tick: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.goldRaw, borderColor: colors.goldRaw },
  actions: { paddingHorizontal: 20, paddingTop: 8 },
});

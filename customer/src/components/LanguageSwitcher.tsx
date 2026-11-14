import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { LANGUAGES, useI18n } from '@/i18n';
import { colors, fonts, radius, touch } from '@/theme';
import { Text } from './Text';

/**
 * ಕನ್ನಡ / हिंदी / EN switcher in the header. Tapping opens a short list
 * with large rows; the choice is remembered on the phone.
 */
export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('common.languageLabel')}: ${current.name}`}
        onPress={() => setOpen(true)}
        style={styles.pill}
        hitSlop={8}
        testID="language-switcher"
      >
        <Text style={styles.pillText}>{current.label} ▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel={t('common.close')}>
          <View style={styles.sheet} accessibilityRole="menu">
            <Text variant="label" style={styles.sheetTitle}>
              {t('common.languageLabel')}
            </Text>
            {LANGUAGES.map((lang) => {
              const selected = lang.code === language;
              return (
                <Pressable
                  key={lang.code}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  testID={`language-${lang.code}`}
                  onPress={() => {
                    setLanguage(lang.code);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && styles.pressed]}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextOn]}>{lang.label === 'EN' ? 'English' : lang.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  pillText: { color: colors.white, fontFamily: fonts.body700, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 16,
    paddingBottom: 32,
    gap: 8,
  },
  sheetTitle: { marginBottom: 4 },
  option: {
    minHeight: touch.min + 4,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionOn: { borderColor: colors.green, backgroundColor: colors.green100 },
  optionText: { fontFamily: fonts.body600, fontSize: 16, color: colors.ink },
  optionTextOn: { color: colors.green },
  pressed: { opacity: 0.7 },
});

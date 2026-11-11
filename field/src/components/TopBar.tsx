import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { initials } from '@/lib/format';
import { colors, fonts, headerGradient, radius, touch } from '@/theme';
import { Button } from './Button';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Swoosh } from './Swoosh';
import { Text } from './Text';

const logo = require('../../assets/logo-mark.png');

interface Props {
  title: string;
  subtitle?: string;
  /** Signed-in person: shows the gold avatar with the log-out menu. */
  personName?: string;
  onLogout?: () => void;
}

/**
 * The blue header on every screen (`.hdr`): logo, title and subtitle, the
 * language switcher and the avatar that opens "Log out". Followed by the
 * swoosh stripe.
 */
export function TopBar({ title, subtitle, personName, onLogout }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <View>
      <LinearGradient colors={headerGradient} style={[styles.bar, { paddingTop: insets.top + 12 }]}>
        <View style={styles.left}>
          <Image source={logo} style={styles.logo} accessibilityLabel={t('common.brand')} />
          <View style={styles.titles}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.right}>
          <LanguageSwitcher />
          {personName ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.accountMenu', { name: personName })}
              onPress={() => setMenuOpen(true)}
              style={styles.avatar}
              hitSlop={6}
              testID="account-menu"
            >
              <Text style={styles.avatarText}>{initials(personName)}</Text>
            </Pressable>
          ) : null}
        </View>
      </LinearGradient>
      <Swoosh />
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.sheet}>
            <Text variant="h2">{personName}</Text>
            <Text variant="muted">{t('common.logoutConfirm')}</Text>
            <Button
              label={t('common.logout')}
              variant="danger"
              testID="logout-button"
              onPress={() => {
                setMenuOpen(false);
                onLogout?.();
              }}
            />
            <Button label={t('common.cancel')} variant="secondary" onPress={() => setMenuOpen(false)} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  logo: { width: 30, height: 30, borderRadius: radius.sm },
  titles: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.display700, fontSize: 15, color: colors.white },
  subtitle: { fontFamily: fonts.body500, fontSize: 11, color: colors.navAccent },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display700, fontSize: 12, color: colors.navy },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
    minHeight: touch.min * 4,
  },
});

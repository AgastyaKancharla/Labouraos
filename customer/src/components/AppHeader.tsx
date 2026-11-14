import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, type MessageKey } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors, fonts, headerGradient, radius, touch } from '@/theme';
import { Icon } from './Icon';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Swoosh } from './Swoosh';
import { Text } from './Text';

const logo = require('../../assets/logo-mark.png');

interface Props {
  title: string;
  subtitle?: string;
  /** Shows a back arrow instead of the logo. */
  onBack?: () => void;
  /** Bell (inbox) and menu — only once signed in with a verified phone. */
  showAccountActions?: boolean;
}

const MENU: { key: MessageKey; href: string; testID: string }[] = [
  { key: 'menu.profiles', href: routes.profiles, testID: 'menu-profiles' },
  { key: 'menu.help', href: routes.help, testID: 'menu-help' },
  { key: 'menu.privacy', href: routes.privacy, testID: 'menu-privacy' },
  { key: 'menu.settings', href: routes.settings, testID: 'menu-settings' },
];

/**
 * The blue Laboura header (copied from Laboura Field's TopBar and adapted):
 * logo or back arrow, title, the language switcher, and for signed-in
 * customers the inbox bell and a menu (My profiles, Help, Privacy, Settings,
 * Sign out). Followed by the colour swoosh.
 */
export function AppHeader({ title, subtitle, onBack, showAccountActions = false }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <View>
      <LinearGradient colors={headerGradient} style={[styles.bar, { paddingTop: insets.top + 10 }]}>
        <View style={styles.left}>
          {onBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={styles.iconButton} hitSlop={8} testID="header-back">
              <Icon name="back" size={22} color={colors.white} />
            </Pressable>
          ) : (
            <Image source={logo} style={styles.logo} accessibilityLabel={t('common.brand')} />
          )}
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
          {showAccountActions ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('menu.inbox')}
                onPress={() => router.push(routes.inbox)}
                style={styles.iconButton}
                hitSlop={6}
                testID="header-inbox"
              >
                <Icon name="bell" size={22} color={colors.white} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('menu.open')}
                onPress={() => setMenuOpen(true)}
                style={styles.iconButton}
                hitSlop={6}
                testID="header-menu"
              >
                <Icon name="menu" size={22} color={colors.white} />
              </Pressable>
            </>
          ) : null}
        </View>
      </LinearGradient>
      <Swoosh />
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)} accessibilityLabel={t('common.close')}>
          <View style={styles.sheet} accessibilityRole="menu">
            {MENU.map((item) => (
              <Pressable
                key={item.href}
                accessibilityRole="menuitem"
                onPress={() => {
                  setMenuOpen(false);
                  router.push(item.href);
                }}
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                testID={item.testID}
              >
                <Text style={styles.optionText}>{t(item.key)}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="menuitem"
              onPress={() => {
                setMenuOpen(false);
                void signOut().then(() => router.replace(routes.signIn));
              }}
              style={({ pressed }) => [styles.option, styles.signOut, pressed && styles.pressed]}
              testID="menu-sign-out"
            >
              <Text style={[styles.optionText, styles.signOutText]}>{t('menu.signOut')}</Text>
            </Pressable>
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
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  logo: { width: 32, height: 32, borderRadius: radius.sm },
  titles: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.display700, fontSize: 17, color: colors.white },
  subtitle: { fontFamily: fonts.body500, fontSize: 12.5, color: colors.navAccent },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 16,
    paddingBottom: 32,
    gap: 8,
  },
  option: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionText: { fontFamily: fonts.body600, fontSize: 17, color: colors.ink },
  signOut: { borderColor: 'rgba(187,35,43,0.4)' },
  signOutText: { color: colors.tomato },
  pressed: { opacity: 0.7 },
});

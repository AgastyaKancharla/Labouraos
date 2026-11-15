import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, heroGradient, radius, shadow, swoosh } from '@/theme';
import { Emoji } from './Emoji';
import { Text } from './Text';

interface Props {
  /** Small upper-case line on top ("Today"). */
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  /** Friendly picture beside the title. */
  emoji?: string;
  /** Top-right corner, e.g. a status pill (use `HeroPill`). */
  corner?: ReactNode;
  children?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The blue gradient hero card (Command Center `.hero`): navy → royal at
 * 135°, white words, the brand swoosh along the bottom. Only white text goes
 * on it; numbers and labels inside use `HeroStat` / `HeroPill`.
 */
export function HeroCard({ eyebrow, title, subtitle, emoji, corner, children, testID, style }: Props) {
  // With no title the picture sits in the top corner, beside the eyebrow.
  const topEmoji = emoji && !title && !subtitle && !corner ? <Emoji symbol={emoji} size={26} /> : null;
  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <LinearGradient colors={heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        {eyebrow || corner || topEmoji ? (
          <View style={styles.top}>
            {eyebrow ? (
              <Text style={styles.eyebrow} accessibilityRole="header">
                {eyebrow}
              </Text>
            ) : (
              <View />
            )}
            {corner ?? topEmoji}
          </View>
        ) : null}
        {title || subtitle ? (
          <View style={styles.titleRow}>
            <View style={styles.titles}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            {emoji ? <Emoji symbol={emoji} size={30} /> : null}
          </View>
        ) : null}
        {children}
      </LinearGradient>
      <LinearGradient colors={swoosh.colors} locations={swoosh.locations} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.swoosh} />
    </View>
  );
}

/** A translucent pill on the hero (`rgba(255,255,255,.16)`, white words). */
export function HeroPill({ label, testID }: { label: string; testID?: string }) {
  return (
    <View style={styles.pill} testID={testID}>
      <View style={styles.pillDot} />
      <Text style={styles.pillText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A big white number with its label, for the hero. `bar` is a raw brand colour shown as the short bar above. */
export function HeroStat({ value, label, bar, testID }: { value: string; label: string; bar?: string; testID?: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`} testID={testID}>
      {bar ? <View style={[styles.statBar, { backgroundColor: bar }]} /> : null}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.navy, ...shadow.hero },
  card: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eyebrow: { fontFamily: fonts.body700, fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.onBlueSoft },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titles: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.display700, fontSize: 20, lineHeight: 26, color: colors.white },
  subtitle: { fontFamily: fonts.body500, fontSize: 13, lineHeight: 18, color: colors.onBlueSoft },
  swoosh: { height: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    flexShrink: 1,
  },
  pillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gold },
  pillText: { fontFamily: fonts.body700, fontSize: 11.5, color: colors.white, flexShrink: 1 },
  stat: { gap: 2 },
  statBar: { width: 24, height: 4, borderRadius: 2, marginBottom: 4 },
  statValue: { fontFamily: fonts.display700, fontSize: 30, lineHeight: 36, color: colors.white, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: fonts.body500, fontSize: 12.5, lineHeight: 17, color: colors.onBlueSoft },
});

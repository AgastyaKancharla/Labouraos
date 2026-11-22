import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, heroGradient, shadow } from '@/theme';
import Svg, { Path } from 'react-native-svg';
import { Text } from './Text';

interface Props {
  /** Small line above the title, e.g. "Job seeker · JS-1234". */
  eyebrow?: string;
  title: string;
  /** A friendly picture beside the title (decoration; the words carry the meaning). */
  emoji?: string;
  children?: ReactNode;
  testID?: string;
}

/**
 * The Command Center `.hero` card: royal → navy gradient, white text and a
 * deep navy shadow. Version 2: 24 px corners, a soft ring and the gold
 * swoosh arc in the corner (decoration). Only white and `navSoft` text is
 * used on it.
 */
export function HeroCard({ eyebrow, title, emoji, children, testID }: Props) {
  return (
    <View style={styles.shadow} testID={testID}>
      <LinearGradient colors={heroGradient.colors} start={heroGradient.start} end={heroGradient.end} style={styles.card}>
        <View style={styles.ring} pointerEvents="none" />
        <View style={styles.top}>
          <View style={styles.titles}>
            {eyebrow ? (
              <Text style={styles.eyebrow} numberOfLines={2}>
                {eyebrow}
              </Text>
            ) : null}
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          </View>
          {emoji ? (
            <View style={styles.emojiBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={styles.emoji}>{emoji}</Text>
            </View>
          ) : null}
        </View>
        {children ? <View style={styles.body}>{children}</View> : null}
        <View style={styles.arc} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg width={240} height={120} viewBox="0 0 240 120">
            <Path d="M0 116 Q120 20 240 116" fill="none" stroke={colors.goldRaw} strokeWidth={3} opacity={0.9} />
            <Path d="M0 132 Q120 36 240 132" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={2} />
          </Svg>
        </View>
      </LinearGradient>
    </View>
  );
}

/** Text styles for things placed inside a HeroCard (white on the gradient). */
export const heroText = StyleSheet.create({
  label: { fontFamily: fonts.body700, fontSize: 12.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.navSoft },
  big: { fontFamily: fonts.display700, fontSize: 22, lineHeight: 29, color: colors.white },
  body: { fontFamily: fonts.body500, fontSize: 15, lineHeight: 21, color: colors.white },
  soft: { fontFamily: fonts.body400, fontSize: 14, lineHeight: 20, color: colors.navSoft },
});

const styles = StyleSheet.create({
  shadow: { borderRadius: 24, backgroundColor: colors.navy, ...shadow.hero },
  card: { borderRadius: 24, overflow: 'hidden', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, gap: 14 },
  ring: { position: 'absolute', right: -70, top: -80, width: 200, height: 200, borderRadius: 100, borderWidth: 34, borderColor: 'rgba(255,255,255,0.06)' },
  arc: { position: 'absolute', right: -40, bottom: -46 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titles: { flex: 1, gap: 2 },
  eyebrow: { fontFamily: fonts.body600, fontSize: 13, color: colors.navSoft },
  title: { fontFamily: fonts.display700, fontSize: 20, lineHeight: 26, color: colors.white },
  emojiBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 28, lineHeight: 34 },
  body: { gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(207,228,255,0.22)', paddingTop: 12 },
});

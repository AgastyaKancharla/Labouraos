import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { colors, fonts, fontSize } from '@/theme';

export type TextVariant = 'h1' | 'h2' | 'body' | 'bodyStrong' | 'small' | 'muted' | 'label' | 'stat' | 'tiny';

interface Props extends TextProps {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle['textAlign'];
}

/**
 * All text in the app. Variants follow the designs: `.h1` (Sora 22),
 * `.h2` (Sora 15), body (Plex 13.5), `.muted` (Plex 12.5 soft), `.lbl`
 * (Plex 11.5 bold upper case), stat numbers (Sora 18).
 */
export function Text({ variant = 'body', color, align, style, ...rest }: Props) {
  return (
    <RNText
      {...rest}
      style={[styles[variant], color ? { color } : null, align ? { textAlign: align } : null, style]}
    />
  );
}

const styles = StyleSheet.create({
  h1: { fontFamily: fonts.display700, fontSize: fontSize.h1, color: colors.navy, lineHeight: 28 },
  h2: { fontFamily: fonts.display700, fontSize: fontSize.h2, color: colors.navy, lineHeight: 20 },
  body: { fontFamily: fonts.body400, fontSize: fontSize.body, color: colors.ink, lineHeight: 20 },
  bodyStrong: { fontFamily: fonts.body700, fontSize: fontSize.body, color: colors.ink, lineHeight: 20 },
  small: { fontFamily: fonts.body500, fontSize: fontSize.small, color: colors.ink, lineHeight: 18 },
  muted: { fontFamily: fonts.body400, fontSize: fontSize.small, color: colors.soft, lineHeight: 19 },
  label: {
    fontFamily: fonts.body700,
    fontSize: fontSize.label,
    color: colors.soft,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stat: { fontFamily: fonts.display700, fontSize: fontSize.stat, color: colors.ink, fontVariant: ['tabular-nums'] },
  tiny: { fontFamily: fonts.body500, fontSize: fontSize.tiny, color: colors.soft, lineHeight: 14 },
});

import { StyleSheet, Text as RNText, type StyleProp, type TextStyle } from 'react-native';

/**
 * A friendly emoji picture next to a heading or an empty state (Master Guide
 * rev 171–172). Never the only meaning — the words beside it say it — so it
 * is hidden from screen readers and does not scale with the font setting.
 */
export function Emoji({ symbol, size = 20, style }: { symbol: string; size?: number; style?: StyleProp<TextStyle> }) {
  return (
    <RNText
      style={[styles.emoji, { fontSize: size, lineHeight: Math.round(size * 1.25) }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      allowFontScaling={false}
    >
      {symbol}
    </RNText>
  );
}

const styles = StyleSheet.create({
  emoji: { textAlign: 'center' },
});

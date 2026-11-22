import { StyleSheet, View, type ViewProps } from 'react-native';
import { accents, colors, radius, shadow, type Accent } from '@/theme';
import { Text } from './Text';

interface Props extends ViewProps {
  /** Small upper-case heading (`.lbl`), e.g. "Today", "Alerts". */
  title?: string;
  compact?: boolean;
  /**
   * A short bar in one palette colour above the title (the Command Center's
   * `.bar-top`), so each section card gets its own colour.
   */
  accent?: Accent;
  /** A friendly picture before the title (decoration; never the only meaning). */
  emoji?: string;
}

/** `.card`: white, 22 px corners, a layered shadow instead of a border (Version 2). */
export function Card({ title, compact, accent, emoji, style, children, ...rest }: Props) {
  return (
    <View style={[styles.card, compact && styles.compact, style]} {...rest}>
      {accent ? <View style={[styles.bar, { backgroundColor: accents[accent].raw }]} testID={rest.testID ? `${rest.testID}-accent-${accent}` : undefined} /> : null}
      {title ? (
        <View style={styles.titleRow}>
          {emoji ? (
            <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">
              {emoji}
            </Text>
          ) : null}
          <Text variant="label" style={styles.titleText} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: 18,
    paddingHorizontal: 18,
    ...shadow.card,
  },
  compact: { paddingVertical: 12, paddingHorizontal: 12 },
  bar: { width: 24, height: 4, borderRadius: radius.pill, marginBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  titleText: { flexShrink: 1 },
  emoji: { fontSize: 16, lineHeight: 20 },
});

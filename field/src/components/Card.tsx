import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors, radius, shadow } from '@/theme';
import { Text } from './Text';

interface Props extends ViewProps {
  /** Small upper-case heading (`.lbl`), e.g. "Today", "Alerts". */
  title?: string;
  compact?: boolean;
}

/** `.card`: white, 16 px corners, thin border. */
export function Card({ title, compact, style, children, ...rest }: Props) {
  return (
    <View style={[styles.card, compact && styles.compact, style]} {...rest}>
      {title ? (
        <Text variant="label" style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingVertical: 16,
    paddingHorizontal: 16,
    ...shadow.card,
  },
  compact: { paddingVertical: 12, paddingHorizontal: 12 },
  title: { marginBottom: 6 },
});

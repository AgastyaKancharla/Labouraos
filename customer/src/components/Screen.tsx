import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { colors, space } from '@/theme';

interface Props {
  children: ReactNode;
  /** Pull to refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Plain View instead of ScrollView (screens that manage their own list). */
  scroll?: boolean;
  testID?: string;
}

/** The page body (`.pb`): light blue background, 16 px padding, 14 px gaps. */
export function Screen({ children, onRefresh, refreshing = false, scroll = true, testID }: Props) {
  if (!scroll) {
    return (
      <View style={[styles.flex, styles.content]} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID={testID}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: space.xl, gap: 14 },
});

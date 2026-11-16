/** Shared expo-router fake: `jest.mock('expo-router', () => require('@/test/expo-router-mock'))`. */
export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  dismissTo: jest.fn(),
  dismissAll: jest.fn(),
  canGoBack: jest.fn(() => true),
  canDismiss: jest.fn(() => true),
};
export function Redirect({ href }: { href: string }) {
  const { Text } = require('react-native');
  return <Text testID="redirect">{href}</Text>;
}
export const useRouter = () => router;

/** Tests set the route's query: `searchParams.current = { id: 'v-1' }` (or `(useLocalSearchParams as jest.Mock).mockReturnValue(…)`). */
export const searchParams: { current: Record<string, string | undefined> } = { current: {} };
export const useLocalSearchParams = jest.fn(() => searchParams.current);

/**
 * The route's segments, which tell a screen which tab it is in. Tests of a
 * screen inside the Visits tab set `segments.current = ['(app)', '(tabs)', '(visits)', 'visit', 'done']`.
 */
export const segments: { current: string[] } = { current: [] };
export const useSegments = jest.fn(() => segments.current);
export function Stack() {
  return null;
}
Stack.Screen = function StackScreen() {
  return null;
};

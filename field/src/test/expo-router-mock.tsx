/** Shared expo-router fake: `jest.mock('expo-router', () => require('@/test/expo-router-mock'))`. */
export const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
export function Redirect({ href }: { href: string }) {
  const { Text } = require('react-native');
  return <Text testID="redirect">{href}</Text>;
}
export const useRouter = () => router;

/** Tests set the route's query: `searchParams.current = { id: 'v-1' }`. */
export const searchParams: { current: Record<string, string | undefined> } = { current: {} };
export const useLocalSearchParams = () => searchParams.current;

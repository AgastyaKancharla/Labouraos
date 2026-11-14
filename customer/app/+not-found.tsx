import { Redirect } from 'expo-router';
import { routes } from '@/navigation/routes';

/** Unknown address (an old link): start again from the top. */
export default function NotFound() {
  return <Redirect href={routes.start} />;
}

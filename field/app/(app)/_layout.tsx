import { Redirect, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingState } from '@/components';
import { routes } from '@/navigation/routes';
import StaffPhotoScreen from '@/screens/StaffPhoto';

/**
 * Everything behind sign-in. A signed-out agent is sent to FA01. An agent
 * with no staff photo yet, or asked by the CEO for a new one, takes it first
 * (guide, login codes, 14 Nov). If the API can't say, the agent is not blocked.
 */
export default function AppLayout() {
  const { status, session } = useAuth();
  const { staffPhoto } = useEndpoints();
  const photo = useQuery({
    queryKey: [...queryKeys.staffPhoto, session?.staff.id ?? ''],
    queryFn: () => staffPhoto.status(),
    enabled: status === 'signedIn',
    staleTime: Infinity,
    retry: false,
  });
  if (status === 'loading') return <LoadingState />;
  if (status === 'signedOut') return <Redirect href={routes.login} />;
  if (photo.isPending) return <LoadingState />;
  if (photo.data?.required) return <StaffPhotoScreen reason={photo.data.reason} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

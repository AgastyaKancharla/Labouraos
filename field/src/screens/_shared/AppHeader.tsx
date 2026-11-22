import { router, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { routes } from '@/navigation/routes';
import { TopBar } from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { goBack, useTabRoot, type ParentNavigation } from '@/navigation/useFlow';
import { OfflineNotices } from './OfflineNotices';
import { HeaderStatus, HeaderStatusError } from '../_attendance/DayControls';

interface Props {
  title: string;
  subtitle?: string;
  /** A tab's main page: no back arrow (the tab bar is the way around). */
  root?: boolean;
  /** Where the back arrow goes when there is no history (a link opened straight); the tab's main page by default. */
  backTo?: string;
  /** Replaces the back arrow's action (e.g. a step that must go back to a set screen). */
  onBack?: () => void;
}

/** How often a tab's main page asks for the bell's unread count. */
export const BELL_POLL_MS = 60_000;

/**
 * The signed-in header: back arrow on every inner screen, title, subtitle,
 * language switcher and the avatar with Log out. A tab's main page also
 * shows the bell with the unread count (21 Nov), opening Notifications,
 * and, just left of the bell, the agent's status (22 Nov evening), tap to change.
 */
export function AppHeader({ title, subtitle, root = false, backTo, onBack }: Props) {
  const { session, logout } = useAuth();
  const tab = useTabRoot();
  const navigation = useNavigation() as unknown as ParentNavigation | undefined;
  const statusShown = root && session?.staff.role === 'field_agent';
  const { fieldOps } = useEndpoints();
  const bell = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => fieldOps.notifications(),
    enabled: root && session?.staff.role === 'field_agent',
    refetchInterval: BELL_POLL_MS,
  });
  return (
    <>
    <TopBar
      title={title}
      subtitle={subtitle}
      personName={session?.staff.name}
      onLogout={() => void logout()}
      onBack={root ? undefined : (onBack ?? (() => goBack(backTo ?? tab.root, navigation)))}
      bell={root && session ? { count: bell.data?.unseenCount ?? 0, onPress: () => router.push(routes.notifications) } : undefined}
      // 22 Nov evening: the status chip IN the header, just left of the bell, on every tab's main page.
      status={statusShown ? <HeaderStatus /> : undefined}
    />
    {statusShown ? <HeaderStatusError /> : null}
    <OfflineNotices />
    </>
  );
}

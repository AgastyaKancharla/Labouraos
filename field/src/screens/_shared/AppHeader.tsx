import { TopBar } from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { goBack, useTabRoot } from '@/navigation/useFlow';

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

/**
 * The signed-in header: back arrow on every inner screen, title, subtitle,
 * language switcher and the avatar with Log out.
 */
export function AppHeader({ title, subtitle, root = false, backTo, onBack }: Props) {
  const { session, logout } = useAuth();
  const tab = useTabRoot();
  return (
    <TopBar
      title={title}
      subtitle={subtitle}
      personName={session?.staff.name}
      onLogout={() => void logout()}
      onBack={root ? undefined : (onBack ?? (() => goBack(backTo ?? tab.root)))}
    />
  );
}

import { TopBar } from '@/components';
import { useAuth } from '@/auth/AuthProvider';

/** The signed-in header: title, subtitle, language switcher and the avatar with Log out. */
export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { session, logout } = useAuth();
  return <TopBar title={title} subtitle={subtitle} personName={session?.staff.name} onLogout={() => void logout()} />;
}

import { Link, Outlet } from 'react-router';
import { useAuth } from '../../features/auth/AuthContext';
import { Logo } from '../halloween/Logo';
import { AppShell } from './AppShell';

/** Pages reachable signed-out (leaderboard, profiles, tournaments) use the app shell when signed in. */
export function AdaptiveShell() {
  const { user } = useAuth();
  if (user) return <AppShell />;
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" aria-label="ChessArena home">
            <Logo size="sm" />
          </Link>
          <nav className="flex gap-2 text-sm">
            <Link to="/login" className="rounded-lg px-3 py-2 text-stone-700 hover:bg-stone-100">
              Sign in
            </Link>
            <Link to="/register" className="rounded-lg bg-green-800 px-3 py-2 font-medium text-white hover:bg-green-900">
              Create account
            </Link>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

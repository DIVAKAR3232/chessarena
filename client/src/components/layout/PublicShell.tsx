import { Crown } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../../features/auth/AuthContext';
import { AppShell } from './AppShell';

/** Pages reachable signed-out (leaderboard, profiles, tournaments) use the app shell when signed in. */
export function AdaptiveShell() {
  const { user } = useAuth();
  if (user) return <AppShell />;
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-green-800 text-white">
              <Crown className="size-4" aria-hidden />
            </span>
            ChessArena
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

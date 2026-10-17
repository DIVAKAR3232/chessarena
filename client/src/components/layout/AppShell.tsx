import {
  BarChart3,
  Crown,
  FileClock,
  Gavel,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Swords,
  Trophy,
  User,
  Users,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../features/auth/AuthContext';
import { useConnectionStatus } from '../../hooks/useSocket';
import type { Role } from '../../types/api';
import { cx } from '../ui';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const NAV: Record<Role, NavItem[]> = {
  PLAYER: [
    { to: '/play', label: 'Dashboard', icon: <LayoutDashboard className="size-4" />, end: true },
    { to: '/play/lobby', label: 'Play', icon: <Swords className="size-4" /> },
    { to: '/play/history', label: 'History', icon: <History className="size-4" /> },
    { to: '/tournaments', label: 'Tournaments', icon: <Trophy className="size-4" /> },
    { to: '/leaderboard', label: 'Leaderboard', icon: <BarChart3 className="size-4" /> },
  ],
  COORDINATOR: [
    { to: '/coordinator', label: 'Dashboard', icon: <LayoutDashboard className="size-4" />, end: true },
    { to: '/coordinator/tournaments', label: 'Tournaments', icon: <Trophy className="size-4" /> },
    { to: '/coordinator/matches', label: 'Matches', icon: <Swords className="size-4" /> },
    { to: '/coordinator/disputes', label: 'Disputes', icon: <Gavel className="size-4" /> },
    { to: '/leaderboard', label: 'Leaderboard', icon: <BarChart3 className="size-4" /> },
  ],
  ADMIN: [
    { to: '/admin', label: 'Overview', icon: <LayoutDashboard className="size-4" />, end: true },
    { to: '/admin/users', label: 'Users', icon: <Users className="size-4" /> },
    { to: '/admin/tournaments', label: 'Tournaments', icon: <Trophy className="size-4" /> },
    { to: '/admin/matches', label: 'Games', icon: <Swords className="size-4" /> },
    { to: '/admin/disputes', label: 'Disputes', icon: <Gavel className="size-4" /> },
    { to: '/leaderboard', label: 'Leaderboard', icon: <BarChart3 className="size-4" /> },
    { to: '/admin/audit', label: 'Audit log', icon: <FileClock className="size-4" /> },
    { to: '/admin/settings', label: 'Settings', icon: <Settings className="size-4" /> },
  ],
};

function ConnectionDot() {
  const status = useConnectionStatus();
  const label = status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline';
  return (
    <span className="hidden items-center gap-1.5 text-xs text-stone-500 sm:flex" title={`Realtime connection: ${label}`}>
      <span
        className={cx(
          'size-2 rounded-full',
          status === 'connected' ? 'bg-green-600' : status === 'connecting' ? 'animate-pulse bg-amber-500' : 'bg-red-500',
        )}
      />
      {label}
    </span>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const items = NAV[user.role];

  const links = (
    <ul className="flex flex-col gap-1 lg:flex-row lg:items-center">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-green-50 text-green-900' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <button className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle navigation">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link to="/" className="flex items-center gap-2 font-semibold text-stone-900">
            <span className="flex size-8 items-center justify-center rounded-lg bg-green-800 text-white">
              <Crown className="size-4" aria-hidden />
            </span>
            ChessArena
          </Link>
          <nav className="hidden flex-1 lg:block" aria-label="Main">
            {links}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ConnectionDot />
            <NotificationBell />
            <Link to="/account" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100" aria-label="Account settings">
              <User className="size-4" />
              <span className="hidden max-w-32 truncate sm:inline">{user.displayName}</span>
              {user.role !== 'PLAYER' && <span className="hidden text-xs text-stone-500 sm:inline">({user.role.toLowerCase()})</span>}
            </Link>
            <button
              onClick={async () => {
                await logout();
                navigate(user.role === 'ADMIN' ? '/admin/login' : '/login');
              }}
              className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-stone-100 px-4 py-2 lg:hidden" aria-label="Main mobile">
            {links}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

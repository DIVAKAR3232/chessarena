import { createBrowserRouter, Link } from 'react-router';
import { AppShell } from '../components/layout/AppShell';
import { AdaptiveShell } from '../components/layout/PublicShell';
import { AdminLoginPage } from '../pages/admin/AdminLoginPage';
import { AdminAudit, AdminMatches, AdminSettings, DisputesPage } from '../pages/admin/AdminMisc';
import { AdminOverview } from '../pages/admin/AdminOverview';
import { AdminUserDetail } from '../pages/admin/AdminUserDetail';
import { AdminUsers } from '../pages/admin/AdminUsers';
import { CoordinatorDashboard, CoordinatorMatches } from '../pages/coordinator/CoordinatorPages';
import { AccountPage } from '../pages/player/AccountPage';
import { GamePage } from '../pages/player/GamePage';
import { HistoryPage } from '../pages/player/HistoryPage';
import { LobbyPage } from '../pages/player/LobbyPage';
import { NotificationsPage } from '../pages/player/NotificationsPage';
import { PlayerDashboard } from '../pages/player/PlayerDashboard';
import { ReplayPage } from '../pages/player/ReplayPage';
import { LandingPage } from '../pages/public/LandingPage';
import { LeaderboardPage } from '../pages/public/LeaderboardPage';
import { LoginPage } from '../pages/public/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from '../pages/public/PasswordPages';
import { PlayerProfilePage } from '../pages/public/PlayerProfilePage';
import { RegisterPage } from '../pages/public/RegisterPage';
import { TournamentDetailPage } from '../pages/tournaments/TournamentDetailPage';
import { TournamentFormPage } from '../pages/tournaments/TournamentFormPage';
import { TournamentsPage } from '../pages/tournaments/TournamentsPage';
import { GuestOnly, RequireAuth } from './guards';

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-5xl font-semibold text-stone-300">404</p>
      <p className="text-stone-700">This page does not exist.</p>
      <Link to="/" className="text-sm font-medium text-green-800 hover:underline">
        Go home
      </Link>
    </div>
  );
}

const admin = (el: React.ReactNode) => <RequireAuth roles={['ADMIN']}>{el}</RequireAuth>;
const coord = (el: React.ReactNode) => <RequireAuth roles={['COORDINATOR', 'ADMIN']}>{el}</RequireAuth>;
const player = (el: React.ReactNode) => <RequireAuth roles={['PLAYER']}>{el}</RequireAuth>;

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <GuestOnly><LoginPage /></GuestOnly> },
  { path: '/register', element: <GuestOnly><RegisterPage /></GuestOnly> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/admin/login', element: <AdminLoginPage /> },
  {
    element: <AdaptiveShell />,
    children: [
      { path: '/leaderboard', element: <LeaderboardPage /> },
      { path: '/players/:id', element: <PlayerProfilePage /> },
      { path: '/tournaments', element: <TournamentsPage /> },
      { path: '/tournaments/:id', element: <TournamentDetailPage /> },
    ],
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/play', element: player(<PlayerDashboard />) },
      { path: '/play/lobby', element: player(<LobbyPage />) },
      { path: '/play/history', element: player(<HistoryPage />) },
      { path: '/games/:id', element: <GamePage /> },
      { path: '/games/:id/replay', element: <ReplayPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/account', element: <AccountPage /> },

      { path: '/admin', element: admin(<AdminOverview />) },
      { path: '/admin/users', element: admin(<AdminUsers />) },
      { path: '/admin/users/:id', element: admin(<AdminUserDetail />) },
      { path: '/admin/tournaments', element: admin(<TournamentsPage base="/admin/tournaments" />) },
      { path: '/admin/tournaments/new', element: admin(<TournamentFormPage />) },
      { path: '/admin/tournaments/:id', element: admin(<TournamentDetailPage />) },
      { path: '/admin/matches', element: admin(<AdminMatches />) },
      { path: '/admin/disputes', element: admin(<DisputesPage endpoint="/admin/disputes" canResolve />) },
      { path: '/admin/audit', element: admin(<AdminAudit />) },
      { path: '/admin/settings', element: admin(<AdminSettings />) },

      { path: '/coordinator', element: coord(<CoordinatorDashboard />) },
      { path: '/coordinator/tournaments', element: coord(<TournamentsPage scope="assigned" title="Assigned tournaments" base="/coordinator/tournaments" />) },
      { path: '/coordinator/tournaments/:id', element: coord(<TournamentDetailPage />) },
      { path: '/coordinator/matches', element: coord(<CoordinatorMatches />) },
      { path: '/coordinator/disputes', element: coord(<DisputesPage endpoint="/coordinator/disputes" canResolve={false} />) },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

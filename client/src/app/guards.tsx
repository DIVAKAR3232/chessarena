import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Spinner } from '../components/ui';
import { homePathFor, useAuth } from '../features/auth/AuthContext';
import type { Role } from '../types/api';

/**
 * Client-side route guards are a UX convenience only: every protected API endpoint and socket
 * event is independently authorized on the server.
 */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) {
    const loginPath = location.pathname.startsWith('/admin') ? '/admin/login' : '/login';
    return <Navigate to={loginPath} replace state={{ from: location.pathname + location.search }} />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user)} replace />;
  return <>{children}</>;
}

/** Login/register pages: signed-in users go straight to their home. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Navigate to={homePathFor(user)} replace />;
  return <>{children}</>;
}

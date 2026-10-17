import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, post } from '../../services/api/client';
import { connectSocket, disconnectSocket } from '../../services/socket/socket';
import type { Me } from '../../types/api';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (identifier: string, password: string, portal?: 'app' | 'admin') => Promise<Me>;
  register: (input: RegisterInput) => Promise<{ user: Me; verificationRequired: boolean }>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  setUser: (u: Me) => void;
}

export interface RegisterInput {
  displayName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    // Only a 401 means "signed out"; network errors and 5xx (e.g. API restarting) are retried
    // with backoff so a brief outage does not log the user out.
    for (let attempt = 0; ; attempt++) {
      try {
        const { user } = await get<{ user: Me }>('/auth/me');
        setUser(user);
        break;
      } catch (err) {
        const transient = !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
        if (!transient || attempt >= 5) {
          setUser(null);
          break;
        }
        await new Promise((r) => setTimeout(r, Math.min(4000, 500 * 2 ** attempt)));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // One socket per signed-in session.
  useEffect(() => {
    if (user) connectSocket();
    else disconnectSocket();
  }, [user]);

  const login = useCallback(async (identifier: string, password: string, portal: 'app' | 'admin' = 'app') => {
    const { user } = await post<{ user: Me }>('/auth/login', { identifier, password, portal });
    setUser(user);
    return user;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await post<{ user: Me; verificationRequired: boolean }>('/auth/register', input);
    if (!res.verificationRequired) setUser(res.user);
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, reload, setUser }),
    [user, loading, login, register, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function homePathFor(user: Pick<Me, 'role'>): string {
  if (user.role === 'ADMIN') return '/admin';
  if (user.role === 'COORDINATOR') return '/coordinator';
  return '/play';
}

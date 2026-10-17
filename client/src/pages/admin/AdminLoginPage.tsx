import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router';
import type { z } from 'zod';
import { Spinner } from '../../components/ui';
import { homePathFor, useAuth } from '../../features/auth/AuthContext';
import { loginSchema } from '../../features/auth/schemas';
import { errorMessage } from '../../services/api/client';

type Values = z.infer<typeof loginSchema>;

/** Separate sign-in portal for administrators. The server rejects non-admin accounts here. */
export function AdminLoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(loginSchema) });

  if (loading) return <Spinner />;
  if (user) return <Navigate to={homePathFor(user)} replace />;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.identifier, v.password, 'admin');
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const field =
    'block w-full rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-sm text-white outline-none placeholder:text-stone-500 focus:border-green-500 focus:ring-2 focus:ring-green-900';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-950 px-4 py-10">
      <div className="mb-6 flex items-center gap-3 text-white">
        <span className="flex size-10 items-center justify-center rounded-lg bg-green-700">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-lg font-semibold">ChessArena Admin</p>
          <p className="text-xs text-stone-400">Restricted area: administrators only</p>
        </div>
      </div>
      <form onSubmit={onSubmit} noValidate className="w-full max-w-sm space-y-4 rounded-xl border border-stone-800 bg-stone-900 p-6 shadow-xl">
        {error && (
          <p role="alert" className="rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="admin-id" className="mb-1 block text-sm font-medium text-stone-300">
            Admin username
          </label>
          <input id="admin-id" autoComplete="username" className={field} {...register('identifier')} />
          {formState.errors.identifier && <p className="mt-1 text-xs text-red-300">{formState.errors.identifier.message}</p>}
        </div>
        <div>
          <label htmlFor="admin-pw" className="mb-1 block text-sm font-medium text-stone-300">
            Password
          </label>
          <input id="admin-pw" type="password" autoComplete="current-password" className={field} {...register('password')} />
          {formState.errors.password && <p className="mt-1 text-xs text-red-300">{formState.errors.password.message}</p>}
        </div>
        <button
          type="submit"
          disabled={formState.isSubmitting}
          className="w-full rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500 disabled:opacity-50"
        >
          {formState.isSubmitting ? 'Signing in…' : 'Sign in to admin portal'}
        </button>
      </form>
      <p className="mt-4 text-sm text-stone-500">
        Not an administrator?{' '}
        <Link to="/login" className="text-stone-300 hover:underline">
          Player sign-in
        </Link>
      </p>
    </div>
  );
}

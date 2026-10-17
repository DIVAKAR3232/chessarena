import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import type { z } from 'zod';
import { Button, Input } from '../../components/ui';
import { homePathFor, useAuth } from '../../features/auth/AuthContext';
import { loginSchema } from '../../features/auth/schemas';
import { errorMessage } from '../../services/api/client';
import { AuthLayout, FormError } from './AuthLayout';

type Values = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(loginSchema) });
  const from = (location.state as { from?: string } | null)?.from;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values.identifier, values.password);
      navigate(from && from !== '/login' ? from : homePathFor(user), { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back to ChessArena."
      footer={
        <div className="flex flex-col items-center gap-2">
          <span>
            New here?{' '}
            <Link to="/register" className="font-medium text-green-800 hover:underline">
              Create an account
            </Link>
          </span>
          <Link to="/admin/login" className="text-xs text-stone-500 hover:text-stone-800 hover:underline">
            Administrator sign-in
          </Link>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Input label="Email or username" autoComplete="username" {...register('identifier')} error={formState.errors.identifier?.message} />
        <Input label="Password" type="password" autoComplete="current-password" {...register('password')} error={formState.errors.password?.message} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-green-800 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

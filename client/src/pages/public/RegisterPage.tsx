import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { Button, Input } from '../../components/ui';
import { applyServerErrors } from '../../features/auth/applyServerErrors';
import { useAuth } from '../../features/auth/AuthContext';
import { registerSchema } from '../../features/auth/schemas';
import { AuthLayout, FormError } from './AuthLayout';

type Values = z.infer<typeof registerSchema>;
const FIELDS = ['displayName', 'username', 'email', 'password', 'confirmPassword'] as const;

export function RegisterPage() {
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [verifySent, setVerifySent] = useState<string | null>(null);
  const { register, handleSubmit, formState, setError } = useForm<Values>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await signUp(values);
      if (res.verificationRequired) setVerifySent(values.email);
      else navigate('/play', { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  if (verifySent) {
    return (
      <AuthLayout title="Check your email">
        <div className="flex flex-col items-center gap-3 text-center text-sm text-stone-700">
          <MailCheck className="size-10 text-green-700" aria-hidden />
          <p>
            We sent a verification link to <strong>{verifySent}</strong>. Open it to activate your account, then sign in.
          </p>
          <Link to="/login" className="font-medium text-green-800 hover:underline">
            Go to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join ChessArena and start playing."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-green-800 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Input label="Display name" autoComplete="name" {...register('displayName')} error={formState.errors.displayName?.message} />
        <Input label="Username" autoComplete="username" hint="Letters, numbers and underscores" {...register('username')} error={formState.errors.username?.message} />
        <Input label="Email" type="email" autoComplete="email" {...register('email')} error={formState.errors.email?.message} />
        <Input label="Password" type="password" autoComplete="new-password" hint="8+ characters with a letter and a number" {...register('password')} error={formState.errors.password?.message} />
        <Input label="Confirm password" type="password" autoComplete="new-password" {...register('confirmPassword')} error={formState.errors.confirmPassword?.message} />
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

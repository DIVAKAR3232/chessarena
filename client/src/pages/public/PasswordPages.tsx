import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { Button, Input, Spinner } from '../../components/ui';
import { applyServerErrors } from '../../features/auth/applyServerErrors';
import { forgotSchema, resetSchema } from '../../features/auth/schemas';
import { errorMessage, post } from '../../services/api/client';
import { AuthLayout, FormError } from './AuthLayout';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await post('/auth/forgot-password', values);
      setSent(true);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new password." footer={<Link to="/login" className="text-green-800 hover:underline">Back to sign in</Link>}>
      {sent ? (
        <p className="text-sm text-stone-700">If an account exists for that email, a reset link is on its way. The link expires in 30 minutes.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Input label="Email" type="email" autoComplete="email" {...register('email')} error={formState.errors.email?.message} />
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState, setError } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await post('/auth/reset-password', { token, ...values });
      setDone(true);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ['password', 'confirmPassword']));
    }
  });

  if (!token) {
    return (
      <AuthLayout title="Invalid link">
        <p className="text-sm text-stone-700">
          This reset link is incomplete. <Link to="/forgot-password" className="text-green-800 hover:underline">Request a new one</Link>.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <div className="flex flex-col items-center gap-3 text-center text-sm text-stone-700">
          <CheckCircle2 className="size-10 text-green-700" aria-hidden />
          <p>Your password has been changed and all sessions were signed out.</p>
          <Link to="/login" className="font-medium text-green-800 hover:underline">
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Input label="New password" type="password" autoComplete="new-password" {...register('password')} error={formState.errors.password?.message} />
          <Input label="Confirm password" type="password" autoComplete="new-password" {...register('confirmPassword')} error={formState.errors.confirmPassword?.message} />
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // single-use token: never submit twice (StrictMode)
    started.current = true;
    if (!token) {
      setState('error');
      setMessage('This verification link is incomplete.');
      return;
    }
    post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((err) => {
        setState('error');
        setMessage(errorMessage(err));
      });
  }, [token]);

  return (
    <AuthLayout title="Email verification">
      {state === 'pending' && <Spinner label="Verifying…" />}
      {state === 'ok' && (
        <p className="text-sm text-stone-700">
          Your email is verified. <Link to="/login" className="font-medium text-green-800 hover:underline">Sign in</Link>
        </p>
      )}
      {state === 'error' && <FormError message={message} />}
    </AuthLayout>
  );
}

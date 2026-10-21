import { Logo } from '../../components/halloween/Logo';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-6" aria-label="ChessArena home">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white/90 p-6 shadow-[0_0_40px_rgba(126,58,242,0.18)] backdrop-blur">
        <h1 className="text-xl font-semibold text-stone-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-600">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="mt-4 text-sm text-stone-600">{footer}</div>}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}

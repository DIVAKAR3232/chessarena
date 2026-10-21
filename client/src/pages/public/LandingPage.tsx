import { BarChart3, Clock, ShieldCheck, Swords, Trophy } from 'lucide-react';
import { Logo } from '../../components/halloween/Logo';
import { Link } from 'react-router';
import { homePathFor, useAuth } from '../../features/auth/AuthContext';

const FEATURES = [
  { icon: Swords, title: 'Real-time 1-vs-1', text: 'Every move validated by the server and synced instantly to both players.' },
  { icon: Clock, title: 'Fair clocks', text: 'Server-side clocks with increments, from 1-minute bullet to 15+10 rapid.' },
  { icon: Trophy, title: 'Tournaments', text: 'Round-robin and knockout events run by coordinators with live standings.' },
  { icon: BarChart3, title: 'Elo ratings', text: 'Ratings computed from every rated result, with a public leaderboard.' },
  { icon: ShieldCheck, title: 'Secure by design', text: 'Role-based access for players, coordinators and administrators.' },
];

export function LandingPage() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Logo size="lg" />
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/leaderboard" className="hidden rounded-lg px-3 py-2 text-stone-700 hover:bg-stone-100 sm:block">
            Leaderboard
          </Link>
          {user ? (
            <Link to={homePathFor(user)} className="rounded-lg bg-green-800 px-4 py-2 font-medium text-white hover:bg-green-900">
              Open app
            </Link>
          ) : (
            <>
              <Link to="/login" className="rounded-lg px-3 py-2 text-stone-700 hover:bg-stone-100">
                Sign in
              </Link>
              <Link to="/register" className="rounded-lg bg-green-800 px-4 py-2 font-medium text-white hover:bg-green-900">
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 md:grid-cols-2 md:py-20">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-900 ring-1 ring-green-200">
            🎃 Halloween Arena is open
          </p>
          <h1 className="text-5xl tracking-tight sm:text-6xl">Play if you dare.</h1>
          <p className="mt-4 max-w-md text-lg text-stone-600">
            Challenge friends at midnight, survive haunted tournaments, and climb the spookiest leaderboard in town.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={user ? homePathFor(user) : '/register'} className="rounded-lg bg-green-800 px-5 py-2.5 font-medium text-white hover:bg-green-900">
              {user ? 'Go to dashboard' : 'Start playing'}
            </Link>
            <Link to="/leaderboard" className="rounded-lg bg-white px-5 py-2.5 font-medium text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50">
              View leaderboard
            </Link>
          </div>
        </div>
        <div aria-hidden className="relative mx-auto w-full max-w-sm">
          <div className="grid aspect-square w-full grid-cols-8 overflow-hidden rounded-xl shadow-[0_0_60px_rgba(249,115,22,0.25)] ring-1 ring-orange-500/30">
            {Array.from({ length: 64 }, (_, i) => (
              <div key={i} className={(Math.floor(i / 8) + i) % 2 === 0 ? 'bg-[#f2c48d]' : 'bg-[#6b3fa0]'} />
            ))}
          </div>
          <span className="absolute -top-8 -left-6 animate-float text-6xl drop-shadow-[0_0_14px_rgba(255,255,255,0.35)]">👻</span>
          <span className="absolute -right-5 -bottom-6 animate-float text-6xl drop-shadow-[0_0_18px_rgba(249,115,22,0.6)] [animation-delay:1.5s]">🎃</span>
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-8xl text-[#1b1129] opacity-90 drop-shadow-[0_0_12px_rgba(249,115,22,0.5)]">♞</span>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-xl border border-stone-200 bg-white p-4">
              <f.icon className="size-5 text-green-800" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold text-stone-900">{f.title}</h2>
              <p className="mt-1 text-sm text-stone-600">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

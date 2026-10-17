import { BarChart3, Clock, Crown, ShieldCheck, Swords, Trophy } from 'lucide-react';
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
        <span className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex size-9 items-center justify-center rounded-lg bg-green-800 text-white">
            <Crown className="size-5" aria-hidden />
          </span>
          ChessArena
        </span>
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
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-800">Competitive chess, organized</p>
          <h1 className="text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">Play, compete and climb the ladder.</h1>
          <p className="mt-4 max-w-md text-lg text-stone-600">
            Challenge friends, join coordinated tournaments, and track every rated game, all in one platform.
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
        <div aria-hidden className="mx-auto grid aspect-square w-full max-w-sm grid-cols-8 overflow-hidden rounded-xl shadow-lg ring-1 ring-stone-300">
          {Array.from({ length: 64 }, (_, i) => (
            <div key={i} className={(Math.floor(i / 8) + i) % 2 === 0 ? 'bg-[#eeeed2]' : 'bg-[#769656]'} />
          ))}
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

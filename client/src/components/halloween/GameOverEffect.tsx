import { useEffect, useMemo, useState } from 'react';

const ICONS = ['🎃', '👻', '🦇', '🕷️', '🍬', '💀'];

/** Short shower of Halloween icons plus a headline when a game ends. */
export function GameOverEffect({ trigger, headline }: { trigger: number; headline: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 4200);
    return () => clearTimeout(t);
  }, [trigger]);

  const pieces = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        icon: ICONS[i % ICONS.length]!,
        left: (i * 41 + trigger) % 100,
        delay: (i % 9) * 0.18,
        duration: 2.4 + ((i * 13) % 10) / 6,
        size: 1.2 + ((i * 7) % 5) * 0.3,
      })),
    [trigger],
  );

  if (!visible) return null;
  return (
    <div aria-hidden className="halloween-motion pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="spooky-fall absolute top-0"
          style={{ left: `${p.left}%`, fontSize: `${p.size}rem`, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }}
        >
          {p.icon}
        </span>
      ))}
      <div className="absolute inset-x-0 top-1/3 flex justify-center px-4">
        <p className="result-pop font-spooky rounded-2xl bg-black/70 px-6 py-3 text-center text-4xl text-[#fdba74] ring-1 ring-orange-500/40 [text-shadow:0_0_20px_rgba(249,115,22,0.7)] sm:text-5xl">
          {headline}
        </p>
      </div>
    </div>
  );
}

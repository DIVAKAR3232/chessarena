import { useMemo } from 'react';

/**
 * Decorative, non-interactive Halloween scene behind every page: moon, stars, drifting ghosts,
 * flapping bats and rolling fog. Hidden from assistive tech and disabled for reduced motion.
 */
export function HalloweenBackdrop() {
  const stars = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: (i * 37) % 100,
        top: (i * 53) % 55,
        size: 1 + ((i * 7) % 3),
        delay: (i % 7) * 0.7,
        duration: 2.5 + (i % 5),
      })),
    [],
  );

  const ghosts = [
    { top: '18%', size: '2.6rem', duration: 46, delay: -5, opacity: 0.22 },
    { top: '52%', size: '2rem', duration: 62, delay: -28, opacity: 0.16 },
    { top: '78%', size: '3rem', duration: 55, delay: -40, opacity: 0.18 },
  ];
  const bats = [
    { top: '9%', size: '1.4rem', duration: 19, delay: -3 },
    { top: '14%', size: '1.1rem', duration: 24, delay: -12 },
    { top: '6%', size: '1.7rem', duration: 31, delay: -20 },
  ];

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none">
      {/* Moon */}
      <div className="absolute top-8 right-[8%] size-24 rounded-full bg-[#fff4d6] opacity-80 shadow-[0_0_60px_25px_rgba(255,214,140,0.25)] sm:size-32">
        <div className="absolute top-5 left-6 size-5 rounded-full bg-[#f1e2bd]" />
        <div className="absolute top-12 left-14 size-3 rounded-full bg-[#f1e2bd]" />
      </div>

      {/* Stars */}
      {stars.map((s, i) => (
        <span
          key={i}
          className="halloween-star absolute rounded-full bg-[#fff6e0]"
          style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, animationDuration: `${s.duration}s` }}
        />
      ))}

      {/* Ghosts drifting across while bobbing */}
      <div className="halloween-motion">
        {ghosts.map((g, i) => (
          <div
            key={i}
            className="halloween-ghost-track absolute left-0"
            style={{ top: g.top, animationDuration: `${g.duration}s`, animationDelay: `${g.delay}s`, opacity: g.opacity }}
          >
            <span className="inline-block animate-float" style={{ fontSize: g.size, animationDelay: `${i * 1.3}s` }}>
              👻
            </span>
          </div>
        ))}

        {/* Bats */}
        {bats.map((b, i) => (
          <div key={i} className="halloween-bat absolute left-0" style={{ top: b.top, fontSize: b.size, animationDuration: `${b.duration}s`, animationDelay: `${b.delay}s`, opacity: 0.55 }}>
            <span>🦇</span>
          </div>
        ))}
      </div>

      {/* Graveyard silhouette + fog */}
      <svg className="absolute bottom-0 left-0 h-24 w-full opacity-60" viewBox="0 0 1200 100" preserveAspectRatio="none">
        <path
          fill="#07040c"
          d="M0 100 V70 Q60 55 120 68 T240 64 T360 70 T480 62 T600 70 T720 60 T840 68 T960 62 T1080 70 T1200 64 V100 Z"
        />
        <g fill="#07040c">
          <rect x="140" y="44" width="16" height="30" rx="8" />
          <rect x="420" y="40" width="20" height="34" rx="10" />
          <rect x="433" y="50" width="2" height="0" />
          <path d="M760 74 v-32 h4 v-8 h6 v8 h4 v32 z" />
          <rect x="1010" y="46" width="18" height="28" rx="9" />
        </g>
      </svg>
      <div className="halloween-motion absolute bottom-0 left-0 h-40 w-[200%]">
        <div
          className="halloween-fog h-full w-full opacity-40"
          style={{
            background:
              'radial-gradient(40% 60% at 10% 100%, rgba(200,190,230,0.35), transparent 70%), radial-gradient(35% 55% at 35% 100%, rgba(200,190,230,0.25), transparent 70%), radial-gradient(40% 60% at 60% 100%, rgba(200,190,230,0.35), transparent 70%), radial-gradient(35% 55% at 85% 100%, rgba(200,190,230,0.25), transparent 70%)',
          }}
        />
      </div>
    </div>
  );
}

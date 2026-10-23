/** Deterministic PRNG so the same row always gets the same hand-drawn stroke. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function strikePath(seed: string): string {
  const r = seeded(seed);
  const y = () => 7 + r() * 8;
  return `M3 ${y().toFixed(1)} C${(60 + r() * 40).toFixed(0)} ${y().toFixed(1)} ${(140 + r() * 40).toFixed(0)} ${y().toFixed(1)} ${(
    230 + r() * 20
  ).toFixed(0)} ${y().toFixed(1)} S${(380 + r() * 30).toFixed(0)} ${y().toFixed(1)} ${(470 + r() * 6).toFixed(0)} ${y().toFixed(1)}`;
}

/** The marker strike across a removed row. `draw` animates it on, once. */
export function Strike({ seed, draw = false, delay = 0, className = '' }: { seed: string; draw?: boolean; delay?: number; className?: string }) {
  return (
    <svg
      className={`strike ${draw ? 'draw' : ''} ${className}`}
      viewBox="0 0 478 22"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ ['--strike-delay' as string]: `${delay}ms` }}
    >
      <path d={strikePath(seed)} pathLength={1} />
    </svg>
  );
}

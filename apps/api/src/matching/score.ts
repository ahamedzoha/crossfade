import { artistKey, artistTokens, parseTitle } from './normalize.js';

export interface TrackLike {
  title: string;
  artists: string[];
  album?: string | null;
  durationMs?: number | null;
  isrc?: string | null;
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of A) {
    overlap += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return (2 * overlap) / total;
}

export function durationScore(a?: number | null, b?: number | null): number {
  if (!a || !b) return 0.7;
  const diff = Math.abs(a - b) / 1000;
  if (diff <= 2) return 1;
  if (diff <= 5) return 0.85;
  if (diff <= 10) return 0.6;
  if (diff <= 20) return 0.3;
  return 0;
}

export interface ScoreBreakdown {
  score: number;
  title: number;
  artist: number;
  duration: number;
  versionMismatch: boolean;
}

/** How likely `candidate` is the same recording as `target`, 0..1. */
export function scoreMatch(target: TrackLike, candidate: TrackLike): ScoreBreakdown {
  if (target.isrc && candidate.isrc && target.isrc.toUpperCase() === candidate.isrc.toUpperCase()) {
    return { score: 1, title: 1, artist: 1, duration: 1, versionMismatch: false };
  }

  const t = parseTitle(target.title, target.artists);
  const c = parseTitle(candidate.title, candidate.artists);

  let title = similarity(t.key, c.key);
  if (title < 1 && t.key.length > 3 && c.key.length > 3 && (t.key.includes(c.key) || c.key.includes(t.key))) {
    title = Math.max(title, 0.88);
  }

  const ta = artistTokens(target.artists);
  const ca = artistTokens(candidate.artists);
  let artist = similarity(artistKey(target.artists), artistKey(candidate.artists));
  for (const x of ta) {
    for (const y of ca) artist = Math.max(artist, similarity(x, y));
  }

  const duration = durationScore(target.durationMs, candidate.durationMs);
  const versionMismatch = (t.versionTag ?? '') !== (c.versionTag ?? '');
  const penalty = versionMismatch ? 0.25 : 0;

  const score = Math.max(0, Math.min(1, 0.5 * title + 0.3 * artist + 0.2 * duration - penalty));
  return { score: Math.round(score * 1000) / 1000, title, artist, duration, versionMismatch };
}

export type DedupeMode = 'strict' | 'loose';

/** Whether two tracks are the same song for dedupe purposes. */
export function sameRecording(a: TrackLike, b: TrackLike, mode: DedupeMode): boolean {
  if (a.isrc && b.isrc && a.isrc.toUpperCase() === b.isrc.toUpperCase()) return true;
  const ta = parseTitle(a.title, a.artists);
  const tb = parseTitle(b.title, b.artists);
  if (ta.key !== tb.key || (ta.versionTag ?? '') !== (tb.versionTag ?? '')) return false;
  if (artistKey(a.artists) !== artistKey(b.artists)) return false;
  if (mode === 'loose') return true;
  if (!a.durationMs || !b.durationMs) return true;
  return Math.abs(a.durationMs - b.durationMs) <= 6000;
}

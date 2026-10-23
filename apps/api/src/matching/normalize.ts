/**
 * Title/artist normalisation shared by matching and dedupe.
 *
 * Goal: "Dreams - 2004 Remaster", "Dreams (Remastered)" and "Dreams" share a key,
 * while "Dreams (Live)" keeps a version tag so it is never collapsed into the studio cut.
 */

const VERSION_WORDS: [RegExp, string][] = [
  [/\b(live|en vivo|ao vivo)\b/, 'live'],
  [/\bacoustic\b/, 'acoustic'],
  [/\bunplugged\b/, 'acoustic'],
  [/\binstrumental\b/, 'instrumental'],
  [/\bkaraoke\b/, 'karaoke'],
  [/\bdemo\b/, 'demo'],
  [/\b(sped up|speed up|slowed|reverb|nightcore)\b/, 'altered'],
  [/\b(remix|rmx|bootleg|rework|vip mix|club mix|dub mix|extended mix)\b/, 'remix'],
  [/\bcover\b/, 'cover'],
  [/\b(a cappella|acapella)\b/, 'acapella'],
];

const NOISE =
  /\b(remaster(ed)?|\d{4} remaster(ed)?|mono|stereo|version|edit|radio|single|album|original|explicit|clean|deluxe|bonus( track)?|anniversary|edition|expanded|from .+|official( music)?( video| audio)?|music video|lyric(s)?( video)?|visuali[sz]er|audio|video|hd|hq|4k|mv|prod\.? .+)\b/;

const FEAT = /\b(feat\.?|ft\.?|featuring|with)\b/;

export function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' and ');
}

function clean(value: string): string {
  return value
    .replace(/'/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TitleParts {
  key: string;
  versionTag: string | null;
}

/** Splits a title into its base key and an optional version tag. */
export function parseTitle(title: string, artists: string[] = []): TitleParts {
  let base = fold(title);
  const extras: string[] = [];

  // Bracketed segments: (feat. X), [Live], {Remix}
  base = base.replace(/[([{]([^)\]}]*)[)\]}]/g, (_, inner: string) => {
    extras.push(inner);
    return ' ';
  });

  // Dash suffixes: "Dreams - 2004 Remaster", "Song - Live at Wembley"
  const dash = base.split(/\s[-–—]\s/);
  if (dash.length > 1) {
    // YouTube video titles often read "Artist - Title (Official Video)".
    const head = clean(dash[0] ?? '');
    const artistKeys = artists.map((a) => clean(fold(a)));
    if (artistKeys.some((a) => a && (head === a || head.startsWith(a)))) {
      base = dash.slice(1).join(' - ');
      const rest = base.split(/\s[-–—]\s/);
      base = rest[0] ?? base;
      extras.push(...rest.slice(1));
    } else {
      base = dash[0] ?? base;
      extras.push(...dash.slice(1));
    }
  }

  // Inline "feat." without brackets
  const featIdx = base.search(FEAT);
  if (featIdx > 0) base = base.slice(0, featIdx);

  let versionTag: string | null = null;
  for (const extra of extras) {
    const e = clean(extra);
    if (!e || FEAT.test(e)) continue;
    for (const [re, tag] of VERSION_WORDS) {
      if (re.test(e)) {
        versionTag = tag === 'remix' ? `remix:${e}` : tag;
        break;
      }
    }
    if (versionTag) break;
    if (NOISE.test(e)) continue;
  }

  const key = clean(base);
  return { key: key || clean(fold(title)), versionTag };
}

const ARTIST_SPLIT = /\s*(?:,|;|\/|\band\b|\bx\b|\bvs\.?\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/;

/** Primary artist key, derived identically for every provider's artist formatting. */
export function artistKey(artists: string[]): string {
  const joined = fold(artists.filter(Boolean).join(', '));
  const first = joined.split(ARTIST_SPLIT)[0] ?? joined;
  return clean(first).replace(/^the /, '').replace(/ - topic$/, '');
}

/** All artist tokens, for overlap scoring. */
export function artistTokens(artists: string[]): Set<string> {
  const out = new Set<string>();
  for (const part of fold(artists.join(', ')).split(ARTIST_SPLIT)) {
    const c = clean(part).replace(/^the /, '').replace(/ topic$/, '');
    if (c) out.add(c);
  }
  return out;
}

/** Splits a single display string like "Daft Punk & Julian Casablancas" into names. */
export function splitArtistString(value: string): string[] {
  return value
    .split(/\s*(?:,|&| x | feat\.? | ft\.? )\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

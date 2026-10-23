import { Logger } from '@nestjs/common';

/**
 * The music.apple.com web player ships its own developer token inside its JS bundle.
 * "Web session" connections borrow it (with the user's media-user-token cookie), so no
 * paid Apple Developer account is needed. Unofficial: Apple rotates the token roughly
 * monthly and can change the page at any time, so it is re-read when it nears expiry
 * or stops working.
 */

const ORIGIN = 'https://music.apple.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0';
const logger = new Logger('AppleWebToken');

let cached: { token: string; exp: number } | null = null;
let inflight: Promise<string> | null = null;

interface Claims {
  iss?: string;
  exp?: number;
  root_https_origin?: string[];
}

function claims(jwt: string): Claims | null {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Claims;
  } catch {
    return null;
  }
}

async function text(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`music.apple.com returned HTTP ${res.status} for ${new URL(url).pathname}`);
  return res.text();
}

async function scrape(): Promise<{ token: string; exp: number }> {
  const html = await text(`${ORIGIN}/us/browse`);
  const scripts = [...new Set([...html.matchAll(/\/assets\/index[~-][\w-]+\.js/g)].map((m) => m[0]))];
  if (!scripts.length) throw new Error("Couldn't find the Apple Music web player's script; the page layout may have changed");
  const found: { token: string; c: Claims }[] = [];
  for (const path of scripts) {
    const js = await text(`${ORIGIN}${path}`);
    for (const m of js.matchAll(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g)) {
      const c = claims(m[0]);
      if (c?.exp && c.root_https_origin?.some((o) => o.endsWith('apple.com'))) found.push({ token: m[0], c });
    }
  }
  // The web player's own token is issued as "AMPWebPlay"; fall back to the longest-lived apple.com token.
  const pick =
    found.find((f) => f.c.iss === 'AMPWebPlay') ?? [...found].sort((a, b) => (b.c.exp ?? 0) - (a.c.exp ?? 0))[0];
  if (!pick) throw new Error("Couldn't find a token in the Apple Music web player; the page layout may have changed");
  logger.log(`Using Apple Music web token ${pick.c.iss}, valid until ${new Date(pick.c.exp! * 1000).toISOString().slice(0, 10)}`);
  return { token: pick.token, exp: pick.c.exp! * 1000 };
}

/** The current web-player token, re-read a day before it expires. */
export async function appleWebToken(force = false): Promise<string> {
  if (!force && cached && cached.exp - 24 * 3600_000 > Date.now()) return cached.token;
  inflight ??= scrape()
    .then((t) => {
      cached = t;
      return t.token;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Apple rejects the web token (401) unless the request claims to come from the web player. */
export const APPLE_WEB_HEADERS = { origin: ORIGIN } as const;

import type { ProviderCapabilities } from '@crossfade/shared';
import { PROVIDER_META } from '@crossfade/shared';
import { importPKCS8, SignJWT } from 'jose';
import { AuthExpiredError, ProviderHttpError, UnsupportedError } from '../../common/errors.js';
import { chunk, fetchJson } from '../../common/http.js';
import { APPLE_WEB_HEADERS, appleWebToken } from './apple-web-token.js';
import type {
  AccountIdentity,
  ConnectionContext,
  ProviderClient,
  RemotePlaylistInfo,
  RemoteTrack,
  SearchQuery,
} from '../provider.types.js';

const API = 'https://api.music.apple.com';
/** The web player's API host; the only one that edits library playlists for web sessions. */
const AMP_API = 'https://amp-api.music.apple.com';

export interface AppleAppConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
}

export interface AppleCredentials {
  /** `key`: official MusicKit key + Music-User-Token. `web`: the web player's token + media-user-token cookie. */
  mode?: 'key' | 'web';
  /** The user token: a Music-User-Token in key mode, the media-user-token cookie in web mode. */
  musicUserToken: string;
  storefront: string;
  connectedAt: number;
}

export type AppleAuth = { mode: 'key'; app: AppleAppConfig } | { mode: 'web' };

async function authHeaders(auth: AppleAuth, userToken: string, fresh = false): Promise<Record<string, string>> {
  if (auth.mode === 'key') {
    return { authorization: `Bearer ${await appleDeveloperToken(auth.app)}`, 'music-user-token': userToken };
  }
  // Tools in the wild send the cookie value both ways; the web player itself uses the cookie.
  return {
    authorization: `Bearer ${await appleWebToken(fresh)}`,
    'music-user-token': userToken,
    cookie: `media-user-token=${userToken}`,
    ...APPLE_WEB_HEADERS,
  };
}

const tokenCache = new Map<string, { token: string; exp: number }>();

/** Developer token (ES256 JWT). Cached; Apple allows up to 6 months, we mint 30-day tokens. */
export async function appleDeveloperToken(app: AppleAppConfig): Promise<string> {
  const cacheKey = `${app.teamId}:${app.keyId}`;
  const cached = tokenCache.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 3600 > now) return cached.token;
  const key = await importPKCS8(app.privateKey.trim(), 'ES256');
  const exp = now + 30 * 24 * 3600;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: app.keyId })
    .setIssuer(app.teamId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);
  tokenCache.set(cacheKey, { token, exp });
  return token;
}

interface Resource<A> {
  id: string;
  type: string;
  href?: string;
  attributes?: A;
  relationships?: Record<string, { data: Resource<unknown>[] }>;
}

interface Page<A> {
  data: Resource<A>[];
  next?: string;
}

interface SongAttributes {
  name: string;
  artwork?: { url: string };
  artistName: string;
  albumName?: string;
  durationInMillis?: number;
  isrc?: string;
  url?: string;
  playParams?: { id: string; kind: string; isLibrary?: boolean; catalogId?: string };
}

interface PlaylistAttributes {
  name: string;
  canEdit?: boolean;
  canDelete?: boolean;
  hasCatalog?: boolean;
  artwork?: { url: string };
  playParams?: { globalId?: string };
}

export async function appleStorefront(auth: AppleAuth, userToken: string): Promise<string> {
  const base = auth.mode === 'web' ? AMP_API : API;
  const res = await fetchJson<Page<unknown>>(`${base}/v1/me/storefront`, {
    label: 'Apple storefront',
    authStatuses: [401, 403],
    headers: await authHeaders(auth, userToken),
  });
  return res.data[0]?.id ?? 'us';
}

export class AppleClient implements ProviderClient {
  readonly provider = 'apple' as const;

  /** Library-song ids per playlist, keyed by the track id Crossfade uses; removals need them. */
  private readonly libraryIds = new Map<string, Map<string, string[]>>();

  constructor(
    private readonly auth: AppleAuth,
    private readonly ctx: ConnectionContext<AppleCredentials>,
  ) {}

  /** Web sessions can remove from playlists (the web player can); official keys can't. */
  get capabilities(): ProviderCapabilities {
    const base = PROVIDER_META.apple.capabilities;
    return this.auth.mode === 'web' ? { ...base, removeTracks: true } : base;
  }

  private get sf() {
    return this.ctx.credentials.storefront || 'us';
  }

  private get base() {
    return this.auth.mode === 'web' ? AMP_API : API;
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown; allow404?: boolean } = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.base}${path}`;
    const attempt = async (fresh: boolean) =>
      fetchJson<T>(url, {
        method: init.method ?? 'GET',
        body: init.body,
        label: `Apple Music ${init.method ?? 'GET'} ${path.split('?')[0]}`,
        authStatuses: [401, 403],
        // Apple's throttle spans about an hour and retries extend it: fail fast and let the engine defer.
        retry429: false,
        headers: await authHeaders(this.auth, this.ctx.credentials.musicUserToken, fresh),
      });
    try {
      try {
        return await attempt(false);
      } catch (err) {
        // A rotated web-player token looks like an auth failure: re-read it once before blaming the user's cookie.
        if (!(err instanceof AuthExpiredError) || this.auth.mode !== 'web') throw err;
        try {
          return await attempt(true);
        } catch (again) {
          if (!(again instanceof AuthExpiredError)) throw again;
          // Apple also answers 403 to edits it won't allow on some playlists; that isn't a dead session.
          if ((init.method ?? 'GET') !== 'GET' && (await this.sessionOk())) {
            throw new ProviderHttpError(
              403,
              "Apple Music refused to change this playlist. Playlists made in the Music app sometimes can't be edited from the web; link one Crossfade creates instead.",
            );
          }
          throw new AuthExpiredError('Apple Music stopped accepting this web session. Copy a fresh media-user-token cookie to reconnect.');
        }
      }
    } catch (err) {
      if (init.allow404 && err instanceof ProviderHttpError && err.status === 404) return undefined as T;
      throw err;
    }
  }

  private async sessionOk(): Promise<boolean> {
    try {
      await fetchJson(`${this.base}/v1/me/storefront`, {
        label: 'Apple session check',
        authStatuses: [401, 403],
        retries: 1,
        headers: await authHeaders(this.auth, this.ctx.credentials.musicUserToken),
      });
      return true;
    } catch {
      return false;
    }
  }

  private async pages<A>(first: string): Promise<Resource<A>[]> {
    const out: Resource<A>[] = [];
    let next: string | undefined = first;
    while (next) {
      const page: Page<A> | undefined = await this.call<Page<A>>(next, { allow404: true });
      if (!page) break;
      out.push(...page.data);
      next = page.next ? (page.next.startsWith('/') ? page.next : `/${page.next}`) : undefined;
      if (next && !next.includes('limit=')) next += `${next.includes('?') ? '&' : '?'}limit=100`;
    }
    return out;
  }

  async whoami(): Promise<AccountIdentity> {
    // Apple exposes no user id; the storefront plus token fingerprint identifies the connection.
    return {
      externalUserId: `apple-${this.ctx.credentials.musicUserToken.slice(-12)}`,
      displayName: `Apple Music · ${this.sf.toUpperCase()}`,
    };
  }

  private favorites: string | null | undefined;

  /**
   * Apple's "Favorite Songs" is a smart library playlist with no special flag: it is the one that
   * can be neither edited nor deleted. Its name is localised, so the name only breaks ties.
   */
  private async favoritesPlaylistId(items?: Resource<PlaylistAttributes>[]): Promise<string | null> {
    if (this.favorites !== undefined) return this.favorites;
    const all = items ?? (await this.pages<PlaylistAttributes>('/v1/me/library/playlists?limit=100'));
    const locked = all.filter((p) => p.attributes?.canEdit === false && p.attributes?.canDelete === false && !p.attributes?.hasCatalog);
    const pick = locked.find((p) => /favou?rite/i.test(p.attributes?.name ?? '')) ?? (locked.length === 1 ? locked[0] : undefined);
    this.favorites = pick?.id ?? null;
    return this.favorites;
  }

  async listPlaylists(): Promise<RemotePlaylistInfo[]> {
    const all = await this.pages<PlaylistAttributes>('/v1/me/library/playlists?limit=100');
    const fav = await this.favoritesPlaylistId(all);
    // Favorite Songs is offered as the account's liked collection, not as a playlist.
    const items = all.filter((p) => p.id !== fav);
    return items.map((p) => ({
      id: p.id,
      name: p.attributes?.name ?? 'Untitled',
      trackCount: null,
      editable: p.attributes?.canEdit ?? true,
      url: p.attributes?.playParams?.globalId
        ? `https://music.apple.com/library/playlist/${p.attributes.playParams.globalId}`
        : null,
      imageUrl: p.attributes?.artwork?.url?.replace('{w}', '300').replace('{h}', '300') ?? null,
    }));
  }

  async getPlaylistTracks(playlistId: string): Promise<RemoteTrack[]> {
    const items = await this.pages<SongAttributes>(
      `/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`,
    );
    const ids = new Map<string, string[]>();
    for (const s of items) {
      const t = libraryToRemote(s)[0];
      if (t) ids.set(t.id, [...(ids.get(t.id) ?? []), s.id]);
    }
    this.libraryIds.set(playlistId, ids);
    return this.withIsrc(items);
  }

  async createPlaylist(name: string, description?: string): Promise<RemotePlaylistInfo> {
    const res = await this.call<Page<PlaylistAttributes>>('/v1/me/library/playlists', {
      method: 'POST',
      body: { attributes: { name, description: description ?? 'Kept in sync by Crossfade' } },
    });
    const p = res.data[0];
    if (!p) throw new Error('Apple Music did not return the new playlist');
    return { id: p.id, name, trackCount: 0, editable: true, url: null, imageUrl: null };
  }

  async addTracks(playlistId: string, trackIds: string[]): Promise<void> {
    for (const ids of chunk(trackIds, 100)) {
      await this.call(`/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        method: 'POST',
        body: { data: ids.map(toRef) },
      });
    }
  }

  async removeTracks(playlistId: string, trackIds: string[]): Promise<void> {
    if (this.auth.mode !== 'web') throw new UnsupportedError("Apple Music's API cannot remove tracks from playlists");
    if (!this.libraryIds.has(playlistId)) await this.getPlaylistTracks(playlistId);
    const map = this.libraryIds.get(playlistId)!;
    const libraryIds = trackIds.flatMap((id) => map.get(id) ?? []);
    try {
      for (const ids of chunk(libraryIds, 50)) {
        const q = ids.map((id) => `ids[library-songs]=${encodeURIComponent(id)}`).join('&');
        await this.call(`/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks?${q}&mode=all`, { method: 'DELETE' });
      }
    } catch (err) {
      // If Apple refuses the web player's removal call, fall back to listing it for the user.
      if (err instanceof ProviderHttpError && err.status >= 400 && err.status < 500) {
        throw new UnsupportedError(`Apple Music refused the removal (HTTP ${err.status})`);
      }
      throw err;
    }
    this.libraryIds.delete(playlistId);
  }

  async getLiked(): Promise<RemoteTrack[]> {
    const fav = await this.favoritesPlaylistId();
    if (!fav) throw new Error("Couldn't find your Favorite Songs playlist in Apple Music. Favorite one song in the Music app first.");
    return this.getPlaylistTracks(fav);
  }

  /** Favoriting a song (the old "love") is what puts it in Favorite Songs. */
  async addLiked(trackIds: string[]): Promise<void> {
    const catalog = trackIds.filter((id) => !id.startsWith('l:'));
    for (const ids of chunk(catalog, 50)) {
      try {
        await this.call(`/v1/me/favorites?ids[songs]=${ids.map(encodeURIComponent).join(',')}`, { method: 'POST' });
      } catch (err) {
        if (!(err instanceof ProviderHttpError) || err.status >= 500) throw err;
        // Older route: a "love" rating per song.
        for (const id of ids) {
          await this.call(`/v1/me/ratings/songs/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: { type: 'rating', attributes: { value: 1 } },
          });
        }
      }
    }
  }

  /** Un-favoriting removes the song's rating; the song stays in your library. */
  async removeLiked(trackIds: string[]): Promise<void> {
    try {
      for (const id of trackIds.filter((t) => !t.startsWith('l:'))) {
        await this.call(`/v1/me/ratings/songs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
    } catch (err) {
      if (err instanceof ProviderHttpError && err.status >= 400 && err.status < 500) {
        throw new UnsupportedError(`Apple Music refused to un-favorite (HTTP ${err.status})`);
      }
      throw err;
    }
  }

  async search(query: SearchQuery): Promise<RemoteTrack[]> {
    const term = `${query.title} ${query.artists[0] ?? ''}`.trim();
    const res = await this.call<{ results: { songs?: Page<SongAttributes> } }>(
      `/v1/catalog/${this.sf}/search?types=songs&limit=10&term=${encodeURIComponent(term)}`,
    );
    return (res.results.songs?.data ?? []).flatMap((s) => catalogToRemote(s));
  }

  async lookupIsrc(isrc: string): Promise<RemoteTrack[]> {
    const res = await this.call<Page<SongAttributes>>(
      `/v1/catalog/${this.sf}/songs?filter[isrc]=${encodeURIComponent(isrc)}`,
    );
    return (res?.data ?? []).flatMap((s) => catalogToRemote(s));
  }

  async getTrack(trackId: string): Promise<RemoteTrack | null> {
    const res = await this.call<Page<SongAttributes>>(`/v1/catalog/${this.sf}/songs/${encodeURIComponent(trackId)}`, {
      allow404: true,
    });
    const s = res?.data[0];
    return s ? (catalogToRemote(s)[0] ?? null) : null;
  }

  playlistUrl(): string | null {
    return null;
  }

  /** Library songs carry no ISRC; fetch their catalog versions in batches to get one. */
  private async withIsrc(items: Resource<SongAttributes>[]): Promise<RemoteTrack[]> {
    const tracks = items.flatMap((s) => libraryToRemote(s));
    const catalogIds = [...new Set(tracks.map((t) => t.id).filter((id) => !id.startsWith('l:')))];
    const isrcById = new Map<string, string>();
    for (const ids of chunk(catalogIds, 300)) {
      const res = await this.call<Page<SongAttributes>>(`/v1/catalog/${this.sf}/songs?ids=${ids.join(',')}`, {
        allow404: true,
      });
      for (const s of res?.data ?? []) if (s.attributes?.isrc) isrcById.set(s.id, s.attributes.isrc.toUpperCase());
    }
    return tracks.map((t) => ({ ...t, isrc: isrcById.get(t.id) ?? t.isrc }));
  }
}

function artwork(a?: { url: string }): string | null {
  return a?.url ? a.url.replace('{w}', '200').replace('{h}', '200').replace('{f}', 'jpg') : null;
}

function toRef(id: string) {
  return id.startsWith('l:') ? { id: id.slice(2), type: 'library-songs' } : { id, type: 'songs' };
}

function libraryToRemote(s: Resource<SongAttributes>): RemoteTrack[] {
  const a = s.attributes;
  if (!a) return [];
  const catalogId = a.playParams?.catalogId ?? (a.playParams?.isLibrary === false ? a.playParams.id : undefined);
  const id = catalogId ?? `l:${s.id}`;
  return [
    {
      id,
      title: a.name,
      artists: [a.artistName],
      album: a.albumName ?? null,
      durationMs: a.durationInMillis ?? null,
      isrc: null,
      url: catalogId ? `https://music.apple.com/song/${catalogId}` : null,
      imageUrl: artwork(a.artwork),
    },
  ];
}

function catalogToRemote(s: Resource<SongAttributes>): RemoteTrack[] {
  const a = s.attributes;
  if (!a) return [];
  return [
    {
      id: s.id,
      title: a.name,
      artists: [a.artistName],
      album: a.albumName ?? null,
      durationMs: a.durationInMillis ?? null,
      isrc: a.isrc?.toUpperCase() ?? null,
      url: a.url ?? `https://music.apple.com/song/${s.id}`,
      imageUrl: artwork(a.artwork),
    },
  ];
}

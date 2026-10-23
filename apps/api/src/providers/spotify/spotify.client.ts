import { AuthExpiredError, ProviderHttpError } from '../../common/errors.js';
import { chunk, fetchJson } from '../../common/http.js';
import type {
  AccountIdentity,
  ConnectionContext,
  ProviderClient,
  RemotePlaylistInfo,
  RemoteTrack,
  SearchQuery,
} from '../provider.types.js';

const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';

export const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
];

export interface SpotifyAppConfig {
  clientId: string;
  clientSecret: string;
}

export interface SpotifyCredentials {
  accessToken: string;
  refreshToken: string;
  /** Access token expiry. */
  expiresAt: number;
  /** When the refresh token was issued; Spotify refresh tokens die 6 months later. */
  authorizedAt: number;
  userId: string;
}

interface SpotifyTrackObject {
  id: string | null;
  type?: string;
  name: string;
  is_local?: boolean;
  duration_ms: number;
  artists: { name: string }[];
  album?: { name: string; images?: { url: string; width: number | null }[] };
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
}

interface Paging<T> {
  items: T[];
  next: string | null;
  total: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

export async function exchangeSpotifyCode(
  app: SpotifyAppConfig,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<SpotifyCredentials> {
  const token = await fetchJson<TokenResponse>(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    label: 'Spotify token exchange',
    authStatuses: [],
    headers: { authorization: basic(app), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const me = await fetchJson<{ id: string }>(`${API}/me`, {
    headers: { authorization: `Bearer ${token.access_token}` },
    label: 'Spotify profile',
  });
  const now = Date.now();
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? '',
    expiresAt: now + token.expires_in * 1000,
    authorizedAt: now,
    userId: me.id,
  };
}

export function spotifyAuthorizeUrl(app: SpotifyAppConfig, redirectUri: string, state: string, challenge: string) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: app.clientId,
    scope: SPOTIFY_SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

function basic(app: SpotifyAppConfig) {
  return `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`;
}

export class SpotifyClient implements ProviderClient {
  readonly provider = 'spotify' as const;

  constructor(
    private readonly app: SpotifyAppConfig,
    private readonly ctx: ConnectionContext<SpotifyCredentials>,
  ) {}

  private async token(): Promise<string> {
    const creds = this.ctx.credentials;
    if (creds.expiresAt - 60_000 > Date.now()) return creds.accessToken;
    let res: TokenResponse;
    try {
      res = await fetchJson<TokenResponse>(`${ACCOUNTS}/api/token`, {
        method: 'POST',
        label: 'Spotify token refresh',
        authStatuses: [],
        headers: { authorization: basic(this.app), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken }),
      });
    } catch (err) {
      if (err instanceof ProviderHttpError && err.status === 400) {
        throw new AuthExpiredError('Spotify sign-in expired (refresh tokens last 6 months). Reconnect Spotify.');
      }
      throw err;
    }
    const next: SpotifyCredentials = {
      ...creds,
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? creds.refreshToken,
      expiresAt: Date.now() + res.expires_in * 1000,
    };
    this.ctx.credentials = next;
    this.ctx.save(next, next.authorizedAt + 182 * 24 * 3600 * 1000);
    return next.accessToken;
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown; label?: string } = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    return fetchJson<T>(url, {
      method: init.method ?? 'GET',
      body: init.body,
      label: init.label ?? `Spotify ${init.method ?? 'GET'} ${path.split('?')[0]}`,
      headers: { authorization: `Bearer ${await this.token()}` },
    });
  }

  private async pages<T>(first: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = first;
    while (next) {
      const page: Paging<T> = await this.call<Paging<T>>(next);
      out.push(...page.items);
      next = page.next;
    }
    return out;
  }

  async whoami(): Promise<AccountIdentity> {
    const me = await this.call<{ id: string; display_name: string | null }>('/me');
    return { externalUserId: me.id, displayName: me.display_name || me.id };
  }

  async listPlaylists(): Promise<RemotePlaylistInfo[]> {
    type P = {
      id: string;
      name: string;
      collaborative: boolean;
      owner: { id: string };
      items?: { total: number };
      tracks?: { total: number };
      images?: { url: string }[] | null;
      external_urls?: { spotify?: string };
    };
    const items = await this.pages<P | null>('/me/playlists?limit=50');
    return items
      .filter((p): p is P => !!p)
      .map((p) => ({
        id: p.id,
        name: p.name,
        trackCount: p.items?.total ?? p.tracks?.total ?? null,
        editable: p.owner.id === this.ctx.credentials.userId || p.collaborative,
        url: p.external_urls?.spotify ?? this.playlistUrl(p.id),
        imageUrl: p.images?.[0]?.url ?? null,
      }));
  }

  async getPlaylistTracks(playlistId: string): Promise<RemoteTrack[]> {
    type Item = { item?: SpotifyTrackObject | null; track?: SpotifyTrackObject | null };
    const items = await this.pages<Item>(
      `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`,
    );
    return items.map((i) => i.item ?? i.track).flatMap((t) => (t ? toRemote(t) : []));
  }

  async createPlaylist(name: string, description?: string): Promise<RemotePlaylistInfo> {
    const p = await this.call<{ id: string; name: string; external_urls?: { spotify?: string } }>('/me/playlists', {
      method: 'POST',
      body: { name, public: false, description: description ?? 'Kept in sync by Crossfade' },
    });
    return {
      id: p.id,
      name: p.name,
      trackCount: 0,
      editable: true,
      url: p.external_urls?.spotify ?? this.playlistUrl(p.id),
      imageUrl: null,
    };
  }

  async addTracks(playlistId: string, trackIds: string[]): Promise<void> {
    for (const ids of chunk(trackIds, 100)) {
      await this.call(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: 'POST',
        body: { uris: ids.map((id) => `spotify:track:${id}`) },
      });
    }
  }

  async removeTracks(playlistId: string, trackIds: string[]): Promise<void> {
    for (const ids of chunk(trackIds, 100)) {
      await this.call(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: 'DELETE',
        body: { items: ids.map((id) => ({ uri: `spotify:track:${id}` })) },
      });
    }
  }

  async getLiked(): Promise<RemoteTrack[]> {
    type Item = { track: SpotifyTrackObject | null };
    const items = await this.pages<Item>('/me/tracks?limit=50');
    return items.flatMap((i) => (i.track ? toRemote(i.track) : []));
  }

  async addLiked(trackIds: string[]): Promise<void> {
    for (const ids of chunk(trackIds, 40)) {
      const uris = ids.map((id) => `spotify:track:${id}`).join(',');
      await this.call(`/me/library?uris=${encodeURIComponent(uris)}`, { method: 'PUT' });
    }
  }

  async removeLiked(trackIds: string[]): Promise<void> {
    for (const ids of chunk(trackIds, 40)) {
      const uris = ids.map((id) => `spotify:track:${id}`).join(',');
      await this.call(`/me/library?uris=${encodeURIComponent(uris)}`, { method: 'DELETE' });
    }
  }

  async search(query: SearchQuery): Promise<RemoteTrack[]> {
    const artist = query.artists[0];
    const q = artist ? `track:${stripQuotes(query.title)} artist:${stripQuotes(artist)}` : stripQuotes(query.title);
    const res = await this.searchRaw(q);
    if (res.length > 0) return res;
    // Field filters are strict; fall back to a plain query.
    return this.searchRaw(`${query.title} ${artist ?? ''}`.trim());
  }

  async lookupIsrc(isrc: string): Promise<RemoteTrack[]> {
    return this.searchRaw(`isrc:${isrc}`);
  }

  private async searchRaw(q: string): Promise<RemoteTrack[]> {
    const res = await this.call<{ tracks: Paging<SpotifyTrackObject> }>(
      `/search?type=track&limit=10&q=${encodeURIComponent(q)}`,
    );
    return res.tracks.items.flatMap(toRemote);
  }

  async getTrack(trackId: string): Promise<RemoteTrack | null> {
    try {
      const t = await this.call<SpotifyTrackObject>(`/tracks/${encodeURIComponent(trackId)}`);
      return toRemote(t)[0] ?? null;
    } catch (err) {
      if (err instanceof ProviderHttpError && (err.status === 404 || err.status === 400)) return null;
      throw err;
    }
  }

  playlistUrl(playlistId: string): string {
    return `https://open.spotify.com/playlist/${playlistId}`;
  }
}

function stripQuotes(s: string) {
  return s.replace(/["']/g, '');
}

function toRemote(t: SpotifyTrackObject): RemoteTrack[] {
  if (!t.id || t.is_local || (t.type && t.type !== 'track')) return [];
  return [
    {
      id: t.id,
      title: t.name,
      artists: t.artists.map((a) => a.name),
      album: t.album?.name ?? null,
      durationMs: t.duration_ms ?? null,
      isrc: t.external_ids?.isrc?.toUpperCase() ?? null,
      url: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
      imageUrl: pickImage(t.album?.images),
    },
  ];
}

/** Spotify returns 640/300/64px covers; 300 is plenty for a thumbnail on a 2x screen. */
function pickImage(images?: { url: string; width: number | null }[]): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= 160) ?? sorted[sorted.length - 1])!.url;
}

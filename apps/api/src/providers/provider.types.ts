import type { ProviderCapabilities, ProviderId } from '@crossfade/shared';

/** A track as one provider describes it. `id` is that provider's stable track id. */
export interface RemoteTrack {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  url: string | null;
  /** Cover art, roughly 120–300px square. */
  imageUrl?: string | null;
}

export interface RemotePlaylistInfo {
  id: string;
  name: string;
  trackCount: number | null;
  editable: boolean;
  url: string | null;
  imageUrl: string | null;
}

export interface SearchQuery {
  title: string;
  artists: string[];
  album?: string | null;
  durationMs?: number | null;
}

export interface AccountIdentity {
  externalUserId: string;
  displayName: string;
}

/** Sentinel provider playlist id for liked songs / library. */
export const LIKED_ID = '__liked__';

export interface ProviderClient {
  readonly provider: ProviderId;
  /** Per-connection capabilities when they differ from the provider's defaults (e.g. Apple web sessions). */
  readonly capabilities?: ProviderCapabilities;
  whoami(): Promise<AccountIdentity>;
  listPlaylists(): Promise<RemotePlaylistInfo[]>;
  getPlaylistTracks(playlistId: string): Promise<RemoteTrack[]>;
  createPlaylist(name: string, description?: string): Promise<RemotePlaylistInfo>;
  addTracks(playlistId: string, trackIds: string[]): Promise<void>;
  /** Throws UnsupportedError when the provider cannot remove. */
  removeTracks(playlistId: string, trackIds: string[]): Promise<void>;
  getLiked(): Promise<RemoteTrack[]>;
  addLiked(trackIds: string[]): Promise<void>;
  removeLiked(trackIds: string[]): Promise<void>;
  search(query: SearchQuery): Promise<RemoteTrack[]>;
  /** Exact lookup by ISRC, when the provider supports it. */
  lookupIsrc?(isrc: string): Promise<RemoteTrack[]>;
  /** Fetch a single track by id (used when a user pastes a link). */
  getTrack(trackId: string): Promise<RemoteTrack | null>;
  playlistUrl(playlistId: string): string | null;
}

export interface ConnectionContext<C> {
  connectionId: string;
  credentials: C;
  /** Persist refreshed credentials. */
  save(credentials: C, expiresAt?: number | null): void;
}

/** Common helpers for "list + page through" style APIs. */
export function parseTrackUrl(provider: ProviderId, input: string): string | null {
  const value = input.trim();
  try {
    const url = new URL(value);
    switch (provider) {
      case 'spotify': {
        const m = url.pathname.match(/\/track\/([A-Za-z0-9]{22})/);
        return m?.[1] ?? null;
      }
      case 'ytmusic': {
        const v = url.searchParams.get('v');
        if (v) return v;
        if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
        return null;
      }
      case 'apple': {
        const i = url.searchParams.get('i');
        if (i) return i;
        const m = url.pathname.match(/\/song\/(?:[^/]+\/)?(\d+)/);
        return m?.[1] ?? null;
      }
    }
  } catch {
    // not a URL
  }
  if (provider === 'spotify') {
    const m = value.match(/^spotify:track:([A-Za-z0-9]{22})$/) ?? value.match(/^([A-Za-z0-9]{22})$/);
    return m?.[1] ?? null;
  }
  if (provider === 'ytmusic' && /^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  if (provider === 'apple' && /^\d+$/.test(value)) return value;
  return null;
}

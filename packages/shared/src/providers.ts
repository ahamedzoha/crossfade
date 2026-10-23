export const PROVIDERS = ['spotify', 'ytmusic', 'apple'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface ProviderCapabilities {
  /** Can remove tracks from a playlist through the API. */
  removeTracks: boolean;
  /** Can create playlists through the API. */
  createPlaylist: boolean;
  /** Can read the user's liked songs / library. */
  likedRead: boolean;
  /** Can add to liked songs / library. */
  likedAdd: boolean;
  /** Can remove from liked songs / library. */
  likedRemove: boolean;
  /** Tracks carry ISRC codes, enabling exact matching. */
  isrc: boolean;
}

export type ProviderAuthKind = 'oauth' | 'cookie' | 'musickit';

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  authKind: ProviderAuthKind;
  likedLabel: string;
  capabilities: ProviderCapabilities;
  /** Short, honest notes surfaced in the UI where they matter. */
  limits: string[];
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  spotify: {
    id: 'spotify',
    name: 'Spotify',
    authKind: 'oauth',
    likedLabel: 'Liked Songs',
    capabilities: {
      removeTracks: true,
      createPlaylist: true,
      likedRead: true,
      likedAdd: true,
      likedRemove: true,
      isrc: true,
    },
    limits: [
      'Only playlists you own or collaborate on can be read. Spotify-made playlists (Discover Weekly etc.) are off-limits to developer apps.',
      'A developer-mode Spotify app allows up to 5 allowlisted users, and its owner needs Premium.',
      'Spotify sign-ins expire after 6 months; you will be asked to reconnect.',
    ],
  },
  ytmusic: {
    id: 'ytmusic',
    name: 'YouTube Music',
    authKind: 'cookie',
    likedLabel: 'Liked Music',
    capabilities: {
      removeTracks: true,
      createPlaylist: true,
      likedRead: true,
      likedAdd: true,
      likedRemove: true,
      isrc: false,
    },
    limits: [
      'YouTube Music has no official API. Crossfade uses your browser session cookie, which YouTube can expire without warning.',
      'No ISRC codes, so matches rely on title, artist and duration and land in review more often.',
    ],
  },
  apple: {
    id: 'apple',
    name: 'Apple Music',
    authKind: 'musickit',
    likedLabel: 'Favorite Songs',
    capabilities: {
      removeTracks: false,
      createPlaylist: true,
      likedRead: true,
      likedAdd: true,
      likedRemove: true,
      isrc: true,
    },
    limits: [
      'Connect with a web session from music.apple.com: no developer account needed and removals work, but it is unofficial and can stop working when Apple changes its web player.',
      "Or use a MusicKit key from a paid Apple Developer Program membership. That API is add-only: removals are listed for you to do by hand.",
    ],
  },
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

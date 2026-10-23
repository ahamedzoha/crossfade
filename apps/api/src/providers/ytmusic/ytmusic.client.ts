import { setTimeout as sleep } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import { Innertube, YTNodes } from 'youtubei.js';
import { AuthExpiredError } from '../../common/errors.js';
import { chunk } from '../../common/http.js';
import { sha256 } from '../../common/ids.js';
import type {
  AccountIdentity,
  ConnectionContext,
  ProviderClient,
  RemotePlaylistInfo,
  RemoteTrack,
  SearchQuery,
} from '../provider.types.js';

export interface YtMusicCredentials {
  cookie: string;
  connectedAt: number;
}

const LIKED_PLAYLIST = 'LM';
const logger = new Logger('YouTubeMusic');
const EXPIRED =
  'YouTube stopped accepting this sign-in. Usually your browser refreshed the cookie (copy it from a private window and close that window) or the session was signed out. Paste a fresh cookie to reconnect.';
const CACHE_TTL = 30 * 60_000;
const sessions = new Map<string, { yt: Innertube; at: number }>();

/** Innertube responses are loosely typed node trees; read them defensively. */
type Node = Record<string, any>;

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  const v = value as { toString?: () => string; text?: string };
  if (typeof v.text === 'string') return v.text;
  return typeof v.toString === 'function' ? v.toString() : '';
}

function isAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${(err as Node).info ?? ''}` : String(err);
  return /\b(401|403)\b|login required|sign in|not logged in|LOGIN_REQUIRED|unauthori[sz]ed/i.test(msg);
}

export async function openYtMusicSession(cookie: string): Promise<Innertube> {
  const yt = await Innertube.create({ cookie, retrieve_player: false, lang: 'en', location: 'US' });
  if (!yt.session.logged_in) throw new AuthExpiredError('That cookie is not signed in to YouTube.');
  return yt;
}

export class YtMusicClient implements ProviderClient {
  readonly provider = 'ytmusic' as const;

  constructor(private readonly ctx: ConnectionContext<YtMusicCredentials>) {}

  private async yt(): Promise<Innertube> {
    const key = `${this.ctx.connectionId}:${sha256(this.ctx.credentials.cookie).slice(0, 16)}`;
    const hit = sessions.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.yt;
    const yt = await this.guard(() => openYtMusicSession(this.ctx.credentials.cookie));
    sessions.set(key, { yt, at: Date.now() });
    return yt;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AuthExpiredError) throw err;
      if (isAuthFailure(err)) {
        // Keep YouTube's own reason in the server log; it never contains the cookie.
        logger.warn(`Connection ${this.ctx.connectionId} rejected: ${(err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 300)}`);
        throw new AuthExpiredError(EXPIRED);
      }
      throw err;
    }
  }

  async whoami(): Promise<AccountIdentity> {
    const yt = await this.yt();
    return this.guard(async () => {
      const accounts = (await yt.account.getInfo(true)) as Node[];
      const acc = accounts.find((a) => a.is_selected) ?? accounts[0];
      if (!acc) throw new AuthExpiredError(EXPIRED);
      const name = text(acc.account_name) || 'YouTube Music';
      const handle = text(acc.channel_handle);
      return { externalUserId: handle || name, displayName: handle ? `${name} (${handle})` : name };
    });
  }

  async listPlaylists(): Promise<RemotePlaylistInfo[]> {
    const yt = await this.yt();
    return this.guard(async () => {
      const out = new Map<string, RemotePlaylistInfo>();
      let feed: Node = await yt.getPlaylists();
      for (let page = 0; page < 20; page++) {
        for (const p of (feed.playlists ?? []) as Node[]) {
          const id: string | undefined = p.content_id ?? p.id;
          if (!id || id === LIKED_PLAYLIST || id === 'WL') continue;
          const name = text(p.metadata?.title) || text(p.title) || 'Untitled';
          const count = Number.parseInt(text(p.video_count).replace(/[^\d]/g, ''), 10);
          out.set(id, {
            id,
            name,
            trackCount: Number.isFinite(count) ? count : null,
            editable: true,
            url: this.playlistUrl(id),
            imageUrl: (p.thumbnails?.[0]?.url as string | undefined) ?? null,
          });
        }
        if (!feed.has_continuation) break;
        feed = await feed.getContinuation();
      }
      return [...out.values()];
    });
  }

  async getPlaylistTracks(playlistId: string): Promise<RemoteTrack[]> {
    const yt = await this.yt();
    return this.guard(async () => {
      let page: Node = await yt.music.getPlaylist(playlistId);
      const items: Node[] = [...(page.items ?? [])];
      for (let i = 0; i < 200 && page.has_continuation; i++) {
        page = await page.getContinuation();
        items.push(...(page.items ?? []));
      }
      return items.flatMap(toRemote);
    });
  }

  async createPlaylist(name: string): Promise<RemotePlaylistInfo> {
    const yt = await this.yt();
    return this.guard(async () => {
      const res = await yt.playlist.create(name, []);
      if (!res.playlist_id) throw new Error('YouTube Music did not return the new playlist id');
      return { id: res.playlist_id, name, trackCount: 0, editable: true, url: this.playlistUrl(res.playlist_id), imageUrl: null };
    });
  }

  async addTracks(playlistId: string, trackIds: string[]): Promise<void> {
    const yt = await this.yt();
    await this.guard(async () => {
      for (const ids of chunk(trackIds, 50)) {
        await yt.playlist.addVideos(playlistId, ids);
        await sleep(300);
      }
    });
  }

  async removeTracks(playlistId: string, trackIds: string[]): Promise<void> {
    const yt = await this.yt();
    await this.guard(async () => {
      for (const ids of chunk(trackIds, 50)) {
        await yt.playlist.removeVideos(playlistId, ids);
        await sleep(300);
      }
    });
  }

  async getLiked(): Promise<RemoteTrack[]> {
    return this.getPlaylistTracks(LIKED_PLAYLIST);
  }

  async addLiked(trackIds: string[]): Promise<void> {
    await this.rate(trackIds, 'LIKE');
  }

  async removeLiked(trackIds: string[]): Promise<void> {
    await this.rate(trackIds, 'INDIFFERENT');
  }

  /**
   * youtubei.js's like()/removeRating() go through YouTube's TV client, which rejects cookie
   * sessions with HTTP 400. The same endpoint works through the YouTube Music web client.
   * One unlikeable video (removed, region-locked) doesn't stop the rest.
   */
  private async rate(trackIds: string[], status: 'LIKE' | 'INDIFFERENT') {
    const yt = await this.yt();
    let failed = 0;
    let last: unknown;
    for (const id of trackIds) {
      try {
        await this.guard(() =>
          new YTNodes.NavigationEndpoint({ likeEndpoint: { status, target: { videoId: id } } }).call(yt.actions, { client: 'YTMUSIC' }),
        );
      } catch (err) {
        if (err instanceof AuthExpiredError) throw err;
        failed++;
        last = err;
      }
      await sleep(200);
    }
    if (failed) {
      logger.warn(`${status === 'LIKE' ? 'Like' : 'Unlike'} failed for ${failed} of ${trackIds.length} tracks: ${last instanceof Error ? last.message.slice(0, 200) : String(last)}`);
      if (failed === trackIds.length) throw last instanceof Error ? last : new Error(String(last));
    }
  }

  async search(query: SearchQuery): Promise<RemoteTrack[]> {
    const yt = await this.yt();
    return this.guard(async () => {
      const res: Node = await yt.music.search(`${query.title} ${query.artists[0] ?? ''}`.trim(), { type: 'song' });
      const shelves: Node[] = res.songs ? [res.songs] : (res.contents ?? []);
      return shelves.flatMap((s) => (s.contents ?? []) as Node[]).flatMap(toRemote).slice(0, 10);
    });
  }

  async getTrack(trackId: string): Promise<RemoteTrack | null> {
    const yt = await this.yt();
    try {
      const info: Node = await yt.music.getInfo(trackId);
      const b = info.basic_info ?? {};
      return {
        id: trackId,
        title: b.title ?? trackId,
        artists: b.author ? [String(b.author).replace(/ - Topic$/, '')] : [],
        album: null,
        durationMs: typeof b.duration === 'number' ? b.duration * 1000 : null,
        isrc: null,
        url: `https://music.youtube.com/watch?v=${trackId}`,
      };
    } catch {
      // Metadata is a nicety for pasted links; the id is what matters.
      return { id: trackId, title: trackId, artists: [], album: null, durationMs: null, isrc: null, url: `https://music.youtube.com/watch?v=${trackId}` };
    }
  }

  playlistUrl(playlistId: string): string {
    return `https://music.youtube.com/playlist?list=${playlistId}`;
  }
}

function toRemote(item: Node): RemoteTrack[] {
  const id: string | undefined = item.id;
  const title: string | undefined = item.title;
  if (!id || !title || /^(UC|MPRE|VL|PL|OLAK)/.test(id)) return [];
  if (item.item_type && !['song', 'video', 'non_music_track'].includes(item.item_type)) return [];
  const artists: string[] = ((item.artists ?? item.authors ?? []) as Node[])
    .map((a) => String(a.name ?? '').replace(/ - Topic$/, ''))
    .filter(Boolean);
  return [
    {
      id,
      title,
      artists: artists.length ? artists : item.author?.name ? [String(item.author.name)] : [],
      album: item.album?.name ?? null,
      durationMs: item.duration?.seconds ? item.duration.seconds * 1000 : null,
      isrc: null,
      url: `https://music.youtube.com/watch?v=${id}`,
      imageUrl: thumbnail(item),
    },
  ];
}

/** Smallest thumbnail at least 120px wide; Google image URLs are re-sized to a 240px square. */
function thumbnail(item: Node): string | null {
  const list: { url: string; width: number }[] = (() => {
    try {
      return (item.thumbnails ?? item.thumbnail?.contents ?? []) as { url: string; width: number }[];
    } catch {
      return [];
    }
  })();
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a.width - b.width);
  const pick = sorted.find((t) => t.width >= 120) ?? sorted[sorted.length - 1]!;
  return pick.url.replace(/=w\d+-h\d+/, '=w240-h240');
}

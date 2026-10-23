import { beforeEach, describe, expect, it } from 'vitest';
import { PROVIDER_META, type ProviderId } from '@crossfade/shared';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../config/config.js';
import { UnsupportedError } from '../common/errors.js';
import { openDatabase, type Db } from '../db/db.js';
import { connections, playlistEntries, playlistLinks, playlists, reviewItems, syncRuns, users } from '../db/schema.js';
import { TracksService } from '../library/tracks.service.js';
import { MatchService } from '../matching/match.service.js';
import type { ProviderClient, RemoteTrack, SearchQuery } from '../providers/provider.types.js';
import type { ProvidersService } from '../providers/providers.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { RunLog, SyncEngine } from './sync.engine.js';

// ----------------------------------------------------------------------------- fake services

interface Song {
  key: string;
  title: string;
  artists: string[];
  durationMs: number;
  isrc: string | null;
}

const SONGS: Record<string, Song> = {
  midnight: { key: 'midnight', title: 'Midnight City', artists: ['M83'], durationMs: 243_000, isrc: 'FR6V81141061' },
  nightcall: { key: 'nightcall', title: 'Nightcall', artists: ['Kavinsky'], durationMs: 258_000, isrc: 'FR6V81000025' },
  teardrop: { key: 'teardrop', title: 'Teardrop', artists: ['Massive Attack'], durationMs: 329_000, isrc: 'GBAAA9800109' },
  teardropSingle: { key: 'teardropSingle', title: 'Teardrop', artists: ['Massive Attack'], durationMs: 329_000, isrc: 'GBAAA9800109' },
  crush: { key: 'crush', title: 'Instant Crush', artists: ['Daft Punk', 'Julian Casablancas'], durationMs: 337_000, isrc: 'USQX91300105' },
  dreams: { key: 'dreams', title: 'Dreams', artists: ['Fleetwood Mac'], durationMs: 254_000, isrc: 'USWB10400001' },
  dreams04: { key: 'dreams04', title: 'Dreams - 2004 Remaster', artists: ['Fleetwood Mac'], durationMs: 257_000, isrc: 'USWB10401234' },
  electric: { key: 'electric', title: 'Electric Feel', artists: ['MGMT'], durationMs: 229_000, isrc: 'USSM10704671' },
  tadow: { key: 'tadow', title: 'Tadow', artists: ['Masego', 'FKJ'], durationMs: 301_000, isrc: 'USAT21701234' },
};

/** One in-memory streaming service. Each service has its own id scheme. */
class FakeService implements ProviderClient {
  playlists = new Map<string, string[]>();
  liked: string[] = [];
  calls: string[] = [];

  constructor(
    readonly provider: ProviderId,
    private readonly canRemove = true,
    private readonly hasIsrc = true,
  ) {}

  id(key: string) {
    return `${this.provider}:${key}`;
  }

  private remote(id: string): RemoteTrack {
    const song = SONGS[id.split(':')[1]!]!;
    return {
      id,
      title: song.title,
      artists: song.artists,
      album: null,
      durationMs: song.durationMs,
      isrc: this.hasIsrc ? song.isrc : null,
      url: null,
    };
  }

  seed(playlistId: string, keys: string[]) {
    this.playlists.set(playlistId, keys.map((k) => this.id(k)));
  }

  keys(playlistId: string) {
    return (this.playlists.get(playlistId) ?? []).map((id) => id.split(':')[1]);
  }

  async whoami() {
    return { externalUserId: this.provider, displayName: this.provider };
  }
  async listPlaylists() {
    return [...this.playlists.keys()].map((id) => ({ id, name: id, trackCount: null, editable: true, url: null, imageUrl: null }));
  }
  async getPlaylistTracks(playlistId: string) {
    return (this.playlists.get(playlistId) ?? []).map((id) => this.remote(id));
  }
  async createPlaylist(name: string) {
    this.playlists.set(name, []);
    return { id: name, name, trackCount: 0, editable: true, url: null, imageUrl: null };
  }
  async addTracks(playlistId: string, ids: string[]) {
    this.calls.push(`add:${ids.length}`);
    this.playlists.set(playlistId, [...(this.playlists.get(playlistId) ?? []), ...ids]);
  }
  async removeTracks(playlistId: string, ids: string[]) {
    if (!this.canRemove) throw new UnsupportedError('cannot remove');
    this.calls.push(`remove:${ids.length}`);
    this.playlists.set(playlistId, (this.playlists.get(playlistId) ?? []).filter((id) => !ids.includes(id)));
  }
  async getLiked() {
    return this.liked.map((id) => this.remote(id));
  }
  async addLiked(ids: string[]) {
    this.liked.push(...ids);
  }
  async removeLiked(ids: string[]) {
    this.liked = this.liked.filter((id) => !ids.includes(id));
  }
  async search(q: SearchQuery) {
    return Object.values(SONGS)
      .filter((s) => s.title.toLowerCase().includes(q.title.toLowerCase().split(' - ')[0]!))
      .map((s) => this.remote(this.id(s.key)));
  }
  async getTrack(id: string) {
    return this.remote(id);
  }
  playlistUrl() {
    return null;
  }
}

// ----------------------------------------------------------------------------- harness

let db: Db;
let engine: SyncEngine;
let services: Record<string, FakeService>;
let playlistId: string;
let runN = 0;

function setup(opts: { appleCanRemove?: boolean } = {}) {
  db = openDatabase(':memory:').db;
  const config = { appUrl: 'http://localhost:3000', version: 'test' } as AppConfig;
  const settings = new SettingsService(db, config);
  const tracks = new TracksService(db);
  const matcher = new MatchService(db, tracks, settings);
  services = {
    spotify: new FakeService('spotify'),
    ytmusic: new FakeService('ytmusic', true, false),
    apple: new FakeService('apple', opts.appleCanRemove ?? false),
  };
  const providers = {
    clientFor: (row: { provider: string }) => services[row.provider]!,
    markStatus: () => {},
    touch: () => {},
  } as unknown as ProvidersService;
  engine = new SyncEngine(db, tracks, matcher, providers, settings);

  const now = Date.now();
  db.insert(users).values({ id: 'u1', username: 'zoha', displayName: 'zoha', role: 'admin', createdAt: now }).run();
  playlistId = 'pl1';
  db.insert(playlists).values({ id: playlistId, userId: 'u1', name: 'Late Night Drive', createdAt: now, updatedAt: now }).run();
}

function link(provider: ProviderId, remoteId: string, snapshot: string[] | null = null) {
  const now = Date.now();
  db.insert(connections)
    .values({ id: `c-${provider}`, userId: 'u1', provider, externalUserId: provider, displayName: provider, credentialsEnc: 'x', createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run();
  db.insert(playlistLinks)
    .values({ id: `l-${provider}`, playlistId, connectionId: `c-${provider}`, provider, providerPlaylistId: remoteId, name: remoteId, direction: 'both', snapshot, createdAt: now })
    .run();
}

async function run(opts: { dryRun?: boolean; overrideGuard?: boolean } = {}) {
  const runId = `run${++runN}`;
  db.insert(syncRuns).values({ id: runId, userId: 'u1', playlistId, trigger: 'manual', createdAt: Date.now() }).run();
  const playlist = db.select().from(playlists).where(eq(playlists.id, playlistId)).get()!;
  const log = new RunLog(() => {});
  const outcome = await engine.sync(playlist, runId, { dryRun: !!opts.dryRun, overrideGuard: !!opts.overrideGuard }, log);
  engine.finish(runId, outcome, log);
  return outcome;
}

function canonical() {
  const rows = db.select().from(playlistEntries).where(eq(playlistEntries.playlistId, playlistId)).all();
  return rows.filter((r) => !r.removedAt).length;
}

// ----------------------------------------------------------------------------- scenarios

describe('SyncEngine', () => {
  beforeEach(() => setup());

  it('merges two playlists on first sync and fills every service', async () => {
    services.spotify!.seed('sp1', ['midnight', 'nightcall', 'teardrop']);
    services.ytmusic!.seed('yt1', ['nightcall', 'crush']);
    link('spotify', 'sp1');
    link('ytmusic', 'yt1');

    const out = await run();
    expect(out.status).toBe('success');
    expect(out.stats.added).toBe(4);
    expect(canonical()).toBe(4);
    expect(new Set(services.spotify!.keys('sp1'))).toEqual(new Set(['midnight', 'nightcall', 'teardrop', 'crush']));
    expect(new Set(services.ytmusic!.keys('yt1'))).toEqual(new Set(['midnight', 'nightcall', 'teardrop', 'crush']));
  });

  it('propagates an add made on one service to the others', async () => {
    services.spotify!.seed('sp1', ['midnight']);
    services.apple!.seed('am1', ['midnight']);
    link('spotify', 'sp1');
    link('apple', 'am1');
    await run();

    services.apple!.playlists.get('am1')!.push('apple:tadow');
    const out = await run();
    expect(out.stats.added).toBe(1);
    expect(services.spotify!.keys('sp1')).toContain('tadow');
  });

  it('propagates a removal, and flags it for services that cannot remove', async () => {
    services.spotify!.seed('sp1', ['midnight', 'electric', 'nightcall', 'teardrop']);
    services.apple!.seed('am1', ['midnight', 'electric', 'nightcall', 'teardrop']);
    services.ytmusic!.seed('yt1', ['midnight', 'electric', 'nightcall', 'teardrop']);
    link('spotify', 'sp1');
    link('apple', 'am1');
    link('ytmusic', 'yt1');
    await run();

    services.spotify!.playlists.set('sp1', services.spotify!.playlists.get('sp1')!.filter((id) => !id.endsWith('electric')));
    const out = await run();
    expect(out.stats.removed).toBe(1);
    expect(canonical()).toBe(3);
    expect(services.ytmusic!.keys('yt1')).not.toContain('electric');
    expect(services.apple!.keys('am1')).toContain('electric');
    const manual = db.select().from(reviewItems).all().filter((r) => r.reason === 'manual_remove');
    expect(manual).toHaveLength(1);
    expect(manual[0]!.provider).toBe('apple');

    // Removing it by hand on Apple closes the review item; nothing comes back.
    services.apple!.playlists.set('am1', services.apple!.playlists.get('am1')!.filter((id) => !id.endsWith('electric')));
    await run();
    expect(canonical()).toBe(3);
    expect(db.select().from(reviewItems).all().find((r) => r.reason === 'manual_remove')!.status).toBe('resolved');
  });

  it('collapses a remaster duplicate and removes it from services', async () => {
    services.spotify!.seed('sp1', ['dreams', 'midnight', 'dreams04']);
    link('spotify', 'sp1');
    const out = await run();
    expect(out.stats.deduped).toBe(1);
    expect(canonical()).toBe(2);
    expect(services.spotify!.keys('sp1')).toEqual(['dreams', 'midnight']);
  });

  it('stops a mass deletion with the guard and changes nothing', async () => {
    const all = ['midnight', 'nightcall', 'teardrop', 'crush', 'dreams', 'electric', 'tadow'];
    services.spotify!.seed('sp1', all);
    services.ytmusic!.seed('yt1', all);
    link('spotify', 'sp1');
    link('ytmusic', 'yt1');
    await run();

    services.spotify!.seed('sp1', ['midnight', 'nightcall']);
    const out = await run();
    expect(out.status).toBe('guarded');
    expect(canonical()).toBe(7);
    expect(services.ytmusic!.keys('yt1')).toHaveLength(7);

    const forced = await run({ overrideGuard: true });
    expect(forced.status).toBe('success');
    expect(canonical()).toBe(2);
  });

  it('lets an add win over a removal of the same track in the same cycle', async () => {
    services.spotify!.seed('sp1', ['midnight', 'teardrop']);
    services.ytmusic!.seed('yt1', ['midnight', 'teardrop']);
    link('spotify', 'sp1');
    link('ytmusic', 'yt1');
    await run();

    // YouTube Music drops Teardrop while Spotify swaps in the single release of the same recording.
    services.ytmusic!.playlists.set('yt1', ['ytmusic:midnight']);
    services.spotify!.playlists.set('sp1', ['spotify:midnight', 'spotify:teardropSingle']);
    const out = await run();
    expect(out.stats.removed).toBe(0);
    expect(canonical()).toBe(2);
    expect(services.ytmusic!.keys('yt1')).toContain('teardrop');
  });

  it('dry run reports changes without writing anything', async () => {
    services.spotify!.seed('sp1', ['midnight', 'nightcall']);
    services.ytmusic!.seed('yt1', ['teardrop']);
    link('spotify', 'sp1');
    link('ytmusic', 'yt1');
    const out = await run({ dryRun: true });
    expect(out.stats.added).toBe(3);
    expect(canonical()).toBe(0);
    expect(services.spotify!.keys('sp1')).toEqual(['midnight', 'nightcall']);
    expect(services.spotify!.calls).toEqual([]);
  });

  it('removes in-service duplicates of the same track', async () => {
    services.ytmusic!.seed('yt1', ['midnight', 'nightcall', 'midnight']);
    link('ytmusic', 'yt1');
    await run();
    expect(services.ytmusic!.keys('yt1').filter((k) => k === 'midnight')).toHaveLength(1);
  });

  it('lists a refused removal for the user when a service that can remove refuses', async () => {
    // An Apple web session advertises removals, but Apple can still refuse them for a playlist.
    Object.defineProperty(services.apple!, 'capabilities', { value: { ...PROVIDER_META.apple.capabilities, removeTracks: true } });
    services.spotify!.seed('sp1', ['midnight', 'electric', 'nightcall', 'teardrop']);
    services.apple!.seed('am1', ['midnight', 'electric', 'nightcall', 'teardrop']);
    link('spotify', 'sp1');
    link('apple', 'am1');
    await run();

    services.spotify!.playlists.set('sp1', services.spotify!.playlists.get('sp1')!.filter((id) => !id.endsWith('electric')));
    const out = await run();
    expect(out.status).toBe('success');
    expect(out.stats.push.apple?.manual).toBe(1);
    expect(db.select().from(reviewItems).all().filter((r) => r.reason === 'manual_remove')).toHaveLength(1);
  });

  it('never unlikes because of duplicates, only because of a real unlike', async () => {
    db.update(playlists).set({ kind: 'liked' }).where(eq(playlists.id, playlistId)).run();
    services.ytmusic!.liked = ['ytmusic:dreams', 'ytmusic:dreams04', 'ytmusic:midnight'];
    services.spotify!.liked = ['spotify:midnight', 'spotify:teardrop'];
    link('ytmusic', '__liked__');
    link('spotify', '__liked__');
    await run();
    // The remaster duplicate is collapsed in the canonical list but stays liked on YouTube.
    expect(services.ytmusic!.liked).toContain('ytmusic:dreams04');
    expect(services.spotify!.liked).toContain('spotify:teardrop');

    // A real unlike on Spotify propagates.
    services.spotify!.liked = services.spotify!.liked.filter((id) => id !== 'spotify:midnight');
    await run();
    expect(services.ytmusic!.liked).not.toContain('ytmusic:midnight');
    expect(services.ytmusic!.liked).toContain('ytmusic:dreams04');
  });

  it('knows Apple Music is add-only', () => {
    expect(PROVIDER_META.apple.capabilities.removeTracks).toBe(false);
  });
});

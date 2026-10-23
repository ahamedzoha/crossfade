/**
 * Demo data for trying the UI without real accounts.
 *
 *   DATA_DIR=./demo-data WORKER_DISABLED=1 node dist/demo/seed.js
 *
 * Everything here is synthetic: the connections hold fake credentials, so run the
 * API with WORKER_DISABLED=1 against this data directory or every sync will fail.
 */
import { generateKeyPairSync } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { loadConfig } from '../config/config.js';
import { CryptoService } from '../common/crypto.service.js';
import { newId } from '../common/ids.js';
import { openDatabase } from '../db/db.js';
import {
  connections,
  playlistEntries,
  playlistLinks,
  playlists,
  providerTracks,
  reviewItems,
  runChanges,
  syncRuns,
  tracks,
  users,
} from '../db/schema.js';
import { artistKey, parseTitle } from '../matching/normalize.js';

const config = loadConfig();
const { db } = openDatabase(config.dbPath);
const crypto = new CryptoService(config);

if (db.select().from(users).all().length) {
  console.error(`${config.dbPath} already has users; seed an empty DATA_DIR.`);
  process.exit(1);
}

const now = Date.now();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Song = [title: string, artists: string, seconds: number];
const LATE_NIGHT: Song[] = [
  ['Midnight City', 'M83', 243], ['Nightcall', 'Kavinsky', 258], ['Teardrop', 'Massive Attack', 329],
  ['Instant Crush', 'Daft Punk, Julian Casablancas', 337], ['Pink + White', 'Frank Ocean', 184],
  ['Dreams - 2004 Remaster', 'Fleetwood Mac', 257], ['Dreams', 'Fleetwood Mac', 254], ['Electric Feel', 'MGMT', 229],
  ['Redbone', 'Childish Gambino', 326], ['Tadow', 'Masego, FKJ', 301], ['Genesis', 'Grimes', 255],
  ['A Real Hero', 'College, Electric Youth', 268], ['Resonance', 'HOME', 212], ['After Dark', 'Mr.Kitty', 257],
  ['Breathe', 'Télépopmusik', 279], ['Angel', 'Massive Attack', 379], ['Sweet Disposition', 'The Temper Trap', 231],
  ['Strangers', 'Bring Me The Horizon', 244], ['Ivy', 'Frank Ocean', 249], ['Motion Sickness', 'Phoebe Bridgers', 230],
  ['Night Owl', 'Galimatias', 222], ['Do I Wanna Know?', 'Arctic Monkeys', 272], ['Feels Like We Only Go Backwards', 'Tame Impala', 193],
  ['The Less I Know The Better', 'Tame Impala', 216], ['Get Lucky', 'Daft Punk, Pharrell Williams', 369],
  ['Roads', 'Portishead', 305], ['Lost in Yesterday', 'Tame Impala', 250], ['Heartbeats', 'José González', 160],
  ['Kids', 'MGMT', 302], ['Video Games', 'Lana Del Rey', 282], ['Nights', 'Frank Ocean', 307],
  ['Cola', 'Lana Del Rey', 260], ['Blinding Lights', 'The Weeknd', 200], ['Wicked Game', 'Chris Isaak', 289],
  ['Space Song', 'Beach House', 320], ['Myth', 'Beach House', 258], ['Retrograde', 'James Blake', 223],
  ['Holocene', 'Bon Iver', 337], ['Intro', 'The xx', 128], ['Crystalised', 'The xx', 201],
];
const GYM: Song[] = [
  ['Till I Collapse', 'Eminem, Nate Dogg', 297], ['Power', 'Kanye West', 292], ['Lose Yourself', 'Eminem', 326],
  ['Stronger', 'Kanye West', 312], ['HUMBLE.', 'Kendrick Lamar', 177], ['Can’t Hold Us', 'Macklemore & Ryan Lewis, Ray Dalton', 258],
  ['Remember the Name', 'Fort Minor', 230], ['X Gon’ Give It to Ya', 'DMX', 217], ['Sicko Mode', 'Travis Scott', 312],
  ['Bodies', 'Drowning Pool', 202], ['Killing in the Name', 'Rage Against the Machine', 314], ['Duality', 'Slipknot', 252],
];
const COFFEE: Song[] = [
  ['Banana Pancakes', 'Jack Johnson', 191], ['Bloom', 'The Paper Kites', 214], ['Holocene', 'Bon Iver', 337],
  ['Heartbeats', 'José González', 160], ['Sunday Morning', 'Maroon 5', 245], ['Put Your Records On', 'Corinne Bailey Rae', 215],
  ['Better Together', 'Jack Johnson', 207], ['Riptide', 'Vance Joy', 204], ['Ho Hey', 'The Lumineers', 163],
];

const trackIds = new Map<string, string>();
let pidN = 0;
function track([title, artists, seconds]: Song): string {
  const key = `${title}|${artists}`;
  const hit = trackIds.get(key);
  if (hit) return hit;
  const id = newId('tr');
  const list = artists.split(', ');
  const { key: titleKey, versionTag } = parseTitle(title, list);
  db.insert(tracks)
    .values({ id, title, artists: list, album: null, durationMs: seconds * 1000, isrc: null, titleKey, artistKey: artistKey(list), versionTag, createdAt: now - 40 * DAY })
    .run();
  for (const provider of ['spotify', 'ytmusic', 'apple']) {
    const pid = `${provider}-demo-${++pidN}`;
    db.insert(providerTracks)
      .values({ provider, providerTrackId: pid, trackId: id, title, artists: list, album: null, durationMs: seconds * 1000, isrc: null, url: null, method: provider === 'spotify' ? 'source' : 'isrc', confidence: 1, updatedAt: now })
      .run();
  }
  trackIds.set(key, id);
  return id;
}

const pids = (provider: string, ids: string[]) =>
  db
    .select()
    .from(providerTracks)
    .all()
    .filter((p) => p.provider === provider && ids.includes(p.trackId))
    .map((p) => p.providerTrackId);

async function main() {
  const userId = newId('usr');
  db.insert(users).values({ id: userId, username: 'demo', displayName: 'zoha', passwordHash: await hash('crossfade-demo'), role: 'admin', createdAt: now - 60 * DAY }).run();

  // Placeholder service apps so the demo reads as a configured server. Not real credentials.
  const { providerConfigs } = await import('../db/schema.js');
  const demoKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  db.insert(providerConfigs).values({ provider: 'spotify', configEnc: crypto.encryptJson({ clientId: 'demo-client-id', clientSecret: 'demo-client-secret' }), updatedAt: now }).run();
  db.insert(providerConfigs).values({ provider: 'apple', configEnc: crypto.encryptJson({ teamId: 'DEMOTEAM01', keyId: 'DEMOKEY001', privateKey: demoKey }), updatedAt: now }).run();

  const conn = (provider: string, displayName: string, extra: Partial<typeof connections.$inferInsert> = {}) => {
    const id = newId('cn');
    db.insert(connections)
      .values({ id, userId, provider, externalUserId: `${provider}-demo`, displayName, credentialsEnc: crypto.encryptJson({ demo: true }), status: 'active', createdAt: now - 30 * DAY, updatedAt: now, lastUsedAt: now - 30 * MIN, expiresAt: now + 150 * DAY, ...extra })
      .run();
    return id;
  };
  const sp = conn('spotify', 'zoha');
  const yt = conn('ytmusic', 'Zoha (@zoha)', { status: 'expiring', statusMessage: 'Sign-in expires in 12 days. Reconnect to keep syncing.', expiresAt: now + 12 * DAY });
  const am = conn('apple', 'Apple Music · US');

  const makePlaylist = (name: string, songs: Song[], kind: 'playlist' | 'liked', schedule: number | null, lastRunAt: number) => {
    const id = newId('pl');
    db.insert(playlists).values({ id, userId, name, kind, scheduleMinutes: schedule, createdAt: now - 30 * DAY, updatedAt: now, lastRunAt }).run();
    const ids = songs.map(track);
    ids.forEach((t, i) =>
      db.insert(playlistEntries).values({ id: newId('en'), playlistId: id, trackId: t, position: i + 1, addedAt: now - 30 * DAY, addedFrom: 'spotify' }).run(),
    );
    for (const [connectionId, provider, remote] of [
      [sp, 'spotify', name],
      [yt, 'ytmusic', name],
      [am, 'apple', name],
    ] as const) {
      db.insert(playlistLinks)
        .values({ id: newId('ln'), playlistId: id, connectionId, provider, providerPlaylistId: kind === 'liked' ? '__liked__' : `${provider}-${id}`, name: kind === 'liked' ? { spotify: 'Liked Songs', ytmusic: 'Liked Music', apple: 'Library' }[provider] : remote, direction: 'both', snapshot: pids(provider, ids), trackCount: ids.length, lastSyncedAt: lastRunAt, createdAt: now - 30 * DAY })
        .run();
    }
    return { id, ids };
  };

  const run = (playlistId: string, name: string, at: number, seconds: number, status: 'success' | 'guarded' | 'partial', stats: Record<string, unknown>, log: string[], error: string | null = null) => {
    const id = newId('run');
    db.insert(syncRuns)
      .values({ id, userId, playlistId, playlistName: name, trigger: 'schedule', status, createdAt: at - seconds * 1000, startedAt: at - seconds * 1000, finishedAt: at, stats, error, log: log.map((msg, i) => ({ t: at - seconds * 1000 + i * 900, level: msg.startsWith('!') ? 'warn' : 'info', msg: msg.replace(/^!/, '') })) })
      .run();
    return id;
  };

  // Late Night Drive: the run shown on the overview.
  const late = makePlaylist('Late Night Drive', LATE_NIGHT, 'playlist', 30, now - 4 * MIN);
  const T = (title: string) => trackIds.get(`${title}|${LATE_NIGHT.find((s) => s[0] === title)![1]}`)!;
  const dup = db.select().from(playlistEntries).all().find((e) => e.playlistId === late.id && e.trackId === T('Dreams - 2004 Remaster'))!;
  const kept = db.select().from(playlistEntries).all().find((e) => e.playlistId === late.id && e.trackId === T('Dreams'))!;
  const gone = db.select().from(playlistEntries).all().find((e) => e.playlistId === late.id && e.trackId === T('Electric Feel'))!;
  const at = now - 4 * MIN;
  const { eq } = await import('drizzle-orm');
  db.update(playlistEntries).set({ removedAt: at, removedReason: 'duplicate', duplicateOfEntryId: kept.id }).where(eq(playlistEntries.id, dup.id)).run();
  db.update(playlistEntries).set({ removedAt: at, removedReason: 'removed:spotify' }).where(eq(playlistEntries.id, gone.id)).run();
  for (const t of ['Instant Crush', 'Pink + White']) {
    db.update(playlistEntries).set({ addedAt: at, addedFrom: t === 'Instant Crush' ? 'ytmusic' : 'spotify' }).where(eq(playlistEntries.trackId, T(t))).run();
  }
  // Redbone has only a shaky YouTube Music match.
  db.update(providerTracks).set({ method: 'search', confidence: 0.71 }).where(eq(providerTracks.trackId, T('Redbone'))).run();
  const ytRedbone = db.select().from(providerTracks).all().find((p) => p.trackId === T('Redbone') && p.provider === 'ytmusic')!;
  const lateLinks = db.select().from(playlistLinks).all().filter((l) => l.playlistId === late.id);
  for (const l of lateLinks) {
    const keep = l.provider === 'apple' ? (l.snapshot ?? []) : (l.snapshot ?? []).filter((p) => !pids(l.provider, [T('Electric Feel'), T('Dreams - 2004 Remaster')]).includes(p));
    db.update(playlistLinks).set({ snapshot: keep, trackCount: keep.length }).where(eq(playlistLinks.id, l.id)).run();
  }

  const lateRun = run(late.id, 'Late Night Drive', at, 38, 'success', {
    added: 2, removed: 1, deduped: 1, review: 1, unchanged: 37, trackCount: 38,
    push: { spotify: { added: 1, removed: 1, failed: 0, manual: 0 }, ytmusic: { added: 1, removed: 2, failed: 0, manual: 0 }, apple: { added: 2, removed: 0, failed: 0, manual: 1 } },
    guard: { removals: 1, total: 39, percent: 3, limit: 30 },
  }, ['Syncing Late Night Drive', 'Read 39 tracks from Spotify · Late Night Drive', 'Read 40 tracks from YouTube Music · Late Night Drive', 'Read 40 tracks from Apple Music · Late Night Drive', 'Spotify · Late Night Drive: +1 −1', 'YouTube Music · Late Night Drive: +1 −2', 'Apple Music · Late Night Drive: +2 −0', 'Done: +2 −1, 1 duplicate collapsed, 1 to review, 38 tracks']);
  const ch = (action: string, title: string, detail: string | null, provider: string | null, position: number | null) =>
    db.insert(runChanges).values({ id: newId('ch'), runId: lateRun, action, provider, trackId: T(title), detail, position, createdAt: at }).run();
  ch('added', 'Instant Crush', 'added on YouTube Music', 'ytmusic', 4);
  ch('pushed_add', 'Instant Crush', null, 'spotify', 4);
  ch('pushed_add', 'Instant Crush', null, 'apple', 4);
  ch('added', 'Pink + White', 'added on Spotify', 'spotify', 5);
  ch('pushed_add', 'Pink + White', null, 'ytmusic', 5);
  ch('pushed_add', 'Pink + White', null, 'apple', 5);
  ch('deduped', 'Dreams - 2004 Remaster', 'duplicate of Dreams; kept the earlier one', null, 6);
  ch('removed', 'Electric Feel', 'removed on Spotify', 'spotify', 8);
  ch('manual_remove', 'Electric Feel', "Apple Music can't remove via API: remove by hand", 'apple', 8);
  ch('review', 'Redbone', 'matched on YouTube Music at 71%, please check', 'ytmusic', 9);

  const review = (trackId: string, provider: string, reason: 'no_match' | 'low_confidence' | 'manual_remove', candidates: unknown[], ago: number) =>
    db.insert(reviewItems).values({ id: newId('rv'), userId, playlistId: late.id, trackId, provider, reason, status: 'pending', candidates, createdAt: now - ago }).run();
  review(T('Redbone'), 'ytmusic', 'low_confidence', [
    { providerTrackId: ytRedbone.providerTrackId, title: 'Redbone (Official Audio)', artists: ['Childish Gambino'], album: null, durationMs: 327_000, url: null, score: 0.71 },
    { providerTrackId: 'yt-cand-2', title: 'Redbone', artists: ['Childish Gambino'], album: 'Awaken, My Love!', durationMs: 326_000, url: null, score: 0.69 },
    { providerTrackId: 'yt-cand-3', title: 'Redbone (Live from Coachella)', artists: ['Childish Gambino'], album: null, durationMs: 361_000, url: null, score: 0.41 },
  ], 4 * MIN);
  review(T('Electric Feel'), 'apple', 'manual_remove', [], 4 * MIN);
  review(T('Breathe'), 'ytmusic', 'no_match', [
    { providerTrackId: 'yt-cand-4', title: 'Breathe', artists: ['The Prodigy'], album: 'The Fat of the Land', durationMs: 335_000, url: null, score: 0.52 },
    { providerTrackId: 'yt-cand-5', title: 'Breathe (In the Air)', artists: ['Pink Floyd'], album: null, durationMs: 169_000, url: null, score: 0.33 },
  ], 2 * DAY);
  db.update(providerTracks).set({ method: 'search', confidence: 0.66 }).where(eq(providerTracks.trackId, T('After Dark'))).run();
  const amAfterDark = db.select().from(providerTracks).all().find((p) => p.trackId === T('After Dark') && p.provider === 'apple')!;
  review(T('After Dark'), 'apple', 'low_confidence', [
    { providerTrackId: amAfterDark.providerTrackId, title: 'After Dark (Slowed)', artists: ['Mr.Kitty'], album: null, durationMs: 301_000, url: null, score: 0.66 },
    { providerTrackId: 'am-cand-2', title: 'After Dark', artists: ['Mr.Kitty'], album: 'Time', durationMs: 257_000, url: null, score: 0.64 },
  ], 3 * DAY);

  const gym = makePlaylist('Gym — Heavy', GYM, 'playlist', 30, now - 34 * MIN);
  run(gym.id, 'Gym — Heavy', now - 34 * MIN, 12, 'success', { added: 0, removed: 0, deduped: 0, review: 0, unchanged: 12, trackCount: 12, push: {} }, ['Syncing Gym — Heavy', 'Done: +0 −0, 0 duplicates collapsed, 0 to review, 12 tracks']);
  const coffee = makePlaylist('Sunday Coffee', COFFEE, 'playlist', 30, now - 64 * MIN);
  run(coffee.id, 'Sunday Coffee', now - 64 * MIN, 9, 'success', { added: 1, removed: 0, deduped: 0, review: 0, unchanged: 8, trackCount: 9, push: {} }, ['Syncing Sunday Coffee', 'Done: +1 −0, 0 duplicates collapsed, 0 to review, 9 tracks']);
  const liked = makePlaylist('Liked Songs', [...new Map([...LATE_NIGHT.slice(0, 30), ...GYM, ...COFFEE].map((s) => [`${s[0]}|${s[1]}`, s] as const)).values()], 'liked', 60, now - 94 * MIN);
  run(liked.id, 'Liked Songs', now - 94 * MIN, 5, 'guarded', { added: 0, removed: 0, deduped: 0, review: 0, unchanged: 0, trackCount: 51, push: {}, guard: { removals: 21, total: 51, percent: 41, limit: 30 } }, ['Syncing Liked Songs', 'Read 30 tracks from Spotify · Liked Songs', '!Guard stopped this run: would remove 21 of 51 tracks (41%), over the 30% limit.'], 'Guard: would remove 21 of 51 tracks (41%), over the 30% limit');
  for (const i of [1, 2, 3]) run(late.id, 'Late Night Drive', now - (4 + i * 30) * MIN, 30 + i * 3, 'success', { added: 0, removed: 0, deduped: 0, review: 0, unchanged: 39, trackCount: 39, push: {} }, ['Syncing Late Night Drive', 'Done: no changes']);

  console.log(`Demo data written to ${config.dbPath}\nSign in as demo / crossfade-demo (run the API with WORKER_DISABLED=1).`);
}

await main();

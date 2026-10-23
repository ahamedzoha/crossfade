import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreatePlaylistInput,
  type EntryAvailability,
  type LinkTargetInput,
  type PlaylistDetail,
  type PlaylistEntry,
  type PlaylistLink,
  type PlaylistSummary,
  PROVIDER_META,
  type ProviderId,
  type UpdatePlaylistInput,
} from '@crossfade/shared';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { AuthExpiredError, errorMessage } from '../common/errors.js';
import { newId } from '../common/ids.js';
import { DB, type Db } from '../db/db.js';
import { connections, playlistEntries, playlistLinks, playlists, reviewItems, tracks } from '../db/schema.js';
import { LIKED_ID } from '../providers/provider.types.js';
import { ProvidersService } from '../providers/providers.service.js';
import { RunsService } from '../runs/runs.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SyncService } from '../sync/sync.service.js';
import { TracksService } from './tracks.service.js';

type PlaylistRow = typeof playlists.$inferSelect;
type LinkRow = typeof playlistLinks.$inferSelect;
type EntryRow = typeof playlistEntries.$inferSelect;

@Injectable()
export class PlaylistsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tracks: TracksService,
    private readonly providers: ProvidersService,
    private readonly runs: RunsService,
    private readonly settings: SettingsService,
    private readonly sync: SyncService,
  ) {}

  get(userId: string, id: string): PlaylistRow {
    const row = this.db.select().from(playlists).where(and(eq(playlists.id, id), eq(playlists.userId, userId))).get();
    if (!row) throw new NotFoundException('Playlist not found');
    return row;
  }

  list(userId: string): PlaylistSummary[] {
    const rows = this.db.select().from(playlists).where(eq(playlists.userId, userId)).orderBy(playlists.createdAt).all();
    return this.summaries(rows);
  }

  summaries(rows: PlaylistRow[]): PlaylistSummary[] {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const links = this.db.select().from(playlistLinks).where(inArray(playlistLinks.playlistId, ids)).all();
    const counts = new Map(
      this.db
        .select({
          id: playlistEntries.playlistId,
          n: sql<number>`count(*)`,
          dur: sql<number>`coalesce(sum(${tracks.durationMs}), 0)`,
        })
        .from(playlistEntries)
        .innerJoin(tracks, eq(playlistEntries.trackId, tracks.id))
        .where(and(inArray(playlistEntries.playlistId, ids), isNull(playlistEntries.removedAt)))
        .groupBy(playlistEntries.playlistId)
        .all()
        .map((r) => [r.id, r]),
    );
    const reviews = new Map(
      this.db
        .select({ id: reviewItems.playlistId, n: sql<number>`count(*)` })
        .from(reviewItems)
        .where(and(inArray(reviewItems.playlistId, ids), eq(reviewItems.status, 'pending')))
        .groupBy(reviewItems.playlistId)
        .all()
        .map((r) => [r.id, r.n]),
    );
    const latest = this.runs.latestFor(ids);
    const instance = this.settings.get();
    return rows.map((p) => {
      const pl = links.filter((l) => l.playlistId === p.id);
      const effective = p.scheduleMinutes ?? instance.defaultScheduleMinutes;
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        kind: p.kind,
        syncEnabled: p.syncEnabled,
        scheduleMinutes: p.scheduleMinutes,
        effectiveScheduleMinutes: effective,
        dedupeMode: p.dedupeMode ?? instance.dedupeMode,
        guardPercent: p.guardPercent ?? instance.guardPercent,
        trackCount: counts.get(p.id)?.n ?? 0,
        totalDurationMs: counts.get(p.id)?.dur ?? 0,
        links: pl.map(linkDto),
        reviewCount: reviews.get(p.id) ?? 0,
        lastRun: latest.get(p.id) ?? null,
        nextRunAt: p.syncEnabled && pl.length ? (p.lastRunAt ?? Date.now()) + effective * 60_000 : null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });
  }

  detail(userId: string, id: string): PlaylistDetail {
    const p = this.get(userId, id);
    const summary = this.summaries([p])[0]!;
    const entries = this.db.select().from(playlistEntries).where(eq(playlistEntries.playlistId, id)).all();
    const active = entries.filter((e) => !e.removedAt).sort((a, b) => a.position - b.position);
    const removed = entries
      .filter((e) => e.removedAt)
      .sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0))
      .slice(0, 300);

    const links = this.db.select().from(playlistLinks).where(eq(playlistLinks.playlistId, id)).all();
    const held = new Map<string, Set<string>>(); // linkId → canonical ids held
    for (const l of links) {
      const map = this.tracks.lookupMany(l.provider as ProviderId, l.snapshot ?? []);
      held.set(l.id, new Set(map.values()));
    }
    const pending = this.db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.playlistId, id), eq(reviewItems.status, 'pending')))
      .all();
    const reviewKey = new Map(pending.map((r) => [`${r.trackId}:${r.provider}`, r.reason]));

    const trackRows = this.tracks.getMany([...active, ...removed].map((e) => e.trackId));
    const dtos = new Map(this.tracks.toDtos([...trackRows.values()]).map((t) => [t.id, t]));

    const toEntry = (e: EntryRow, isActive: boolean): PlaylistEntry | null => {
      const track = dtos.get(e.trackId);
      if (!track) return null;
      const availability: Partial<Record<ProviderId, EntryAvailability>> = {};
      for (const l of links) {
        const provider = l.provider as ProviderId;
        const has = held.get(l.id)?.has(e.trackId) ?? false;
        const review = reviewKey.get(`${e.trackId}:${provider}`);
        let state: EntryAvailability;
        // A shaky match is on the service but still flagged, so review wins over present.
        if (isActive) state = review && review !== 'manual_remove' ? 'review' : has ? 'present' : 'missing';
        else state = has ? 'pending_remove' : 'missing';
        // Several links on one service: "present" anywhere wins.
        if (availability[provider] !== 'present' || state === 'review') availability[provider] = state;
      }
      return {
        id: e.id,
        position: e.position,
        track,
        addedAt: e.addedAt,
        addedFrom: e.addedFrom,
        removedAt: e.removedAt,
        removedReason: e.removedReason,
        duplicateOfEntryId: e.duplicateOfEntryId,
        availability,
      };
    };

    return {
      ...summary,
      entries: active.map((e) => toEntry(e, true)).filter((e): e is PlaylistEntry => !!e),
      removed: removed.map((e) => toEntry(e, false)).filter((e): e is PlaylistEntry => !!e),
    };
  }

  async create(userId: string, input: CreatePlaylistInput): Promise<PlaylistSummary> {
    if (input.kind === 'liked') {
      const existing = this.db
        .select({ id: playlists.id })
        .from(playlists)
        .where(and(eq(playlists.userId, userId), eq(playlists.kind, 'liked')))
        .get();
      if (existing) throw new ConflictException('You already sync your liked songs');
    }
    const now = Date.now();
    const id = newId('pl');
    this.db
      .insert(playlists)
      .values({
        id,
        userId,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        syncEnabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    try {
      for (const link of input.links) await this.attach(userId, id, link);
    } catch (err) {
      this.db.delete(playlists).where(eq(playlists.id, id)).run();
      throw err;
    }
    if (input.syncNow && input.links.length) this.sync.request(userId, id, 'link', { dryRun: input.preview });
    return this.summaries([this.get(userId, id)])[0]!;
  }

  async addLink(userId: string, playlistId: string, input: LinkTargetInput): Promise<PlaylistSummary> {
    this.get(userId, playlistId);
    await this.attach(userId, playlistId, input);
    this.sync.request(userId, playlistId, 'link');
    return this.summaries([this.get(userId, playlistId)])[0]!;
  }

  updateLink(userId: string, playlistId: string, linkId: string, direction: 'both' | 'pull' | 'push') {
    this.get(userId, playlistId);
    const res = this.db
      .update(playlistLinks)
      .set({ direction })
      .where(and(eq(playlistLinks.id, linkId), eq(playlistLinks.playlistId, playlistId)))
      .run();
    if (!res.changes) throw new NotFoundException('Link not found');
    return this.summaries([this.get(userId, playlistId)])[0]!;
  }

  removeLink(userId: string, playlistId: string, linkId: string) {
    this.get(userId, playlistId);
    this.db
      .delete(playlistLinks)
      .where(and(eq(playlistLinks.id, linkId), eq(playlistLinks.playlistId, playlistId)))
      .run();
  }

  update(userId: string, id: string, input: UpdatePlaylistInput): PlaylistSummary {
    this.get(userId, id);
    this.db
      .update(playlists)
      .set({ ...input, updatedAt: Date.now() })
      .where(eq(playlists.id, id))
      .run();
    return this.summaries([this.get(userId, id)])[0]!;
  }

  remove(userId: string, id: string) {
    this.get(userId, id);
    this.db.delete(playlists).where(eq(playlists.id, id)).run();
  }

  /** Strike a track from the canonical list; the next sync removes it everywhere. */
  removeEntry(userId: string, playlistId: string, entryId: string) {
    this.get(userId, playlistId);
    const res = this.db
      .update(playlistEntries)
      .set({ removedAt: Date.now(), removedReason: 'manual' })
      .where(and(eq(playlistEntries.id, entryId), eq(playlistEntries.playlistId, playlistId), isNull(playlistEntries.removedAt)))
      .run();
    if (!res.changes) throw new NotFoundException('Track not found in this playlist');
  }

  restoreEntry(userId: string, playlistId: string, entryId: string) {
    this.get(userId, playlistId);
    const max =
      this.db
        .select({ m: sql<number>`max(${playlistEntries.position})` })
        .from(playlistEntries)
        .where(eq(playlistEntries.playlistId, playlistId))
        .get()?.m ?? 0;
    const res = this.db
      .update(playlistEntries)
      .set({ removedAt: null, removedReason: null, duplicateOfEntryId: null, position: max + 1 })
      .where(and(eq(playlistEntries.id, entryId), eq(playlistEntries.playlistId, playlistId), isNotNull(playlistEntries.removedAt)))
      .run();
    if (!res.changes) throw new NotFoundException('Removed track not found');
  }

  recentlyRemoved(userId: string, limit = 50) {
    return this.db
      .select({ e: playlistEntries })
      .from(playlistEntries)
      .innerJoin(playlists, eq(playlistEntries.playlistId, playlists.id))
      .where(and(eq(playlists.userId, userId), isNotNull(playlistEntries.removedAt)))
      .orderBy(desc(playlistEntries.removedAt))
      .limit(limit)
      .all()
      .map((r) => r.e);
  }

  // -----------------------------------------------------------------

  private async attach(userId: string, playlistId: string, input: LinkTargetInput) {
    const playlist = this.get(userId, playlistId);
    const conn = this.db
      .select()
      .from(connections)
      .where(and(eq(connections.id, input.connectionId), eq(connections.userId, userId)))
      .get();
    if (!conn) throw new NotFoundException('Connection not found');
    const provider = conn.provider as ProviderId;
    const client = this.providers.clientFor(conn);
    // A Liked Songs list links every account's liked collection; any other playlist can link one too.
    const liked = playlist.kind === 'liked' || (input.mode === 'existing' && input.providerPlaylistId === LIKED_ID);

    let remoteId: string;
    let name: string;
    let url: string | null;
    let snapshot: string[] | null = null;
    try {
      if (liked) {
        if (!PROVIDER_META[provider].capabilities.likedRead) throw new BadRequestException(`${PROVIDER_META[provider].name} liked songs can't be read`);
        remoteId = LIKED_ID;
        name = PROVIDER_META[provider].likedLabel;
        url = null;
      } else if (input.mode === 'create') {
        const created = await client.createPlaylist(input.name ?? playlist.name, playlist.description ?? undefined);
        remoteId = created.id;
        name = created.name;
        url = created.url;
        snapshot = []; // brand new and empty: nothing to pull
      } else {
        const remote = (await client.listPlaylists()).find((p) => p.id === input.providerPlaylistId);
        if (!remote) throw new BadRequestException('That playlist was not found on the service');
        remoteId = remote.id;
        name = remote.name;
        url = remote.url;
      }
    } catch (err) {
      if (err instanceof AuthExpiredError) this.providers.markStatus(conn.id, 'expired', err.message);
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(errorMessage(err));
    }

    const dup = this.db
      .select({ playlistId: playlistLinks.playlistId })
      .from(playlistLinks)
      .where(and(eq(playlistLinks.connectionId, conn.id), eq(playlistLinks.providerPlaylistId, remoteId)))
      .get();
    if (dup) throw new ConflictException(`${name} is already linked to another Crossfade playlist`);

    this.db
      .insert(playlistLinks)
      .values({
        id: newId('ln'),
        playlistId,
        connectionId: conn.id,
        provider,
        providerPlaylistId: remoteId,
        name,
        url,
        direction: input.direction,
        snapshot,
        createdAt: Date.now(),
      })
      .run();
  }
}

function linkDto(l: LinkRow): PlaylistLink {
  return {
    id: l.id,
    connectionId: l.connectionId,
    provider: l.provider as ProviderId,
    providerPlaylistId: l.providerPlaylistId,
    name: l.name,
    url: l.url,
    direction: l.direction,
    trackCount: l.trackCount,
    lastSyncedAt: l.lastSyncedAt,
    lastError: l.lastError,
  };
}

import { Inject, Injectable } from '@nestjs/common';
import type { MatchMethod, ProviderId, Track, TrackLink } from '@crossfade/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { newId } from '../common/ids.js';
import { DB, type Db } from '../db/db.js';
import {
  matchMisses,
  playlistEntries,
  providerTracks,
  reviewItems,
  runChanges,
  tracks,
} from '../db/schema.js';
import { artistKey, parseTitle } from '../matching/normalize.js';
import type { RemoteTrack } from '../providers/provider.types.js';

type TrackRow = typeof tracks.$inferSelect;
type ProviderTrackRow = typeof providerTracks.$inferSelect;

const METHOD_RANK: Record<MatchMethod, number> = { manual: 4, source: 3, isrc: 2, search: 1 };

@Injectable()
export class TracksService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Map a provider's track to a canonical track, creating one when nothing matches.
   * Order: known provider id → ISRC → normalised title/artist/version (+duration) → new.
   */
  resolve(provider: ProviderId, remote: RemoteTrack): string {
    const known = this.db
      .select()
      .from(providerTracks)
      .where(and(eq(providerTracks.provider, provider), eq(providerTracks.providerTrackId, remote.id)))
      .get();
    if (known) {
      this.refreshMetadata(known, remote);
      this.backfillArtwork(known.trackId, remote.imageUrl);
      return known.trackId;
    }

    if (remote.isrc) {
      const byIsrc = this.db.select().from(tracks).where(eq(tracks.isrc, remote.isrc)).get();
      if (byIsrc) {
        this.link(provider, remote, byIsrc.id, 'isrc', 1);
        this.backfillArtwork(byIsrc.id, remote.imageUrl);
        return byIsrc.id;
      }
    }

    const { key, versionTag } = parseTitle(remote.title, remote.artists);
    const aKey = artistKey(remote.artists);
    if (key && aKey) {
      const candidates = this.db
        .select()
        .from(tracks)
        .where(and(eq(tracks.titleKey, key), eq(tracks.artistKey, aKey)))
        .all()
        .filter((t) => (t.versionTag ?? '') === (versionTag ?? ''))
        .filter((t) => !t.durationMs || !remote.durationMs || Math.abs(t.durationMs - remote.durationMs) <= 4000)
        // Two different ISRCs are two different recordings.
        .filter((t) => !t.isrc || !remote.isrc || t.isrc === remote.isrc);
      const hit = candidates[0];
      if (hit) {
        this.link(provider, remote, hit.id, 'search', 0.95);
        if (!hit.isrc && remote.isrc) this.db.update(tracks).set({ isrc: remote.isrc }).where(eq(tracks.id, hit.id)).run();
        this.backfillArtwork(hit.id, remote.imageUrl);
        return hit.id;
      }
    }

    const id = this.create(remote);
    this.link(provider, remote, id, 'source', 1);
    return id;
  }

  /** Canonical track id for a provider track id, if known. */
  lookup(provider: ProviderId, providerTrackId: string): string | null {
    return (
      this.db
        .select({ trackId: providerTracks.trackId })
        .from(providerTracks)
        .where(and(eq(providerTracks.provider, provider), eq(providerTracks.providerTrackId, providerTrackId)))
        .get()?.trackId ?? null
    );
  }

  lookupMany(provider: ProviderId, ids: string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      if (!slice.length) continue;
      const rows = this.db
        .select({ pid: providerTracks.providerTrackId, trackId: providerTracks.trackId })
        .from(providerTracks)
        .where(and(eq(providerTracks.provider, provider), inArray(providerTracks.providerTrackId, slice)))
        .all();
      for (const r of rows) out.set(r.pid, r.trackId);
    }
    return out;
  }

  /** Provider ids for a canonical track, best first. */
  providerLinks(trackId: string, provider: ProviderId): ProviderTrackRow[] {
    return this.db
      .select()
      .from(providerTracks)
      .where(and(eq(providerTracks.trackId, trackId), eq(providerTracks.provider, provider)))
      .all()
      .sort((a, b) => METHOD_RANK[b.method] - METHOD_RANK[a.method] || b.confidence - a.confidence);
  }

  get(trackId: string): TrackRow | undefined {
    return this.db.select().from(tracks).where(eq(tracks.id, trackId)).get();
  }

  link(provider: ProviderId, remote: RemoteTrack, trackId: string, method: MatchMethod, confidence: number) {
    const values = {
      provider,
      providerTrackId: remote.id,
      trackId,
      title: remote.title,
      artists: remote.artists,
      album: remote.album,
      durationMs: remote.durationMs,
      isrc: remote.isrc,
      url: remote.url,
      artworkUrl: remote.imageUrl ?? null,
      method,
      confidence,
      updatedAt: Date.now(),
    };
    this.db
      .insert(providerTracks)
      .values(values)
      .onConflictDoUpdate({
        target: [providerTracks.provider, providerTracks.providerTrackId],
        set: { trackId, method, confidence, updatedAt: values.updatedAt, ...(remote.imageUrl ? { artworkUrl: remote.imageUrl } : {}) },
      })
      .run();
    this.backfillArtwork(trackId, remote.imageUrl);
    this.db
      .delete(matchMisses)
      .where(and(eq(matchMisses.trackId, trackId), eq(matchMisses.provider, provider)))
      .run();
  }

  /** Detach a provider id from its canonical track by giving it a canonical track of its own. */
  detach(provider: ProviderId, providerTrackId: string) {
    const row = this.db
      .select()
      .from(providerTracks)
      .where(and(eq(providerTracks.provider, provider), eq(providerTracks.providerTrackId, providerTrackId)))
      .get();
    if (!row) return;
    const remote: RemoteTrack = {
      id: row.providerTrackId,
      title: row.title,
      artists: row.artists,
      album: row.album,
      durationMs: row.durationMs,
      isrc: row.isrc,
      url: row.url,
      imageUrl: row.artworkUrl,
    };
    const id = this.create(remote);
    this.db
      .update(providerTracks)
      .set({ trackId: id, method: 'source', confidence: 1, updatedAt: Date.now() })
      .where(and(eq(providerTracks.provider, provider), eq(providerTracks.providerTrackId, providerTrackId)))
      .run();
  }

  /**
   * Fold `dropId` into `keepId`: provider ids, playlist entries, review items and history
   * move over; where a playlist already holds `keepId`, the dropped entry disappears.
   */
  merge(keepId: string, dropId: string) {
    if (keepId === dropId) return;
    this.db.transaction((tx) => {
      tx.update(providerTracks).set({ trackId: keepId }).where(eq(providerTracks.trackId, dropId)).run();

      const dropEntries = tx.select().from(playlistEntries).where(eq(playlistEntries.trackId, dropId)).all();
      for (const e of dropEntries) {
        const keep = tx
          .select()
          .from(playlistEntries)
          .where(and(eq(playlistEntries.playlistId, e.playlistId), eq(playlistEntries.trackId, keepId)))
          .get();
        if (!keep) {
          tx.update(playlistEntries).set({ trackId: keepId }).where(eq(playlistEntries.id, e.id)).run();
          continue;
        }
        if (keep.removedAt && !e.removedAt) {
          tx.update(playlistEntries)
            .set({ removedAt: null, removedReason: null, duplicateOfEntryId: null, position: e.position })
            .where(eq(playlistEntries.id, keep.id))
            .run();
        }
        tx.update(playlistEntries)
          .set({ duplicateOfEntryId: keep.id })
          .where(eq(playlistEntries.duplicateOfEntryId, e.id))
          .run();
        tx.delete(playlistEntries).where(eq(playlistEntries.id, e.id)).run();
      }

      const reviews = tx.select().from(reviewItems).where(eq(reviewItems.trackId, dropId)).all();
      for (const r of reviews) {
        const clash = tx
          .select({ id: reviewItems.id })
          .from(reviewItems)
          .where(
            and(
              eq(reviewItems.playlistId, r.playlistId),
              eq(reviewItems.trackId, keepId),
              eq(reviewItems.provider, r.provider),
              eq(reviewItems.reason, r.reason),
            ),
          )
          .get();
        if (clash) tx.delete(reviewItems).where(eq(reviewItems.id, r.id)).run();
        else tx.update(reviewItems).set({ trackId: keepId }).where(eq(reviewItems.id, r.id)).run();
      }

      tx.update(runChanges).set({ trackId: keepId }).where(eq(runChanges.trackId, dropId)).run();
      tx.delete(matchMisses).where(eq(matchMisses.trackId, dropId)).run();

      const keep = tx.select().from(tracks).where(eq(tracks.id, keepId)).get();
      const drop = tx.select().from(tracks).where(eq(tracks.id, dropId)).get();
      if (keep && drop && !keep.isrc && drop.isrc) {
        tx.update(tracks).set({ isrc: drop.isrc }).where(eq(tracks.id, keepId)).run();
      }
      if (keep && drop && !keep.artworkUrl && drop.artworkUrl) {
        tx.update(tracks).set({ artworkUrl: drop.artworkUrl }).where(eq(tracks.id, keepId)).run();
      }
      tx.delete(tracks).where(eq(tracks.id, dropId)).run();
    });
  }

  toDto(row: TrackRow): Track {
    return this.toDtos([row])[0]!;
  }

  toDtos(rows: TrackRow[]): Track[] {
    const ids = rows.map((r) => r.id);
    const links = new Map<string, TrackLink[]>();
    const art = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      if (!slice.length) continue;
      for (const l of this.db.select().from(providerTracks).where(inArray(providerTracks.trackId, slice)).all()) {
        if (l.artworkUrl && !art.has(l.trackId)) art.set(l.trackId, l.artworkUrl);
        const list = links.get(l.trackId) ?? [];
        list.push({
          provider: l.provider as ProviderId,
          id: l.providerTrackId,
          url: l.url,
          method: l.method,
          confidence: l.confidence,
        });
        links.set(l.trackId, list);
      }
    }
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      artists: r.artists,
      album: r.album,
      durationMs: r.durationMs,
      isrc: r.isrc,
      artworkUrl: r.artworkUrl ?? art.get(r.id) ?? null,
      links: (links.get(r.id) ?? []).sort(
        (a, b) => METHOD_RANK[b.method] - METHOD_RANK[a.method] || b.confidence - a.confidence,
      ),
    }));
  }

  getMany(ids: string[]): Map<string, TrackRow> {
    const out = new Map<string, TrackRow>();
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      if (!slice.length) continue;
      for (const r of this.db.select().from(tracks).where(inArray(tracks.id, slice)).all()) out.set(r.id, r);
    }
    return out;
  }

  count(): number {
    return this.db.select({ n: sql<number>`count(*)` }).from(tracks).get()?.n ?? 0;
  }

  private create(remote: RemoteTrack): string {
    const { key, versionTag } = parseTitle(remote.title, remote.artists);
    const id = newId('tr');
    this.db
      .insert(tracks)
      .values({
        id,
        title: remote.title,
        artists: remote.artists,
        album: remote.album,
        durationMs: remote.durationMs,
        isrc: remote.isrc,
        artworkUrl: remote.imageUrl ?? null,
        titleKey: key,
        artistKey: artistKey(remote.artists),
        versionTag,
        createdAt: Date.now(),
      })
      .run();
    return id;
  }

  /** Give a canonical track cover art the first time any service offers some. */
  private backfillArtwork(trackId: string, imageUrl: string | null | undefined) {
    if (!imageUrl) return;
    this.db
      .update(tracks)
      .set({ artworkUrl: imageUrl })
      .where(and(eq(tracks.id, trackId), isNull(tracks.artworkUrl)))
      .run();
  }

  private refreshMetadata(row: ProviderTrackRow, remote: RemoteTrack) {
    const artChanged = !!remote.imageUrl && row.artworkUrl !== remote.imageUrl;
    if (!artChanged && row.title === remote.title && row.durationMs === remote.durationMs && (row.isrc || !remote.isrc)) return;
    this.db
      .update(providerTracks)
      .set({
        title: remote.title,
        artists: remote.artists,
        album: remote.album,
        durationMs: remote.durationMs,
        isrc: remote.isrc ?? row.isrc,
        url: remote.url ?? row.url,
        artworkUrl: remote.imageUrl ?? row.artworkUrl,
        updatedAt: Date.now(),
      })
      .where(and(eq(providerTracks.provider, row.provider), eq(providerTracks.providerTrackId, row.providerTrackId)))
      .run();
  }
}

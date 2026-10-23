import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type MatchCandidate,
  type ProviderId,
  PROVIDER_META,
  type ResolveReviewInput,
  type ReviewItem,
} from '@crossfade/shared';
import { and, asc, eq } from 'drizzle-orm';
import { errorMessage } from '../common/errors.js';
import { DB, type Db } from '../db/db.js';
import { connections, playlistLinks, playlists, reviewItems } from '../db/schema.js';
import { TracksService } from '../library/tracks.service.js';
import { MatchService, toCandidate } from '../matching/match.service.js';
import { scoreMatch } from '../matching/score.js';
import { parseTrackUrl, type ProviderClient, type RemoteTrack } from '../providers/provider.types.js';
import { ProvidersService } from '../providers/providers.service.js';
import { SyncService } from '../sync/sync.service.js';

type ReviewRow = typeof reviewItems.$inferSelect;

@Injectable()
export class ReviewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tracks: TracksService,
    private readonly matcher: MatchService,
    private readonly providers: ProvidersService,
    private readonly sync: SyncService,
  ) {}

  list(userId: string, playlistId?: string): ReviewItem[] {
    const rows = this.db
      .select({ r: reviewItems, name: playlists.name })
      .from(reviewItems)
      .innerJoin(playlists, eq(reviewItems.playlistId, playlists.id))
      .where(
        and(
          eq(reviewItems.userId, userId),
          eq(reviewItems.status, 'pending'),
          playlistId ? eq(reviewItems.playlistId, playlistId) : undefined,
        ),
      )
      .orderBy(asc(reviewItems.createdAt))
      .all();
    const trackRows = this.tracks.getMany(rows.map((r) => r.r.trackId));
    const dtos = new Map(this.tracks.toDtos([...trackRows.values()]).map((t) => [t.id, t]));
    return rows.flatMap(({ r, name }) => {
      const track = dtos.get(r.trackId);
      if (!track) return [];
      const provider = r.provider as ProviderId;
      const link = track.links.find((l) => l.provider === provider);
      const current = link
        ? this.tracks.providerLinks(r.trackId, provider)[0]
        : undefined;
      return [
        {
          id: r.id,
          playlistId: r.playlistId,
          playlistName: name,
          provider,
          reason: r.reason,
          track,
          candidates: r.candidates as MatchCandidate[],
          currentMatch: current
            ? {
                providerTrackId: current.providerTrackId,
                title: current.title,
                artists: current.artists,
                album: current.album,
                durationMs: current.durationMs,
                url: current.url,
                imageUrl: current.artworkUrl,
                score: current.confidence,
              }
            : null,
          createdAt: r.createdAt,
        },
      ];
    });
  }

  async refresh(userId: string, id: string): Promise<ReviewItem> {
    const row = this.get(userId, id);
    const client = this.clientFor(userId, row);
    const candidates = await this.matcher.candidates(client, row.trackId);
    this.db.update(reviewItems).set({ candidates }).where(eq(reviewItems.id, id)).run();
    return this.list(userId, row.playlistId).find((r) => r.id === id)!;
  }

  async resolve(userId: string, id: string, input: ResolveReviewInput) {
    const row = this.get(userId, id);
    const provider = row.provider as ProviderId;

    if (input.action === 'ignore') {
      this.close(id, 'ignored');
      return;
    }
    if (input.action === 'done') {
      this.close(id, 'resolved');
      this.sync.request(userId, row.playlistId, 'manual');
      return;
    }

    const client = this.clientFor(userId, row);
    let remote: RemoteTrack | null = null;
    if (input.action === 'accept') {
      const c = (row.candidates as MatchCandidate[]).find((x) => x.providerTrackId === input.providerTrackId);
      remote = c
        ? { id: c.providerTrackId, title: c.title, artists: c.artists, album: c.album, durationMs: c.durationMs, isrc: null, url: c.url, imageUrl: c.imageUrl ?? null }
        : await client.getTrack(input.providerTrackId);
    } else {
      const pid = parseTrackUrl(provider, input.url);
      if (!pid) throw new BadRequestException(`That doesn't look like a ${PROVIDER_META[provider].name} track link`);
      try {
        remote = await client.getTrack(pid);
      } catch (err) {
        throw new BadRequestException(`Couldn't look that track up: ${errorMessage(err)}`);
      }
    }
    if (!remote) throw new BadRequestException('Track not found on the service');

    // A previous automatic pick that the user just overruled gets its own identity,
    // so the next sync swaps it out of the service playlist.
    for (const old of this.tracks.providerLinks(row.trackId, provider)) {
      if (old.providerTrackId !== remote.id && old.method !== 'source') this.tracks.detach(provider, old.providerTrackId);
    }
    const owner = this.tracks.lookup(provider, remote.id);
    if (owner && owner !== row.trackId) this.tracks.merge(row.trackId, owner);
    const track = this.tracks.get(row.trackId);
    const score = track ? scoreMatch({ title: track.title, artists: track.artists, durationMs: track.durationMs }, remote).score : 1;
    this.tracks.link(provider, remote, row.trackId, 'manual', Math.max(score, 0.99));
    this.matcher.clearMiss(row.trackId, provider);

    // Every pending item for this track on this service is answered by the same choice.
    for (const other of this.db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.trackId, row.trackId), eq(reviewItems.provider, provider), eq(reviewItems.status, 'pending')))
      .all()) {
      if (other.reason !== 'manual_remove') this.close(other.id, 'resolved');
    }
    this.sync.request(userId, row.playlistId, 'manual');
    return toCandidate(remote, score);
  }

  private close(id: string, status: 'resolved' | 'ignored') {
    this.db.update(reviewItems).set({ status, resolvedAt: Date.now() }).where(eq(reviewItems.id, id)).run();
  }

  private get(userId: string, id: string): ReviewRow {
    const row = this.db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.id, id), eq(reviewItems.userId, userId)))
      .get();
    if (!row) throw new NotFoundException('Review item not found');
    return row;
  }

  private clientFor(userId: string, row: ReviewRow): ProviderClient {
    const conn =
      this.db
        .select({ c: connections })
        .from(playlistLinks)
        .innerJoin(connections, eq(playlistLinks.connectionId, connections.id))
        .where(and(eq(playlistLinks.playlistId, row.playlistId), eq(playlistLinks.provider, row.provider)))
        .get()?.c ??
      this.db
        .select()
        .from(connections)
        .where(and(eq(connections.userId, userId), eq(connections.provider, row.provider)))
        .get();
    if (!conn) throw new BadRequestException(`No ${row.provider} connection to search with`);
    return this.providers.clientFor(conn);
  }
}

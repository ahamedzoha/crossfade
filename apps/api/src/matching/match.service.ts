import { Inject, Injectable } from '@nestjs/common';
import type { MatchCandidate, ProviderId } from '@crossfade/shared';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.js';
import { matchMisses } from '../db/schema.js';
import { TracksService } from '../library/tracks.service.js';
import type { ProviderClient, RemoteTrack } from '../providers/provider.types.js';
import { SettingsService } from '../settings/settings.service.js';
import { scoreMatch } from './score.js';

/** Re-search a provider for a previously unmatched track at most this often. */
const MISS_TTL = 3 * 24 * 3600 * 1000;

export type EnsureResult = (
  | {
      status: 'matched';
      providerTrackId: string;
      confidence: number;
      lowConfidence: boolean;
      candidates: MatchCandidate[];
      /** Another canonical track was folded into this one while matching. */
      merged?: boolean;
    }
  | { status: 'missing'; candidates: MatchCandidate[] }
) & {
  /** True when this call hit the service's search (the engine budgets those). */
  searched?: boolean;
};

@Injectable()
export class MatchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tracks: TracksService,
    private readonly settings: SettingsService,
  ) {}

  /** Make sure `trackId` has an id on `client.provider`, searching when needed. */
  async ensure(client: ProviderClient, trackId: string): Promise<EnsureResult> {
    const provider = client.provider;
    const existing = this.tracks.providerLinks(trackId, provider)[0];
    if (existing) {
      const { reviewScore, autoAcceptScore } = this.settings.get();
      const low = existing.method === 'search' && existing.confidence < autoAcceptScore;
      if (!low || existing.confidence >= reviewScore) {
        return {
          status: 'matched',
          providerTrackId: existing.providerTrackId,
          confidence: existing.confidence,
          lowConfidence: low,
          candidates: [],
        };
      }
    }

    const miss = this.db
      .select()
      .from(matchMisses)
      .where(and(eq(matchMisses.trackId, trackId), eq(matchMisses.provider, provider)))
      .get();
    if (miss && Date.now() - miss.checkedAt < MISS_TTL) {
      return { status: 'missing', candidates: miss.candidates as MatchCandidate[] };
    }

    const track = this.tracks.get(trackId);
    if (!track) return { status: 'missing', candidates: [] };

    const target = {
      title: track.title,
      artists: track.artists,
      album: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
    };

    const searched = true;
    let results: RemoteTrack[] = [];
    if (track.isrc && client.lookupIsrc) {
      results = await client.lookupIsrc(track.isrc);
    }
    if (!results.some((r) => r.isrc && r.isrc === track.isrc)) {
      results = [...results, ...(await client.search(target))];
    }

    const scored = dedupeById(results)
      .map((r) => ({ remote: r, score: scoreMatch(target, r).score }))
      .sort((a, b) => b.score - a.score);
    const candidates = scored.slice(0, 5).map(({ remote, score }) => toCandidate(remote, score));

    const { autoAcceptScore, reviewScore } = this.settings.get();
    const best = scored[0];
    if (!best || best.score < reviewScore) {
      this.recordMiss(trackId, provider, candidates);
      return { status: 'missing', candidates, searched };
    }

    // The provider id may already belong to another canonical track: same recording, so converge.
    const owner = this.tracks.lookup(provider, best.remote.id);
    let merged = false;
    if (owner && owner !== trackId) {
      if (best.score >= autoAcceptScore) {
        this.tracks.merge(trackId, owner);
        merged = true;
      } else {
        this.recordMiss(trackId, provider, candidates);
        return { status: 'missing', candidates, searched };
      }
    }

    const method = best.remote.isrc && best.remote.isrc === track.isrc ? 'isrc' : 'search';
    this.tracks.link(provider, best.remote, trackId, method, best.score);
    return {
      status: 'matched',
      providerTrackId: best.remote.id,
      confidence: best.score,
      lowConfidence: best.score < autoAcceptScore,
      candidates,
      merged,
      searched,
    };
  }

  /** Fresh candidates for the review screen. */
  async candidates(client: ProviderClient, trackId: string): Promise<MatchCandidate[]> {
    const track = this.tracks.get(trackId);
    if (!track) return [];
    const target = { title: track.title, artists: track.artists, durationMs: track.durationMs, isrc: track.isrc };
    let results = await client.search(target);
    if (track.isrc && client.lookupIsrc) results = [...(await client.lookupIsrc(track.isrc)), ...results];
    return dedupeById(results)
      .map((r) => toCandidate(r, scoreMatch(target, r).score))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  private recordMiss(trackId: string, provider: ProviderId, candidates: MatchCandidate[]) {
    this.db
      .insert(matchMisses)
      .values({ trackId, provider, candidates, checkedAt: Date.now() })
      .onConflictDoUpdate({
        target: [matchMisses.trackId, matchMisses.provider],
        set: { candidates, checkedAt: Date.now() },
      })
      .run();
  }

  clearMiss(trackId: string, provider: ProviderId) {
    this.db
      .delete(matchMisses)
      .where(and(eq(matchMisses.trackId, trackId), eq(matchMisses.provider, provider)))
      .run();
  }
}

function dedupeById(items: RemoteTrack[]): RemoteTrack[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

export function toCandidate(r: RemoteTrack, score: number): MatchCandidate {
  return {
    providerTrackId: r.id,
    title: r.title,
    artists: r.artists,
    album: r.album,
    durationMs: r.durationMs,
    url: r.url,
    imageUrl: r.imageUrl ?? null,
    score,
  };
}

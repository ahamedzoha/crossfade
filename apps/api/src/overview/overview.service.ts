import { Inject, Injectable } from '@nestjs/common';
import type { Health, HealthReason, Overview } from '@crossfade/shared';
import { PROVIDER_META } from '@crossfade/shared';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.js';
import { playlistEntries, playlists, runChanges, syncRuns } from '../db/schema.js';
import { ConnectionsService } from '../connections/connections.service.js';
import { PlaylistsService } from '../library/playlists.service.js';
import { RunsService } from '../runs/runs.service.js';

@Injectable()
export class OverviewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly playlists: PlaylistsService,
    private readonly runs: RunsService,
    private readonly connections: ConnectionsService,
  ) {}

  get(userId: string): Overview {
    const conns = this.connections.list(userId);
    const pls = this.playlists.list(userId);
    const recentRuns = this.runs.recent(userId, 12);
    const activeRuns = this.runs.active(userId);
    const lastFinished = this.db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.userId, userId), inArray(syncRuns.status, ['success', 'partial', 'guarded', 'failed'])))
      .orderBy(desc(syncRuns.finishedAt))
      .limit(1)
      .get();

    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const dedupedThisWeek =
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(runChanges)
        .innerJoin(syncRuns, eq(runChanges.runId, syncRuns.id))
        .where(and(eq(syncRuns.userId, userId), eq(runChanges.action, 'deduped'), gt(runChanges.createdAt, weekAgo), eq(syncRuns.dryRun, false)))
        .get()?.n ?? 0;

    const trackCount =
      this.db
        .select({ n: sql<number>`count(distinct ${playlistEntries.trackId})` })
        .from(playlistEntries)
        .innerJoin(playlists, eq(playlistEntries.playlistId, playlists.id))
        .where(and(eq(playlists.userId, userId), isNull(playlistEntries.removedAt)))
        .get()?.n ?? 0;

    const reviewCount = pls.reduce((n, p) => n + p.reviewCount, 0);
    const reasons: HealthReason[] = [];
    let health: Health = pls.length ? 'ok' : 'idle';
    const raise = (level: Health) => {
      const order: Health[] = ['idle', 'ok', 'attention', 'error'];
      if (order.indexOf(level) > order.indexOf(health)) health = level;
    };
    for (const c of conns) {
      const name = PROVIDER_META[c.provider].name;
      if (c.status === 'expired' || c.status === 'error') {
        raise('error');
        reasons.push({ level: 'error', text: `${name} needs reconnecting`, href: '/connections', action: 'Reconnect' });
      } else if (c.status === 'expiring') {
        raise('attention');
        const days = c.expiresAt ? Math.max(0, Math.round((c.expiresAt - Date.now()) / 86_400_000)) : null;
        reasons.push({
          level: 'attention',
          text: `${name} sign-in expires ${days != null ? `in ${days} day${days === 1 ? '' : 's'}` : 'soon'}`,
          href: '/connections',
          action: 'Renew',
        });
      }
    }
    for (const p of pls) {
      const r = p.lastRun;
      if (!r) continue;
      const where = p.kind === 'liked' ? '/liked' : `/playlists/${p.id}`;
      if (r.status === 'failed') {
        raise('error');
        reasons.push({ level: 'error', text: `${p.name}: last sync failed`, href: `/runs/${r.id}`, action: 'See why' });
      } else if (r.status === 'guarded') {
        raise('attention');
        const pct = r.stats?.guard?.percent;
        reasons.push({
          level: 'attention',
          text: `${p.name}: guard stopped a run that would remove ${pct != null ? `${pct}%` : 'too much'}`,
          href: where,
          action: 'Decide',
        });
      } else if (r.status === 'partial') {
        raise('attention');
        reasons.push({ level: 'attention', text: `${p.name}: last sync partly failed`, href: `/runs/${r.id}`, action: 'See why' });
      }
    }
    if (reviewCount) {
      raise('attention');
      reasons.push({ level: 'attention', text: `${reviewCount} track${reviewCount === 1 ? '' : 's'} to review`, href: '/review', action: 'Review' });
    }

    const next = pls.map((p) => p.nextRunAt).filter((n): n is number => n !== null);
    return {
      health,
      healthReasons: reasons,
      nextSyncAt: next.length ? Math.min(...next) : null,
      playlistCount: pls.length,
      syncedPlaylistCount: pls.filter((p) => p.syncEnabled && p.links.length > 0).length,
      trackCount,
      reviewCount,
      dedupedThisWeek,
      connections: conns,
      recentRuns,
      lastRun: lastFinished ? this.runs.toDetail(lastFinished) : null,
      activeRuns,
    };
  }
}

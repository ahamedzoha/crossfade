import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Paged, ProviderId, RunChange, RunDetail, RunStats, RunSummary } from '@crossfade/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.js';
import { runChanges, syncRuns } from '../db/schema.js';
import { TracksService } from '../library/tracks.service.js';

type RunRow = typeof syncRuns.$inferSelect;

@Injectable()
export class RunsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tracks: TracksService,
  ) {}

  toSummary(r: RunRow): RunSummary {
    return {
      id: r.id,
      playlistId: r.playlistId,
      playlistName: r.playlistName,
      trigger: r.trigger,
      status: r.status,
      dryRun: r.dryRun,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
      stats: (r.stats as RunStats | null) ?? null,
      error: r.error,
    };
  }

  list(
    userId: string,
    q: { playlistId?: string; status?: RunRow['status']; limit: number; offset: number },
  ): Paged<RunSummary> {
    const where = and(
      eq(syncRuns.userId, userId),
      q.playlistId ? eq(syncRuns.playlistId, q.playlistId) : undefined,
      q.status ? eq(syncRuns.status, q.status) : undefined,
    );
    const items = this.db
      .select()
      .from(syncRuns)
      .where(where)
      .orderBy(desc(syncRuns.createdAt))
      .limit(q.limit)
      .offset(q.offset)
      .all()
      .map((r) => this.toSummary(r));
    const total = this.db.select({ n: sql<number>`count(*)` }).from(syncRuns).where(where).get()?.n ?? 0;
    return { items, total, limit: q.limit, offset: q.offset };
  }

  get(userId: string, id: string): RunRow {
    const row = this.db.select().from(syncRuns).where(and(eq(syncRuns.id, id), eq(syncRuns.userId, userId))).get();
    if (!row) throw new NotFoundException('Run not found');
    return row;
  }

  detail(userId: string, id: string): RunDetail {
    return this.toDetail(this.get(userId, id));
  }

  toDetail(row: RunRow): RunDetail {
    const changes = this.db.select().from(runChanges).where(eq(runChanges.runId, row.id)).all();
    const trackRows = this.tracks.getMany([...new Set(changes.map((c) => c.trackId).filter((t): t is string => !!t))]);
    const dtos = new Map(this.tracks.toDtos([...trackRows.values()]).map((t) => [t.id, t]));
    const out: RunChange[] = changes.map((c) => ({
      id: c.id,
      action: c.action as RunChange['action'],
      provider: (c.provider as ProviderId | null) ?? null,
      track: c.trackId ? (dtos.get(c.trackId) ?? null) : null,
      detail: c.detail,
      position: c.position,
    }));
    return {
      ...this.toSummary(row),
      changes: out,
      log: (row.log as RunDetail['log'] | null) ?? [],
    };
  }

  latestFor(playlistIds: string[]): Map<string, RunSummary> {
    const out = new Map<string, RunSummary>();
    if (!playlistIds.length) return out;
    const rows = this.db
      .select()
      .from(syncRuns)
      .where(
        and(
          inArray(syncRuns.playlistId, playlistIds),
          inArray(syncRuns.status, ['success', 'partial', 'failed', 'guarded', 'running', 'queued']),
        ),
      )
      .orderBy(desc(syncRuns.createdAt))
      .all();
    for (const r of rows) if (r.playlistId && !out.has(r.playlistId)) out.set(r.playlistId, this.toSummary(r));
    return out;
  }

  active(userId: string): RunSummary[] {
    return this.db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.userId, userId), inArray(syncRuns.status, ['queued', 'running'])))
      .orderBy(desc(syncRuns.createdAt))
      .all()
      .map((r) => this.toSummary(r));
  }

  recent(userId: string, limit: number): RunSummary[] {
    return this.list(userId, { limit, offset: 0 }).items;
  }
}

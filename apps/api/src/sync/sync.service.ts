import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { RunSummary, RunTrigger } from '@crossfade/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { errorMessage } from '../common/errors.js';
import { newId } from '../common/ids.js';
import { DB, type Db } from '../db/db.js';
import { playlists, syncRuns } from '../db/schema.js';
import { QueueService } from '../jobs/queue.service.js';
import { WorkerService } from '../jobs/worker.service.js';
import { RunsService } from '../runs/runs.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { RunLog, SyncEngine, type SyncOptions } from './sync.engine.js';

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly engine: SyncEngine,
    private readonly queue: QueueService,
    private readonly worker: WorkerService,
    private readonly runs: RunsService,
    private readonly webhooks: WebhooksService,
  ) {}

  onModuleInit() {
    this.worker.register('sync', async (job) => {
      await this.execute(String(job.payload.runId));
    });
  }

  /** Queue a run; if one is already queued or running for this playlist, return that instead. */
  request(userId: string, playlistId: string, trigger: RunTrigger, opts: Partial<SyncOptions> = {}): RunSummary {
    const playlist = this.db
      .select()
      .from(playlists)
      .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
      .get();
    if (!playlist) throw new NotFoundException('Playlist not found');

    const active = this.db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.playlistId, playlistId), inArray(syncRuns.status, ['queued', 'running'])))
      .get();
    if (active) return this.runs.toSummary(active);

    const id = newId('run');
    const now = Date.now();
    this.db
      .insert(syncRuns)
      .values({
        id,
        userId,
        playlistId,
        playlistName: playlist.name,
        trigger,
        status: 'queued',
        dryRun: opts.dryRun ?? false,
        overrideGuard: opts.overrideGuard ?? false,
        createdAt: now,
      })
      .run();
    const jobId = this.queue.enqueue('sync', { runId: id }, { dedupeKey: `sync:${playlistId}`, maxAttempts: 1 });
    if (!jobId) {
      this.db.delete(syncRuns).where(eq(syncRuns.id, id)).run();
      const again = this.db
        .select()
        .from(syncRuns)
        .where(and(eq(syncRuns.playlistId, playlistId), inArray(syncRuns.status, ['queued', 'running'])))
        .get();
      if (again) return this.runs.toSummary(again);
      throw new Error('Could not queue the sync');
    }
    return this.runs.toSummary(this.runs.get(userId, id));
  }

  async execute(runId: string) {
    const run = this.db.select().from(syncRuns).where(eq(syncRuns.id, runId)).get();
    if (!run || !['queued', 'running'].includes(run.status)) return;
    const playlist = run.playlistId
      ? this.db.select().from(playlists).where(eq(playlists.id, run.playlistId)).get()
      : undefined;

    const log = new RunLog((lines) => {
      this.db.update(syncRuns).set({ log: lines }).where(eq(syncRuns.id, runId)).run();
    });

    if (!playlist) {
      this.db
        .update(syncRuns)
        .set({ status: 'failed', error: 'Playlist no longer exists', finishedAt: Date.now() })
        .where(eq(syncRuns.id, runId))
        .run();
      return;
    }

    this.db.update(syncRuns).set({ status: 'running', startedAt: Date.now() }).where(eq(syncRuns.id, runId)).run();
    log.info(`Syncing ${playlist.name}`);

    try {
      const outcome = await this.engine.sync(
        playlist,
        runId,
        { dryRun: run.dryRun, overrideGuard: run.overrideGuard },
        log,
      );
      const s = outcome.stats;
      log.info(
        `Done: +${s.added} −${s.removed}, ${s.deduped} duplicate${s.deduped === 1 ? '' : 's'} collapsed, ${s.review} to review, ${s.trackCount} tracks`,
      );
      this.engine.finish(runId, outcome, log);
      if (!run.dryRun) {
        this.db.update(playlists).set({ lastRunAt: Date.now() }).where(eq(playlists.id, playlist.id)).run();
      }

      const summary = this.runs.toSummary(this.runs.get(run.userId, runId));
      const event =
        outcome.status === 'guarded' ? 'run.guarded' : outcome.status === 'failed' ? 'run.failed' : 'run.finished';
      this.webhooks.emit(run.userId, event, summary);
      if (outcome.changedCanonical && !run.dryRun) {
        this.webhooks.emit(run.userId, 'playlist.changed', { playlistId: playlist.id, name: playlist.name, runId });
      }
      for (const e of outcome.expired) {
        this.webhooks.emit(e.userId, 'connection.expired', { connectionId: e.connectionId, provider: e.provider, runId });
      }
      if (outcome.newReviews > 0) {
        this.webhooks.emit(run.userId, 'review.created', { playlistId: playlist.id, count: outcome.newReviews, runId });
      }
    } catch (err) {
      const msg = errorMessage(err);
      this.logger.error(`Run ${runId} failed: ${msg}`, err instanceof Error ? err.stack : undefined);
      log.error(msg);
      this.db
        .update(syncRuns)
        .set({ status: 'failed', error: msg, finishedAt: Date.now(), log: log.lines })
        .where(eq(syncRuns.id, runId))
        .run();
      this.db.update(playlists).set({ lastRunAt: Date.now() }).where(eq(playlists.id, playlist.id)).run();
      this.webhooks.emit(run.userId, 'run.failed', this.runs.toSummary(this.runs.get(run.userId, runId)));
    }
  }
}

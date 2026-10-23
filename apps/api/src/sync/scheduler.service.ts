import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { and, eq, inArray, lt, ne } from 'drizzle-orm';
import { errorMessage } from '../common/errors.js';
import { DB, type Db } from '../db/db.js';
import { connections, oauthStates, playlistLinks, playlists, sessions, syncRuns } from '../db/schema.js';
import { QueueService } from '../jobs/queue.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { SyncService } from './sync.service.js';

const TICK_MS = 30_000;
const DAY = 24 * 3600 * 1000;

/** Decides which playlists are due and queues them; also does daily housekeeping. */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastHousekeeping = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sync: SyncService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
    private readonly webhooks: WebhooksService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.WORKER_DISABLED === '1') return;
    // Runs interrupted by a restart: their jobs are re-queued by the worker, but a run whose job
    // is gone would sit in "running" forever.
    const orphaned = this.db
      .select({ id: syncRuns.id, playlistId: syncRuns.playlistId })
      .from(syncRuns)
      .where(inArray(syncRuns.status, ['queued', 'running']))
      .all()
      .filter((r) => !r.playlistId || !this.queue.hasActive(`sync:${r.playlistId}`));
    for (const r of orphaned) {
      this.db
        .update(syncRuns)
        .set({ status: 'failed', error: 'Interrupted by a restart', finishedAt: Date.now() })
        .where(eq(syncRuns.id, r.id))
        .run();
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
    setTimeout(() => this.tick(), 5_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** When a playlist is next due, or null when it isn't scheduled. */
  nextRunAt(p: { syncEnabled: boolean; scheduleMinutes: number | null; lastRunAt: number | null }, linkCount: number) {
    if (!p.syncEnabled || linkCount === 0) return null;
    const minutes = p.scheduleMinutes ?? this.settings.get().defaultScheduleMinutes;
    return (p.lastRunAt ?? 0) + minutes * 60_000;
  }

  tick() {
    try {
      const now = Date.now();
      const rows = this.db.select().from(playlists).where(eq(playlists.syncEnabled, true)).all();
      const linked = new Set(
        this.db
          .select({ playlistId: playlistLinks.playlistId })
          .from(playlistLinks)
          .innerJoin(connections, eq(playlistLinks.connectionId, connections.id))
          .where(ne(connections.status, 'expired'))
          .all()
          .map((l) => l.playlistId),
      );
      for (const p of rows) {
        if (!linked.has(p.id)) continue;
        const due = this.nextRunAt(p, 1);
        if (due === null || due > now) continue;
        if (this.queue.hasActive(`sync:${p.id}`)) continue;
        this.sync.request(p.userId, p.id, 'schedule');
      }
      if (now - this.lastHousekeeping > 6 * 3600 * 1000) this.housekeeping();
    } catch (err) {
      this.logger.error(`Scheduler tick failed: ${errorMessage(err)}`);
    }
  }

  private housekeeping() {
    this.lastHousekeeping = Date.now();
    const now = Date.now();
    this.queue.prune(now - 7 * DAY);
    this.db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
    this.db.delete(oauthStates).where(lt(oauthStates.createdAt, now - 3600 * 1000)).run();
    this.db
      .delete(syncRuns)
      .where(and(lt(syncRuns.createdAt, now - 90 * DAY), inArray(syncRuns.status, ['success', 'failed', 'partial', 'guarded'])))
      .run();

    // Spotify refresh tokens die 6 months after sign-in: warn two weeks ahead.
    const expiring = this.db
      .select()
      .from(connections)
      .where(and(eq(connections.status, 'active'), lt(connections.expiresAt, now + 14 * DAY)))
      .all();
    for (const c of expiring) {
      if (!c.expiresAt) continue;
      const days = Math.max(0, Math.round((c.expiresAt - now) / DAY));
      this.db
        .update(connections)
        .set({ status: 'expiring', statusMessage: `Sign-in expires in ${days} day${days === 1 ? '' : 's'}. Reconnect to keep syncing.` })
        .where(eq(connections.id, c.id))
        .run();
      this.webhooks.emit(c.userId, 'connection.expired', { connectionId: c.id, provider: c.provider, expiresAt: c.expiresAt });
    }
  }
}

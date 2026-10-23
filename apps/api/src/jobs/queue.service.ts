import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { newId } from '../common/ids.js';
import { DB, type Db } from '../db/db.js';
import { jobs } from '../db/schema.js';

export type JobRow = typeof jobs.$inferSelect;

export interface EnqueueOptions {
  runAt?: number;
  dedupeKey?: string;
  maxAttempts?: number;
}

const LEASE_MS = 30 * 60_000;

/** A small durable job queue on SQLite. Single writer, so claiming is a plain transaction. */
@Injectable()
export class QueueService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Returns the new job id, or null when a job with the same dedupe key is already active. */
  enqueue(type: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}): string | null {
    const now = Date.now();
    const id = newId('job');
    const res = this.db
      .insert(jobs)
      .values({
        id,
        type,
        payload,
        status: 'queued',
        dedupeKey: opts.dedupeKey ?? null,
        runAt: opts.runAt ?? now,
        maxAttempts: opts.maxAttempts ?? 3,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
    return res.changes > 0 ? id : null;
  }

  claim(types: string[]): JobRow | null {
    return this.db.transaction((tx) => {
      const now = Date.now();
      const job = tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, now), inArray(jobs.type, types)))
        .orderBy(jobs.runAt)
        .limit(1)
        .get();
      if (!job) return null;
      tx.update(jobs)
        .set({ status: 'running', attempts: job.attempts + 1, lockedUntil: now + LEASE_MS, updatedAt: now })
        .where(eq(jobs.id, job.id))
        .run();
      return { ...job, status: 'running' as const, attempts: job.attempts + 1 };
    });
  }

  complete(id: string) {
    this.db.update(jobs).set({ status: 'done', lockedUntil: null, updatedAt: Date.now() }).where(eq(jobs.id, id)).run();
  }

  fail(job: JobRow, error: string) {
    const now = Date.now();
    const retry = job.attempts < job.maxAttempts;
    this.db
      .update(jobs)
      .set({
        status: retry ? 'queued' : 'failed',
        runAt: retry ? now + Math.min(3_600_000, 30_000 * 2 ** (job.attempts - 1)) : job.runAt,
        lockedUntil: null,
        lastError: error.slice(0, 2000),
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id))
      .run();
    return retry;
  }

  /** Jobs left running by a crash go back to the queue. */
  recoverStale() {
    return this.db
      .update(jobs)
      .set({ status: 'queued', lockedUntil: null, updatedAt: Date.now() })
      .where(eq(jobs.status, 'running'))
      .run().changes;
  }

  hasActive(dedupeKey: string): boolean {
    return !!this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, dedupeKey), inArray(jobs.status, ['queued', 'running'])))
      .get();
  }

  prune(olderThan: number) {
    this.db
      .delete(jobs)
      .where(and(inArray(jobs.status, ['done', 'failed']), lt(jobs.updatedAt, olderThan)))
      .run();
  }

  counts() {
    return this.db
      .select({ status: jobs.status, n: sql<number>`count(*)` })
      .from(jobs)
      .groupBy(jobs.status)
      .all();
  }
}

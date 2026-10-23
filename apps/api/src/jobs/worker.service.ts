import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { errorMessage } from '../common/errors.js';
import { type JobRow, QueueService } from './queue.service.js';

export type JobHandler = (job: JobRow) => Promise<void>;

/** Polls the queue and runs jobs in-process with bounded concurrency. */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private stopping = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly queue: QueueService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  onApplicationBootstrap() {
    if (process.env.WORKER_DISABLED === '1') return;
    const recovered = this.queue.recoverStale();
    if (recovered) this.logger.log(`Re-queued ${recovered} interrupted job(s)`);
    for (let i = 0; i < this.config.workerConcurrency; i++) this.loops.push(this.loop(i));
    this.logger.log(`Worker started with concurrency ${this.config.workerConcurrency}`);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    await Promise.race([Promise.all(this.loops), sleep(15_000)]);
  }

  private async loop(slot: number) {
    while (!this.stopping) {
      let job: JobRow | null = null;
      try {
        job = this.queue.claim([...this.handlers.keys()]);
      } catch (err) {
        this.logger.error(`Claim failed: ${errorMessage(err)}`);
      }
      if (!job) {
        await sleep(1000 + slot * 150);
        continue;
      }
      const handler = this.handlers.get(job.type);
      try {
        if (!handler) throw new Error(`No handler for job type ${job.type}`);
        await handler(job);
        this.queue.complete(job.id);
      } catch (err) {
        const retry = this.queue.fail(job, errorMessage(err));
        this.logger.warn(`Job ${job.type} ${job.id} failed (${retry ? 'will retry' : 'giving up'}): ${errorMessage(err)}`);
      }
    }
  }
}

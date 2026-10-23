import { createHmac } from 'node:crypto';
import { Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { CreateWebhookInput, Webhook, WebhookCreated, WebhookEvent } from '@crossfade/shared';
import { and, eq } from 'drizzle-orm';
import { CryptoService } from '../common/crypto.service.js';
import { errorMessage } from '../common/errors.js';
import { newId, randomToken } from '../common/ids.js';
import { DB, type Db } from '../db/db.js';
import { webhooks } from '../db/schema.js';
import { QueueService } from '../jobs/queue.service.js';
import { WorkerService } from '../jobs/worker.service.js';

type Row = typeof webhooks.$inferSelect;

@Injectable()
export class WebhooksService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly crypto: CryptoService,
    private readonly queue: QueueService,
    private readonly worker: WorkerService,
  ) {}

  onModuleInit() {
    this.worker.register('webhook', async (job) => {
      const { webhookId, event, payload, deliveryId } = job.payload as {
        webhookId: string;
        event: WebhookEvent;
        payload: unknown;
        deliveryId: string;
      };
      await this.deliver(webhookId, event, payload, deliveryId);
    });
  }

  list(userId: string): Webhook[] {
    return this.db.select().from(webhooks).where(eq(webhooks.userId, userId)).all().map(toDto);
  }

  create(userId: string, input: CreateWebhookInput): WebhookCreated {
    const secret = `whsec_${randomToken(24)}`;
    const row: Row = {
      id: newId('wh'),
      userId,
      url: input.url,
      secretEnc: this.crypto.encrypt(secret),
      events: input.events,
      active: true,
      createdAt: Date.now(),
      lastStatus: null,
      lastError: null,
      lastDeliveryAt: null,
    };
    this.db.insert(webhooks).values(row).run();
    return { ...toDto(row), secret };
  }

  update(userId: string, id: string, input: { url?: string; events?: string[]; active?: boolean }): Webhook {
    this.get(userId, id);
    this.db.update(webhooks).set(input).where(eq(webhooks.id, id)).run();
    return toDto(this.get(userId, id));
  }

  remove(userId: string, id: string) {
    this.get(userId, id);
    this.db.delete(webhooks).where(eq(webhooks.id, id)).run();
  }

  test(userId: string, id: string) {
    const hook = this.get(userId, id);
    this.queue.enqueue(
      'webhook',
      { webhookId: hook.id, event: 'run.finished', payload: { test: true, message: 'Test delivery from Crossfade' }, deliveryId: newId('dl') },
      { maxAttempts: 1 },
    );
  }

  /** Fan an event out to the user's subscribed webhooks (delivered by the worker, with retries). */
  emit(userId: string, event: WebhookEvent, payload: unknown) {
    const hooks = this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.userId, userId), eq(webhooks.active, true)))
      .all()
      .filter((h) => h.events.includes(event));
    for (const h of hooks) {
      this.queue.enqueue('webhook', { webhookId: h.id, event, payload, deliveryId: newId('dl') }, { maxAttempts: 5 });
    }
  }

  private async deliver(webhookId: string, event: WebhookEvent, payload: unknown, deliveryId: string) {
    const hook = this.db.select().from(webhooks).where(eq(webhooks.id, webhookId)).get();
    if (!hook || !hook.active) return;
    const body = JSON.stringify({ id: deliveryId, event, createdAt: new Date().toISOString(), data: payload });
    const signature = createHmac('sha256', this.crypto.decrypt(hook.secretEnc)).update(body).digest('hex');
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Crossfade-Webhook/1',
          'x-crossfade-event': event,
          'x-crossfade-delivery': deliveryId,
          'x-crossfade-signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = errorMessage(err);
    }
    this.db
      .update(webhooks)
      .set({ lastStatus: status, lastError: error, lastDeliveryAt: Date.now() })
      .where(eq(webhooks.id, webhookId))
      .run();
    if (error) throw new Error(`Webhook delivery failed: ${error}`);
  }

  private get(userId: string, id: string): Row {
    const row = this.db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId))).get();
    if (!row) throw new NotFoundException('Webhook not found');
    return row;
  }
}

function toDto(r: Row): Webhook {
  return {
    id: r.id,
    url: r.url,
    events: r.events as WebhookEvent[],
    active: r.active,
    createdAt: r.createdAt,
    lastStatus: r.lastStatus,
    lastError: r.lastError,
    lastDeliveryAt: r.lastDeliveryAt,
  };
}

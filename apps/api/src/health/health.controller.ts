import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, type Db } from '../db/db.js';
import { QueueService } from '../jobs/queue.service.js';
import { buildOpenApi } from '../openapi/openapi.js';

@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queue: QueueService,
  ) {}

  @Get('health')
  health() {
    this.db.run(sql`select 1`);
    return { status: 'ok', version: this.config.version, jobs: Object.fromEntries(this.queue.counts().map((c) => [c.status, c.n])) };
  }

  @Get('openapi.json')
  openapi() {
    return buildOpenApi(this.config.version, this.config.appUrl);
  }
}

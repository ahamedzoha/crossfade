import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { CryptoService } from './common/crypto.service.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ConfigModule } from './config/config.module.js';
import { ConnectionsController } from './connections/connections.controller.js';
import { ConnectionsService } from './connections/connections.service.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { KeysController } from './keys/keys.controller.js';
import { PlaylistsService } from './library/playlists.service.js';
import { TracksService } from './library/tracks.service.js';
import { V1Controller } from './library/v1.controller.js';
import { MatchService } from './matching/match.service.js';
import { OverviewService } from './overview/overview.service.js';
import { ProvidersService } from './providers/providers.service.js';
import { ReviewService } from './review/review.service.js';
import { RunsService } from './runs/runs.service.js';
import { SettingsService } from './settings/settings.service.js';
import { SchedulerService } from './sync/scheduler.service.js';
import { SyncEngine } from './sync/sync.engine.js';
import { SyncService } from './sync/sync.service.js';
import { UsersController } from './users/users.controller.js';
import { WebhooksService } from './webhooks/webhooks.service.js';

@Module({
  imports: [ConfigModule, DbModule, JobsModule],
  controllers: [HealthController, AuthController, UsersController, KeysController, ConnectionsController, V1Controller],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    CryptoService,
    AuthService,
    SettingsService,
    ProvidersService,
    ConnectionsService,
    TracksService,
    MatchService,
    WebhooksService,
    RunsService,
    SyncEngine,
    SyncService,
    SchedulerService,
    PlaylistsService,
    ReviewService,
    OverviewService,
  ],
})
export class AppModule {}

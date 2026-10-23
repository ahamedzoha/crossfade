import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, openDatabase, SQLITE } from './db.js';

@Global()
@Module({
  providers: [
    {
      provide: SQLITE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => openDatabase(config.dbPath),
    },
    {
      provide: DB,
      inject: [SQLITE],
      useFactory: (handle: ReturnType<typeof openDatabase>) => handle.db,
    },
  ],
  exports: [DB, SQLITE],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(SQLITE) private readonly handle: { sqlite: Database.Database }) {}

  onApplicationShutdown() {
    this.handle.sqlite.close();
  }
}

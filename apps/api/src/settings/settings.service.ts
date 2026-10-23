import { Inject, Injectable } from '@nestjs/common';
import type { InstanceSettings, InstanceSettingsInput } from '@crossfade/shared';
import { eq } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, type Db } from '../db/db.js';
import { settings } from '../db/schema.js';

type Stored = Omit<InstanceSettings, 'appUrl' | 'version'>;

const DEFAULTS: Stored = {
  defaultScheduleMinutes: 60,
  guardPercent: 30,
  autoAcceptScore: 0.85,
  reviewScore: 0.6,
  dedupeMode: 'strict',
};

const KEY = 'instance';

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get(): InstanceSettings {
    const row = this.db.select().from(settings).where(eq(settings.key, KEY)).get();
    const stored = { ...DEFAULTS, ...((row?.value as Partial<Stored> | undefined) ?? {}) };
    return { ...stored, appUrl: this.config.appUrl, version: this.config.version };
  }

  update(input: InstanceSettingsInput): InstanceSettings {
    const { appUrl: _a, version: _v, ...current } = this.get();
    const next: Stored = { ...current, ...input };
    if (next.reviewScore > next.autoAcceptScore) next.reviewScore = next.autoAcceptScore;
    this.db
      .insert(settings)
      .values({ key: KEY, value: next })
      .onConflictDoUpdate({ target: settings.key, set: { value: next } })
      .run();
    return this.get();
  }
}

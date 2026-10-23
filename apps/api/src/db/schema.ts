import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// All timestamps are epoch milliseconds. JSON columns are stored as text.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256 of the cookie token
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    scopes: text('scopes', { mode: 'json' }).$type<('read' | 'write')[]>().notNull(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

/** Instance-level provider credentials (Spotify app, Apple MusicKit key), encrypted. */
export const providerConfigs = sqliteTable('provider_configs', {
  provider: text('provider').primaryKey(),
  configEnc: text('config_enc').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const connections = sqliteTable(
  'connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalUserId: text('external_user_id').notNull(),
    displayName: text('display_name').notNull(),
    credentialsEnc: text('credentials_enc').notNull(),
    status: text('status', { enum: ['active', 'expiring', 'expired', 'error'] })
      .notNull()
      .default('active'),
    statusMessage: text('status_message'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [uniqueIndex('connections_user_provider_ext_idx').on(t.userId, t.provider, t.externalUserId)],
);

/** Canonical tracks, shared across users: the same recording is the same recording. */
export const tracks = sqliteTable(
  'tracks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    artists: text('artists', { mode: 'json' }).$type<string[]>().notNull(),
    album: text('album'),
    durationMs: integer('duration_ms'),
    isrc: text('isrc'),
    artworkUrl: text('artwork_url'),
    titleKey: text('title_key').notNull(),
    artistKey: text('artist_key').notNull(),
    versionTag: text('version_tag'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('tracks_isrc_idx').on(t.isrc),
    index('tracks_key_idx').on(t.titleKey, t.artistKey),
  ],
);

/** A provider's track id resolved to a canonical track. */
export const providerTracks = sqliteTable(
  'provider_tracks',
  {
    provider: text('provider').notNull(),
    providerTrackId: text('provider_track_id').notNull(),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    artists: text('artists', { mode: 'json' }).$type<string[]>().notNull(),
    album: text('album'),
    durationMs: integer('duration_ms'),
    isrc: text('isrc'),
    url: text('url'),
    artworkUrl: text('artwork_url'),
    method: text('method', { enum: ['source', 'isrc', 'search', 'manual'] }).notNull(),
    confidence: real('confidence').notNull().default(1),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerTrackId] }),
    index('provider_tracks_track_idx').on(t.trackId, t.provider),
  ],
);

/** Negative cache: we searched this provider for this track and found nothing usable. */
export const matchMisses = sqliteTable(
  'match_misses',
  {
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    candidates: text('candidates', { mode: 'json' }).$type<unknown[]>().notNull(),
    checkedAt: integer('checked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.provider] })],
);

export const playlists = sqliteTable(
  'playlists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind', { enum: ['playlist', 'liked'] }).notNull().default('playlist'),
    syncEnabled: integer('sync_enabled', { mode: 'boolean' }).notNull().default(true),
    scheduleMinutes: integer('schedule_minutes'),
    dedupeMode: text('dedupe_mode', { enum: ['strict', 'loose'] }),
    guardPercent: integer('guard_percent'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastRunAt: integer('last_run_at'),
  },
  (t) => [index('playlists_user_idx').on(t.userId)],
);

export const playlistEntries = sqliteTable(
  'playlist_entries',
  {
    id: text('id').primaryKey(),
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    position: real('position').notNull(),
    addedAt: integer('added_at').notNull(),
    addedFrom: text('added_from').notNull(),
    removedAt: integer('removed_at'),
    removedReason: text('removed_reason'),
    duplicateOfEntryId: text('duplicate_of_entry_id'),
  },
  (t) => [
    index('entries_playlist_idx').on(t.playlistId, t.removedAt),
    uniqueIndex('entries_playlist_track_idx').on(t.playlistId, t.trackId),
  ],
);

export const playlistLinks = sqliteTable(
  'playlist_links',
  {
    id: text('id').primaryKey(),
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerPlaylistId: text('provider_playlist_id').notNull(),
    name: text('name').notNull(),
    url: text('url'),
    direction: text('direction', { enum: ['both', 'pull', 'push'] }).notNull().default('both'),
    /** Provider track ids present after the last successful sync; null before the first sync. */
    snapshot: text('snapshot', { mode: 'json' }).$type<string[] | null>(),
    trackCount: integer('track_count'),
    lastSyncedAt: integer('last_synced_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('links_playlist_idx').on(t.playlistId),
    uniqueIndex('links_connection_remote_idx').on(t.connectionId, t.providerPlaylistId),
  ],
);

export const reviewItems = sqliteTable(
  'review_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    provider: text('provider').notNull(),
    reason: text('reason', { enum: ['no_match', 'low_confidence', 'manual_remove'] }).notNull(),
    status: text('status', { enum: ['pending', 'resolved', 'ignored'] }).notNull().default('pending'),
    candidates: text('candidates', { mode: 'json' }).$type<unknown[]>().notNull(),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    index('review_user_status_idx').on(t.userId, t.status),
    uniqueIndex('review_unique_idx').on(t.playlistId, t.trackId, t.provider, t.reason),
  ],
);

export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    playlistId: text('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
    playlistName: text('playlist_name'),
    trigger: text('trigger', { enum: ['schedule', 'manual', 'api', 'link'] }).notNull(),
    status: text('status', { enum: ['queued', 'running', 'success', 'partial', 'failed', 'guarded'] })
      .notNull()
      .default('queued'),
    dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false),
    overrideGuard: integer('override_guard', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    stats: text('stats', { mode: 'json' }).$type<Record<string, unknown>>(),
    log: text('log', { mode: 'json' }).$type<{ t: number; level: string; msg: string }[]>(),
    error: text('error'),
  },
  (t) => [
    index('runs_user_created_idx').on(t.userId, t.createdAt),
    index('runs_playlist_created_idx').on(t.playlistId, t.createdAt),
  ],
);

export const runChanges = sqliteTable(
  'run_changes',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    provider: text('provider'),
    trackId: text('track_id'),
    detail: text('detail'),
    position: real('position'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('changes_run_idx').on(t.runId)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull().default('queued'),
    /** Only one queued/running job per key (e.g. one sync per playlist). */
    dedupeKey: text('dedupe_key'),
    runAt: integer('run_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lockedUntil: integer('locked_until'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('jobs_status_run_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_active_dedupe_idx')
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('queued', 'running') and ${t.dedupeKey} is not null`),
  ],
);

export const webhooks = sqliteTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secretEnc: text('secret_enc').notNull(),
    events: text('events', { mode: 'json' }).$type<string[]>().notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
    lastDeliveryAt: integer('last_delivery_at'),
  },
  (t) => [index('webhooks_user_idx').on(t.userId)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

/** OAuth `state` values in flight. */
export const oauthStates = sqliteTable('oauth_states', {
  state: text('state').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  verifier: text('verifier'),
  createdAt: integer('created_at').notNull(),
});

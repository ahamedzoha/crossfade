import type { ProviderId } from './providers.js';

/** Epoch milliseconds. */
export type Millis = number;

export type Role = 'admin' | 'member';

export interface Me {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface SessionStatus {
  needsSetup: boolean;
  authenticated: boolean;
  user: Me | null;
  trustedHeader: boolean;
}

export interface UserSummary extends Me {
  createdAt: Millis;
  connectionCount: number;
  playlistCount: number;
}

// ---------------------------------------------------------------------------
// Providers & connections

export interface ProviderField {
  key: string;
  label: string;
  kind: 'text' | 'secret' | 'textarea';
  required: boolean;
  help?: string;
  placeholder?: string;
}

export interface ProviderSetup {
  provider: ProviderId;
  configured: boolean;
  /** Fields the instance admin fills in. Values for secrets are never returned. */
  fields: ProviderField[];
  values: Record<string, string>;
  /** Fields set through environment variables (read-only in the UI). */
  envLocked: string[];
  redirectUri: string | null;
  /** When true the redirect URI is not HTTPS/loopback, so OAuth uses the paste-back flow. */
  manualRedirect: boolean;
  instructions: string[];
}

export type ConnectionStatus = 'active' | 'expiring' | 'expired' | 'error';

export interface Connection {
  id: string;
  provider: ProviderId;
  /** Apple only: `key` (official MusicKit, add-only) or `web` (web-player session, can remove). */
  authMode: 'key' | 'web' | null;
  displayName: string;
  externalUserId: string;
  status: ConnectionStatus;
  statusMessage: string | null;
  expiresAt: Millis | null;
  createdAt: Millis;
  lastUsedAt: Millis | null;
}

export interface RemotePlaylist {
  id: string;
  /** `liked`: the account's Liked Songs / Liked Music / Favorite Songs collection. */
  kind: 'liked' | 'playlist';
  name: string;
  trackCount: number | null;
  editable: boolean;
  url: string | null;
  imageUrl: string | null;
  /** Canonical playlist this remote playlist is already linked to, if any. */
  linkedPlaylistId: string | null;
}

// ---------------------------------------------------------------------------
// Tracks

export interface TrackLink {
  provider: ProviderId;
  id: string;
  url: string | null;
  method: MatchMethod;
  confidence: number;
}

export type MatchMethod = 'source' | 'isrc' | 'search' | 'manual';

export interface Track {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  /** Square cover art, from whichever service had it first. */
  artworkUrl: string | null;
  links: TrackLink[];
}

// ---------------------------------------------------------------------------
// Canonical playlists

export type PlaylistKind = 'playlist' | 'liked';
export type LinkDirection = 'both' | 'pull' | 'push';
export type DedupeMode = 'strict' | 'loose';

export interface PlaylistLink {
  id: string;
  connectionId: string;
  provider: ProviderId;
  providerPlaylistId: string;
  name: string;
  url: string | null;
  direction: LinkDirection;
  trackCount: number | null;
  lastSyncedAt: Millis | null;
  lastError: string | null;
}

export type EntryAvailability = 'present' | 'missing' | 'review' | 'pending_remove';

export interface PlaylistEntry {
  id: string;
  position: number;
  track: Track;
  addedAt: Millis;
  addedFrom: string;
  removedAt: Millis | null;
  removedReason: string | null;
  duplicateOfEntryId: string | null;
  availability: Partial<Record<ProviderId, EntryAvailability>>;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  kind: PlaylistKind;
  syncEnabled: boolean;
  scheduleMinutes: number | null;
  effectiveScheduleMinutes: number;
  dedupeMode: DedupeMode;
  guardPercent: number;
  trackCount: number;
  totalDurationMs: number;
  links: PlaylistLink[];
  reviewCount: number;
  lastRun: RunSummary | null;
  nextRunAt: Millis | null;
  createdAt: Millis;
  updatedAt: Millis;
}

export interface PlaylistDetail extends PlaylistSummary {
  entries: PlaylistEntry[];
  removed: PlaylistEntry[];
}

// ---------------------------------------------------------------------------
// Runs

export type RunTrigger = 'schedule' | 'manual' | 'api' | 'link';
export type RunStatus = 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'guarded';

export interface ProviderPushStats {
  added: number;
  removed: number;
  failed: number;
  manual: number;
  /** Tracks not matched yet because of the per-run search budget or a rate limit; next run continues. */
  pending?: number;
}

export interface RunStats {
  added: number;
  removed: number;
  deduped: number;
  review: number;
  unchanged: number;
  trackCount: number;
  push: Partial<Record<ProviderId, ProviderPushStats>>;
  guard?: { removals: number; total: number; percent: number; limit: number } | null;
}

export interface RunSummary {
  id: string;
  playlistId: string | null;
  playlistName: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  dryRun: boolean;
  createdAt: Millis;
  startedAt: Millis | null;
  finishedAt: Millis | null;
  durationMs: number | null;
  stats: RunStats | null;
  error: string | null;
}

export type ChangeAction =
  | 'added'
  | 'removed'
  | 'deduped'
  | 'restored'
  | 'review'
  | 'pushed_add'
  | 'pushed_remove'
  | 'push_failed'
  | 'manual_remove';

export interface RunChange {
  id: string;
  action: ChangeAction;
  provider: ProviderId | null;
  track: Track | null;
  detail: string | null;
  position: number | null;
}

export interface RunLogLine {
  t: Millis;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface RunDetail extends RunSummary {
  changes: RunChange[];
  log: RunLogLine[];
}

// ---------------------------------------------------------------------------
// Review

export type ReviewReason = 'no_match' | 'low_confidence' | 'manual_remove';

export interface MatchCandidate {
  providerTrackId: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  url: string | null;
  imageUrl?: string | null;
  score: number;
}

export interface ReviewItem {
  id: string;
  playlistId: string;
  playlistName: string;
  provider: ProviderId;
  reason: ReviewReason;
  track: Track;
  candidates: MatchCandidate[];
  currentMatch: MatchCandidate | null;
  createdAt: Millis;
}

// ---------------------------------------------------------------------------
// API keys & webhooks

export type ApiScope = 'read' | 'write';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: Millis;
  lastUsedAt: Millis | null;
}

export interface ApiKeyCreated extends ApiKey {
  /** Shown exactly once. */
  token: string;
}

export const WEBHOOK_EVENTS = [
  'run.finished',
  'run.failed',
  'run.guarded',
  'playlist.changed',
  'review.created',
  'connection.expired',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: Millis;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: Millis | null;
}

export interface WebhookCreated extends Webhook {
  /** HMAC-SHA256 signing secret. Shown exactly once. */
  secret: string;
}

// ---------------------------------------------------------------------------
// Settings & overview

export interface InstanceSettings {
  defaultScheduleMinutes: number;
  guardPercent: number;
  autoAcceptScore: number;
  reviewScore: number;
  dedupeMode: DedupeMode;
  appUrl: string;
  version: string;
}

export type Health = 'ok' | 'attention' | 'error' | 'idle';

/** One thing that needs a person, with where to go to deal with it. */
export interface HealthReason {
  level: 'attention' | 'error';
  text: string;
  href: string;
  action: string;
}

export interface Overview {
  health: Health;
  healthReasons: HealthReason[];
  nextSyncAt: Millis | null;
  playlistCount: number;
  syncedPlaylistCount: number;
  trackCount: number;
  reviewCount: number;
  dedupedThisWeek: number;
  connections: Connection[];
  recentRuns: RunSummary[];
  lastRun: RunDetail | null;
  activeRuns: RunSummary[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

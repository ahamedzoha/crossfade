import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ChangeAction,
  PROVIDER_META,
  type ProviderId,
  type ProviderPushStats,
  type RunStats,
  type RunStatus,
} from '@crossfade/shared';
import { and, eq, inArray, max } from 'drizzle-orm';
import { setTimeout as sleep } from 'node:timers/promises';
import { AuthExpiredError, errorMessage, ProviderHttpError, UnsupportedError } from '../common/errors.js';
import { newId } from '../common/ids.js';
import { DB, type Db } from '../db/db.js';
import {
  connections,
  playlistEntries,
  playlistLinks,
  playlists,
  reviewItems,
  runChanges,
  syncRuns,
} from '../db/schema.js';
import { TracksService } from '../library/tracks.service.js';
import { MatchService } from '../matching/match.service.js';
import { LIKED_ID, type ProviderClient, type RemoteTrack } from '../providers/provider.types.js';
import { ProvidersService } from '../providers/providers.service.js';
import { SettingsService } from '../settings/settings.service.js';

type LinkRow = typeof playlistLinks.$inferSelect;
type ConnectionRow = typeof connections.$inferSelect;
type PlaylistRow = typeof playlists.$inferSelect;
type EntryRow = typeof playlistEntries.$inferSelect;

interface LinkState {
  link: LinkRow;
  conn: ConnectionRow;
  provider: ProviderId;
  client: ProviderClient;
  liked: boolean;
  current: string[];
  pidToTrack: Map<string, string>;
  failed: string | null;
  wrote: boolean;
}

interface ModelEntry {
  entryId: string | null;
  trackId: string;
  position: number;
  removedAt: number | null;
  removedReason: string | null;
  duplicateOf: string | null;
  addedFrom: string;
  dirty: boolean;
}

interface Change {
  action: ChangeAction;
  provider: ProviderId | null;
  trackId: string | null;
  detail: string | null;
  position: number | null;
}

export interface SyncOptions {
  dryRun: boolean;
  overrideGuard: boolean;
}

export interface SyncOutcome {
  status: RunStatus;
  stats: RunStats;
  error: string | null;
  changedCanonical: boolean;
  newReviews: number;
  /** Connections this run found signed out. */
  expired: { connectionId: string; userId: string; provider: ProviderId }[];
}

/** Per-run log buffered in memory and flushed to the run row. */
export class RunLog {
  readonly lines: { t: number; level: 'info' | 'warn' | 'error'; msg: string }[] = [];
  /** Connections this run found signed out. Per run, because the engine is shared. */
  readonly expired: { connectionId: string; userId: string; provider: ProviderId }[] = [];
  private lastFlush = 0;
  constructor(private readonly flush: (lines: RunLog['lines']) => void) {}
  info(msg: string) {
    this.push('info', msg);
  }
  warn(msg: string) {
    this.push('warn', msg);
  }
  error(msg: string) {
    this.push('error', msg);
  }
  private push(level: 'info' | 'warn' | 'error', msg: string) {
    this.lines.push({ t: Date.now(), level, msg });
    if (Date.now() - this.lastFlush > 2000) this.save();
  }
  save() {
    this.lastFlush = Date.now();
    this.flush(this.lines);
  }
}

const name = (p: ProviderId) => PROVIDER_META[p].name;

/** New searches per service per run. Big first merges finish over a few runs instead of tripping rate limits. */
const SEARCH_BUDGET = 150;
const SEARCH_PAUSE_MS = 250;

/**
 * Two-way merge for one canonical playlist:
 *  1. pull every linked service and diff it against its last snapshot,
 *  2. apply adds/removes to the canonical list (adds win), guarded against mass deletion,
 *  3. collapse duplicates,
 *  4. push the canonical list back out to every service,
 *  5. re-snapshot so the next run only sees what users changed.
 */
@Injectable()
export class SyncEngine {
  private readonly logger = new Logger(SyncEngine.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tracks: TracksService,
    private readonly matcher: MatchService,
    private readonly providers: ProvidersService,
    private readonly settings: SettingsService,
  ) {}

  async sync(playlist: PlaylistRow, runId: string, opts: SyncOptions, log: RunLog): Promise<SyncOutcome> {
    const outcome = await this.run(playlist, runId, opts, log);
    return { ...outcome, expired: log.expired };
  }

  private async run(playlist: PlaylistRow, runId: string, opts: SyncOptions, log: RunLog): Promise<Omit<SyncOutcome, 'expired'>> {
    const instance = this.settings.get();
    const guardPercent = playlist.guardPercent ?? instance.guardPercent;
    const dedupeMode = playlist.dedupeMode ?? instance.dedupeMode;
    const changes: Change[] = [];
    const stats: RunStats = {
      added: 0,
      removed: 0,
      deduped: 0,
      review: 0,
      unchanged: 0,
      trackCount: 0,
      push: {},
      guard: null,
    };
    let newReviews = 0;

    const linkRows = this.db
      .select({ link: playlistLinks, conn: connections })
      .from(playlistLinks)
      .innerJoin(connections, eq(playlistLinks.connectionId, connections.id))
      .where(eq(playlistLinks.playlistId, playlist.id))
      .all();

    if (linkRows.length === 0) {
      log.warn('No services linked to this playlist yet.');
      return { status: 'success', stats, error: null, changedCanonical: false, newReviews };
    }
    if (opts.dryRun) log.info('Dry run: nothing will be written to your services or the canonical list.');

    // ---------------------------------------------------------------- 1. pull
    const states: LinkState[] = [];
    for (const { link, conn } of linkRows) {
      const provider = link.provider as ProviderId;
      const state: LinkState = {
        link,
        conn,
        provider,
        client: this.providers.clientFor(conn),
        // A link to a service's Liked/Favorites collection, in any canonical playlist.
        liked: link.providerPlaylistId === LIKED_ID || playlist.kind === 'liked',
        current: [],
        pidToTrack: new Map(),
        failed: null,
        wrote: false,
      };
      states.push(state);
      if (conn.status === 'expired') {
        state.failed = `${name(provider)} connection expired`;
        log.warn(`${state.failed}; skipping ${link.name}. Reconnect it under Connections.`);
        continue;
      }
      try {
        const remote = await this.fetch(state);
        for (const t of remote) {
          state.current.push(t.id);
          if (!state.pidToTrack.has(t.id)) state.pidToTrack.set(t.id, this.tracks.resolve(provider, t));
        }
        this.providers.touch(conn.id);
        log.info(`Read ${remote.length} tracks from ${name(provider)} · ${link.name}`);
      } catch (err) {
        this.fail(state, err, log);
      }
    }

    const healthy = states.filter((s) => !s.failed);
    if (healthy.length === 0) {
      return { status: 'failed', stats, error: 'Every linked service failed to load', changedCanonical: false, newReviews };
    }

    // ---------------------------------------------------------------- 2. deltas
    const adds = new Map<string, { provider: ProviderId; initial: boolean }>();
    const removes = new Map<string, Set<ProviderId>>();
    let suspicious: string | null = null;

    for (const s of healthy) {
      if (s.link.direction === 'push') continue;
      const canonNow = new Set(s.pidToTrack.values());
      const snapshot = s.link.snapshot;
      if (!snapshot) {
        for (const pid of s.current) {
          const t = s.pidToTrack.get(pid)!;
          if (!adds.has(t)) adds.set(t, { provider: s.provider, initial: true });
        }
        continue;
      }
      if (snapshot.length >= 5 && s.current.length === 0) {
        suspicious = `${name(s.provider)} returned an empty list for ${s.link.name} (had ${snapshot.length})`;
      }
      const snapSet = new Set(snapshot);
      const curSet = new Set(s.current);
      for (const pid of curSet) {
        if (snapSet.has(pid)) continue;
        const t = s.pidToTrack.get(pid)!;
        adds.set(t, { provider: s.provider, initial: false });
      }
      const gone = [...snapSet].filter((pid) => !curSet.has(pid));
      const goneMap = this.tracks.lookupMany(s.provider, gone);
      for (const pid of gone) {
        const t = goneMap.get(pid);
        if (!t || canonNow.has(t)) continue; // still there under another id
        const set = removes.get(t) ?? new Set<ProviderId>();
        set.add(s.provider);
        removes.set(t, set);
      }
    }

    // ---------------------------------------------------------------- 3. canonical model
    const model = this.loadModel(playlist.id);
    const byTrack = new Map(model.map((m) => [m.trackId, m]));
    const activeBefore = model.filter((m) => !m.removedAt).length;
    let nextPos = Math.max(0, ...model.map((m) => m.position)) + 1;

    const plannedRemovals = [...removes.entries()].filter(([t]) => {
      const m = byTrack.get(t);
      return m && !m.removedAt && !adds.has(t);
    });

    // Mass-deletion guard: refuse to propagate a wipe that is probably an API glitch.
    const removalPct = activeBefore ? Math.round((plannedRemovals.length / activeBefore) * 100) : 0;
    stats.guard = { removals: plannedRemovals.length, total: activeBefore, percent: removalPct, limit: guardPercent };
    if (!opts.overrideGuard && (suspicious || (plannedRemovals.length >= 3 && removalPct > guardPercent))) {
      const why =
        suspicious ??
        `would remove ${plannedRemovals.length} of ${activeBefore} tracks (${removalPct}%), over the ${guardPercent}% limit`;
      log.warn(`Guard stopped this run: ${why}. Nothing was changed. Review and run again with the guard overridden if intended.`);
      for (const [t, provs] of plannedRemovals) {
        changes.push({
          action: 'removed',
          provider: [...provs][0] ?? null,
          trackId: t,
          detail: `would be removed (removed on ${[...provs].map(name).join(', ')})`,
          position: byTrack.get(t)?.position ?? null,
        });
      }
      this.saveChanges(runId, changes);
      stats.trackCount = activeBefore;
      return { status: 'guarded', stats, error: `Guard: ${why}`, changedCanonical: false, newReviews };
    }

    // Initial import order: keep each service's own order, first link first.
    for (const s of healthy) {
      for (const pid of s.current) {
        const t = s.pidToTrack.get(pid)!;
        const add = adds.get(t);
        if (!add || add.provider !== s.provider) continue;
        const existing = byTrack.get(t);
        if (existing && !existing.removedAt) continue;
        if (existing) {
          // A tombstone only comes back when someone actively re-added it, not on first link.
          if (add.initial) continue;
          existing.removedAt = null;
          existing.removedReason = null;
          existing.duplicateOf = null;
          existing.position = nextPos++;
          existing.dirty = true;
          changes.push({ action: 'restored', provider: s.provider, trackId: t, detail: `re-added on ${name(s.provider)}`, position: existing.position });
        } else {
          const m: ModelEntry = {
            entryId: null,
            trackId: t,
            position: nextPos++,
            removedAt: null,
            removedReason: null,
            duplicateOf: null,
            addedFrom: s.provider,
            dirty: true,
          };
          model.push(m);
          byTrack.set(t, m);
          changes.push({ action: 'added', provider: s.provider, trackId: t, detail: `added on ${name(s.provider)}`, position: m.position });
        }
        stats.added++;
      }
    }

    const now = Date.now();
    for (const [t, provs] of plannedRemovals) {
      const m = byTrack.get(t)!;
      m.removedAt = now;
      m.removedReason = `removed:${[...provs].join(',')}`;
      m.dirty = true;
      stats.removed++;
      changes.push({
        action: 'removed',
        provider: [...provs][0] ?? null,
        trackId: t,
        detail: `removed on ${[...provs].map(name).join(', ')}`,
        position: m.position,
      });
    }

    // ---------------------------------------------------------------- 4. dedupe
    stats.deduped = this.dedupe(model, dedupeMode, changes);

    if (!opts.dryRun) this.persistModel(playlist.id, model);
    const changedCanonical = stats.added + stats.removed + stats.deduped > 0;

    // ---------------------------------------------------------------- 5. push
    let desired = model.filter((m) => !m.removedAt).sort((a, b) => a.position - b.position);
    stats.trackCount = desired.length;
    stats.unchanged = Math.max(0, desired.length - stats.added);

    for (const s of healthy) {
      if (s.link.direction === 'pull') continue;
      const push: ProviderPushStats = { added: 0, removed: 0, failed: 0, manual: 0 };
      stats.push[s.provider] = push;
      const caps = s.client.capabilities ?? PROVIDER_META[s.provider].capabilities;
      const canAdd = s.liked ? caps.likedAdd : true;
      const canRemove = s.liked ? caps.likedRemove : caps.removeTracks;

      // Find ids on this service for every desired track it doesn't hold yet.
      const present = new Set(s.pidToTrack.values());
      const toAdd: { pid: string; trackId: string }[] = [];
      let merged = false;
      if (canAdd) {
        let searches = 0;
        let throttled = false;
        for (const m of desired) {
          if (present.has(m.trackId)) continue;
          // Out of budget (or rate-limited): only use matches we already know; the rest wait for the next run.
          if ((throttled || searches >= SEARCH_BUDGET) && !this.tracks.providerLinks(m.trackId, s.provider).length) {
            push.pending = (push.pending ?? 0) + 1;
            continue;
          }
          try {
            const res = await this.matcher.ensure(s.client, m.trackId);
            if (res.searched) {
              searches++;
              await sleep(SEARCH_PAUSE_MS);
            }
            if (res.status === 'matched' && res.merged) merged = true;
            if (res.status === 'missing') {
              newReviews += this.upsertReview(playlist, m.trackId, s.provider, 'no_match', res.candidates);
              stats.review++;
              changes.push({ action: 'review', provider: s.provider, trackId: m.trackId, detail: `no confident match on ${name(s.provider)}`, position: m.position });
              continue;
            }
            if (res.lowConfidence) {
              newReviews += this.upsertReview(playlist, m.trackId, s.provider, 'low_confidence', res.candidates);
              stats.review++;
              changes.push({
                action: 'review',
                provider: s.provider,
                trackId: m.trackId,
                detail: `matched on ${name(s.provider)} at ${Math.round(res.confidence * 100)}%, please check`,
                position: m.position,
              });
            }
            if (!s.current.includes(res.providerTrackId)) toAdd.push({ pid: res.providerTrackId, trackId: m.trackId });
          } catch (err) {
            if (err instanceof AuthExpiredError) {
              this.fail(s, err, log);
              break;
            }
            if (err instanceof ProviderHttpError && err.status === 429) {
              if (!throttled) log.warn(`${name(s.provider)} is rate-limiting searches; pausing matching there until the next run`);
              throttled = true;
              push.pending = (push.pending ?? 0) + 1;
              continue;
            }
            push.failed++;
            log.warn(`Matching "${this.tracks.get(m.trackId)?.title ?? m.trackId}" on ${name(s.provider)} failed: ${errorMessage(err)}`);
          }
        }
      }
      if (push.pending) {
        log.info(`${name(s.provider)} · ${s.link.name}: ${push.pending} tracks still to match; the next runs continue`);
      }
      if (s.failed) continue;
      if (merged && !opts.dryRun) {
        desired = this.loadModel(playlist.id).filter((m) => !m.removedAt).sort((a, b) => a.position - b.position);
      }

      // What this service holds that the canonical list doesn't want (or holds twice).
      const desiredSet = new Set(desired.map((m) => m.trackId));
      const owner = this.tracks.lookupMany(s.provider, [...new Set(s.current)]);
      const seenTrack = new Set<string>();
      const counts = new Map<string, number>();
      for (const pid of s.current) counts.set(pid, (counts.get(pid) ?? 0) + 1);
      const toRemove: { pid: string; trackId: string | null; reason: string }[] = [];
      const reAdd: { pid: string; trackId: string }[] = [];
      // Likes are not a list: two liked versions of a song are harmless, and unliking is personal.
      // So a liked collection only loses a track the user actually removed somewhere (or struck here).
      const explicitlyRemoved = (t: string) => {
        const reason = byTrack.get(t)?.removedReason ?? '';
        return reason === 'manual' || reason.startsWith('removed:');
      };
      for (const pid of new Set(s.current)) {
        const t = owner.get(pid) ?? null;
        if (s.liked) {
          if (t && !desiredSet.has(t) && explicitlyRemoved(t)) toRemove.push({ pid, trackId: t, reason: 'unliked elsewhere' });
          continue;
        }
        if (!t || !desiredSet.has(t)) {
          toRemove.push({ pid, trackId: t, reason: 'not in canonical list' });
        } else if (seenTrack.has(t)) {
          toRemove.push({ pid, trackId: t, reason: 'duplicate on service' });
        } else {
          seenTrack.add(t);
          if ((counts.get(pid) ?? 1) > 1 && canRemove) {
            toRemove.push({ pid, trackId: t, reason: 'duplicate on service' });
            reAdd.push({ pid, trackId: t });
          }
        }
      }

      // Second guard, per service: never strip most of a service's playlist in one go.
      const removePct = s.current.length ? Math.round((toRemove.length / s.current.length) * 100) : 0;
      let removals = toRemove;
      if (!opts.overrideGuard && toRemove.length >= 5 && removePct > Math.max(guardPercent, 50)) {
        log.warn(
          `Skipped removing ${toRemove.length} of ${s.current.length} tracks from ${name(s.provider)} · ${s.link.name} (${removePct}%). Override the guard to apply.`,
        );
        removals = [];
        push.failed += toRemove.length;
      }

      const handOff = (list: typeof removals) => {
        for (const r of list) {
          if (!r.trackId) continue;
          push.manual++;
          newReviews += this.upsertReview(playlist, r.trackId, s.provider, 'manual_remove', []);
          changes.push({
            action: 'manual_remove',
            provider: s.provider,
            trackId: r.trackId,
            detail: `${name(s.provider)} can't remove via API: remove by hand`,
            position: byTrack.get(r.trackId)?.position ?? null,
          });
        }
      };
      if (removals.length && !canRemove) {
        handOff(removals);
        removals = [];
      }

      if (opts.dryRun) {
        for (const r of removals) changes.push({ action: 'pushed_remove', provider: s.provider, trackId: r.trackId, detail: r.reason, position: null });
        for (const a of toAdd) changes.push({ action: 'pushed_add', provider: s.provider, trackId: a.trackId, detail: null, position: byTrack.get(a.trackId)?.position ?? null });
        push.removed = removals.length;
        push.added = toAdd.length;
        continue;
      }

      try {
        if (removals.length) {
          const pids = removals.map((r) => r.pid);
          try {
            if (s.liked) await s.client.removeLiked(pids);
            else await s.client.removeTracks(s.link.providerPlaylistId, pids);
            s.wrote = true;
            push.removed = removals.length;
            for (const r of removals) changes.push({ action: 'pushed_remove', provider: s.provider, trackId: r.trackId, detail: r.reason, position: null });
          } catch (err) {
            // The service refused removals it normally allows (e.g. an Apple web session on a locked playlist):
            // list them for the user instead of failing the push.
            if (!(err instanceof UnsupportedError)) throw err;
            log.warn(`${name(s.provider)} · ${s.link.name}: ${err.message}; listed under Review → Remove by hand`);
            handOff(removals);
          }
        }
        const adding = [...reAdd, ...toAdd];
        if (adding.length) {
          const pids = adding.map((a) => a.pid);
          if (s.liked) await s.client.addLiked(pids);
          else await s.client.addTracks(s.link.providerPlaylistId, pids);
          s.wrote = true;
          push.added = toAdd.length;
          for (const a of toAdd) changes.push({ action: 'pushed_add', provider: s.provider, trackId: a.trackId, detail: null, position: byTrack.get(a.trackId)?.position ?? null });
        }
        if (removals.length || adding.length) {
          log.info(`${name(s.provider)} · ${s.link.name}: +${toAdd.length} −${removals.length}`);
        }
      } catch (err) {
        if (err instanceof UnsupportedError) {
          log.warn(err.message);
        } else {
          push.failed += toAdd.length + removals.length;
          this.fail(s, err, log);
          changes.push({ action: 'push_failed', provider: s.provider, trackId: null, detail: errorMessage(err), position: null });
        }
      }
    }

    // ---------------------------------------------------------------- 6. snapshot
    if (!opts.dryRun) {
      for (const s of states) {
        if (s.failed) continue;
        let snapshot = s.current;
        if (s.wrote) {
          try {
            snapshot = (await this.fetch(s)).map((t) => t.id);
          } catch (err) {
            log.warn(`Could not re-read ${name(s.provider)} after writing: ${errorMessage(err)}`);
          }
        }
        this.db
          .update(playlistLinks)
          .set({ snapshot, trackCount: snapshot.length, lastSyncedAt: Date.now(), lastError: null })
          .where(eq(playlistLinks.id, s.link.id))
          .run();
      }
      this.autoResolveReviews(playlist.id, desired.map((m) => m.trackId), states);
    }

    this.saveChanges(runId, changes);

    const anyFailed = states.some((s) => s.failed) || Object.values(stats.push).some((p) => p && p.failed > 0);
    const status: RunStatus = anyFailed ? 'partial' : 'success';
    const failures = states.filter((s) => s.failed).map((s) => s.failed);
    return { status, stats, error: failures.length ? failures.join('; ') : null, changedCanonical, newReviews };
  }

  // -------------------------------------------------------------------------

  private async fetch(s: LinkState): Promise<RemoteTrack[]> {
    return s.liked ? s.client.getLiked() : s.client.getPlaylistTracks(s.link.providerPlaylistId);
  }

  private fail(s: LinkState, err: unknown, log: RunLog) {
    const msg = errorMessage(err);
    if (err instanceof AuthExpiredError) {
      this.providers.markStatus(s.conn.id, 'expired', msg);
      if (!log.expired.some((e) => e.connectionId === s.conn.id)) {
        log.expired.push({ connectionId: s.conn.id, userId: s.conn.userId, provider: s.provider });
      }
      s.failed = `${name(s.provider)}: ${msg}`;
    } else {
      s.failed = `${name(s.provider)} · ${s.link.name}: ${msg}`;
    }
    log.error(s.failed);
    this.db.update(playlistLinks).set({ lastError: msg }).where(eq(playlistLinks.id, s.link.id)).run();
  }

  private loadModel(playlistId: string): ModelEntry[] {
    return this.db
      .select()
      .from(playlistEntries)
      .where(eq(playlistEntries.playlistId, playlistId))
      .all()
      .map((e: EntryRow) => ({
        entryId: e.id,
        trackId: e.trackId,
        position: e.position,
        removedAt: e.removedAt,
        removedReason: e.removedReason,
        duplicateOf: e.duplicateOfEntryId,
        addedFrom: e.addedFrom,
        dirty: false,
      }));
  }

  /** Collapse duplicates in place; the earliest entry wins. Returns how many were removed. */
  private dedupe(model: ModelEntry[], mode: 'strict' | 'loose', changes: Change[]): number {
    const active = model.filter((m) => !m.removedAt).sort((a, b) => a.position - b.position);
    const rows = this.tracks.getMany(active.map((m) => m.trackId));
    const byIsrc = new Map<string, ModelEntry>();
    const byKey = new Map<string, ModelEntry[]>();
    let removed = 0;
    for (const m of active) {
      const t = rows.get(m.trackId);
      if (!t) continue;
      let keeper: ModelEntry | undefined;
      if (t.isrc) keeper = byIsrc.get(t.isrc);
      const key = `${t.titleKey}|${t.artistKey}|${t.versionTag ?? ''}`;
      if (!keeper) {
        keeper = (byKey.get(key) ?? []).find((k) => {
          const kt = rows.get(k.trackId);
          if (!kt) return false;
          if (kt.isrc && t.isrc && kt.isrc !== t.isrc && mode === 'strict') {
            // Different ISRCs under one title: a remaster. Strict mode still folds it when lengths agree.
            return !!kt.durationMs && !!t.durationMs && Math.abs(kt.durationMs - t.durationMs) <= 6000;
          }
          if (mode === 'loose') return true;
          return !kt.durationMs || !t.durationMs || Math.abs(kt.durationMs - t.durationMs) <= 6000;
        });
      }
      if (keeper) {
        const kt = rows.get(keeper.trackId)!;
        m.removedAt = Date.now();
        m.removedReason = 'duplicate';
        m.duplicateOf = keeper.entryId ?? `pending:${keeper.trackId}`;
        m.dirty = true;
        removed++;
        changes.push({
          action: 'deduped',
          provider: null,
          trackId: m.trackId,
          detail: `duplicate of ${kt.title}; kept the earlier one`,
          position: m.position,
        });
        continue;
      }
      if (t.isrc) byIsrc.set(t.isrc, m);
      byKey.set(key, [...(byKey.get(key) ?? []), m]);
    }
    return removed;
  }

  private persistModel(playlistId: string, model: ModelEntry[]) {
    const dirty = model.filter((m) => m.dirty);
    if (!dirty.length) return;
    this.db.transaction((tx) => {
      const idByTrack = new Map<string, string>();
      for (const m of model) if (m.entryId) idByTrack.set(m.trackId, m.entryId);
      for (const m of dirty) {
        if (!m.entryId) {
          m.entryId = newId('en');
          idByTrack.set(m.trackId, m.entryId);
          tx.insert(playlistEntries)
            .values({
              id: m.entryId,
              playlistId,
              trackId: m.trackId,
              position: m.position,
              addedAt: Date.now(),
              addedFrom: m.addedFrom,
              removedAt: m.removedAt,
              removedReason: m.removedReason,
              duplicateOfEntryId: null,
            })
            .run();
        }
      }
      for (const m of dirty) {
        const dup = m.duplicateOf?.startsWith('pending:') ? (idByTrack.get(m.duplicateOf.slice(8)) ?? null) : m.duplicateOf;
        tx.update(playlistEntries)
          .set({ position: m.position, removedAt: m.removedAt, removedReason: m.removedReason, duplicateOfEntryId: dup })
          .where(eq(playlistEntries.id, m.entryId!))
          .run();
      }
      tx.update(playlists).set({ updatedAt: Date.now() }).where(eq(playlists.id, playlistId)).run();
    });
  }

  /** Returns 1 when a new pending item was created. */
  private upsertReview(
    playlist: PlaylistRow,
    trackId: string,
    provider: ProviderId,
    reason: 'no_match' | 'low_confidence' | 'manual_remove',
    candidates: unknown[],
  ): number {
    const existing = this.db
      .select()
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.playlistId, playlist.id),
          eq(reviewItems.trackId, trackId),
          eq(reviewItems.provider, provider),
          eq(reviewItems.reason, reason),
        ),
      )
      .get();
    if (existing) {
      if (existing.status === 'pending' && candidates.length) {
        this.db.update(reviewItems).set({ candidates }).where(eq(reviewItems.id, existing.id)).run();
      }
      return 0;
    }
    this.db
      .insert(reviewItems)
      .values({
        id: newId('rv'),
        userId: playlist.userId,
        playlistId: playlist.id,
        trackId,
        provider,
        reason,
        status: 'pending',
        candidates,
        createdAt: Date.now(),
      })
      .run();
    return 1;
  }

  private autoResolveReviews(playlistId: string, activeTrackIds: string[], states: LinkState[]) {
    const pending = this.db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.playlistId, playlistId), eq(reviewItems.status, 'pending')))
      .all();
    if (!pending.length) return;
    const active = new Set(activeTrackIds);
    const held = new Map<ProviderId, Set<string>>();
    for (const s of states) {
      if (s.failed) continue;
      const set = held.get(s.provider) ?? new Set<string>();
      for (const t of this.tracks.lookupMany(s.provider, s.current).values()) set.add(t);
      held.set(s.provider, set);
    }
    const resolved: string[] = [];
    for (const r of pending) {
      const provider = r.provider as ProviderId;
      const has = held.get(provider);
      if (r.reason === 'manual_remove') {
        if (active.has(r.trackId) || (has && !has.has(r.trackId))) resolved.push(r.id);
      } else if (!active.has(r.trackId)) {
        resolved.push(r.id);
      } else if (r.reason === 'no_match' && has?.has(r.trackId)) {
        resolved.push(r.id);
      }
    }
    if (resolved.length) {
      this.db
        .update(reviewItems)
        .set({ status: 'resolved', resolvedAt: Date.now() })
        .where(inArray(reviewItems.id, resolved))
        .run();
    }
  }

  private saveChanges(runId: string, changes: Change[]) {
    if (!changes.length) return;
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const c of changes) {
        tx.insert(runChanges)
          .values({ id: newId('ch'), runId, action: c.action, provider: c.provider, trackId: c.trackId, detail: c.detail, position: c.position, createdAt: now })
          .run();
      }
    });
  }

  /** Highest position currently used in a playlist. */
  maxPosition(playlistId: string): number {
    return (
      this.db
        .select({ m: max(playlistEntries.position) })
        .from(playlistEntries)
        .where(eq(playlistEntries.playlistId, playlistId))
        .get()?.m ?? 0
    );
  }

  /** Mark the run row finished. Exposed so the service and tests share one path. */
  finish(runId: string, outcome: SyncOutcome, log: RunLog) {
    this.db
      .update(syncRuns)
      .set({
        status: outcome.status,
        finishedAt: Date.now(),
        stats: outcome.stats as unknown as Record<string, unknown>,
        error: outcome.error,
        log: log.lines,
      })
      .where(eq(syncRuns.id, runId))
      .run();
  }
}

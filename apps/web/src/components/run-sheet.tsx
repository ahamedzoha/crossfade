'use client';

import { type PlaylistEntry, PROVIDERS, type ProviderId, type RunChange, type RunDetail } from '@crossfade/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { plural, runTime, when } from '@/lib/format';
import { serviceName } from '@/lib/services';
import { Ruler, SetlistHead, SetlistRow } from './setlist';
import { Tape, TapeCorners } from './tape';

const CANONICAL = new Set(['added', 'restored', 'removed', 'deduped', 'review', 'manual_remove']);
const PRIORITY: Record<string, number> = { removed: 5, deduped: 5, added: 4, restored: 4, review: 2, manual_remove: 1 };

interface ChangeRow {
  key: string;
  trackId: string;
  position: number | null;
  primary: RunChange;
  all: RunChange[];
}

/** Collapse a run's change log into one row per track, most important change first. */
export function changeRows(changes: RunChange[]): ChangeRow[] {
  const byTrack = new Map<string, ChangeRow>();
  for (const c of changes) {
    if (!c.track) continue;
    const row = byTrack.get(c.track.id) ?? { key: c.id, trackId: c.track.id, position: c.position, primary: c, all: [] };
    row.all.push(c);
    if (CANONICAL.has(c.action) && (PRIORITY[c.action] ?? 0) > (PRIORITY[row.primary.action] ?? 0)) row.primary = c;
    if (row.position == null && c.position != null) row.position = c.position;
    byTrack.set(c.track.id, row);
  }
  return [...byTrack.values()]
    .filter((r) => r.all.some((c) => CANONICAL.has(c.action)))
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
}

const isStruck = (r: ChangeRow) => r.primary.action === 'removed' || r.primary.action === 'deduped';

function changeNote(row: ChangeRow) {
  const p = row.primary;
  const pushedTo = new Set(row.all.filter((c) => c.action === 'pushed_add').map((c) => c.provider));
  const manual = row.all.find((c) => c.action === 'manual_remove');
  const review = row.all.find((c) => c.action === 'review');
  switch (p.action) {
    case 'added':
    case 'restored':
      return (
        <>
          {p.detail}
          {pushedTo.size ? ` · pushed to ${pushedTo.size === 1 ? serviceName([...pushedTo][0] as ProviderId) : `${pushedTo.size} others`}` : ''}
          {review ? (
            <>
              {' · '}
              <mark>{review.detail}</mark>
            </>
          ) : null}
        </>
      );
    case 'removed':
      return (
        <>
          {p.detail}
          {manual ? (
            <>
              {' · '}
              <mark>{serviceName(manual.provider as ProviderId)}: remove by hand</mark>
            </>
          ) : null}
        </>
      );
    case 'review':
    case 'manual_remove':
      return <mark>{p.detail}</mark>;
    default:
      return p.detail;
  }
}

function changeTabs(row: ChangeRow, linked: ProviderId[]) {
  const held = new Set(row.all[0]?.track?.links.map((l) => l.provider));
  const stillOn = new Set(row.all.filter((c) => c.action === 'manual_remove').map((c) => c.provider));
  const review = new Set(row.all.filter((c) => c.action === 'review').map((c) => c.provider));
  return linked.map((p) => {
    if (isStruck(row)) {
      return stillOn.has(p) ? <Tape key={p} provider={p} title={`Still on ${serviceName(p)}`} /> : <Tape key={p} kind="missing" title={`Gone from ${serviceName(p)}`} />;
    }
    if (review.has(p)) return <Tape key={p} kind="warn" title={`${serviceName(p)}: needs review`}>Review</Tape>;
    return held.has(p) ? <Tape key={p} provider={p} /> : <Tape key={p} kind="missing" title={`Not on ${serviceName(p)}`} />;
  });
}

function entryTabs(e: PlaylistEntry, linked: ProviderId[]) {
  return linked.map((p) => {
    const a = e.availability[p];
    if (a === 'present') return <Tape key={p} provider={p} />;
    if (a === 'review') return <Tape key={p} kind="warn" title={`${serviceName(p)}: needs review`}>Review</Tape>;
    return <Tape key={p} kind="missing" title={`Not on ${serviceName(p)} yet`} />;
  });
}

/** Guide words: the first and last row title in view, like a dictionary's running head. */
export function useGuideWords(container: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [words, setWords] = useState<[string, string] | null>(null);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const rows = [...el.querySelectorAll<HTMLElement>('[data-row-title]')];
    if (!rows.length) return setWords(null);
    const visible = new Set<HTMLElement>();
    const update = () => {
      const inView = rows.filter((r) => visible.has(r));
      const first = inView[0] ?? rows[0]!;
      const last = inView[inView.length - 1] ?? rows[rows.length - 1]!;
      setWords([first.dataset.rowTitle ?? '', last.dataset.rowTitle ?? '']);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.isIntersecting ? visible.add(e.target as HTMLElement) : visible.delete(e.target as HTMLElement);
        update();
      },
      { threshold: 0.6 },
    );
    rows.forEach((r) => io.observe(r));
    update();
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return words;
}

interface SheetRow {
  key: string;
  trackId: string;
  art: string | null;
  title: string;
  sub: string;
  durationMs: number | null;
  num: number | null;
  position: number;
  change: ChangeRow | null;
  entry: PlaylistEntry | null;
}

/**
 * A run drawn as the setlist it changed.
 * `window`: a stretch of the playlist around the changes, unchanged rows as context (overview).
 * `changes`: only the changed rows (run detail).
 */
export function RunSheet({
  run,
  linked,
  context,
  mode = 'window',
  limit = 14,
  tilt = true,
  label = 'Last run',
  showRunLink = true,
}: {
  run: RunDetail;
  linked: ProviderId[];
  /** The playlist's current active entries, for numbering and context rows. */
  context?: PlaylistEntry[];
  mode?: 'window' | 'changes';
  limit?: number;
  tilt?: boolean;
  label?: string;
  showRunLink?: boolean;
}) {
  const changes = changeRows(run.changes);
  const services = PROVIDERS.filter((p) => linked.includes(p));
  const indexByTrack = new Map((context ?? []).map((e, i) => [e.track.id, i + 1]));

  const fromChange = (c: ChangeRow): SheetRow => {
    const t = c.all[0]!.track!;
    return {
      key: c.key,
      trackId: c.trackId,
      art: t.artworkUrl,
      title: t.title,
      sub: t.artists.join(', '),
      durationMs: t.durationMs,
      num: isStruck(c) ? null : (indexByTrack.get(c.trackId) ?? null),
      position: c.position ?? Number.MAX_SAFE_INTEGER,
      change: c,
      entry: null,
    };
  };

  let rows: SheetRow[];
  let windowNote: string | null = null;
  if (context && mode === 'window') {
    const byTrack = new Map(changes.map((c) => [c.trackId, c]));
    const merged: SheetRow[] = [
      ...context.map((e, i) => ({
        key: e.id,
        trackId: e.track.id,
        art: e.track.artworkUrl,
        title: e.track.title,
        sub: e.track.artists.join(', '),
        durationMs: e.track.durationMs,
        num: i + 1,
        position: e.position,
        change: byTrack.get(e.track.id) ?? null,
        entry: e,
      })),
      ...changes.filter((c) => isStruck(c) || !indexByTrack.has(c.trackId)).map(fromChange),
    ].sort((a, b) => a.position - b.position);
    const changed = merged.flatMap((r, i) => (r.change ? [i] : []));
    const first = changed[0] ?? 0;
    const last = changed[changed.length - 1] ?? 0;
    if (changed.length && last - first + 1 > limit) {
      rows = changes.slice(0, limit).map(fromChange);
      windowNote = `${Math.min(limit, changes.length)} of ${plural(changes.length, 'change')} shown`;
    } else {
      const start = Math.max(0, Math.min(first - 2, merged.length - limit));
      rows = merged.slice(start, start + limit);
      const shownChanges = rows.filter((r) => r.change).length;
      const firstNum = rows.find((r) => r.num)?.num;
      const lastNum = [...rows].reverse().find((r) => r.num)?.num;
      windowNote =
        `${firstNum && lastNum ? `Tracks ${firstNum}–${lastNum} of ${context.length}` : plural(context.length, 'track')}` +
        (changes.length ? ` · ${shownChanges === changes.length ? `all ${plural(changes.length, 'change')}` : `${shownChanges} of ${changes.length} changes`} in view` : '');
    }
  } else {
    rows = changes.slice(0, Number.isFinite(limit) ? limit : undefined).map(fromChange);
    windowNote = changes.length > rows.length ? `${rows.length} of ${plural(changes.length, 'change')} shown` : changes.length ? `All ${plural(changes.length, 'change')}` : null;
  }

  const ref = useRef<HTMLDivElement>(null);
  const guide = useGuideWords(ref, [run.id, rows.length]);
  const s = run.stats;
  const fresh = !!run.finishedAt && Date.now() - run.finishedAt < 10 * 60_000;
  const scaleMax = Math.max(60_000, Math.ceil((run.durationMs ?? 0) / 60_000) * 60_000);
  let strikeN = 0;

  return (
    <section className={`sheet ${tilt ? 'sheet-tilt' : ''} px-4 pt-6 sm:px-[22px]`} aria-label={`${label} of ${run.playlistName}`}>
      <TapeCorners />
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px] text-n4">
        <span>
          {run.dryRun ? 'Dry run' : label} · {when(run.finishedAt ?? run.createdAt)} · {plural(s?.trackCount ?? 0, 'track')}
        </span>
        {guide && guide[0] && guide[0] !== guide[1] ? (
          <span className="text-[13px] font-extrabold tracking-[0.06em] text-ink uppercase" aria-label="First and last track in view">
            {guide[0]} — {guide[1]}
          </span>
        ) : null}
      </div>
      <h2 className="display mt-2.5 mb-3.5 text-[34px] [font-stretch:118%] sm:text-[46px]">
        <Link href={`/playlists/${run.playlistId}`} className="no-underline hover:underline">
          {run.playlistName}
        </Link>
      </h2>

      <div className="grid grid-cols-2 items-center gap-x-6 gap-y-3 pb-4 sm:flex sm:flex-wrap">
        <Tally n={`+${s?.added ?? 0}`} label="added" />
        <Tally n={`−${s?.removed ?? 0}`} label="removed" />
        <Tally n={String(s?.deduped ?? 0)} label={s?.deduped === 1 ? 'dup' : 'dups'} />
        <div className="flex items-baseline gap-2">
          <b className="display text-[28px] [font-stretch:108%]">{s?.review ?? 0}</b>
          {s?.review ? <Tape kind="warn">Review</Tape> : <small className="label">to review</small>}
        </div>
        <div className="col-span-2 flex items-center gap-3 whitespace-nowrap sm:ml-auto">
          <b className="display text-[28px] normal-case [font-stretch:108%]">{runTime(run.durationMs)}</b>
          <span className="hidden sm:inline">
            <Ruler value={run.durationMs ?? 0} max={scaleMax} width={200} />
          </span>
          <span className="sm:hidden">
            <Ruler value={run.durationMs ?? 0} max={scaleMax} width={140} />
          </span>
          <small className="label">0–{Math.round(scaleMax / 1000)} s</small>
        </div>
      </div>

      {run.status === 'guarded' ? (
        <p className="mb-3 bg-warn px-3 py-2 text-[13.5px] font-semibold">
          {run.error?.replace(/^Guard: /, 'Guard stopped this run: ')}. Nothing was changed.
        </p>
      ) : null}

      <div ref={ref}>
        {rows.length ? (
          <>
            <SetlistHead art />
            {rows.map((r, i) => {
              const c = r.change;
              // On phones the window shrinks to the changes plus one row of context either side.
              const near = !!c || !!rows[i - 1]?.change || !!rows[i + 1]?.change;
              const struck = !!c && isStruck(c);
              const a = c?.primary.action;
              return (
                <SetlistRow
                  key={r.key}
                  id={r.trackId}
                  art={r.art}
                  num={r.num}
                  title={r.title}
                  sub={r.sub}
                  durationMs={r.durationMs}
                  mark={struck ? 'strike' : a === 'added' || a === 'restored' ? 'plus' : null}
                  drawStrike={fresh}
                  strikeDelay={struck ? 300 + strikeN++ * 160 : 0}
                  tabs={c ? changeTabs(c, services) : r.entry ? entryTabs(r.entry, services) : null}
                  note={c ? changeNote(c) : null}
                  className={near ? '' : 'max-md:hidden'}
                />
              );
            })}
          </>
        ) : (
          <p className="border-t-2 border-ink py-6 text-[15px]">
            No changes. {plural(s?.trackCount ?? 0, 'track')}, identical on {plural(services.length, 'service')}.
          </p>
        )}
      </div>

      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-[13px] text-n4">
        <span>{windowNote ?? ' '}</span>
        <span className="flex gap-4">
          {showRunLink ? (
            <Link href={`/runs/${run.id}`} className="font-bold no-underline hover:underline">
              Run details
            </Link>
          ) : null}
          <Link href={`/playlists/${run.playlistId}`} className="border-b-2 border-ink font-bold no-underline">
            Open full playlist
          </Link>
        </span>
      </div>
    </section>
  );
}

function Tally({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <b className="display text-[28px] [font-stretch:108%]">{n}</b>
      <small className="label">{label}</small>
    </div>
  );
}

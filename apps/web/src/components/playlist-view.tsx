'use client';

import {
  type Connection,
  type PlaylistDetail,
  type PlaylistEntry,
  type PlaylistLink,
  PROVIDER_META,
  PROVIDERS,
  type ProviderId,
  type RemotePlaylist,
  type RunSummary,
  type Paged,
} from '@crossfade/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { clock, every, longDuration, plural, relative, runTime, when } from '@/lib/format';
import { serviceName } from '@/lib/services';
import { ConfirmButton, DIRECTIONS, SCHEDULES } from './controls';
import { ErrorLine, PageHeader, Section } from './page';
import { useGuideWords } from './run-sheet';
import { SetlistHead, SetlistRow } from './setlist';
import { Tape, TapeCorners } from './tape';
import { useToast } from './toast';

export function PlaylistView({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api<PlaylistDetail>(`/v1/playlists/${id}`),
    refetchInterval: (query) => (['queued', 'running'].includes(query.state.data?.lastRun?.status ?? '') ? 2500 : 30_000),
  });
  const p = q.data;

  const sync = useMutation({
    mutationFn: (opts: { dryRun?: boolean; overrideGuard?: boolean }) => api<RunSummary>(`/v1/playlists/${id}/sync`, { method: 'POST', body: opts }),
    onSuccess: (run, opts) => {
      toast(opts.dryRun ? 'Dry run queued. Nothing will be written.' : opts.overrideGuard ? 'Queued with the guard overridden' : 'Sync queued');
      qc.setQueryData<PlaylistDetail>(['playlist', id], (d) => (d ? { ...d, lastRun: run } : d));
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err) => toast(errorText(err), 'error'),
  });

  if (q.isError) {
    return (
      <>
        <PageHeader title="Playlist not found" />
        <div className="px-7 py-6">
          <ErrorLine>{errorText(q.error)}</ErrorLine>
        </div>
      </>
    );
  }
  if (!p) {
    return (
      <>
        <PageHeader title={<span className="text-n4">Loading…</span>} />
        <div className="px-4 py-6 sm:px-7">
          <div className="sheet h-[600px] p-6">
            <div className="skeleton h-12 w-1/2" />
          </div>
        </div>
      </>
    );
  }

  const running = p.lastRun?.status === 'queued' || p.lastRun?.status === 'running';
  const guarded = p.lastRun?.status === 'guarded';

  return (
    <>
      <PageHeader
        title={p.name}
        sub={
          <>
            <span>
              {plural(p.trackCount, 'track')} · {longDuration(p.totalDurationMs)}
            </span>
            <span>{p.syncEnabled ? every(p.effectiveScheduleMinutes) : 'Sync paused'}</span>
            {p.lastRun ? (
              <Link href={`/runs/${p.lastRun.id}`} className="text-n6 hover:text-paper">
                last run {when(p.lastRun.finishedAt ?? p.lastRun.createdAt)} · {p.lastRun.status}
              </Link>
            ) : null}
            {p.nextRunAt && p.syncEnabled ? <span>next {clock(Math.max(p.nextRunAt, Date.now()))}</span> : null}
          </>
        }
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => sync.mutate({ dryRun: true })} disabled={running || !p.links.length}>
              Dry run
            </button>
            <button className="btn btn-primary" onClick={() => sync.mutate({})} disabled={running || !p.links.length}>
              <RefreshCw size={15} className={running ? 'spin' : ''} aria-hidden="true" />
              {running ? 'Syncing…' : 'Sync now'}
            </button>
          </>
        }
      />

      {p.lastRun?.dryRun && (p.lastRun.status === 'success' || p.lastRun.status === 'partial') ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-n2 bg-n1 px-4 py-3 text-[14px] sm:px-7">
          <span className="min-w-0 flex-1">
            <b className="font-bold">Preview only.</b> This sync would add {p.lastRun.stats?.added ?? 0} and remove {p.lastRun.stats?.removed ?? 0}{' '}
            in the list, and write{' '}
            {Object.entries(p.lastRun.stats?.push ?? {})
              .map(([prov, st]) => `+${st?.added ?? 0} −${st?.removed ?? 0} on ${serviceName(prov as ProviderId)}`)
              .join(', ') || 'nothing'}
            . Nothing has been written yet.
          </span>
          <Link href={`/runs/${p.lastRun.id}`} className="btn btn-ghost btn-sm no-underline">
            See every change
          </Link>
          <button className="btn btn-primary btn-sm" onClick={() => sync.mutate({})} disabled={running}>
            Apply it
          </button>
        </div>
      ) : null}

      {guarded ? (
        <div className="flex flex-wrap items-center gap-3 bg-warn px-4 py-3 text-[14px] font-semibold text-ink sm:px-7">
          <span className="min-w-0 flex-1">
            {p.lastRun?.error?.replace(/^Guard: /, 'The guard stopped the last run: ')}. Nothing was changed.
          </span>
          <Link href={`/runs/${p.lastRun?.id}`} className="btn btn-outline btn-sm no-underline">
            See what would change
          </Link>
          <ConfirmButton className="btn btn-ink btn-sm" confirmLabel="Yes, apply the removals" onConfirm={() => sync.mutate({ overrideGuard: true })}>
            Run anyway
          </ConfirmButton>
        </div>
      ) : null}

      <div className="grid gap-x-7 gap-y-8 px-4 pt-6 pb-12 sm:px-7 xl:grid-cols-[minmax(0,1fr)_308px]">
        <Sheet p={p} />
        <aside className="flex min-w-0 flex-col gap-8">
          <Links p={p} />
          <Schedule p={p} />
          <Exports p={p} />
          <PlaylistRuns id={p.id} />
          <Danger p={p} />
        </aside>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------- the setlist

function availabilityTabs(e: PlaylistEntry, providers: ProviderId[], removed: boolean) {
  return providers.map((pr) => {
    const a = e.availability[pr];
    if (removed) {
      return a === 'pending_remove' ? (
        <Tape key={pr} provider={pr} title={`Still on ${serviceName(pr)}; removed next sync${PROVIDER_META[pr].capabilities.removeTracks ? '' : ' (by hand)'}`} />
      ) : (
        <Tape key={pr} kind="missing" title={`Gone from ${serviceName(pr)}`}>{' '}</Tape>
      );
    }
    if (a === 'present') return <Tape key={pr} provider={pr} />;
    if (a === 'review') return <Tape key={pr} kind="warn" title={`${serviceName(pr)}: needs review`}>Review</Tape>;
    return <Tape key={pr} kind="missing" title={`Not on ${serviceName(pr)} yet`}>{' '}</Tape>;
  });
}

function removedNote(e: PlaylistEntry, byId: Map<string, PlaylistEntry>, index: Map<string, number>) {
  const r = e.removedReason ?? '';
  if (r === 'duplicate') {
    const keep = e.duplicateOfEntryId ? byId.get(e.duplicateOfEntryId) : undefined;
    const n = keep ? index.get(keep.id) : undefined;
    return keep ? `DUP of ${keep.track.title}${n ? ` (#${n})` : ''}, kept that one` : 'duplicate, collapsed';
  }
  if (r === 'manual') return `removed by you ${when(e.removedAt)}`;
  if (r.startsWith('removed:')) {
    const who = r.slice(8).split(',').map((p) => serviceName(p as ProviderId)).join(', ');
    return `removed on ${who} ${when(e.removedAt)}`;
  }
  return `removed ${when(e.removedAt)}`;
}

function Sheet({ p }: { p: PlaylistDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [justStruck, setJustStruck] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const providers = PROVIDERS.filter((pr) => p.links.some((l) => l.provider === pr));
  const all = [...p.entries, ...p.removed];
  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);
  const index = useMemo(() => new Map(p.entries.map((e, i) => [e.id, i + 1])), [p.entries]);
  const recentCut = Date.now() - 7 * 86_400_000;
  const recent = p.removed.filter((e) => (e.removedAt ?? 0) > recentCut || justStruck.has(e.id));
  const struckList = showRemoved ? p.removed : recent;

  const needle = filter.trim().toLowerCase();
  const match = (e: PlaylistEntry) => !needle || `${e.track.title} ${e.track.artists.join(' ')} ${e.track.album ?? ''}`.toLowerCase().includes(needle);
  const active = p.entries.filter(match);
  const struck = struckList.filter(match);
  const guide = useGuideWords(ref, [p.id, active.length, needle]);

  const mutateEntry = useMutation({
    mutationFn: ({ entry, restore }: { entry: PlaylistEntry; restore: boolean }) =>
      api(`/v1/playlists/${p.id}/entries/${entry.id}${restore ? '/restore' : ''}`, { method: restore ? 'POST' : 'DELETE' }),
    onMutate: ({ entry, restore }) => {
      // Strike (or un-strike) immediately; the marker draws while the request flies.
      qc.setQueryData<PlaylistDetail>(['playlist', p.id], (d) => {
        if (!d) return d;
        if (restore) {
          const e = { ...entry, removedAt: null, removedReason: null, duplicateOfEntryId: null };
          return { ...d, removed: d.removed.filter((x) => x.id !== entry.id), entries: [...d.entries, e], trackCount: d.trackCount + 1 };
        }
        const e = { ...entry, removedAt: Date.now(), removedReason: 'manual' };
        return { ...d, entries: d.entries.filter((x) => x.id !== entry.id), removed: [e, ...d.removed], trackCount: d.trackCount - 1 };
      });
      if (!restore) setJustStruck((s) => new Set(s).add(entry.id));
    },
    onSuccess: (_, { entry, restore }) =>
      toast(restore ? `${entry.track.title} is back. It syncs out on the next run.` : `${entry.track.title} struck. The next sync removes it everywhere.`),
    onError: (err) => toast(errorText(err), 'error'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['playlist', p.id] }),
  });

  // Tracks from the first import aren't news; only later additions get the ✚ and a note.
  const freshAdds = (e: PlaylistEntry) => Date.now() - e.addedAt < 24 * 3600_000 && e.addedAt - p.createdAt > 10 * 60_000;

  return (
    <section className="sheet min-w-0 px-4 pt-6 sm:px-[22px]" aria-label={`${p.name} setlist`}>
      <TapeCorners />
      <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-transparent bg-paper px-4 py-2 sm:-mx-[22px] sm:px-[22px] lg:top-0">
        <label className="relative w-full max-w-[320px] flex-1 sm:flex-none">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-n4" aria-hidden="true" />
          <input className="field !h-9 pl-9" placeholder="Find a track" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tracks" />
        </label>
        {guide && guide[0] && guide[0] !== guide[1] && active.length > 12 ? (
          <span className="hidden text-[13px] font-extrabold tracking-[0.06em] uppercase sm:inline" aria-label="First and last track in view">
            {guide[0]} — {guide[1]}
          </span>
        ) : null}
        <button className="btn btn-outline btn-sm md:hidden" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      <div ref={ref} className={`has-actions mt-3 ${editing ? 'editing' : ''} ${p.entries.length > 150 ? 'setlist-long' : ''}`}>
        <SetlistHead art />
        {active.map((e) => (
          <SetlistRow
            key={e.id}
            id={e.id}
            art={e.track.artworkUrl}
            num={index.get(e.id) ?? null}
            title={e.track.title}
            sub={[e.track.artists.join(', '), e.track.album].filter(Boolean).join(' · ')}
            durationMs={e.track.durationMs}
            mark={freshAdds(e) ? 'plus' : null}
            tabs={availabilityTabs(e, providers, false)}
            note={freshAdds(e) ? `added on ${addedFrom(e.addedFrom)} ${when(e.addedAt)}` : null}
            actions={
              <button className="btn btn-quiet btn-xs" onClick={() => mutateEntry.mutate({ entry: e, restore: false })}>
                Strike
              </button>
            }
          />
        ))}
        {active.length === 0 ? (
          <p className="py-6 text-[14.5px] text-n4">
            {needle ? `Nothing matches “${filter}”.` : p.links.length ? 'Empty so far. The first sync fills it in.' : 'Link a service on the right to fill this list.'}
          </p>
        ) : null}

        {struck.length ? (
          <>
            <h3 className="label mt-8 mb-1 !text-ink">Struck from the list {showRemoved ? '' : '· last 7 days'}</h3>
            {struck.map((e) => (
              <SetlistRow
                key={e.id}
                id={e.id}
                art={e.track.artworkUrl}
                num={null}
                title={e.track.title}
                sub={e.track.artists.join(', ')}
                durationMs={e.track.durationMs}
                mark="strike"
                drawStrike={justStruck.has(e.id)}
                tabs={availabilityTabs(e, providers, true)}
                note={removedNote(e, byId, index)}
                actions={
                  <button className="btn btn-quiet btn-xs" onClick={() => mutateEntry.mutate({ entry: e, restore: true })}>
                    Restore
                  </button>
                }
              />
            ))}
          </>
        ) : null}
      </div>

      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-3 text-[13px] text-n4">
        <span>
          {needle ? `${active.length} of ${p.entries.length} tracks` : `${plural(p.entries.length, 'track')}`}
          {p.removed.length ? ` · ${p.removed.length} struck in total` : ''}
        </span>
        {p.removed.length > recent.length ? (
          <button className="font-bold text-ink underline-offset-4 hover:underline" onClick={() => setShowRemoved((s) => !s)}>
            {showRemoved ? 'Show only the last 7 days' : `Show all ${p.removed.length} struck tracks`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function addedFrom(src: string) {
  return src === 'spotify' || src === 'ytmusic' || src === 'apple' ? serviceName(src) : src;
}

// ----------------------------------------------------------------------------- links

function Links({ p }: { p: PlaylistDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['playlist', p.id] });
    qc.invalidateQueries({ queryKey: ['playlists'] });
  };
  const update = useMutation({
    mutationFn: ({ link, direction }: { link: PlaylistLink; direction: string }) =>
      api(`/v1/playlists/${p.id}/links/${link.id}`, { method: 'PATCH', body: { direction } }),
    onSuccess: refresh,
    onError: (err) => toast(errorText(err), 'error'),
  });
  const unlink = useMutation({
    mutationFn: (link: PlaylistLink) => api(`/v1/playlists/${p.id}/links/${link.id}`, { method: 'DELETE' }),
    onSuccess: (_, link) => {
      toast(`Unlinked ${link.name}. The playlist on ${serviceName(link.provider)} is left as it is.`);
      refresh();
    },
    onError: (err) => toast(errorText(err), 'error'),
  });

  return (
    <Section title="Linked on">
      {p.links.map((l) => (
        <div key={l.id} className="border-t border-n2 py-3">
          <div className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-2.5">
            <Tape provider={l.provider} kind={l.lastError ? 'hazard' : undefined} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="display truncate text-[15px] [font-stretch:106%]">{l.name}</h3>
                {l.url ? (
                  <a href={l.url} target="_blank" rel="noreferrer" className="text-n5 hover:text-paper" aria-label={`Open ${l.name} on ${serviceName(l.provider)}`}>
                    <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
              <p className="text-[12.5px] text-n6">
                {serviceName(l.provider)}
                {l.trackCount != null ? ` · ${plural(l.trackCount, 'track')}` : ''} · synced {relative(l.lastSyncedAt)}
              </p>
              {l.lastError ? <p className="mt-1 text-[12.5px] text-paper">{l.lastError}</p> : null}
            </div>
          </div>
          {p.kind === 'playlist' ? (
            <div className="mt-2.5 flex items-center gap-2 pl-[50px]">
              <select
                className="field !h-8 !text-[13px]"
                aria-label={`Direction for ${l.name}`}
                value={l.direction}
                onChange={(e) => update.mutate({ link: l, direction: e.target.value })}
              >
                {DIRECTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <ConfirmButton className="btn btn-quiet btn-xs shrink-0 text-n6" confirmLabel="Unlink?" onConfirm={() => unlink.mutate(l)}>
                Unlink
              </ConfirmButton>
            </div>
          ) : (
            <div className="mt-1 pl-[50px]">
              <ConfirmButton className="btn btn-quiet btn-xs text-n6" confirmLabel="Unlink?" onConfirm={() => unlink.mutate(l)}>
                Unlink
              </ConfirmButton>
            </div>
          )}
        </div>
      ))}
      {adding ? <AddLink p={p} onDone={() => setAdding(false)} /> : (
        <button className="btn btn-ghost btn-sm mt-2" onClick={() => setAdding(true)}>
          Link another service
        </button>
      )}
    </Section>
  );
}

function AddLink({ p, onDone }: { p: PlaylistDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const conns = useQuery({ queryKey: ['connections'], queryFn: () => api<Connection[]>('/connections') });
  const linkedConns = new Set(p.links.map((l) => l.connectionId));
  const options = (conns.data ?? []).filter((c) => c.status !== 'expired' && (p.kind === 'playlist' || !linkedConns.has(c.id)));
  const [connectionId, setConnectionId] = useState('');
  const [target, setTarget] = useState('__create__');
  const remote = useQuery({
    queryKey: ['remote-playlists', connectionId],
    queryFn: () => api<RemotePlaylist[]>(`/connections/${connectionId}/playlists`),
    enabled: !!connectionId && p.kind === 'playlist',
  });
  const add = useMutation({
    mutationFn: () =>
      api(`/v1/playlists/${p.id}/links`, {
        method: 'POST',
        body:
          p.kind === 'liked' || target !== '__create__'
            ? { mode: 'existing', connectionId, providerPlaylistId: p.kind === 'liked' ? '__liked__' : target, direction: 'both' }
            : { mode: 'create', connectionId, name: p.name, direction: 'both' },
      }),
    onSuccess: () => {
      toast('Linked. A sync is on its way.');
      qc.invalidateQueries({ queryKey: ['playlist', p.id] });
      onDone();
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  return (
    <div className="mt-3 flex flex-col gap-2 bg-n1 p-3">
      <select className="field" value={connectionId} onChange={(e) => setConnectionId(e.target.value)} aria-label="Account">
        <option value="">Choose an account</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {serviceName(c.provider)} · {c.displayName}
          </option>
        ))}
      </select>
      {p.kind === 'playlist' && connectionId ? (
        <select className="field" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Playlist" disabled={remote.isLoading}>
          <option value="__create__">Create “{p.name}” there</option>
          {(remote.data ?? []).some((r) => r.kind === 'liked') ? (
            <optgroup label="Liked">
              {(remote.data ?? [])
                .filter((r) => r.kind === 'liked')
                .map((r) => (
                  <option key={r.id} value={r.id} disabled={!!r.linkedPlaylistId}>
                    {r.name}
                    {r.linkedPlaylistId ? ' · already synced' : ''}
                  </option>
                ))}
            </optgroup>
          ) : null}
          <optgroup label="Playlists">
            {(remote.data ?? [])
              .filter((r) => r.kind === 'playlist')
              .map((r) => (
                <option key={r.id} value={r.id} disabled={!!r.linkedPlaylistId || !r.editable}>
                  {r.name}
                  {r.linkedPlaylistId ? ' · already synced' : ''}
                </option>
              ))}
          </optgroup>
        </select>
      ) : null}
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" disabled={!connectionId || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? 'Linking…' : 'Link'}
        </button>
        <button className="btn btn-quiet btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- settings

function Schedule({ p }: { p: PlaylistDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/v1/playlists/${p.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlist', p.id] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  return (
    <Section title="Schedule & cleanup">
      <label className="flex items-center gap-2.5 border-t border-n2 py-3 text-[14px] font-semibold">
        <input type="checkbox" className="check" checked={p.syncEnabled} onChange={(e) => save.mutate({ syncEnabled: e.target.checked })} />
        Sync automatically
      </label>
      <div className="grid gap-3 border-t border-n2 py-3">
        <label>
          <span className="label mb-1.5">How often</span>
          <select
            className="field"
            value={p.scheduleMinutes ?? ''}
            disabled={!p.syncEnabled}
            onChange={(e) => save.mutate({ scheduleMinutes: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Instance default ({every(p.effectiveScheduleMinutes).replace(/^every /, '')})</option>
            {SCHEDULES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label mb-1.5">Duplicates</span>
          <select className="field" value={p.dedupeMode} onChange={(e) => save.mutate({ dedupeMode: e.target.value })}>
            <option value="strict">Strict: same song, similar length</option>
            <option value="loose">Loose: same song, any length</option>
          </select>
          <span className="mt-1.5 block text-[12px] text-n5">Live, acoustic and remix versions are never folded together.</span>
        </label>
        <label>
          <span className="label mb-1.5">Deletion guard</span>
          <span className="flex items-center gap-2">
            <input
              className="field !w-20"
              type="number"
              min={1}
              max={100}
              defaultValue={p.guardPercent}
              onBlur={(e) => Number(e.target.value) !== p.guardPercent && save.mutate({ guardPercent: Number(e.target.value) })}
            />
            <span className="text-[13px] text-n6">% of the list removed in one run stops the run</span>
          </span>
        </label>
      </div>
    </Section>
  );
}

function Exports({ p }: { p: PlaylistDetail }) {
  return (
    <Section title="Export">
      <div className="flex flex-wrap gap-2 border-t border-n2 pt-3">
        {(['json', 'csv', 'jspf', 'm3u'] as const).map((f) => (
          <a key={f} className="btn btn-ghost btn-sm no-underline" href={`/api/v1/playlists/${p.id}/export?format=${f}`} download>
            <Download size={13} aria-hidden="true" /> {f.toUpperCase()}
          </a>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-n5">
        The same list is at <code className="font-mono text-n6">/api/v1/playlists/{p.id}</code> for your other services.
      </p>
    </Section>
  );
}

function PlaylistRuns({ id }: { id: string }) {
  const runs = useQuery({ queryKey: ['runs', { playlistId: id }], queryFn: () => api<Paged<RunSummary>>(`/v1/runs?playlistId=${id}&limit=6`) });
  const items = runs.data?.items ?? [];
  const max = Math.max(1, ...items.map((r) => r.durationMs ?? 0));
  return (
    <Section title="Runs" aside={<Link href={`/runs?playlistId=${id}`} className="text-[12px] text-n6 hover:text-paper">All</Link>}>
      {items.length === 0 ? <p className="border-t border-n2 py-3 text-[13px] text-n5">No runs yet.</p> : null}
      {items.map((r) => (
        <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center gap-2 border-t border-n2 py-2 text-[12.5px] text-n6 no-underline hover:text-paper">
          <span className="w-[86px] shrink-0">{when(r.finishedAt ?? r.createdAt).replace('today ', '')}</span>
          <i className="bar" style={{ width: `${Math.max(2, ((r.durationMs ?? 0) / max) * 90)}px` }} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {r.status === 'success' ? `${runTime(r.durationMs)} · +${r.stats?.added ?? 0} −${r.stats?.removed ?? 0}` : r.status}
            {r.dryRun ? ' · dry' : ''}
          </span>
        </Link>
      ))}
    </Section>
  );
}

function Danger({ p }: { p: PlaylistDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => api(`/v1/playlists/${p.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(`Stopped syncing ${p.name}. The playlists on your services were not touched.`);
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      router.push('/playlists');
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  return (
    <Section title="Stop syncing">
      <p className="border-t border-n2 pt-3 text-[12.5px] text-n6">Forgets this canonical list and its history. Playlists on your services stay as they are.</p>
      <ConfirmButton className="btn btn-ghost btn-sm mt-3" confirmLabel="Yes, stop and forget it" onConfirm={() => remove.mutate()}>
        Stop syncing {p.kind === 'liked' ? 'liked songs' : 'this playlist'}
      </ConfirmButton>
    </Section>
  );
}

'use client';

import {
  type Connection,
  type Overview,
  type PlaylistDetail,
  type PlaylistSummary,
  PROVIDER_META,
  PROVIDERS,
  type ProviderId,
  type ReviewItem,
  type RunSummary,
} from '@crossfade/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { ErrorLine, PageHeader } from '@/components/page';
import { RunSheet } from '@/components/run-sheet';
import { SetlistRow } from '@/components/setlist';
import { Tape, TapeCorners } from '@/components/tape';
import { useToast } from '@/components/toast';
import { api, errorText } from '@/lib/api';
import { clock, every, plural, relative, runTime } from '@/lib/format';
import { serviceName } from '@/lib/services';
import { useOverview } from '@/lib/session';

export default function OverviewPage() {
  const overview = useOverview();
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: () => api<PlaylistSummary[]>('/v1/playlists') });
  const lastPlaylistId = overview.data?.lastRun?.playlistId;
  const context = useQuery({
    queryKey: ['playlist', lastPlaylistId],
    queryFn: () => api<PlaylistDetail>(`/v1/playlists/${lastPlaylistId}`),
    enabled: !!lastPlaylistId,
  });
  const o = overview.data;

  if (overview.isError || playlists.isError) {
    return (
      <>
        <PageHeader title="Can’t reach Crossfade’s API" />
        <div className="flex flex-col items-start gap-4 px-4 py-6 sm:px-7">
          <ErrorLine>{errorText(overview.error ?? playlists.error)}</ErrorLine>
          <p className="max-w-[60ch] text-[13.5px] text-n6">
            The web app is up but the API behind it isn’t answering. If you run the container, check its logs; it may still be starting.
          </p>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              overview.refetch();
              playlists.refetch();
            }}
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  if (!o || !playlists.data) {
    return (
      <>
        <PageHeader title={<span className="text-n6">Checking every service…</span>} />
        <div className="grid gap-6 px-4 py-6 sm:px-7 xl:grid-cols-[minmax(0,1fr)_308px]">
          <div className="sheet h-[520px] p-6">
            <div className="skeleton h-10 w-2/3" />
          </div>
          <div className="skeleton hidden h-[300px] xl:block" />
        </div>
      </>
    );
  }

  const pls = playlists.data;
  const linked = [...new Set(pls.flatMap((p) => p.links.map((l) => l.provider)))];

  return (
    <>
      <OverviewHeader o={o} playlists={pls} />
      <div className="grid gap-x-7 gap-y-8 px-4 pt-6 pb-12 sm:px-7 xl:grid-cols-[minmax(0,1fr)_308px]">
        <main className="min-w-0">
          {o.lastRun && pls.length ? (
            <RunSheet run={o.lastRun} linked={linked} context={context.data?.entries} />
          ) : (
            <GetStarted connections={o.connections} playlists={pls} />
          )}
          {o.activeRuns.length ? <ActiveRuns runs={o.activeRuns} /> : null}
        </main>
        <aside className="flex min-w-0 flex-col gap-7">
          <Services connections={o.connections} />
          <ReviewBlock count={o.reviewCount} />
          <RecentRuns runs={o.recentRuns} />
        </aside>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------

function headline(o: Overview): string {
  if (o.health === 'idle') return o.connections.length ? 'Nothing synced yet' : 'Plug in your services';
  if (o.health === 'ok') return 'All services in sync';
  if (o.healthReasons.length === 1) return o.healthReasons[0]!.text;
  return `${o.healthReasons.length} things need you`;
}

function OverviewHeader({ o, playlists }: { o: Overview; playlists: PlaylistSummary[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const syncAll = useMutation({
    mutationFn: () => api<RunSummary[]>('/v1/sync', { method: 'POST' }),
    onSuccess: (runs) => {
      toast(runs.length ? `Queued ${plural(runs.length, 'playlist')}` : 'Nothing to sync yet. Link a playlist first.', runs.length ? 'ok' : 'warn');
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err) => toast(errorText(err), 'error'),
  });

  const links = playlists.flatMap((p) => p.links);
  const proof = PROVIDERS.filter((p) => links.some((l) => l.provider === p)).map((p) => {
    const mine = links.filter((l) => l.provider === p);
    const ok = mine.filter((l) => l.lastSyncedAt && !l.lastError).length;
    return { p, ok, total: mine.length };
  });
  const schedules = [...new Set(playlists.filter((p) => p.syncEnabled && p.links.length).map((p) => p.effectiveScheduleMinutes))];
  const busy = o.activeRuns.length > 0 || syncAll.isPending;
  const due = o.nextSyncAt != null && o.nextSyncAt <= Date.now() + 30_000;

  return (
    <PageHeader
      title={headline(o)}
      sub={
        <>
          {proof.map(({ p, ok, total }) => (
            <span key={p} className="flex items-center gap-2">
              <i className={`tape ${p === 'spotify' ? 'tape-sp' : p === 'ytmusic' ? 'tape-yt' : 'tape-am'} !h-2.5 !min-w-[26px]`} aria-hidden="true" />
              {serviceName(p)} {ok}/{total}
            </span>
          ))}
          {proof.length ? <span>lists matched{o.lastRun?.finishedAt ? ` · run ${clock(o.lastRun.finishedAt)}` : ''}</span> : null}
          {o.healthReasons.length ? (
            <ul className="mt-2 flex basis-full flex-col gap-1.5" aria-label="Needs attention">
              {o.healthReasons.map((r) => (
                <li key={r.text} className="grid grid-cols-[22px_minmax(0,1fr)] items-baseline gap-x-2.5 text-[13.5px] text-paper">
                  {r.level === 'error' ? <Tape kind="hazard" title="Broken" className="!min-w-[22px]" /> : <Tape kind="warn" title="Needs attention" className="!min-w-[22px]" />}
                  <span>
                    {r.text}{' '}
                    <Link href={r.href} className="ml-1 inline-flex items-center gap-1 font-bold whitespace-nowrap text-paper underline-offset-4 hover:underline">
                      {r.action} <ArrowRight size={13} aria-hidden="true" />
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      }
      actions={
        <>
          {o.nextSyncAt ? (
            <div className="md:text-right">
              <span className="label mb-2">Next sync</span>
              <b className="display mr-1.5 text-[28px] normal-case [font-stretch:108%]">{due ? 'Now' : clock(o.nextSyncAt)}</b>
              <span className="text-[13px] text-n6">
                {[schedules.length === 1 ? every(schedules[0]!) : null, due ? null : relative(o.nextSyncAt)].filter(Boolean).join(' · ')}
              </span>
            </div>
          ) : null}
          <button className="btn btn-primary h-[42px] px-[22px]" onClick={() => syncAll.mutate()} disabled={busy || !playlists.length}>
            <RefreshCw size={15} className={busy ? 'spin' : ''} aria-hidden="true" />
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        </>
      }
    />
  );
}

function ActiveRuns({ runs }: { runs: RunSummary[] }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-n6" aria-live="polite">
      <RefreshCw size={14} className="spin" aria-hidden="true" />
      {runs.map((r) => (
        <Link key={r.id} href={`/runs/${r.id}`} className="font-semibold text-paper no-underline hover:underline">
          {r.status === 'queued' ? 'Queued' : 'Syncing'} {r.playlistName}
        </Link>
      ))}
    </div>
  );
}

/** First-run checklist, drawn as a setlist: finished steps get struck off. */
function GetStarted({ connections, playlists }: { connections: Connection[]; playlists: PlaylistSummary[] }) {
  const providers = new Set(connections.map((c) => c.provider));
  const liked = playlists.some((p) => p.kind === 'liked');
  const steps = [
    {
      id: 'connect-1',
      title: 'Connect a service',
      sub: 'Spotify, YouTube Music or Apple Music',
      done: providers.size >= 1,
      note: providers.size >= 1 ? `done · ${[...providers].map((p) => serviceName(p)).join(', ')}` : null,
      href: '/connections',
      cta: 'Connect',
    },
    {
      id: 'connect-2',
      title: 'Connect a second one',
      sub: 'Syncing needs at least two places to agree',
      done: providers.size >= 2,
      note: providers.size >= 2 ? 'done' : null,
      href: '/connections',
      cta: 'Connect',
    },
    {
      id: 'playlist',
      title: 'Pick a playlist to keep in sync',
      sub: 'Link it on each service, or let Crossfade create the copies',
      done: playlists.some((p) => p.kind === 'playlist'),
      note: playlists.some((p) => p.kind === 'playlist') ? 'done' : null,
      href: '/playlists/new',
      cta: 'Choose',
    },
    {
      id: 'liked',
      title: 'Sync your liked songs',
      sub: 'Optional. Likes on one service show up on the others',
      done: liked,
      note: liked ? 'done' : null,
      href: '/liked',
      cta: 'Set up',
    },
  ];
  return (
    <section className="sheet sheet-tilt px-4 pt-6 pb-2 sm:px-[22px]" aria-label="Getting started">
      <TapeCorners />
      <p className="text-[12.5px] text-n4">Tonight&rsquo;s setlist · four steps, about five minutes</p>
      <h2 className="display mt-2.5 mb-5 text-[34px] [font-stretch:118%] sm:text-[46px]">Get set up</h2>
      <div className="border-t-2 border-ink">
        {steps.map((s, i) => (
          <SetlistRow
            key={s.id}
            id={s.id}
            num={i + 1}
            title={s.title}
            sub={s.sub}
            mark={s.done ? 'strike' : null}
            drawStrike
            strikeDelay={200 + i * 160}
            note={s.note}
            tabs={
              s.done ? null : (
                <Link href={s.href} className="btn btn-ink btn-xs no-underline">
                  {s.cta}
                </Link>
              )
            }
          />
        ))}
      </div>
      <p className="py-4 text-[13px] text-n4">
        Crossfade keeps one clean copy of each playlist and makes every service match it, on a schedule.{' '}
        <Link href="/guide" className="font-bold text-ink">
          Read the guide
        </Link>
      </p>
    </section>
  );
}

function Services({ connections }: { connections: Connection[] }) {
  return (
    <section>
      <h2 className="label mb-2.5">Services</h2>
      {PROVIDERS.map((p) => (
        <ServiceLine key={p} provider={p} conns={connections.filter((c) => c.provider === p)} />
      ))}
    </section>
  );
}

function ServiceLine({ provider, conns }: { provider: ProviderId; conns: Connection[] }) {
  const meta = PROVIDER_META[provider];
  const worst = conns.find((c) => c.status === 'expired' || c.status === 'error') ?? conns.find((c) => c.status === 'expiring') ?? conns[0];
  let status: React.ReactNode = <em className="text-[12px] text-n6 not-italic">Connected</em>;
  let line: React.ReactNode = conns.map((c) => c.displayName).join(', ');
  if (!worst) {
    status = <em className="text-[12px] text-n5 not-italic">Not connected</em>;
    line = (
      <Link href="/connections" className="font-semibold text-paper">
        Connect {meta.name}
      </Link>
    );
  } else if (worst.status === 'expired' || worst.status === 'error') {
    status = <Tape kind="hazard" title="Needs reconnecting" />;
    line = (
      <>
        {worst.statusMessage ?? 'Sign-in stopped working'} ·{' '}
        <Link href="/connections" className="font-semibold text-paper">
          Reconnect
        </Link>
      </>
    );
  } else if (worst.status === 'expiring') {
    const days = worst.expiresAt ? Math.max(0, Math.round((worst.expiresAt - Date.now()) / 86_400_000)) : null;
    status = <Tape kind="warn">{days != null ? `${days} days` : 'Soon'}</Tape>;
    line = (
      <>
        Sign-in expires {days != null ? `in ${days} days` : 'soon'} ·{' '}
        <Link href="/connections" className="font-semibold text-paper">
          Renew
        </Link>
      </>
    );
  } else if (provider === 'apple' && worst.authMode !== 'web') {
    status = <em className="text-[12px] text-n6 not-italic">Add-only</em>;
    line = `${line} · removals are flagged for you`;
  }
  return (
    <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-n2 py-2.5">
      <Tape provider={provider} />
      <h3 className="display truncate text-[15px] [font-stretch:106%]">{meta.name}</h3>
      {status}
      <p className="col-start-2 col-end-4 text-[12.5px] text-n6">{line}</p>
    </div>
  );
}

function ReviewBlock({ count }: { count: number }) {
  const first = useQuery({
    queryKey: ['review'],
    queryFn: () => api<ReviewItem[]>('/v1/review'),
    enabled: count > 0,
  });
  const item = first.data?.[0];
  if (!count) {
    return (
      <section className="flex items-center gap-3 bg-n1 px-4 py-4 text-[13px] text-n6">
        <Check size={16} aria-hidden="true" />
        Nothing to review. Every match was confident.
      </section>
    );
  }
  return (
    <section className="relative bg-n1 px-4 pt-[18px] pb-4">
      <span className="absolute -top-[5px] left-4 h-3 w-[46px] bg-warn" aria-hidden="true" />
      <div className="mb-2.5 flex items-baseline gap-2.5">
        <b className="display text-[40px] [font-stretch:112%]">{count}</b>
        <span className="display text-[16px] [font-stretch:106%]">to review</span>
      </div>
      {item ? (
        <p className="mb-1 text-[13px] text-n6">
          <strong className="text-paper">{item.track.title}</strong> → {serviceName(item.provider)}
          <br />
          {item.reason === 'manual_remove'
            ? 'remove by hand'
            : item.candidates.length
              ? `${plural(item.candidates.length, 'candidate')}, best ${Math.round((item.candidates[0]?.score ?? 0) * 100)}%`
              : 'no match found yet'}
        </p>
      ) : null}
      {count > 1 ? <p className="text-[13px] text-n6">+ {plural(count - 1, 'more track', 'more tracks')}</p> : null}
      <Link href="/review" className="btn btn-ghost btn-sm mt-3 no-underline">
        Review tracks
      </Link>
    </section>
  );
}

function RecentRuns({ runs }: { runs: RunSummary[] }) {
  const shown = runs.filter((r) => r.status !== 'queued' && r.status !== 'running').slice(0, 6);
  const max = Math.max(1, ...shown.map((r) => r.durationMs ?? 0));
  return (
    <section>
      <h2 className="label mb-2.5">Recent runs · bar = run time</h2>
      {shown.length === 0 ? <p className="border-t border-n2 py-3 text-[13px] text-n5">No runs yet.</p> : null}
      {shown.map((r) => (
        <Link key={r.id} href={`/runs/${r.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1.5 border-t border-n2 py-2.5 text-[13px] no-underline hover:bg-n1/50">
          <b className="truncate font-bold">{r.playlistName}</b>
          <span className="text-n6">{clock(r.finishedAt ?? r.createdAt)}</span>
          <span className="col-span-2 flex items-center gap-2 text-[12px] text-n6">
            <i className="bar" style={{ width: `${Math.max(2, ((r.durationMs ?? 0) / max) * 152)}px` }} aria-hidden="true" />
            {r.status === 'success' ? (
              <>
                {runTime(r.durationMs)} <Check size={13} aria-label="succeeded" />
              </>
            ) : r.status === 'guarded' ? (
              <>
                <Tape kind="warn">Guard</Tape>
                {r.stats?.guard ? `would remove ${r.stats.guard.percent}%` : 'stopped'}
              </>
            ) : r.status === 'partial' ? (
              <>
                <Tape kind="warn">Partial</Tape>
                {runTime(r.durationMs)}
              </>
            ) : (
              <>
                <Tape kind="hazard" title="Failed" />
                failed
              </>
            )}
            {r.dryRun ? <span className="text-n5">· dry run</span> : null}
          </span>
        </Link>
      ))}
      {runs.length ? (
        <Link href="/runs" className="mt-1 inline-block text-[13px] font-semibold text-n6 hover:text-paper">
          All runs
        </Link>
      ) : null}
    </section>
  );
}

'use client';

import { type PlaylistDetail, type PlaylistSummary, PROVIDERS, type RunDetail } from '@crossfade/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { ErrorLine, PageHeader, Section } from '@/components/page';
import { RunSheet } from '@/components/run-sheet';
import { Tape } from '@/components/tape';
import { api, errorText } from '@/lib/api';
import { runTime, when } from '@/lib/format';
import { serviceName } from '@/lib/services';
import { StatusTape } from '@/components/status';

const STATUS_TEXT: Record<string, string> = {
  success: 'Synced',
  partial: 'Partly synced',
  failed: 'Failed',
  guarded: 'Stopped by the guard',
  running: 'Syncing now',
  queued: 'Waiting to start',
};

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({
    queryKey: ['run', id],
    queryFn: () => api<RunDetail>(`/v1/runs/${id}`),
    refetchInterval: (query) => (['queued', 'running'].includes(query.state.data?.status ?? '') ? 1500 : false),
  });
  const pls = useQuery({ queryKey: ['playlists'], queryFn: () => api<PlaylistSummary[]>('/v1/playlists') });
  const detail = useQuery({
    queryKey: ['playlist', q.data?.playlistId],
    queryFn: () => api<PlaylistDetail>(`/v1/playlists/${q.data?.playlistId}`),
    enabled: !!q.data?.playlistId,
    retry: false,
  });
  const r = q.data;
  if (q.isError) {
    return (
      <>
        <PageHeader title="Run not found" />
        <div className="px-7 py-6">
          <ErrorLine>{errorText(q.error)}</ErrorLine>
        </div>
      </>
    );
  }
  if (!r) return <PageHeader title={<span className="text-n4">Loading run…</span>} />;

  const linked = pls.data?.find((p) => p.id === r.playlistId)?.links.map((l) => l.provider) ?? PROVIDERS.filter((p) => r.stats?.push[p]);
  const push = Object.entries(r.stats?.push ?? {});

  return (
    <>
      <PageHeader
        title={`${STATUS_TEXT[r.status] ?? r.status}${r.dryRun ? ' (dry run)' : ''}`}
        sub={
          <>
            <StatusTape r={r} />
            {r.playlistId ? (
              <Link href={`/playlists/${r.playlistId}`} className="font-semibold text-paper">
                {r.playlistName}
              </Link>
            ) : (
              <span>{r.playlistName}</span>
            )}
            <span>started {when(r.startedAt ?? r.createdAt)}</span>
            <span>took {runTime(r.durationMs)}</span>
          </>
        }
      />
      <div className="grid gap-x-7 gap-y-8 px-4 pt-6 pb-12 sm:px-7 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <RunSheet run={r} linked={linked} context={detail.data?.entries} mode="changes" limit={Number.POSITIVE_INFINITY} tilt={false} label="Run" showRunLink={false} />
        </div>
        <aside className="flex min-w-0 flex-col gap-8">
          {r.error && r.status !== 'guarded' ? (
            <Section title="Problem">
              <p className="border-t border-n2 pt-3 text-[13.5px]">{r.error}</p>
            </Section>
          ) : null}
          <Section title="Written to each service">
            {push.length === 0 ? <p className="border-t border-n2 pt-3 text-[13px] text-n5">Nothing pushed.</p> : null}
            {push.map(([p, s]) =>
              s ? (
                <div key={p} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-2.5 border-t border-n2 py-2.5 text-[13px]">
                  <Tape provider={p as never} />
                  <span>
                    <b className="font-bold">{serviceName(p as never)}</b>
                    <span className="block text-n6">
                      +{s.added} −{s.removed}
                      {s.manual ? ` · ${s.manual} to remove by hand` : ''}
                      {s.pending ? ` · ${s.pending} still to match` : ''}
                      {s.failed ? ` · ${s.failed} failed` : ''}
                    </span>
                  </span>
                </div>
              ) : null,
            )}
          </Section>
          <Section title="Log">
            <ol className="max-h-[520px] overflow-auto border-t border-n2 pt-2 font-mono text-[12px] leading-[1.55]">
              {r.log.map((l, i) => (
                <li key={i} className={`grid grid-cols-[66px_minmax(0,1fr)] gap-2 py-0.5 ${l.level === 'error' ? 'text-paper' : l.level === 'warn' ? 'text-n7' : 'text-n6'}`}>
                  <span className="text-n5">{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
                  <span>
                    {l.level !== 'info' ? <Tape kind={l.level === 'error' ? 'hazard' : 'warn'} className="mr-1.5 !h-3 !min-w-[18px] align-[-1px]">{l.level === 'warn' ? '!' : ''}</Tape> : null}
                    {l.msg}
                  </span>
                </li>
              ))}
              {r.log.length === 0 ? <li className="text-n5">No log lines.</li> : null}
            </ol>
          </Section>
        </aside>
      </div>
    </>
  );
}

'use client';

import type { Paged, RunStatus, RunSummary } from '@crossfade/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ErrorLine, PageHeader } from '@/components/page';
import { TapeCorners } from '@/components/tape';
import { StatusTape } from '@/components/status';
import { api, errorText } from '@/lib/api';
import { runTime, when } from '@/lib/format';

const STATUSES: { value: '' | RunStatus; label: string }[] = [
  { value: '', label: 'All runs' },
  { value: 'success', label: 'Succeeded' },
  { value: 'partial', label: 'Partly failed' },
  { value: 'guarded', label: 'Stopped by guard' },
  { value: 'failed', label: 'Failed' },
];

const TRIGGER: Record<string, string> = { schedule: 'scheduled', manual: 'by hand', api: 'via API', link: 'after linking' };

function Runs() {
  const params = useSearchParams();
  const playlistId = params.get('playlistId') ?? undefined;
  const [status, setStatus] = useState<'' | RunStatus>('');
  const q = useInfiniteQuery({
    queryKey: ['runs', { playlistId, status }],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<Paged<RunSummary>>(
        `/v1/runs?limit=40&offset=${pageParam}${playlistId ? `&playlistId=${playlistId}` : ''}${status ? `&status=${status}` : ''}`,
      ),
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    refetchInterval: 10_000,
  });
  const runs = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  const max = Math.max(1, ...runs.map((r) => r.durationMs ?? 0));

  return (
    <>
      <PageHeader
        title="Runs"
        sub={<span>{total ? `${total.toLocaleString()} runs kept for 90 days` : 'Every sync is recorded here with what it changed.'}</span>}
        actions={
          <select className="field !w-[200px]" value={status} onChange={(e) => setStatus(e.target.value as '' | RunStatus)} aria-label="Filter by status">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        }
      />
      <div className="px-4 pt-6 pb-12 sm:px-7">
        <section className="sheet max-w-[1100px] px-4 pt-5 pb-3 sm:px-[22px]" aria-label="Run history">
          <TapeCorners />
          {q.isError ? (
            <div className="flex flex-col items-start gap-3 py-4">
              <ErrorLine>{errorText(q.error)}</ErrorLine>
              <button className="btn btn-ink btn-sm" onClick={() => q.refetch()}>
                Try again
              </button>
            </div>
          ) : null}
          {q.isLoading ? <div className="skeleton my-3 h-[240px]" /> : null}
          <div className="hidden grid-cols-[56px_minmax(0,1.4fr)_150px_minmax(0,1fr)_200px] gap-4 border-b-2 border-ink py-2.5 md:grid">
            <span className="label">Result</span>
            <span className="label">Playlist</span>
            <span className="label">When</span>
            <span className="label">Changes</span>
            <span className="label">Run time, to scale</span>
          </div>
          {runs.map((r) => (
            <Link
              key={r.id}
              href={`/runs/${r.id}`}
              className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-n7 py-3 text-[13.5px] no-underline hover:bg-paper-2 md:grid-cols-[56px_minmax(0,1.4fr)_150px_minmax(0,1fr)_200px] md:items-center"
            >
              <span className="row-span-3 md:row-span-1">
                <StatusTape r={r} />
              </span>
              <span className="min-w-0">
                <b className="block truncate font-bold">{r.playlistName ?? 'Deleted playlist'}</b>
                <small className="text-[12px] text-n4">
                  {TRIGGER[r.trigger] ?? r.trigger}
                  {r.dryRun ? ' · dry run' : ''}
                </small>
              </span>
              <span className="text-n4">{when(r.finishedAt ?? r.createdAt)}</span>
              <span className="text-n4">
                {r.stats ? (
                  <>
                    +{r.stats.added} −{r.stats.removed}
                    {r.stats.deduped ? ` · ${r.stats.deduped} dup` : ''}
                    {r.stats.review ? ` · ${r.stats.review} review` : ''}
                  </>
                ) : r.error ? (
                  <span className="text-ink">{r.error}</span>
                ) : (
                  '–'
                )}
              </span>
              <span className="flex items-center gap-2 text-[12px] text-n4">
                <i className="bar !bg-ink" style={{ width: `${Math.max(2, ((r.durationMs ?? 0) / max) * 120)}px` }} aria-hidden="true" />
                {runTime(r.durationMs)}
              </span>
            </Link>
          ))}
          {!q.isLoading && !q.isError && runs.length === 0 ? <p className="py-8 text-n4">No runs match.</p> : null}
          {q.hasNextPage ? (
            <button className="btn btn-outline btn-sm my-4" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? 'Loading…' : 'Load older runs'}
            </button>
          ) : null}
        </section>
      </div>
    </>
  );
}

export default function RunsPage() {
  return (
    <Suspense>
      <Runs />
    </Suspense>
  );
}

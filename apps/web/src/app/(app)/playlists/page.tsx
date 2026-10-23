'use client';

import { type PlaylistSummary, PROVIDERS } from '@crossfade/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ErrorLine, PageHeader } from '@/components/page';
import { SetlistRow } from '@/components/setlist';
import { Tape, TapeCorners } from '@/components/tape';
import { api, errorText } from '@/lib/api';
import { every, longDuration, plural, when } from '@/lib/format';

export default function PlaylistsPage() {
  const q = useQuery({
    queryKey: ['playlists'],
    queryFn: () => api<PlaylistSummary[]>('/v1/playlists'),
    refetchInterval: (query) => (query.state.data?.some((p) => p.lastRun?.status === 'running' || p.lastRun?.status === 'queued') ? 3000 : 30_000),
  });
  // Liked songs come first: it's where quick finds land.
  const pls = [...(q.data ?? [])].sort((a, b) => Number(b.kind === 'liked') - Number(a.kind === 'liked'));
  const hasLiked = pls.some((p) => p.kind === 'liked');
  const tracks = pls.reduce((n, p) => n + p.trackCount, 0);

  return (
    <>
      <PageHeader
        title="Playlists"
        sub={q.data ? <span>{plural(pls.length, 'playlist')} · {plural(tracks, 'track')} kept in sync</span> : null}
        actions={
          <Link href="/playlists/new" className="btn btn-primary no-underline">
            <Plus size={16} aria-hidden="true" /> New playlist
          </Link>
        }
      />
      <div className="px-4 pt-6 pb-12 sm:px-7">
        <section className="sheet max-w-[1100px] px-4 pt-6 pb-3 sm:px-[22px]" aria-label="All playlists">
          <TapeCorners />
          {q.isError ? (
            <div className="flex flex-col items-start gap-3 py-4">
              <ErrorLine>{errorText(q.error)}</ErrorLine>
              <button className="btn btn-ink btn-sm" onClick={() => q.refetch()}>
                Try again
              </button>
            </div>
          ) : q.isLoading ? (
            <div className="skeleton h-[200px]" />
          ) : pls.length === 0 ? (
            <div className="py-6">
              <h2 className="display text-[30px] [font-stretch:116%]">No playlists yet</h2>
              <p className="mt-3 max-w-[56ch] text-[14.5px] text-n4">
                Pick a playlist on any service you&rsquo;ve connected. Crossfade keeps one clean copy and makes every other service match it.
              </p>
              <Link href="/playlists/new" className="btn btn-ink mt-5 no-underline">
                Choose a playlist
              </Link>
            </div>
          ) : (
            <>
              {!hasLiked ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 bg-paper-2 px-4 py-3 text-[14px]">
                  <span>
                    <b className="font-extrabold uppercase">Liked Songs</b> aren&rsquo;t synced yet. Likes and favorites on one service can show
                    up on all of them.
                  </span>
                  <Link href="/liked" className="btn btn-ink btn-sm no-underline">
                    Set up liked songs
                  </Link>
                </div>
              ) : null}
              <div className="setlist-head" aria-hidden="true">
                <span />
                <span>#</span>
                <span>Playlist</span>
                <span className="text-right">Tracks</span>
                <span>Linked on</span>
                <span>Last run</span>
              </div>
              {pls.map((p, i) => (
                <Link key={p.id} href={`/playlists/${p.id}`} className="block no-underline hover:bg-paper-2">
                  <SetlistRow
                    id={p.id}
                    num={i + 1}
                    title={p.name}
                    sub={[
                      p.kind === 'liked' ? 'Liked songs' : null,
                      longDuration(p.totalDurationMs),
                      p.syncEnabled ? every(p.effectiveScheduleMinutes) : 'paused',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    measure={p.trackCount.toLocaleString()}
                    tabs={
                      p.links.length ? (
                        PROVIDERS.filter((pr) => p.links.some((l) => l.provider === pr)).map((pr) => (
                          <Tape key={pr} provider={pr} kind={p.links.some((l) => l.provider === pr && l.lastError) ? 'hazard' : undefined} />
                        ))
                      ) : (
                        <span className="text-[12px] text-n4">none</span>
                      )
                    }
                    note={<RunNote p={p} />}
                  />
                </Link>
              ))}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function RunNote({ p }: { p: PlaylistSummary }) {
  const r = p.lastRun;
  const review = p.reviewCount ? <mark>{p.reviewCount} to review</mark> : null;
  if (!r) return p.links.length ? <>waiting for first sync</> : <>link a service to start</>;
  if (r.status === 'running' || r.status === 'queued') return <>syncing now…</>;
  if (r.status === 'guarded') return <mark>guard stopped {when(r.finishedAt)}</mark>;
  if (r.status === 'failed') return <mark>failed {when(r.finishedAt)}</mark>;
  const s = r.stats;
  const delta = s && (s.added || s.removed || s.deduped) ? ` · +${s.added} −${s.removed}${s.deduped ? ` · ${s.deduped} dup` : ''}` : ' · no changes';
  return (
    <>
      {when(r.finishedAt)}
      {delta}
      {review ? <> · {review}</> : null}
    </>
  );
}

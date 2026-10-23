'use client';

import { type Connection, PROVIDER_META, type PlaylistSummary } from '@crossfade/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorLine, PageHeader } from '@/components/page';
import { PlaylistView } from '@/components/playlist-view';
import { Tape, TapeCorners } from '@/components/tape';
import { api, errorText } from '@/lib/api';
import { serviceName } from '@/lib/services';

export default function LikedPage() {
  const pls = useQuery({ queryKey: ['playlists'], queryFn: () => api<PlaylistSummary[]>('/v1/playlists') });
  const liked = pls.data?.find((p) => p.kind === 'liked');
  if (!pls.data) return <PageHeader title={<span className="text-n4">Liked Songs</span>} />;
  if (liked) return <PlaylistView id={liked.id} />;
  return <LikedSetup />;
}

function LikedSetup() {
  const qc = useQueryClient();
  const conns = useQuery({ queryKey: ['connections'], queryFn: () => api<Connection[]>('/connections') });
  const usable = (conns.data ?? []).filter((c) => c.status !== 'expired' && PROVIDER_META[c.provider].capabilities.likedRead);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const chosen = usable.filter((c) => picked.has(c.id));

  const create = useMutation({
    mutationFn: (preview: boolean) =>
      api('/v1/playlists', {
        method: 'POST',
        body: {
          name: 'Liked Songs',
          kind: 'liked',
          syncNow: true,
          preview,
          links: chosen.map((c) => ({ mode: 'existing', connectionId: c.id, providerPlaylistId: '__liked__', direction: 'both' })),
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
    onError: (err) => setError(errorText(err)),
  });

  return (
    <>
      <PageHeader title="Liked Songs" sub={<span>Like a song on one service, find it liked on the others.</span>} />
      <div className="px-4 pt-6 pb-12 sm:px-7">
        <section className="sheet max-w-[760px] px-4 pt-7 pb-6 sm:px-7">
          <TapeCorners />
          <h2 className="display text-[30px] [font-stretch:116%]">Which libraries?</h2>
          <p className="mt-2 max-w-[60ch] text-[14px] text-n4">
            The first sync merges them: everything liked anywhere gets liked everywhere. Later unlikes sync too. On Apple Music this is
            your Favorite Songs.
          </p>
          <div className="mt-6 border-t-2 border-ink">
            {usable.length === 0 ? (
              <p className="py-5 text-[14px]">
                No connected accounts yet. <Link href="/connections" className="font-bold">Connect one</Link>.
              </p>
            ) : null}
            {usable.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b border-n7 py-3.5">
                <input
                  type="checkbox"
                  className="check"
                  checked={picked.has(c.id)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(c.id);
                      else n.delete(c.id);
                      return n;
                    })
                  }
                />
                <Tape provider={c.provider} />
                <span className="min-w-0 flex-1">
                  <span className="display block text-[16px] [font-stretch:106%]">{PROVIDER_META[c.provider].likedLabel}</span>
                  <small className="text-[12.5px] text-n4">
                    {serviceName(c.provider)} · {c.displayName}
                    {!PROVIDER_META[c.provider].capabilities.likedRemove ? ' · add-only' : ''}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {error ? <div className="mt-4"><ErrorLine>{error}</ErrorLine></div> : null}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button className="btn btn-ink" disabled={chosen.length < 2 || create.isPending} onClick={() => create.mutate(true)}>
              {create.isPending ? 'Starting…' : chosen.length < 2 ? 'Pick at least two' : 'Preview the merge'}
            </button>
            <button className="btn btn-outline" disabled={chosen.length < 2 || create.isPending} onClick={() => create.mutate(false)}>
              Merge now
            </button>
            <span className="text-[13px] text-n4">The preview is a dry run: it shows every like it would add, and writes nothing.</span>
          </div>
        </section>
      </div>
    </>
  );
}

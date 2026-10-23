'use client';

import type { Connection, LinkTargetInput, PlaylistSummary, RemotePlaylist } from '@crossfade/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DIRECTIONS } from '@/components/controls';
import { ErrorLine, PageHeader } from '@/components/page';
import { Tape, TapeCorners } from '@/components/tape';
import { api, errorText } from '@/lib/api';
import { serviceName } from '@/lib/services';

type Choice = { target: string; direction: 'both' | 'pull' | 'push' };
const NONE = '';
const CREATE = '__create__';
const LIKED = '__liked__';

export default function NewPlaylistPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const conns = useQuery({ queryKey: ['connections'], queryFn: () => api<Connection[]>('/connections') });
  const mine = useQuery({ queryKey: ['playlists'], queryFn: () => api<PlaylistSummary[]>('/v1/playlists') });
  const existingLiked = mine.data?.some((p) => p.kind === 'liked') ?? false;
  const usable = (conns.data ?? []).filter((c) => c.status !== 'expired');
  const remote = useQueries({
    queries: usable.map((c) => ({
      queryKey: ['remote-playlists', c.id],
      queryFn: () => api<RemotePlaylist[]>(`/connections/${c.id}/playlists`),
      staleTime: 60_000,
    })),
  });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remoteById = useMemo(() => {
    const m = new Map<string, RemotePlaylist[]>();
    usable.forEach((c, i) => m.set(c.id, remote[i]?.data ?? []));
    return m;
  }, [usable, remote]);

  const picked = Object.entries(choices).filter(([, c]) => c.target !== NONE);
  const sources = picked.filter(([, c]) => c.target !== CREATE);
  const suggested = sources.length ? remoteById.get(sources[0]![0])?.find((p) => p.id === sources[0]![1].target)?.name : undefined;
  const allLiked = picked.length > 0 && picked.every(([, c]) => c.target === LIKED);
  const finalName = name.trim() || (allLiked ? 'Liked Songs' : suggested) || '';

  const create = useMutation({
    mutationFn: (preview: boolean) => {
      const links: LinkTargetInput[] = picked.map(([connectionId, c]) =>
        c.target === CREATE
          ? { mode: 'create', connectionId, name: finalName, direction: c.direction === 'pull' ? 'both' : c.direction }
          : { mode: 'existing', connectionId, providerPlaylistId: c.target, direction: c.direction },
      );
      // Only liked collections picked: this becomes the Liked Songs list (unless one already exists).
      const kind = allLiked && !existingLiked ? 'liked' : 'playlist';
      return api<PlaylistSummary>('/v1/playlists', { method: 'POST', body: { name: finalName, kind, links, syncNow: true, preview } });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      router.push(`/playlists/${p.id}`);
    },
    onError: (err) => setError(errorText(err)),
  });

  const set = (id: string, patch: Partial<Choice>) =>
    setChoices((cs) => ({ ...cs, [id]: { target: cs[id]?.target ?? NONE, direction: cs[id]?.direction ?? 'both', ...patch } }));

  const canSubmit = sources.length >= 1 && picked.length >= 1 && !!finalName && !create.isPending;

  return (
    <>
      <PageHeader title="New playlist" sub={<span>Choose the playlist on each service that should hold the same tracks.</span>} />
      <div className="px-4 pt-6 pb-12 sm:px-7">
        {conns.data && usable.length === 0 ? (
          <section className="sheet max-w-[760px] px-6 py-7">
            <TapeCorners />
            <h2 className="display text-[28px]">Connect a service first</h2>
            <p className="mt-2 text-n4">Crossfade needs at least one account to read playlists from.</p>
            <Link href="/connections" className="btn btn-ink mt-5 no-underline">
              Go to Connections
            </Link>
          </section>
        ) : (
          <form
            className="sheet max-w-[860px] px-4 pt-7 pb-6 sm:px-7"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (canSubmit) create.mutate(false);
            }}
          >
            <TapeCorners />
            <label className="block max-w-[460px]">
              <span className="label mb-2">Name in Crossfade</span>
              <input className="field" value={name} placeholder={suggested ?? 'Late Night Drive'} onChange={(e) => setName(e.target.value)} />
            </label>

            <div className="mt-7 border-t-2 border-ink">
              {usable.map((c, i) => {
                const list = remote[i];
                const choice = choices[c.id] ?? { target: NONE, direction: 'both' };
                return (
                  <div key={c.id} className="grid gap-3 border-b border-n7 py-4 md:grid-cols-[200px_minmax(0,1fr)_170px] md:items-center">
                    <div className="flex items-center gap-2.5">
                      <Tape provider={c.provider} />
                      <div className="min-w-0 leading-tight">
                        <div className="display truncate text-[15px] [font-stretch:106%]">{serviceName(c.provider)}</div>
                        <small className="text-[12px] text-n4">{c.displayName}</small>
                      </div>
                    </div>
                    <select
                      className="field"
                      aria-label={`${serviceName(c.provider)} playlist`}
                      value={choice.target}
                      disabled={list?.isLoading}
                      onChange={(e) => set(c.id, { target: e.target.value })}
                    >
                      <option value={NONE}>{list?.isLoading ? 'Loading playlists…' : 'Don’t link this account'}</option>
                      <option value={CREATE}>Create a new playlist here</option>
                      {list?.data?.some((p) => p.kind === 'liked') ? (
                        <optgroup label="Liked">
                          {list.data
                            .filter((p) => p.kind === 'liked')
                            .map((p) => (
                              <option key={p.id} value={p.id} disabled={!!p.linkedPlaylistId}>
                                {p.name}
                                {p.linkedPlaylistId ? ' · already synced' : ''}
                              </option>
                            ))}
                        </optgroup>
                      ) : null}
                      {list?.data?.some((p) => p.kind === 'playlist') ? (
                        <optgroup label="Your playlists">
                          {list.data.filter((p) => p.kind === 'playlist').map((p) => (
                            <option key={p.id} value={p.id} disabled={!!p.linkedPlaylistId || !p.editable}>
                              {p.name}
                              {p.trackCount != null ? ` (${p.trackCount})` : ''}
                              {p.linkedPlaylistId ? ' · already synced' : !p.editable ? ' · not yours' : ''}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                    <select
                      className="field"
                      aria-label="Direction"
                      value={choice.direction}
                      disabled={choice.target === NONE}
                      onChange={(e) => set(c.id, { direction: e.target.value as Choice['direction'] })}
                    >
                      {DIRECTIONS.filter((d) => choice.target !== CREATE || d.value !== 'pull').map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    {list?.isError ? <div className="md:col-span-3"><ErrorLine>{errorText(list.error)}</ErrorLine></div> : null}
                    {choice.target !== NONE && choice.direction !== 'both' ? (
                      <p className="note text-[13.5px] md:col-start-2 md:col-end-4">
                        {DIRECTIONS.find((d) => d.value === choice.direction)?.help}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <p className="mt-5 max-w-[68ch] text-[13.5px] text-n4">
              The first sync merges: every track from every linked playlist ends up in all of them, with duplicates collapsed. After
              that, adds and removals anywhere sync everywhere.
              {usable.some((c) => c.provider === 'apple' && c.authMode !== 'web')
                ? ' Apple Music connected with a MusicKit key only accepts additions; removals there are listed for you to do by hand.'
                : ''}
            </p>
            {error ? <div className="mt-4"><ErrorLine>{error}</ErrorLine></div> : null}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button className="btn btn-ink" disabled={!canSubmit}>
                {create.isPending ? 'Linking…' : 'Create and sync'}
              </button>
              <button type="button" className="btn btn-outline" disabled={!canSubmit} onClick={() => create.mutate(true)}>
                Create and preview
              </button>
              <span className="text-[13px] text-n4">
                {sources.length === 0 ? 'Pick at least one existing playlist to start from.' : `${picked.length} linked`}
              </span>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

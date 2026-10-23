'use client';

import { type MatchCandidate, PROVIDER_META, type ReviewItem } from '@crossfade/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorLine, PageHeader } from '@/components/page';
import { SetlistRow } from '@/components/setlist';
import { Tape, TapeCorners } from '@/components/tape';
import { useToast } from '@/components/toast';
import { api, errorText } from '@/lib/api';
import { duration, plural } from '@/lib/format';
import { serviceName } from '@/lib/services';

export default function ReviewPage() {
  const q = useQuery({ queryKey: ['review'], queryFn: () => api<ReviewItem[]>('/v1/review') });
  const items = q.data ?? [];
  const matches = items.filter((i) => i.reason !== 'manual_remove');
  const manual = items.filter((i) => i.reason === 'manual_remove');
  const [tab, setTab] = useState<'match' | 'manual'>('match');
  const current = tab === 'match' && !matches.length && manual.length ? 'manual' : tab;

  return (
    <>
      <PageHeader
        title="Review"
        sub={
          q.data ? (
            <span>
              {items.length ? `${plural(items.length, 'decision')} waiting` : 'Nothing waiting'}
              {current === 'match' && matches.length ? ' · ↑ ↓ choose · Enter accept · S skip · I never match' : ''}
            </span>
          ) : null
        }
      />
      <div className="px-4 pt-5 pb-12 sm:px-7">
        <div role="tablist" aria-label="Review queues" className="mb-6 flex gap-1 border-b border-n2">
          <TabButton active={current === 'match'} onClick={() => setTab('match')} count={matches.length}>
            Matches
          </TabButton>
          <TabButton active={current === 'manual'} onClick={() => setTab('manual')} count={manual.length}>
            Remove by hand
          </TabButton>
        </div>
        {q.isLoading ? <div className="sheet h-[420px] max-w-[980px]" /> : current === 'match' ? <MatchQueue items={matches} /> : <ManualList items={manual} />}
      </div>
    </>
  );
}

function TabButton({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-[14px] font-bold ${active ? 'border-paper text-paper' : 'border-transparent text-n6 hover:text-paper'}`}
    >
      {children}
      {count ? <Tape kind={active ? 'warn' : 'gaffer'}>{count}</Tape> : null}
    </button>
  );
}

// ----------------------------------------------------------------------------- one decision at a time

function MatchQueue({ items }: { items: ReviewItem[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [skipped, setSkipped] = useState<string[]>([]);
  const queue = useMemo(() => [...items.filter((i) => !skipped.includes(i.id)), ...items.filter((i) => skipped.includes(i.id))], [items, skipped]);
  const item = queue[0];
  const next = queue[1];
  const [choice, setChoice] = useState(0);
  const [pasting, setPasting] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    setChoice(0);
    setPasting(false);
    setUrl('');
  }, [item?.id]);

  const resolve = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api<MatchCandidate | undefined>(`/v1/review/${id}`, { method: 'POST', body }),
    onMutate: ({ id }) => {
      // Move on immediately; the next decision is already on screen.
      qc.setQueryData<ReviewItem[]>(['review'], (xs) => xs?.filter((x) => x.id !== id));
    },
    onSuccess: (_, { body }) => {
      const action = (body as { action: string }).action;
      toast(action === 'ignore' ? 'Won’t try to match that one again' : 'Match saved. The playlist syncs it next.');
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err) => {
      toast(errorText(err), 'error');
      qc.invalidateQueries({ queryKey: ['review'] });
    },
  });

  const refresh = useMutation({
    mutationFn: (id: string) => api<ReviewItem>(`/v1/review/${id}/refresh`, { method: 'POST' }),
    onSuccess: (fresh) => qc.setQueryData<ReviewItem[]>(['review'], (xs) => xs?.map((x) => (x.id === fresh.id ? fresh : x))),
    onError: (err) => toast(errorText(err), 'error'),
  });

  const accept = useCallback(() => {
    const c = item?.candidates[choice];
    if (item && c) resolve.mutate({ id: item.id, body: { action: 'accept', providerTrackId: c.providerTrackId } });
  }, [item, choice, resolve]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item || pasting || (e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setChoice((c) => Math.min(c + 1, item.candidates.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setChoice((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        accept();
      } else if (e.key === 's') {
        setSkipped((s) => [...s.filter((x) => x !== item.id), item.id]);
      } else if (e.key === 'i') {
        resolve.mutate({ id: item.id, body: { action: 'ignore' } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, pasting, accept, resolve]);

  if (!item) {
    return (
      <section className="sheet max-w-[980px] px-6 py-8">
        <TapeCorners />
        <h2 className="display text-[30px]">Every match is settled</h2>
        <p className="mt-2 text-n4">New low-confidence matches land here after each sync.</p>
      </section>
    );
  }

  const t = item.track;
  const max = Math.max(...item.candidates.map((c) => c.score), 0.01);
  const position = items.findIndex((i) => i.id === item.id) + 1;

  return (
    <div className="grid max-w-[1180px] gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
      <section className="sheet sheet-tilt min-w-0 px-4 pt-6 pb-5 sm:px-7" aria-label={`Match ${t.title} on ${serviceName(item.provider)}`}>
        <TapeCorners />
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-n4">
          <span>
            {position} of {items.length} · {item.playlistName}
          </span>
          <span className="flex items-center gap-2">
            needs a match on <Tape provider={item.provider} wide>{serviceName(item.provider)}</Tape>
          </span>
        </div>
        <div className="mt-3 flex items-start gap-4">
          {t.artworkUrl ? (
            <img
              src={t.artworkUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-[72px] w-[72px] shrink-0 object-cover shadow-[inset_0_0_0_1px_rgb(17_17_17/0.08)] sm:h-[96px] sm:w-[96px]"
            />
          ) : null}
          <div className="min-w-0">
            <h2 className="display text-[32px] [font-stretch:116%] sm:text-[44px]">{t.title}</h2>
            <p className="mt-2 text-[15px] font-semibold">
              {t.artists.join(', ')}
              <span className="font-normal text-n4">
                {t.album ? ` · ${t.album}` : ''} · {duration(t.durationMs)}
                {t.isrc ? ` · ISRC ${t.isrc}` : ''}
              </span>
            </p>
          </div>
        </div>
        <p className="note mt-3 text-[15px]">
          {item.reason === 'no_match'
            ? `No confident match on ${serviceName(item.provider)}${item.candidates.length ? '. Closest finds below' : ', and nothing close'}`
            : `Matched at ${Math.round((item.currentMatch?.score ?? item.candidates[0]?.score ?? 0) * 100)}%. Is it the right version?`}
        </p>
        {t.links.length ? (
          <p className="mt-3 flex flex-wrap gap-3 text-[13px]">
            {t.links
              .filter((l) => l.url)
              .map((l) => (
                <a key={`${l.provider}:${l.id}`} href={l.url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold">
                  Listen on {serviceName(l.provider)} <ExternalLink size={12} aria-hidden="true" />
                </a>
              ))}
          </p>
        ) : null}

        <div className="mt-6 border-t-2 border-ink" role="radiogroup" aria-label="Candidates">
          {item.candidates.length === 0 ? <p className="py-5 text-[14px] text-n4">Nothing found. Paste a link to the right track, or search again.</p> : null}
          {item.candidates.map((c, i) => {
            const isCurrent = item.currentMatch?.providerTrackId === c.providerTrackId;
            const diff = c.durationMs && t.durationMs ? Math.round((c.durationMs - t.durationMs) / 1000) : null;
            return (
              <label
                key={c.providerTrackId}
                className={`grid cursor-pointer grid-cols-[22px_44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-n7 px-1 py-3 ${i === choice ? 'bg-paper-2' : 'hover:bg-paper-2/60'}`}
              >
                <input type="radio" name="candidate" className="sr-only" checked={i === choice} onChange={() => setChoice(i)} />
                <span aria-hidden="true" className={`grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] border-ink ${i === choice ? 'bg-ink' : ''}`}>
                  {i === choice ? <span className="h-1.5 w-1.5 rounded-full bg-paper" /> : null}
                </span>
                <span className="sl-art !h-11 !w-11 [grid-area:auto]" aria-hidden="true">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px] leading-tight font-extrabold uppercase [overflow-wrap:anywhere]">{c.title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-n4">
                    {c.artists.join(', ')}
                    {c.album ? ` · ${c.album}` : ''} · {duration(c.durationMs)}
                    {diff != null && diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff} s)` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2.5">
                  {isCurrent ? <Tape kind="gaffer">Current</Tape> : null}
                  <span className="hidden w-[90px] sm:block" aria-hidden="true">
                    <i className="block h-1.5 bg-ink" style={{ width: `${(c.score / max) * 100}%`, opacity: 0.25 + c.score * 0.75 }} />
                  </span>
                  <b className="w-10 text-right text-[14px]">{Math.round(c.score * 100)}%</b>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Open ${c.title}`} className="text-n4 hover:text-ink">
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>

        {pasting ? (
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) resolve.mutate({ id: item.id, body: { action: 'url', url } });
            }}
          >
            <input className="field" autoFocus placeholder={`Paste a ${serviceName(item.provider)} track link`} value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-ink shrink-0" disabled={!url.trim()}>
              Use this link
            </button>
          </form>
        ) : null}
        {resolve.isError ? <div className="mt-3"><ErrorLine>{errorText(resolve.error)}</ErrorLine></div> : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2">
          <div className="flex flex-wrap gap-2.5">
            <button className="btn btn-ink" onClick={accept} disabled={!item.candidates.length}>
              Use this match <span className="kbd">↵</span>
            </button>
            <button className="btn btn-outline" onClick={() => setPasting((p) => !p)}>
              Paste a link
            </button>
          </div>
          {/* Quiet buttons pull back by their padding so their labels share the filled buttons' left edge. */}
          <div className="-ml-2 flex flex-wrap gap-0.5 sm:ml-0">
            <button className="btn btn-quiet" onClick={() => refresh.mutate(item.id)} disabled={refresh.isPending}>
              <RefreshCw size={14} className={refresh.isPending ? 'spin' : ''} aria-hidden="true" /> Search again
            </button>
            <button className="btn btn-quiet" onClick={() => setSkipped((s) => [...s.filter((x) => x !== item.id), item.id])}>
              Skip <span className="kbd">S</span>
            </button>
            <button className="btn btn-quiet" onClick={() => resolve.mutate({ id: item.id, body: { action: 'ignore' } })}>
              Never match <span className="kbd">I</span>
            </button>
          </div>
        </div>
      </section>

      <aside className="text-[13px] text-n6">
        {next ? (
          <p className="border-t border-n2 py-3">
            Next: <b className="font-bold text-paper">{next.track.title}</b> by {next.track.artists.join(', ')} → {serviceName(next.provider)}
          </p>
        ) : (
          <p className="border-t border-n2 py-3">This is the last one.</p>
        )}
        <p className="mt-3">
          {PROVIDER_META[item.provider].capabilities.isrc
            ? `${serviceName(item.provider)} matches by ISRC when it can; these are the ones it couldn't pin down.`
            : `${serviceName(item.provider)} has no ISRC codes, so matches lean on title, artist and length.`}
        </p>
      </aside>
    </div>
  );
}

// ----------------------------------------------------------------------------- removals the API can't do

function ManualList({ items }: { items: ReviewItem[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [done, setDone] = useState<Set<string>>(new Set());
  const mark = useMutation({
    mutationFn: (id: string) => api(`/v1/review/${id}`, { method: 'POST', body: { action: 'done' } }),
    onMutate: (id) => setDone((s) => new Set(s).add(id)),
    onSuccess: () => {
      toast('Checked off. The next sync confirms it.');
      setTimeout(() => qc.invalidateQueries({ queryKey: ['review'] }), 1200);
    },
    onError: (err, id) => {
      toast(errorText(err), 'error');
      setDone((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    },
  });
  if (!items.length) {
    return (
      <section className="sheet max-w-[980px] px-6 py-8">
        <TapeCorners />
        <h2 className="display text-[30px]">Nothing to remove by hand</h2>
        <p className="mt-2 text-n4">When a track leaves a playlist, services that can&rsquo;t remove through their API get a to-do here.</p>
      </section>
    );
  }
  return (
    <section className="sheet max-w-[980px] px-4 pt-6 pb-3 sm:px-[22px]">
      <TapeCorners />
      <h2 className="display text-[30px] [font-stretch:116%]">Remove these by hand</h2>
      <p className="mt-2 mb-5 max-w-[64ch] text-[13.5px] text-n4">
        Apple Music&rsquo;s API can add to playlists but never remove. Open each playlist in the Music app, remove the track, then check it off.
      </p>
      <div className="has-actions editing border-t-2 border-ink">
        {items.map((i, n) => (
          <SetlistRow
            key={i.id}
            id={i.id}
            art={i.track.artworkUrl}
            num={n + 1}
            title={i.track.title}
            sub={`${i.track.artists.join(', ')} · from ${i.playlistName}`}
            durationMs={i.track.durationMs}
            mark={done.has(i.id) ? 'strike' : null}
            drawStrike
            pinActions
            tabs={<Tape provider={i.provider} />}
            note={done.has(i.id) ? 'done' : `remove from ${serviceName(i.provider)}`}
            actions={
              done.has(i.id) ? null : (
                <button className="btn btn-ink btn-xs" onClick={() => mark.mutate(i.id)}>
                  Done
                </button>
              )
            }
          />
        ))}
      </div>
    </section>
  );
}

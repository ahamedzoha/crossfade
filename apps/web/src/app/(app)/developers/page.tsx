'use client';

import { type ApiKey, type ApiKeyCreated, type Webhook, type WebhookCreated, WEBHOOK_EVENTS, type WebhookEvent } from '@crossfade/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ConfirmButton, CopyButton } from '@/components/controls';
import { ErrorLine, PageHeader } from '@/components/page';
import { Tape, TapeCorners } from '@/components/tape';
import { useToast } from '@/components/toast';
import { api, errorText } from '@/lib/api';
import { relative, when } from '@/lib/format';

const EVENT_HELP: Record<WebhookEvent, string> = {
  'run.finished': 'A sync finished (success or partial)',
  'run.failed': 'A sync failed',
  'run.guarded': 'The deletion guard stopped a sync',
  'playlist.changed': 'A canonical list gained or lost tracks',
  'review.created': 'New tracks need a matching decision',
  'connection.expired': 'A sign-in expired or is about to',
};

const ENDPOINTS: [string, string, string, string][] = [
  ['GET', '/v1/playlists', 'read', 'Every canonical playlist with links, counts and last run'],
  ['GET', '/v1/playlists/{id}', 'read', 'The clean list: tracks, ids on each service, availability'],
  ['GET', '/v1/playlists/{id}/export?format=json|csv|jspf|m3u', 'read', 'Download the list'],
  ['POST', '/v1/playlists/{id}/sync', 'write', 'Queue a sync. Body: { "dryRun": false }'],
  ['POST', '/v1/sync', 'write', 'Queue a sync of every enabled playlist'],
  ['GET', '/v1/runs?playlistId=&status=', 'read', 'Run history'],
  ['GET', '/v1/runs/{id}', 'read', 'One run with every change and its log'],
  ['GET', '/v1/review', 'read', 'Tracks waiting for a decision'],
  ['GET', '/v1/overview', 'read', 'Health, counts and the last run'],
  ['GET', '/v1/tracks/{id}', 'read', 'A canonical track and its ids on each service'],
];

export default function DevelopersPage() {
  const [origin, setOrigin] = useState('https://crossfade.example');
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <>
      <PageHeader title="API & Webhooks" sub={<span>Let your other services read the clean lists, trigger syncs, and hear about changes.</span>} />
      <div className="grid max-w-[1180px] gap-x-8 gap-y-10 px-4 pt-7 pb-14 sm:px-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Keys />
        <Hooks />
        <Reference origin={origin} />
      </div>
    </>
  );
}

function Keys() {
  const qc = useQueryClient();
  const toast = useToast();
  const keys = useQuery({ queryKey: ['keys'], queryFn: () => api<ApiKey[]>('/v1/keys') });
  const [name, setName] = useState('');
  const [write, setWrite] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const create = useMutation({
    mutationFn: () => api<ApiKeyCreated>('/v1/keys', { method: 'POST', body: { name, scopes: write ? ['read', 'write'] : ['read'] } }),
    onSuccess: (k) => {
      setCreated(k);
      setName('');
      qc.invalidateQueries({ queryKey: ['keys'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/v1/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Key revoked. Anything using it stops working now.');
      qc.invalidateQueries({ queryKey: ['keys'] });
    },
  });
  return (
    <section>
      <h2 className="display mb-1 text-[22px]">API keys</h2>
      <p className="mb-4 text-[13px] text-n6">Send as <code className="font-mono text-n7">Authorization: Bearer cf_…</code>. Keys act as you.</p>
      {created ? (
        <div className="sheet press-in mb-5 px-4 py-4">
          <p className="text-[13px] font-semibold">Copy {created.name}&rsquo;s key now. It won&rsquo;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate bg-paper-2 px-2.5 py-2 font-mono text-[12.5px] select-all">{created.token}</code>
            <CopyButton value={created.token} className="btn btn-ink btn-sm" />
          </div>
          <button className="mt-2 text-[12.5px] font-semibold underline-offset-4 hover:underline" onClick={() => setCreated(null)}>
            I&rsquo;ve stored it
          </button>
        </div>
      ) : null}
      {(keys.data ?? []).map((k) => (
        <div key={k.id} className="flex items-center gap-3 border-t border-n2 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <b className="truncate font-bold">{k.name}</b>
              {k.scopes.map((s) => (
                <Tape key={s} kind={s === 'write' ? 'warn' : 'gaffer'}>
                  {s}
                </Tape>
              ))}
            </div>
            <p className="text-[12.5px] text-n6">
              <code className="font-mono">{k.prefix}…</code> · made {when(k.createdAt)} · {k.lastUsedAt ? `used ${relative(k.lastUsedAt)}` : 'never used'}
            </p>
          </div>
          <ConfirmButton className="btn btn-quiet btn-sm text-n6" confirmLabel="Revoke?" onConfirm={() => revoke.mutate(k.id)}>
            Revoke
          </ConfirmButton>
        </div>
      ))}
      <form
        className="mt-3 flex flex-col gap-2.5 border-t border-n2 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input className="field" placeholder="What will use it? e.g. Home Assistant" value={name} onChange={(e) => setName(e.target.value)} aria-label="Key name" />
        <label className="flex items-center gap-2.5 text-[13.5px] text-n6">
          <input type="checkbox" className="check" checked={write} onChange={(e) => setWrite(e.target.checked)} />
          Can also trigger syncs and change playlists (write)
        </label>
        {create.isError ? <ErrorLine>{errorText(create.error)}</ErrorLine> : null}
        <button className="btn btn-primary self-start" disabled={!name.trim() || create.isPending}>
          Create key
        </button>
      </form>
    </section>
  );
}

function Hooks() {
  const qc = useQueryClient();
  const toast = useToast();
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: () => api<Webhook[]>('/v1/webhooks'), refetchInterval: 15_000 });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set(['run.finished', 'run.failed', 'run.guarded']));
  const [created, setCreated] = useState<WebhookCreated | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['webhooks'] });
  const create = useMutation({
    mutationFn: () => api<WebhookCreated>('/v1/webhooks', { method: 'POST', body: { url, events: [...events] } }),
    onSuccess: (h) => {
      setCreated(h);
      setUrl('');
      refresh();
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/v1/webhooks/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/v1/webhooks/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const test = useMutation({
    mutationFn: (id: string) => api(`/v1/webhooks/${id}/test`, { method: 'POST' }),
    onSuccess: () => {
      toast('Test delivery sent');
      setTimeout(refresh, 2500);
    },
  });

  return (
    <section>
      <h2 className="display mb-1 text-[22px]">Webhooks</h2>
      <p className="mb-4 text-[13px] text-n6">
        JSON POSTs signed with <code className="font-mono text-n7">X-Crossfade-Signature: sha256=…</code>, retried up to five times.
      </p>
      {created ? (
        <div className="sheet press-in mb-5 px-4 py-4">
          <p className="text-[13px] font-semibold">Signing secret for {created.url}. Shown once.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate bg-paper-2 px-2.5 py-2 font-mono text-[12.5px] select-all">{created.secret}</code>
            <CopyButton value={created.secret} className="btn btn-ink btn-sm" />
          </div>
          <button className="mt-2 text-[12.5px] font-semibold underline-offset-4 hover:underline" onClick={() => setCreated(null)}>
            I&rsquo;ve stored it
          </button>
        </div>
      ) : null}
      {(hooks.data ?? []).map((h) => (
        <div key={h.id} className="border-t border-n2 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <b className="truncate font-mono text-[13px] font-semibold">{h.url}</b>
                {!h.active ? <Tape kind="gaffer">Paused</Tape> : h.lastError ? <Tape kind="hazard" title={h.lastError} /> : null}
              </div>
              <p className="text-[12.5px] text-n6">
                {h.events.join(', ')}
                <br />
                {h.lastDeliveryAt ? `Last delivery ${relative(h.lastDeliveryAt)} · ${h.lastError ?? `HTTP ${h.lastStatus}`}` : 'No deliveries yet'}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button className="btn btn-ghost btn-xs" onClick={() => test.mutate(h.id)}>
                Test
              </button>
              <button className="btn btn-quiet btn-xs text-n6" onClick={() => patch.mutate({ id: h.id, body: { active: !h.active } })}>
                {h.active ? 'Pause' : 'Resume'}
              </button>
              <ConfirmButton className="btn btn-quiet btn-xs text-n6" confirmLabel="Delete?" onConfirm={() => remove.mutate(h.id)}>
                Delete
              </ConfirmButton>
            </div>
          </div>
        </div>
      ))}
      <form
        className="mt-3 flex flex-col gap-2.5 border-t border-n2 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (url && events.size) create.mutate();
        }}
      >
        <input className="field" type="url" placeholder="https://n8n.home.lan/webhook/crossfade" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Webhook URL" />
        <fieldset className="grid gap-1.5 sm:grid-cols-2">
          <legend className="label mb-2">Send when</legend>
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} className="flex items-start gap-2.5 text-[13px] text-n6">
              <input
                type="checkbox"
                className="check mt-0.5"
                checked={events.has(ev)}
                onChange={(e) =>
                  setEvents((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(ev);
                    else n.delete(ev);
                    return n;
                  })
                }
              />
              <span>
                <code className="font-mono text-[12px] text-n7">{ev}</code>
                <br />
                {EVENT_HELP[ev]}
              </span>
            </label>
          ))}
        </fieldset>
        {create.isError ? <ErrorLine>{errorText(create.error)}</ErrorLine> : null}
        <button className="btn btn-primary self-start" disabled={!url || !events.size || create.isPending}>
          Add webhook
        </button>
      </form>
    </section>
  );
}

function Reference({ origin }: { origin: string }) {
  const base = `${origin}/api`;
  const curl = `curl -H "Authorization: Bearer $CROSSFADE_KEY" \\
  ${base}/v1/playlists`;
  const verify = `import { createHmac, timingSafeEqual } from 'node:crypto';

const sig = req.headers['x-crossfade-signature'];
const expected = 'sha256=' +
  createHmac('sha256', SECRET).update(rawBody).digest('hex');
const ok = sig?.length === expected.length &&
  timingSafeEqual(Buffer.from(sig), Buffer.from(expected));`;
  return (
    <section className="sheet px-4 pt-6 pb-5 sm:px-7 xl:col-span-2">
      <TapeCorners />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="display text-[30px] [font-stretch:116%]">Reference</h2>
        <a href="/api/openapi.json" className="text-[13px] font-bold" target="_blank" rel="noreferrer">
          OpenAPI 3.1 document
        </a>
      </div>
      <p className="mt-2 text-[13.5px] text-n4">
        Base URL <code className="bg-paper-2 px-1.5 py-0.5 font-mono text-[12.5px] text-ink">{base}</code> · read keys can call GET; write keys
        can also POST, PATCH and DELETE.
      </p>
      <div className="mt-5 border-t-2 border-ink">
        {ENDPOINTS.map(([m, path, scope, desc]) => (
          <div key={path + m} className="grid gap-x-4 gap-y-1 border-b border-n7 py-2.5 md:grid-cols-[60px_minmax(0,1fr)_60px_minmax(0,1fr)] md:items-center">
            <b className="font-mono text-[12px]">{m}</b>
            <code className="font-mono text-[12.5px] break-all">{path}</code>
            <span>
              <Tape kind={scope === 'write' ? 'warn' : 'gaffer'}>{scope}</Tape>
            </span>
            <span className="text-[13px] text-n4">{desc}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="label">Try it</h3>
            <CopyButton value={curl} className="btn btn-quiet btn-xs" />
          </div>
          <pre className="overflow-x-auto bg-ink px-4 py-3 font-mono text-[12px] leading-relaxed text-paper">{curl}</pre>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="label">Verify a webhook (Node)</h3>
            <CopyButton value={verify} className="btn btn-quiet btn-xs" />
          </div>
          <pre className="overflow-x-auto bg-ink px-4 py-3 font-mono text-[12px] leading-relaxed text-paper">{verify}</pre>
        </div>
      </div>
    </section>
  );
}

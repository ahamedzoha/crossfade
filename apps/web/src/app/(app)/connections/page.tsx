'use client';

import { type Connection, PROVIDER_META, PROVIDERS, type ProviderId, type ProviderSetup } from '@crossfade/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { ConfirmButton } from '@/components/controls';
import { ErrorLine, PageHeader } from '@/components/page';
import { Tape } from '@/components/tape';
import { useToast } from '@/components/toast';
import { api, errorText } from '@/lib/api';
import { relative, when } from '@/lib/format';
import { useSession } from '@/lib/session';

function Connections() {
  const qc = useQueryClient();
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const session = useSession();
  const conns = useQuery({ queryKey: ['connections'], queryFn: () => api<Connection[]>('/connections') });
  const setups = useQuery({ queryKey: ['providers'], queryFn: () => api<ProviderSetup[]>('/providers') });
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const ok = params.get('connected');
    const err = params.get('error');
    if (!ok && !err) return;
    handled.current = true;
    if (ok) toast(`${PROVIDER_META[ok as ProviderId]?.name ?? 'Account'} connected`);
    if (err) toast(err, 'error');
    qc.invalidateQueries({ queryKey: ['connections'] });
    router.replace('/connections');
  }, [params, toast, qc, router]);

  const isAdmin = session.data?.user?.role === 'admin';

  return (
    <>
      <PageHeader
        title="Connections"
        sub={<span>Everyone links their own accounts. Sign-ins are encrypted and stay on this server.</span>}
      />
      <div className="flex max-w-[1100px] flex-col px-4 pb-12 sm:px-7">
        {PROVIDERS.map((p) => (
          <ProviderBlock
            key={p}
            provider={p}
            setup={setups.data?.find((s) => s.provider === p)}
            conns={(conns.data ?? []).filter((c) => c.provider === p)}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense>
      <Connections />
    </Suspense>
  );
}

function ProviderBlock({ provider, setup, conns, isAdmin }: { provider: ProviderId; setup?: ProviderSetup; conns: Connection[]; isAdmin: boolean }) {
  const meta = PROVIDER_META[provider];
  const [open, setOpen] = useState(false);
  const [appleMode, setAppleMode] = useState<'web' | 'key'>('web');
  const configured = setup?.configured ?? false;
  const reconnect = (c: Connection) => {
    if (c.authMode) setAppleMode(c.authMode);
    setOpen(true);
  };

  return (
    <section className="grid gap-x-8 gap-y-4 border-b border-n2 py-8 lg:grid-cols-[260px_minmax(0,1fr)]" aria-labelledby={`h-${provider}`}>
      <div>
        <Tape provider={provider} className="!h-5 !min-w-[54px] !text-[11px]">
          {provider === 'spotify' ? 'SP' : provider === 'ytmusic' ? 'YT' : 'AM'}
        </Tape>
        <h2 id={`h-${provider}`} className="display mt-3 text-[26px] [font-stretch:112%]">
          {meta.name}
        </h2>
        <ul className="mt-3 flex flex-col gap-2 text-[12.5px] leading-snug text-n6">
          {meta.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>

      <div className="min-w-0">
        {conns.map((c) => (
          <ConnectionRow key={c.id} c={c} onReconnect={() => reconnect(c)} />
        ))}
        {conns.length === 0 ? <p className="mb-4 text-[14px] text-n6">Not connected.</p> : null}

        {provider === 'apple' ? (
          open ? (
            appleMode === 'web' ? (
              <AppleWebFlow onClose={() => setOpen(false)} />
            ) : (
              <AppleFlow onClose={() => setOpen(false)} />
            )
          ) : (
            <div className="flex flex-col items-start gap-2.5">
              <div className="flex flex-wrap gap-2">
                <button
                  className={conns.length ? 'btn btn-ghost btn-sm' : 'btn btn-primary'}
                  onClick={() => {
                    setAppleMode('web');
                    setOpen(true);
                  }}
                >
                  Connect with a web session
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!configured}
                  onClick={() => {
                    setAppleMode('key');
                    setOpen(true);
                  }}
                >
                  Use a MusicKit key
                </button>
              </div>
              {!configured ? (
                <p className="text-[12.5px] text-n6">
                  A web session needs no developer account. The MusicKit key option needs a paid Apple Developer membership
                  {isAdmin ? (
                    <>
                      {' '}
                      and its key added in{' '}
                      <Link href="/settings#services" className="font-semibold text-paper">
                        Settings
                      </Link>
                    </>
                  ) : null}
                  .
                </p>
              ) : null}
            </div>
          )
        ) : !configured ? (
          <div className="bg-n1 px-4 py-3.5 text-[13.5px] text-n6">
            {conns.length
              ? `New ${meta.name} sign-ins, and syncing these accounts, need the ${meta.name} app set up on this server.`
              : `${meta.name} needs a one-time app setup on this server first.`}{' '}
            {isAdmin ? (
              <Link href="/settings#services" className="font-semibold text-paper">
                Set it up in Settings
              </Link>
            ) : (
              'Ask the person who runs Crossfade to add it.'
            )}
          </div>
        ) : open ? (
          <ConnectFlow provider={provider} setup={setup!} onClose={() => setOpen(false)} />
        ) : (
          <button className={conns.length ? 'btn btn-ghost btn-sm' : 'btn btn-primary'} onClick={() => setOpen(true)}>
            {conns.length ? `Connect another ${meta.name} account` : `Connect ${meta.name}`}
          </button>
        )}
      </div>
    </section>
  );
}

function ConnectionRow({ c, onReconnect }: { c: Connection; onReconnect: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const check = useMutation({
    mutationFn: () => api<Connection>(`/connections/${c.id}/check`, { method: 'POST' }),
    onSuccess: (fresh) => {
      toast(fresh.status === 'active' || fresh.status === 'expiring' ? `${fresh.displayName} still works` : fresh.statusMessage ?? 'Needs reconnecting', fresh.status === 'active' ? 'ok' : 'warn');
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api(`/connections/${c.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(`Disconnected ${c.displayName}. Its playlist links were removed too.`);
      qc.invalidateQueries();
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  const bad = c.status === 'expired' || c.status === 'error';
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-n2 pt-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <b className="truncate text-[15px] font-bold">{c.displayName}</b>
          {bad ? <Tape kind="hazard" title="Needs reconnecting" /> : c.status === 'expiring' ? <Tape kind="warn">Expiring</Tape> : null}
        </div>
        <p className="text-[12.5px] text-n6">
          {c.statusMessage ?? `Connected ${when(c.createdAt)}`}
          {c.lastUsedAt ? ` · last used ${relative(c.lastUsedAt)}` : ''}
          {c.expiresAt && !bad ? ` · sign-in valid until ${new Date(c.expiresAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
        </p>
      </div>
      <div className="flex gap-1.5">
        {bad || c.status === 'expiring' ? (
          <button className="btn btn-warn btn-sm" onClick={onReconnect}>
            Reconnect
          </button>
        ) : null}
        <button className="btn btn-ghost btn-sm" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? 'Checking…' : 'Check'}
        </button>
        <ConfirmButton className="btn btn-quiet btn-sm text-n6" confirmLabel="Disconnect and unlink?" onConfirm={() => remove.mutate()}>
          Disconnect
        </ConfirmButton>
      </div>
    </div>
  );
}

function ConnectFlow({ provider, setup, onClose }: { provider: ProviderId; setup: ProviderSetup; onClose: () => void }) {
  if (provider === 'spotify') return <SpotifyFlow setup={setup} onClose={onClose} />;
  if (provider === 'ytmusic') return <YtFlow onClose={onClose} />;
  return <AppleFlow onClose={onClose} />;
}

function useConnected(onClose: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return (c: Connection) => {
    toast(`${PROVIDER_META[c.provider].name} connected as ${c.displayName}`);
    qc.invalidateQueries({ queryKey: ['connections'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
    onClose();
  };
}

function Panel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="sheet on-paper press-in max-w-[680px] px-5 pt-5 pb-5">
      {children}
      <button className="btn btn-quiet btn-sm mt-3 -ml-2" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function SpotifyFlow({ setup, onClose }: { setup: ProviderSetup; onClose: () => void }) {
  const done = useConnected(onClose);
  const [pending, setPending] = useState<{ url: string; redirectUri: string } | null>(null);
  const [pasted, setPasted] = useState('');
  const start = useMutation({
    mutationFn: () => api<{ url: string; manual: boolean; redirectUri: string }>('/connections/spotify/authorize', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.manual) setPending(r);
      else window.location.href = r.url;
    },
  });
  const finish = useMutation({
    mutationFn: () => api<Connection>('/connections/spotify/complete', { method: 'POST', body: { url: pasted } }),
    onSuccess: done,
  });

  return (
    <Panel onClose={onClose}>
      {!pending ? (
        <>
          <h3 className="display text-[20px]">Sign in with Spotify</h3>
          <p className="mt-2 text-[13.5px] text-n4">
            {setup.manualRedirect
              ? 'Crossfade isn’t on HTTPS, so Spotify can’t send you straight back. You’ll copy one address back here instead.'
              : 'You’ll approve access on Spotify and come straight back here.'}
          </p>
          {start.isError ? <div className="mt-3"><ErrorLine>{errorText(start.error)}</ErrorLine></div> : null}
          <button className="btn btn-ink mt-4" onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? 'Opening…' : 'Continue to Spotify'}
          </button>
        </>
      ) : (
        <ol className="flex flex-col gap-4 text-[14px]">
          <li>
            <span className="label mb-1.5">Step 1</span>
            <a className="btn btn-ink btn-sm no-underline" href={pending.url} target="_blank" rel="noreferrer">
              Open Spotify sign-in <ExternalLink size={13} aria-hidden="true" />
            </a>
          </li>
          <li>
            <span className="label mb-1.5">Step 2</span>
            After you approve, the new tab lands on <code className="font-mono text-[12.5px]">{pending.redirectUri}</code> and shows
            an error page. That&rsquo;s expected. Copy the whole address from that tab.
          </li>
          <li>
            <span className="label mb-1.5">Step 3</span>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                finish.mutate();
              }}
            >
              <input className="field" placeholder={`${pending.redirectUri}?code=…&state=…`} value={pasted} onChange={(e) => setPasted(e.target.value)} />
              <button className="btn btn-ink shrink-0" disabled={!pasted.includes('code=') || finish.isPending}>
                {finish.isPending ? 'Connecting…' : 'Finish'}
              </button>
            </form>
            {finish.isError ? <div className="mt-2"><ErrorLine>{errorText(finish.error)}</ErrorLine></div> : null}
          </li>
        </ol>
      )}
    </Panel>
  );
}

function YtFlow({ onClose }: { onClose: () => void }) {
  const done = useConnected(onClose);
  const [cookie, setCookie] = useState('');
  // Browsers shorten long header values with "…" in the Headers view; that copy can never work.
  const truncated = cookie.includes('\u2026');
  const connect = useMutation({
    mutationFn: () => api<Connection>('/connections/ytmusic', { method: 'POST', body: { cookie } }),
    onSuccess: done,
  });
  return (
    <Panel onClose={onClose}>
      <h3 className="display text-[20px]">Paste your YouTube Music cookie</h3>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] text-n4 marker:font-bold marker:text-ink">
        <li>
          Open <b className="text-ink">music.youtube.com</b> in a private window and sign in.
        </li>
        <li>
          Open developer tools → Network and click any request to <code className="font-mono">music.youtube.com</code>.
        </li>
        <li>
          Copy the <b className="text-ink">full</b> Cookie value. The normal Headers view cuts long values short with &ldquo;…&rdquo;:
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            <li>
              <b className="text-ink">Firefox:</b> turn on the <b className="text-ink">Raw</b> toggle next to Request Headers and copy
              everything after <code className="font-mono">Cookie:</code>, or right-click the Cookie line → Copy Value.
            </li>
            <li>
              <b className="text-ink">Chrome, Edge, Brave:</b> right-click the request → Copy → Copy request headers, and take the{' '}
              <code className="font-mono">cookie:</code> line.
            </li>
          </ul>
        </li>
        <li>Paste it below, then close the private window without signing out (signing out kills the cookie).</li>
      </ol>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!truncated) connect.mutate();
        }}
      >
        <textarea
          className="field font-mono !text-[12px]"
          rows={4}
          placeholder="VISITOR_INFO1_LIVE=…; SAPISID=…; __Secure-3PAPISID=…"
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          spellCheck={false}
          aria-invalid={truncated}
        />
        {truncated ? (
          <div className="mt-2">
            <ErrorLine>This copy was cut short: it contains &ldquo;…&rdquo; where the browser hid part of a value. Copy it again from the Raw view.</ErrorLine>
          </div>
        ) : connect.isError ? (
          <div className="mt-2">
            <ErrorLine>{errorText(connect.error)}</ErrorLine>
          </div>
        ) : null}
        <button className="btn btn-ink mt-3" disabled={cookie.trim().length < 20 || truncated || connect.isPending}>
          {connect.isPending ? 'Checking with YouTube…' : 'Connect'}
        </button>
      </form>
    </Panel>
  );
}

function AppleWebFlow({ onClose }: { onClose: () => void }) {
  const done = useConnected(onClose);
  const [token, setToken] = useState('');
  const truncated = token.includes('\u2026');
  const connect = useMutation({
    mutationFn: () => api<Connection>('/connections/apple-web', { method: 'POST', body: { mediaUserToken: token } }),
    onSuccess: done,
  });
  return (
    <Panel onClose={onClose}>
      <h3 className="display text-[20px]">Connect with a web session</h3>
      <p className="mt-2 text-[13.5px] text-n4">
        Crossfade borrows the access the music.apple.com web player uses. No developer account, and removals work. It&rsquo;s
        unofficial, so it can stop working when Apple changes its web player. The sign-in lasts about six months.
      </p>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] text-n4 marker:font-bold marker:text-ink">
        <li>
          Sign in at <b className="text-ink">music.apple.com</b>.
        </li>
        <li>
          Open developer tools → <b className="text-ink">Storage</b> (Firefox, Zen) or <b className="text-ink">Application</b> (Chrome, Edge,
          Brave) → Cookies → <code className="font-mono">https://music.apple.com</code>.
        </li>
        <li>
          Copy the whole value of <code className="font-mono font-bold text-ink">media-user-token</code>. Double-click the value to select all of it.
        </li>
        <li>Paste it below.</li>
      </ol>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!truncated) connect.mutate();
        }}
      >
        <textarea
          className="field font-mono !text-[12px]"
          rows={3}
          placeholder="AmT…  (the media-user-token value)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          spellCheck={false}
          aria-invalid={truncated}
        />
        {truncated ? (
          <div className="mt-2">
            <ErrorLine>This copy was cut short: it contains &ldquo;…&rdquo;. Double-click the cookie value and copy it again.</ErrorLine>
          </div>
        ) : connect.isError ? (
          <div className="mt-2">
            <ErrorLine>{errorText(connect.error)}</ErrorLine>
          </div>
        ) : null}
        <button className="btn btn-ink mt-3" disabled={token.trim().length < 20 || truncated || connect.isPending}>
          {connect.isPending ? 'Checking with Apple…' : 'Connect'}
        </button>
      </form>
    </Panel>
  );
}

declare global {
  interface Window {
    MusicKit?: {
      configure: (opts: { developerToken: string; app: { name: string; build: string } }) => Promise<unknown>;
      getInstance: () => { authorize: () => Promise<string> };
    };
  }
}

function loadMusicKit(): Promise<NonNullable<Window['MusicKit']>> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
    s.async = true;
    s.dataset.webComponents = '';
    document.addEventListener('musickitloaded', () => (window.MusicKit ? resolve(window.MusicKit) : reject(new Error('MusicKit failed to load'))), { once: true });
    s.onerror = () => reject(new Error('Could not load MusicKit from Apple'));
    document.head.appendChild(s);
  });
}

function AppleFlow({ onClose }: { onClose: () => void }) {
  const done = useConnected(onClose);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const go = async () => {
    setError(null);
    try {
      setStep('Getting a developer token…');
      const { token } = await api<{ token: string }>('/providers/apple/developer-token');
      setStep('Loading MusicKit…');
      const mk = await loadMusicKit();
      await mk.configure({ developerToken: token, app: { name: 'Crossfade', build: '1' } });
      setStep('Waiting for you to approve in the Apple window…');
      const musicUserToken = await mk.getInstance().authorize();
      if (!musicUserToken) throw new Error('Apple sign-in was cancelled');
      setStep('Connecting…');
      done(await api<Connection>('/connections/apple', { method: 'POST', body: { musicUserToken } }));
    } catch (err) {
      setError(errorText(err));
      setStep(null);
    }
  };
  return (
    <Panel onClose={onClose}>
      <h3 className="display text-[20px]">Sign in with Apple</h3>
      <p className="mt-2 text-[13.5px] text-n4">
        Apple opens a window to approve access to your library. Crossfade can add tracks to your Apple playlists but can&rsquo;t remove
        them; removals land in Review for you to do by hand.
      </p>
      {!secure ? (
        <p className="mt-3 bg-warn px-3 py-2 text-[13px] font-semibold">
          This page isn&rsquo;t on HTTPS. Apple&rsquo;s sign-in usually refuses that; open Crossfade through your HTTPS address to connect.
        </p>
      ) : null}
      {error ? <div className="mt-3"><ErrorLine>{error}</ErrorLine></div> : null}
      <button className="btn btn-ink mt-4" onClick={go} disabled={!!step}>
        {step ?? 'Continue to Apple Music'}
      </button>
    </Panel>
  );
}

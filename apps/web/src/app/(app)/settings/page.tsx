'use client';

import {
  type InstanceSettings,
  PROVIDER_META,
  type ProviderSetup,
  type UserSummary,
} from '@crossfade/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ConfirmButton, CopyButton, SCHEDULES } from '@/components/controls';
import { ErrorLine, PageHeader } from '@/components/page';
import { Tape } from '@/components/tape';
import { useToast } from '@/components/toast';
import { api, errorText } from '@/lib/api';
import { when } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function SettingsPage() {
  const session = useSession();
  const admin = session.data?.user?.role === 'admin';
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex max-w-[1100px] flex-col px-4 pb-14 sm:px-7">
        <Block title="Your account" intro="How you appear and how you sign in.">
          <Account />
        </Block>
        {admin ? (
          <>
            <Block title="Syncing" intro="Defaults for every playlist on this server. Playlists can override schedule, duplicates and guard.">
              <Instance />
            </Block>
            <Block id="services" title="Service apps" intro="One-time setup per server. Each person still connects their own account.">
              <ProviderApps />
            </Block>
            <Block title="People" intro="Everyone gets their own connections and playlists.">
              <People />
            </Block>
          </>
        ) : null}
        <About />
      </div>
    </>
  );
}

function Block({ id, title, intro, children }: { id?: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-6 gap-x-8 gap-y-4 border-b border-n2 py-8 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <h2 className="display text-[22px] [font-stretch:110%]">{title}</h2>
        <p className="mt-2 text-[13px] text-n6">{intro}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Labeled({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-2">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[12px] text-n5">{hint}</span> : null}
    </label>
  );
}

function Account() {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useSession();
  const me = session.data?.user;
  const [displayName, setDisplayName] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  useEffect(() => setDisplayName(me?.displayName ?? ''), [me?.displayName]);
  const save = useMutation({
    mutationFn: (body: unknown) => api('/auth/me', { method: 'PATCH', body }),
    onSuccess: () => {
      toast('Saved');
      setPw({ currentPassword: '', newPassword: '' });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  if (session.data?.trustedHeader && !me) return null;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ displayName });
        }}
      >
        <Labeled label="Display name">
          <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Labeled>
        <button className="btn btn-ghost btn-sm self-start" disabled={!displayName.trim() || displayName === me?.displayName}>
          Save name
        </button>
      </form>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(pw);
        }}
      >
        <Labeled label="Current password">
          <input className="field" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        </Labeled>
        <Labeled label="New password" hint="At least 8 characters.">
          <input className="field" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        </Labeled>
        <button className="btn btn-ghost btn-sm self-start" disabled={pw.newPassword.length < 8}>
          Change password
        </button>
      </form>
    </div>
  );
}

function Instance() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<InstanceSettings>('/v1/settings') });
  const [draft, setDraft] = useState<InstanceSettings | null>(null);
  useEffect(() => {
    if (q.data) setDraft(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (s: InstanceSettings) =>
      api<InstanceSettings>('/v1/settings', {
        method: 'PATCH',
        body: {
          defaultScheduleMinutes: s.defaultScheduleMinutes,
          guardPercent: s.guardPercent,
          autoAcceptScore: s.autoAcceptScore,
          reviewScore: s.reviewScore,
          dedupeMode: s.dedupeMode,
        },
      }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      qc.invalidateQueries({ queryKey: ['playlists'] });
      toast('Sync defaults saved');
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  if (!draft) return <div className="skeleton h-40" />;
  const pct = (n: number) => Math.round(n * 100);
  return (
    <form
      className="grid gap-5 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(draft);
      }}
    >
      <Labeled label="Default schedule">
        <select className="field" value={draft.defaultScheduleMinutes} onChange={(e) => setDraft({ ...draft, defaultScheduleMinutes: Number(e.target.value) })}>
          {SCHEDULES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label="Duplicates" hint="Live, acoustic and remix versions are never folded together.">
        <select className="field" value={draft.dedupeMode} onChange={(e) => setDraft({ ...draft, dedupeMode: e.target.value as 'strict' | 'loose' })}>
          <option value="strict">Strict: same song, similar length</option>
          <option value="loose">Loose: same song, any length</option>
        </select>
      </Labeled>
      <Labeled label="Deletion guard" hint="A sync that would remove more than this share of a list stops and waits for you.">
        <span className="flex items-center gap-2">
          <input className="field !w-24" type="number" min={1} max={100} value={draft.guardPercent} onChange={(e) => setDraft({ ...draft, guardPercent: Number(e.target.value) })} />
          <span className="text-n6">%</span>
        </span>
      </Labeled>
      <Labeled label="Matching" hint={`Matches at or above ${pct(draft.autoAcceptScore)}% go straight through; ${pct(draft.reviewScore)}–${pct(draft.autoAcceptScore) - 1}% sync but land in Review; below ${pct(draft.reviewScore)}% wait for you.`}>
        <span className="flex items-center gap-2 text-[13px] text-n6">
          accept from
          <input className="field !w-20" type="number" min={50} max={100} value={pct(draft.autoAcceptScore)} onChange={(e) => setDraft({ ...draft, autoAcceptScore: Number(e.target.value) / 100 })} />
          % · review from
          <input className="field !w-20" type="number" min={30} max={100} value={pct(draft.reviewScore)} onChange={(e) => setDraft({ ...draft, reviewScore: Number(e.target.value) / 100 })} />%
        </span>
      </Labeled>
      <div className="md:col-span-2">
        <button className="btn btn-primary btn-sm" disabled={save.isPending}>
          Save sync defaults
        </button>
      </div>
    </form>
  );
}

function ProviderApps() {
  const q = useQuery({ queryKey: ['providers'], queryFn: () => api<ProviderSetup[]>('/providers') });
  return (
    <div className="flex flex-col gap-8">
      {(q.data ?? [])
        .filter((s) => s.fields.length)
        .map((s) => (
          <ProviderForm key={s.provider} setup={s} />
        ))}
      <p className="text-[13px] text-n6">
        YouTube Music needs no server setup: each person pastes a browser cookie on the Connections page.
      </p>
    </div>
  );
}

function ProviderForm({ setup }: { setup: ProviderSetup }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(setup.values);
  useEffect(() => setValues(setup.values), [setup.values]);
  const meta = PROVIDER_META[setup.provider];
  const save = useMutation({
    mutationFn: () => api<ProviderSetup>(`/providers/${setup.provider}`, { method: 'PUT', body: values }),
    onSuccess: (s) => {
      toast(s.configured ? `${meta.name} is ready to connect` : `${meta.name} saved, but some fields are still empty`, s.configured ? 'ok' : 'warn');
      qc.invalidateQueries({ queryKey: ['providers'] });
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  return (
    <div className="border-t border-n2 pt-5">
      <div className="mb-3 flex items-center gap-2.5">
        <Tape provider={setup.provider} />
        <h3 className="display text-[17px] [font-stretch:108%]">{meta.name}</h3>
        {setup.configured ? <span className="text-[12px] text-n6">· ready</span> : <Tape kind="warn">Not set up</Tape>}
      </div>
      <ol className="mb-4 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-n6 marker:text-n5">
        {setup.instructions.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ol>
      {setup.redirectUri ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 bg-n1 px-3 py-2.5 text-[13px]">
          <span className="text-n6">Redirect URI</span>
          <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all text-paper">{setup.redirectUri}</code>
          <CopyButton value={setup.redirectUri} />
          {setup.manualRedirect ? (
            <p className="basis-full text-[12px] text-n5">
              Crossfade isn&rsquo;t on HTTPS, so Spotify can&rsquo;t redirect back to it. Sign-in uses a copy-paste step with this loopback
              address instead. Set <code className="font-mono">APP_URL</code> to your HTTPS address to skip it.
            </p>
          ) : null}
        </div>
      ) : null}
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {setup.fields.map((f) => {
          const locked = setup.envLocked.includes(f.key);
          const common = {
            className: `field ${f.kind === 'textarea' ? 'font-mono !text-[12px]' : ''}`,
            value: locked ? '' : (values[f.key] ?? ''),
            placeholder: locked ? 'Set by environment variable' : f.placeholder,
            disabled: locked,
            onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues({ ...values, [f.key]: e.target.value }),
            onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              if (e.target.value === '••••••••') setValues({ ...values, [f.key]: '' });
            },
          };
          return (
            <div key={f.key} className={f.kind === 'textarea' ? 'md:col-span-2' : ''}>
              <Labeled label={`${f.label}${f.required ? '' : ' (optional)'}`} hint={f.help}>
                {f.kind === 'textarea' ? <textarea rows={5} spellCheck={false} {...common} /> : <input type={f.kind === 'secret' ? 'password' : 'text'} autoComplete="off" {...common} />}
              </Labeled>
            </div>
          );
        })}
        <div className="md:col-span-2">
          <button className="btn btn-primary btn-sm" disabled={save.isPending}>
            Save {meta.name} app
          </button>
        </div>
      </form>
    </div>
  );
}

function People() {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useSession();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserSummary[]>('/users') });
  const [form, setForm] = useState({ username: '', password: '', role: 'member' as 'member' | 'admin' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const add = useMutation({
    mutationFn: () => api('/users', { method: 'POST', body: form }),
    onSuccess: () => {
      toast(`Added ${form.username}. Share the password with them; they can change it after signing in.`);
      setForm({ username: '', password: '', role: 'member' });
      refresh();
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
    onError: (err) => toast(errorText(err), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err) => toast(errorText(err), 'error'),
  });
  return (
    <div>
      {(users.data ?? []).map((u) => (
        <div key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-n2 py-3">
          <div className="min-w-0 flex-1">
            <b className="font-bold">{u.displayName}</b> <span className="text-n6">@{u.username}</span>
            <p className="text-[12.5px] text-n6">
              {u.role} · {u.connectionCount} connections · {u.playlistCount} playlists · joined {when(u.createdAt)}
            </p>
          </div>
          {u.id !== session.data?.user?.id ? (
            <div className="flex gap-1">
              <button className="btn btn-quiet btn-xs text-n6" onClick={() => patch.mutate({ id: u.id, body: { role: u.role === 'admin' ? 'member' : 'admin' } })}>
                Make {u.role === 'admin' ? 'member' : 'admin'}
              </button>
              <ConfirmButton className="btn btn-quiet btn-xs text-n6" confirmLabel="Delete them and their data?" onConfirm={() => remove.mutate(u.id)}>
                Remove
              </ConfirmButton>
            </div>
          ) : (
            <span className="text-[12px] text-n5">you</span>
          )}
        </div>
      ))}
      <form
        className="mt-3 grid gap-3 border-t border-n2 pt-4 md:grid-cols-[1fr_1fr_140px_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Labeled label="Username">
          <input className="field" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Labeled>
        <Labeled label="Starting password">
          <input className="field" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Labeled>
        <Labeled label="Role">
          <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'member' | 'admin' })}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </Labeled>
        <button className="btn btn-primary" disabled={!form.username || form.password.length < 8 || add.isPending}>
          Add person
        </button>
        {add.isError ? <div className="md:col-span-4"><ErrorLine>{errorText(add.error)}</ErrorLine></div> : null}
      </form>
    </div>
  );
}

function About() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<InstanceSettings>('/v1/settings') });
  return (
    <section className="py-8 text-[13px] text-n6">
      Crossfade {q.data?.version ?? ''} · public address <code className="font-mono text-n7">{q.data?.appUrl}</code> · back up the{' '}
      <code className="font-mono text-n7">/data</code> volume to keep everything, including the encryption key.
    </section>
  );
}

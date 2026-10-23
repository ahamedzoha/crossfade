'use client';

import { setupSchema, type SessionStatus } from '@crossfade/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorLine } from '@/components/page';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthSheet, Field } from '../auth-sheet';

export default function SetupPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.data && !session.data.needsSetup) router.replace(session.data.authenticated ? '/' : '/login');
  }, [session.data, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = setupSchema.safeParse({ ...form, displayName: form.displayName || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the form');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/setup', { method: 'POST', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['session'] });
      qc.setQueryData<SessionStatus | undefined>(['session'], (s) => (s ? { ...s, needsSetup: false } : s));
      router.replace('/connections');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthSheet
      title="Set up Crossfade"
      intro="Create the admin account for this instance. You can add the rest of the household afterwards."
    >
      <form onSubmit={submit} noValidate>
        <Field label="Username">
          <input className="field" autoComplete="username" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Display name" hint="Optional. Shown in the sidebar.">
          <input className="field" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <input className="field" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {error ? <div className="mb-4"><ErrorLine>{error}</ErrorLine></div> : null}
        <button className="btn btn-ink mt-2 w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create admin account'}
        </button>
      </form>
    </AuthSheet>
  );
}

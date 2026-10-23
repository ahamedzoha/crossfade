'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ErrorLine } from '@/components/page';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthSheet, Field } from '../auth-sheet';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const session = useSession();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/';

  useEffect(() => {
    if (session.data?.needsSetup) router.replace('/setup');
    else if (session.data?.authenticated) router.replace(next);
  }, [session.data, router, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: form });
      await qc.invalidateQueries({ queryKey: ['session'] });
      router.replace(next);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Field label="Username">
        <input className="field" autoComplete="username" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </Field>
      <Field label="Password">
        <input className="field" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
      {error ? <div className="mb-4"><ErrorLine>{error}</ErrorLine></div> : null}
      <button className="btn btn-ink mt-2 w-full" disabled={busy || !form.username || !form.password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthSheet title="Sign in" intro="Your playlists, kept identical on every service.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthSheet>
  );
}

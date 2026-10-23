'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useOverview, useSession } from '@/lib/session';
import { Tape } from './tape';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/liked', label: 'Liked Songs' },
  { href: '/playlists', label: 'Playlists' },
  { href: '/review', label: 'Review' },
  { href: '/runs', label: 'Runs' },
  { href: '/connections', label: 'Connections' },
  { href: '/developers', label: 'API & Webhooks' },
  { href: '/settings', label: 'Settings' },
  { href: '/guide', label: 'Guide' },
] as const;

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!session.data) return;
    if (session.data.needsSetup) router.replace('/setup');
    else if (!session.data.authenticated) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [session.data, router, path]);

  useEffect(() => setOpen(false), [path]);

  if (!session.data?.authenticated) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <span className="display text-[22px] text-n4" aria-live="polite">
          {session.isError ? 'Crossfade is not responding' : 'Crossfade'}
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[200px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-paper focus:px-3 focus:py-2 focus:text-ink">
        Skip to content
      </a>

      {/* Phone / tablet bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-n2 bg-deck/95 px-4 backdrop-blur-sm lg:hidden">
        <Link href="/" className="display text-[19px] no-underline [font-stretch:118%]">
          Crossfade
        </Link>
        <button className="btn btn-quiet btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="rail">
          {open ? <X size={18} /> : <Menu size={18} />}
          <span>{open ? 'Close' : 'Menu'}</span>
        </button>
      </div>

      <aside
        id="rail"
        className={`${open ? 'flex' : 'hidden'} fixed inset-x-0 top-14 bottom-0 z-20 flex-col border-r border-n2 bg-deck px-3.5 pt-4 pb-5 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:pt-[30px]`}
      >
        <Link href="/" className="display hidden px-3 pb-10 text-[22px] no-underline [font-stretch:112%] lg:block">
          Crossfade
        </Link>
        <Nav path={path} />
        <UserChip name={session.data.user?.displayName ?? ''} role={session.data.user?.role ?? 'member'} />
      </aside>

      <div id="main" className="min-w-0">
        {children}
      </div>
    </div>
  );
}

function Nav({ path }: { path: string }) {
  const overview = useOverview();
  const review = overview.data?.reviewCount ?? 0;
  const broken = overview.data?.connections.filter((c) => c.status === 'expired' || c.status === 'error').length ?? 0;
  const expiring = overview.data?.connections.filter((c) => c.status === 'expiring').length ?? 0;
  return (
    <nav aria-label="Main" className="flex flex-col">
      {NAV.map((item) => {
        const active = isActive(path, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-[38px] items-center justify-between border-l-[3px] px-3 text-[14.5px] no-underline transition-colors ${
              active ? 'border-paper bg-n1 font-bold text-paper' : 'border-transparent font-semibold text-n6 hover:bg-n1/60 hover:text-paper'
            }`}
          >
            {item.label}
            {item.href === '/review' && review > 0 ? <Tape kind="warn">{review > 99 ? '99+' : review}</Tape> : null}
            {item.href === '/connections' && broken ? <Tape kind="hazard" title={`${broken} connection${broken === 1 ? '' : 's'} need reconnecting`} /> : null}
            {item.href === '/connections' && !broken && expiring ? (
              <Tape kind="warn" title={`${expiring} sign-in${expiring === 1 ? '' : 's'} expiring soon`}>
                {expiring}
              </Tape>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function UserChip({ name, role }: { name: string; role: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    router.replace('/login');
  };
  return (
    <div className="mt-auto flex items-center gap-2.5 border-t border-n2 px-3 pt-3.5">
      <b className="grid h-[30px] w-[30px] shrink-0 place-items-center bg-n3 font-extrabold uppercase">{name.slice(0, 1)}</b>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-semibold">{name}</div>
        <small className="text-[12px] text-n5">{role}</small>
      </div>
      <button className="btn btn-quiet btn-xs text-n6" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}

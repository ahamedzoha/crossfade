import type { ReactNode } from 'react';

/** Page header on the deck: the heading carries its own weight, actions sit right. */
export function PageHeader({ title, sub, actions, size = 'lg' }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; size?: 'lg' | 'md' }) {
  return (
    <header className="flex flex-col gap-4 border-b border-n2 px-4 pt-6 pb-5 sm:px-7 md:flex-row md:items-end md:justify-between lg:min-h-[108px] lg:pt-8">
      <div className="min-w-0">
        <h1 className={`display ${size === 'lg' ? 'text-[28px] sm:text-[34px]' : 'text-[26px]'}`}>{title}</h1>
        {sub ? <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-n6">{sub}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-end gap-3">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, children, aside, className = '' }: { title: string; children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="label">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-[13px] font-semibold">
      <i className="tape tape-hazard mt-0.5" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

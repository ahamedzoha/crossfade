import type { ReactNode } from 'react';
import { TapeCorners } from '@/components/tape';

export function AuthSheet({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-[420px]">
        <p className="display mb-8 text-center text-[20px] text-n6 [font-stretch:118%]">Crossfade</p>
        <section className="sheet sheet-tilt px-6 pt-8 pb-7 sm:px-8">
          <TapeCorners />
          <h1 className="display text-[30px] [font-stretch:116%]">{title}</h1>
          <div className="mt-3 mb-6 text-[14px] text-n4">{intro}</div>
          {children}
        </section>
      </div>
    </main>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="label mb-2">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[12.5px] text-n4">{hint}</span> : null}
    </label>
  );
}

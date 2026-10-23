'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'ok' | 'warn' | 'error';
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

let next = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = 'ok') => {
    const id = next++;
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-[min(92vw,440px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="sheet press-in pointer-events-auto flex items-start gap-3 px-4 py-3 text-[14px] font-semibold" role={t.tone === 'error' ? 'alert' : 'status'}>
            <i className={`tape mt-0.5 ${t.tone === 'ok' ? 'tape-gaffer' : t.tone === 'warn' ? 'tape-warn' : 'tape-hazard'}`} aria-hidden="true" />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

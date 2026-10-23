import type { ProviderId } from '@crossfade/shared';
import { serviceName } from '@/lib/services';
import { SetlistHead, SetlistRow } from './setlist';
import { Tape, TapeCorners } from './tape';

const SERVICES: ProviderId[] = ['spotify', 'ytmusic', 'apple'];

function Arrow({ dir = 'right', className = '' }: { dir?: 'right' | 'left' | 'down'; className?: string }) {
  const rot = dir === 'left' ? 180 : dir === 'down' ? 90 : 0;
  return (
    <svg viewBox="0 0 48 12" className={`h-3 w-12 ${className}`} style={{ transform: `rotate(${rot}deg)` }} aria-hidden="true">
      <path d="M1 6 H44 M38 1.5 L45 6 L38 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Services → one clean list → services. The whole product in one picture. */
export function SyncDiagram() {
  const column = (label: string) => (
    <div className="flex flex-col gap-2.5">
      <span className="label">{label}</span>
      {SERVICES.map((p) => (
        <div key={p} className="flex items-center gap-2.5 text-[13.5px] text-n7">
          <Tape provider={p} />
          {serviceName(p)}
        </div>
      ))}
    </div>
  );
  return (
    <figure className="grid items-center gap-5 md:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]" aria-label="How a sync works">
      {column('Read from')}
      <div className="flex justify-center text-n5 md:flex-col md:items-center">
        <Arrow className="hidden md:block" />
        <Arrow dir="down" className="md:hidden" />
        <span className="label mt-1 hidden md:block">pull</span>
      </div>
      <div className="sheet px-4 pt-4 pb-2">
        <p className="text-[12px] text-n4">Canonical list · kept by Crossfade</p>
        <p className="display mt-1 text-[22px] [font-stretch:116%]">Late Night Drive</p>
        <div className="mt-2 border-t-2 border-ink text-[13px]">
          <DiagramRow n="1" title="Midnight City" />
          <DiagramRow n="2" title="Instant Crush" plus note="added on YouTube Music" />
          <DiagramRow title="Dreams (Remaster)" struck note="duplicate, collapsed" />
          <DiagramRow n="3" title="Teardrop" />
        </div>
        <p className="label mt-2 !text-n4">merge · dedupe · guard</p>
      </div>
      <div className="flex justify-center text-n5 md:flex-col md:items-center">
        <Arrow className="hidden md:block" />
        <Arrow dir="down" className="md:hidden" />
        <span className="label mt-1 hidden md:block">push</span>
      </div>
      {column('Written to')}
    </figure>
  );
}

function DiagramRow({ n, title, plus, struck, note }: { n?: string; title: string; plus?: boolean; struck?: boolean; note?: string }) {
  return (
    <div className="relative grid grid-cols-[14px_16px_minmax(0,1fr)] items-baseline gap-x-2 border-b border-n7 py-1.5">
      <span className="font-hand text-[18px] leading-none font-bold" aria-hidden="true">
        {plus ? '+' : ''}
      </span>
      <span className="text-right font-extrabold">{n ?? ''}</span>
      <span className="min-w-0">
        <span className={`font-extrabold uppercase ${struck ? 'text-n4 line-through decoration-ink decoration-[2.5px]' : ''}`}>{title}</span>
        {note ? <span className="note ml-2 inline-block text-[12.5px]">{note}</span> : null}
      </span>
    </div>
  );
}

/** Tiny drawn arrows for the three link directions. */
export function DirectionGlyph({ kind }: { kind: 'both' | 'pull' | 'push' }) {
  return (
    <svg viewBox="0 0 84 20" className="h-5 w-[84px] shrink-0" aria-hidden="true">
      {/* left: the service's playlist (a strip of tape); right: Crossfade's sheet */}
      <rect x="1" y="6" width="22" height="8" fill="currentColor" opacity="0.45" />
      <rect x="61" y="1" width="22" height="18" fill="var(--color-paper)" />
      {kind !== 'push' ? <path d="M26 7 H56 M51 3.5 L57 7 L51 10.5" fill="none" stroke="currentColor" strokeWidth="1.5" /> : null}
      {kind !== 'pull' ? <path d="M58 13 H28 M33 9.5 L27 13 L33 16.5" fill="none" stroke="currentColor" strokeWidth="1.5" /> : null}
    </svg>
  );
}

/** A live sample sheet using the real row component, with every marking the app uses. */
export function LegendSheet() {
  return (
    <section className="sheet px-4 pt-5 sm:px-[22px]" aria-label="Example setlist">
      <TapeCorners />
      <p className="text-[12.5px] text-n4">Example · not your data</p>
      <div className="mt-3">
        <SetlistHead art />
        <SetlistRow id="g1" num={1} art={null} title="Midnight City" sub="M83" durationMs={243_000} tabs={tabs(['p', 'p', 'p'])} />
        <SetlistRow
          id="g2"
          num={2}
          art={null}
          title="Instant Crush"
          sub="Daft Punk, Julian Casablancas"
          durationMs={337_000}
          mark="plus"
          tabs={tabs(['p', 'p', 'p'])}
          note="added on YouTube Music · pushed to 2 others"
        />
        <SetlistRow
          id="g3"
          num={null}
          art={null}
          title="Dreams - 2004 Remaster"
          sub="Fleetwood Mac"
          durationMs={257_000}
          mark="strike"
          tabs={tabs(['g', 'g', 'g'])}
          note="duplicate of Dreams; kept the earlier one"
        />
        <SetlistRow
          id="g4"
          num={null}
          art={null}
          title="Electric Feel"
          sub="MGMT"
          durationMs={229_000}
          mark="strike"
          tabs={tabs(['g', 'g', 'p'])}
          note={
            <>
              removed on Spotify · <mark>Apple Music: remove by hand</mark>
            </>
          }
        />
        <SetlistRow id="g5" num={3} art={null} title="Redbone" sub="Childish Gambino" durationMs={326_000} tabs={tabs(['p', 'r', 'p'])} note={<mark>matched on YouTube Music at 71%, please check</mark>} />
      </div>
      <div className="h-4" />
    </section>
  );
}

function tabs(states: ('p' | 'm' | 'g' | 'r')[]) {
  return states.map((s, i) => {
    const p = SERVICES[i]!;
    if (s === 'p') return <Tape key={p} provider={p} />;
    if (s === 'r') return <Tape key={p} kind="warn" title={`${serviceName(p)}: needs review`}>Review</Tape>;
    return <Tape key={p} kind="missing" title={s === 'g' ? `Gone from ${serviceName(p)}` : `Not on ${serviceName(p)} yet`} />;
  });
}

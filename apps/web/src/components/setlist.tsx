import type { ReactNode } from 'react';
import { duration } from '@/lib/format';
import { Strike } from './strike';

export function SetlistHead({ notes = 'Notes', art = false }: { notes?: string; art?: boolean }) {
  return (
    <div className={`setlist-head ${art ? 'has-art' : ''}`} aria-hidden="true">
      <span />
      <span>#</span>
      {art ? <span /> : null}
      <span>Title · artist</span>
      <span className="text-right">Time</span>
      <span>Held on</span>
      <span>{notes}</span>
    </div>
  );
}

export function SetlistRow({
  id,
  num,
  title,
  sub,
  durationMs,
  tabs,
  note,
  mark,
  drawStrike,
  strikeDelay,
  actions,
  measure,
  pinActions,
  className = '',
  art,
}: {
  id: string;
  num: number | string | null;
  title: string;
  sub?: ReactNode;
  durationMs?: number | null;
  tabs?: ReactNode;
  note?: ReactNode;
  mark?: 'plus' | 'strike' | null;
  drawStrike?: boolean;
  strikeDelay?: number;
  actions?: ReactNode;
  /** Replaces the duration column, e.g. a track count. */
  measure?: ReactNode;
  /** Keep actions visible instead of revealing them on hover. */
  pinActions?: boolean;
  className?: string;
  /** Cover art URL; `null` draws an empty cover slot, `undefined` drops the column. */
  art?: string | null;
}) {
  const struck = mark === 'strike';
  return (
    <div className={`setlist-row group ${struck ? 'is-struck' : ''} ${art !== undefined ? 'has-art' : ''} ${className}`} data-row-title={title}>
      <span className="sl-plus setlist-plus" aria-hidden="true">
        {mark === 'plus' ? '+' : ''}
      </span>
      <span className="sl-num setlist-num">{num ?? ''}</span>
      {art !== undefined ? (
        <span className="sl-art" aria-hidden="true">
          {art ? <img src={art} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
        </span>
      ) : null}
      <div className="sl-title min-w-0">
        <div className="setlist-title">
          {struck ? <span className="sr-only">Removed: </span> : null}
          {title}
        </div>
        {sub ? <span className="setlist-sub">{sub}</span> : null}
      </div>
      <span className="sl-dur setlist-dur">{measure ?? duration(durationMs)}</span>
      <span className="sl-tabs flex min-h-6 flex-wrap items-center gap-1">{tabs}</span>
      <span className="sl-note note min-w-0 self-center">{note}</span>
      <span
        className={`sl-actions flex shrink-0 items-center gap-1 self-center transition-opacity ${
          pinActions ? '' : 'md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100'
        }`}
      >
        {actions}
      </span>
      {struck ? (
        <span className="strike-lane" aria-hidden="true">
          <Strike seed={id} draw={drawStrike} delay={strikeDelay} />
        </span>
      ) : null}
    </div>
  );
}

/** A duration drawn to true scale on a ruler. */
export function Ruler({ value, max, width = 240, tick }: { value: number; max: number; width?: number; tick?: number }) {
  const w = Math.max(2, Math.min(width, (value / Math.max(max, 1)) * width));
  return (
    <span className="ruler inline-block" style={{ width, ['--tick' as string]: `${tick ?? width / 6}px` }} aria-hidden="true">
      <i style={{ width: w }} />
    </span>
  );
}

import type { ProviderId } from '@crossfade/shared';
import type { ReactNode } from 'react';
import { serviceName, TAPE } from '@/lib/services';

type Kind = 'warn' | 'hazard' | 'gaffer' | 'missing' | 'struck';

/** A strip of spike tape. Colour only ever means a service or a state. */
export function Tape({
  provider,
  kind,
  children,
  className = '',
  title,
  wide,
}: {
  provider?: ProviderId;
  kind?: Kind;
  children?: ReactNode;
  className?: string;
  title?: string;
  wide?: boolean;
}) {
  const cls = provider && !kind ? TAPE[provider].cls : kind ? `tape-${kind}` : 'tape-gaffer';
  const label = children ?? (provider ? TAPE[provider].abbr : null);
  const name = title ?? (provider ? serviceName(provider) : typeof children === 'string' || typeof children === 'number' ? String(children) : undefined);
  return (
    <i
      className={`tape ${cls} ${wide ? 'px-1.5' : ''} ${className}`}
      title={name}
      {...(name ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
    >
      {label}
    </i>
  );
}

/** Two strips of gaffer tape holding a sheet to the deck. */
export function TapeCorners() {
  const strip = (
    <svg viewBox="0 0 92 24" className="h-full w-full" aria-hidden="true">
      <path
        d="M3 2 L6 0 L9 3 L12 1 L88 1 L90 4 L87 7 L91 10 L88 13 L91 17 L88 20 L90 23 L12 23 L9 21 L6 24 L3 21 L5 18 L1 15 L4 12 L1 9 L4 6 Z"
        fill="currentColor"
      />
    </svg>
  );
  return (
    <>
      <span className="tape-corner l">{strip}</span>
      <span className="tape-corner r">{strip}</span>
    </>
  );
}

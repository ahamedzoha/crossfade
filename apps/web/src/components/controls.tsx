'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

/** Two-step destructive button: first click arms it, second click within 4 s confirms. No browser dialogs. */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Click again to confirm',
  className = 'btn btn-ghost btn-sm',
  disabled,
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className} ${armed ? '!bg-warn !text-ink !shadow-none' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function CopyButton({ value, label = 'Copy', className = 'btn btn-ghost btn-xs' }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          // Clipboard needs a secure context; the value is selectable anyway.
        }
      }}
    >
      {done ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {done ? 'Copied' : label}
    </button>
  );
}

export const SCHEDULES: { value: number; label: string }[] = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Hourly' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Daily' },
];

export const DIRECTIONS = [
  { value: 'both', label: 'Two-way', help: 'Changes here sync out, and this gets every change' },
  { value: 'pull', label: 'Read only', help: 'Changes here sync out; Crossfade never writes to it' },
  { value: 'push', label: 'Mirror', help: 'Crossfade makes it match exactly; edits here are undone' },
] as const;

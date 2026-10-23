import type { RunSummary } from '@crossfade/shared';
import { Check } from 'lucide-react';
import { Tape } from './tape';

export function StatusTape({ r }: { r: RunSummary }) {
  switch (r.status) {
    case 'success':
      return <Check size={15} aria-label="Succeeded" role="img" />;
    case 'guarded':
      return <Tape kind="warn">Guard</Tape>;
    case 'partial':
      return <Tape kind="warn">Partial</Tape>;
    case 'failed':
      return <Tape kind="hazard" title="Failed" />;
    case 'running':
      return <Tape kind="gaffer">Running</Tape>;
    default:
      return <Tape kind="gaffer">Queued</Tape>;
  }
}

'use client';

import type { Overview, SessionStatus } from '@crossfade/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useSession() {
  return useQuery({ queryKey: ['session'], queryFn: () => api<SessionStatus>('/auth/session'), staleTime: 60_000 });
}

/** Overview polls faster while something is running. */
export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/v1/overview'),
    refetchInterval: (q) => (q.state.data?.activeRuns.length ? 2_500 : 30_000),
  });
}

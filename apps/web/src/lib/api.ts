'use client';

import type { ApiError } from '@crossfade/shared';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: ApiError,
  ) {
    super(message);
  }
}

/** JSON fetch against the API. Writes carry the header the API's CSRF check expects. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    signal: init.signal,
    headers: {
      accept: 'application/json',
      'x-requested-with': 'crossfade',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204 || res.status === 202 && res.headers.get('content-length') === '0') return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const body = data as ApiError | undefined;
    throw new HttpError(res.status, body?.message ?? `Request failed (${res.status})`, body);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

export function errorText(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

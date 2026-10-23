import { setTimeout as sleep } from 'node:timers/promises';
import { AuthExpiredError, ProviderHttpError } from './errors.js';

export interface FetchJsonOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Max attempts for 429/5xx/network errors. */
  retries?: number;
  /** Treat these statuses as "credentials expired". */
  authStatuses?: number[];
  label?: string;
  /** Retry 429s. Off for services whose rate limit grows when you keep knocking (Apple). */
  retry429?: boolean;
}

const MAX_RETRY_AFTER_MS = 120_000;

/**
 * JSON fetch with retries for 429 (honouring Retry-After), 5xx and network errors.
 * Returns undefined for empty bodies (204/202).
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { retries = 4, authStatuses = [401], label = 'request', retry429 = true, body, headers, ...init } = opts;
  let attempt = 0;
  for (;;) {
    attempt++;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          accept: 'application/json',
          ...(body !== undefined && !(body instanceof URLSearchParams) ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body:
          body === undefined ? undefined : body instanceof URLSearchParams ? body : JSON.stringify(body),
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(backoff(attempt));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries || (res.status === 429 && !retry429)) {
        throw new ProviderHttpError(res.status, `${label} failed: HTTP ${res.status}`, await safeBody(res));
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
      await sleep(Math.min(wait, MAX_RETRY_AFTER_MS));
      continue;
    }

    if (authStatuses.includes(res.status)) {
      throw new AuthExpiredError();
    }

    if (!res.ok) {
      const errBody = await safeBody(res);
      throw new ProviderHttpError(res.status, `${label} failed: HTTP ${res.status} ${describe(errBody)}`.trim(), errBody);
    }

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

function backoff(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
}

async function safeBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return undefined;
  }
}

function describe(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 200);
  const b = body as { error?: { message?: string } | string; error_description?: string; message?: string };
  if (typeof b.error === 'object' && b.error?.message) return b.error.message;
  if (typeof b.error_description === 'string') return b.error_description;
  if (typeof b.error === 'string') return b.error;
  if (typeof b.message === 'string') return b.message;
  return '';
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

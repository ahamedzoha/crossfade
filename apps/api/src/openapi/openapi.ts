import {
  createPlaylistSchema,
  linkTargetSchema,
  resolveReviewSchema,
  syncRequestSchema,
  updateLinkSchema,
  updatePlaylistSchema,
  WEBHOOK_EVENTS,
} from '@crossfade/shared';
import { z } from 'zod';

interface Op {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  summary: string;
  scope: 'read' | 'write';
  tag: string;
  body?: z.ZodType;
  query?: Record<string, { type: string; description: string; enum?: string[] }>;
  returns: string;
  status?: number;
}

const OPS: Op[] = [
  { method: 'get', path: '/api/v1/overview', summary: 'Sync health, counts, recent runs and the last run in detail', scope: 'read', tag: 'Overview', returns: 'Overview' },
  { method: 'get', path: '/api/v1/playlists', summary: 'List canonical playlists with links, counts and last run', scope: 'read', tag: 'Playlists', returns: 'PlaylistSummary[]' },
  { method: 'post', path: '/api/v1/playlists', summary: 'Create a canonical playlist and link services', scope: 'write', tag: 'Playlists', body: createPlaylistSchema, returns: 'PlaylistSummary' },
  { method: 'get', path: '/api/v1/playlists/{id}', summary: 'The clean canonical list: active entries (with per-service availability) and recently removed ones', scope: 'read', tag: 'Playlists', returns: 'PlaylistDetail' },
  { method: 'patch', path: '/api/v1/playlists/{id}', summary: 'Rename, change schedule, dedupe mode or guard', scope: 'write', tag: 'Playlists', body: updatePlaylistSchema, returns: 'PlaylistSummary' },
  { method: 'delete', path: '/api/v1/playlists/{id}', summary: 'Stop syncing and forget the canonical list (service playlists are left alone)', scope: 'write', tag: 'Playlists', returns: 'nothing', status: 204 },
  { method: 'get', path: '/api/v1/playlists/{id}/export', summary: 'Export the canonical list', scope: 'read', tag: 'Playlists', query: { format: { type: 'string', enum: ['json', 'csv', 'jspf', 'm3u'], description: 'Output format (default json)' } }, returns: 'file' },
  { method: 'post', path: '/api/v1/playlists/{id}/sync', summary: 'Queue a sync now (returns the run; an already queued run is returned instead of a new one)', scope: 'write', tag: 'Sync', body: syncRequestSchema, returns: 'RunSummary', status: 202 },
  { method: 'post', path: '/api/v1/sync', summary: 'Queue a sync of every enabled playlist', scope: 'write', tag: 'Sync', returns: 'RunSummary[]', status: 202 },
  { method: 'post', path: '/api/v1/playlists/{id}/links', summary: 'Link another service playlist (existing or newly created)', scope: 'write', tag: 'Playlists', body: linkTargetSchema, returns: 'PlaylistSummary' },
  { method: 'patch', path: '/api/v1/playlists/{id}/links/{linkId}', summary: 'Change a link direction: both, pull (read only) or push (mirror)', scope: 'write', tag: 'Playlists', body: updateLinkSchema, returns: 'PlaylistSummary' },
  { method: 'delete', path: '/api/v1/playlists/{id}/links/{linkId}', summary: 'Unlink a service playlist', scope: 'write', tag: 'Playlists', returns: 'nothing', status: 204 },
  { method: 'delete', path: '/api/v1/playlists/{id}/entries/{entryId}', summary: 'Remove a track from the canonical list (propagates on next sync)', scope: 'write', tag: 'Playlists', returns: 'nothing', status: 204 },
  { method: 'post', path: '/api/v1/playlists/{id}/entries/{entryId}/restore', summary: 'Restore a removed or deduped track', scope: 'write', tag: 'Playlists', returns: 'nothing', status: 204 },
  { method: 'get', path: '/api/v1/tracks/{id}', summary: 'A canonical track and its ids on each service', scope: 'read', tag: 'Tracks', returns: 'Track' },
  { method: 'get', path: '/api/v1/runs', summary: 'Sync run history', scope: 'read', tag: 'Sync', query: { playlistId: { type: 'string', description: 'Filter by playlist' }, status: { type: 'string', enum: ['queued', 'running', 'success', 'partial', 'failed', 'guarded'], description: 'Filter by status' }, limit: { type: 'integer', description: '1–200, default 50' }, offset: { type: 'integer', description: 'Default 0' } }, returns: 'Paged<RunSummary>' },
  { method: 'get', path: '/api/v1/runs/{id}', summary: 'One run with every change and its log', scope: 'read', tag: 'Sync', returns: 'RunDetail' },
  { method: 'get', path: '/api/v1/review', summary: 'Tracks waiting for a matching decision', scope: 'read', tag: 'Review', query: { playlistId: { type: 'string', description: 'Filter by playlist' } }, returns: 'ReviewItem[]' },
  { method: 'post', path: '/api/v1/review/{id}', summary: 'Resolve a review item: accept a candidate, give a link, ignore, or mark a manual removal done', scope: 'write', tag: 'Review', body: resolveReviewSchema, returns: 'MatchCandidate | nothing' },
  { method: 'get', path: '/api/v1/settings', summary: 'Instance settings (schedule default, guard, match thresholds)', scope: 'read', tag: 'Settings', returns: 'InstanceSettings' },
];

export function buildOpenApi(version: string, serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    for (const [name, q] of Object.entries(op.query ?? {})) {
      params.push({ name, in: 'query', required: false, schema: { type: q.type, ...(q.enum ? { enum: q.enum } : {}) }, description: q.description } as never);
    }
    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      tags: [op.tag],
      summary: op.summary,
      description: `Requires an API key with the \`${op.scope}\` scope. Returns \`${op.returns}\` (see the type reference in the app under API & Webhooks).`,
      parameters: params,
      ...(op.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(op.body, { io: 'input', unrepresentable: 'any' }) } } } }
        : {}),
      responses: {
        [String(op.status ?? 200)]: { description: op.returns },
        '401': { description: 'Missing or invalid API key' },
        '403': { description: 'API key lacks the required scope' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Crossfade API',
      version,
      description:
        'Read the clean, deduplicated canonical playlists and trigger syncs. Authenticate with `Authorization: Bearer cf_…` (create keys under API & Webhooks).\n\n' +
        `Webhook events: ${WEBHOOK_EVENTS.join(', ')}. Deliveries are POSTed as JSON with an \`X-Crossfade-Signature: sha256=<hmac>\` header computed over the raw body with your webhook secret.`,
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'cf_…' } } },
    paths,
  };
}

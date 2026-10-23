import { z } from 'zod';
import { PROVIDERS } from './providers.js';
import { WEBHOOK_EVENTS } from './types.js';

export const providerIdSchema = z.enum(PROVIDERS);

const username = z
  .string()
  .trim()
  .min(2, 'At least 2 characters')
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only');
const password = z.string().min(8, 'At least 8 characters').max(200);

export const setupSchema = z.object({
  username,
  displayName: z.string().trim().min(1).max(60).optional(),
  password,
});
export type SetupInput = z.infer<typeof setupSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  username,
  displayName: z.string().trim().min(1).max(60).optional(),
  password,
  role: z.enum(['admin', 'member']).default('member'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  currentPassword: z.string().optional(),
  newPassword: password.optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const providerConfigSchema = z.record(z.string(), z.string().max(10_000));
export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;

export const oauthCompleteSchema = z.object({
  /** Full URL the provider redirected to (paste-back flow) or the raw code. */
  url: z.string().trim().min(1),
});

export const ytmusicConnectSchema = z.object({
  cookie: z.string().trim().min(20, 'Paste the full Cookie header value'),
});

export const appleConnectSchema = z.object({
  musicUserToken: z.string().trim().min(20),
});

export const appleWebConnectSchema = z.object({
  mediaUserToken: z.string().trim().min(20, 'Paste the media-user-token cookie value'),
});

export const linkTargetSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('existing'),
    connectionId: z.string(),
    providerPlaylistId: z.string(),
    direction: z.enum(['both', 'pull', 'push']).default('both'),
  }),
  z.object({
    mode: z.literal('create'),
    connectionId: z.string(),
    name: z.string().trim().min(1).max(100).optional(),
    direction: z.enum(['both', 'push']).default('both'),
  }),
]);
export type LinkTargetInput = z.infer<typeof linkTargetSchema>;

export const createPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).optional(),
  kind: z.enum(['playlist', 'liked']).default('playlist'),
  links: z.array(linkTargetSchema).max(10).default([]),
  syncNow: z.boolean().default(true),
  /** Make the first sync a dry run, so nothing is written until the user has seen it. */
  preview: z.boolean().default(false),
});
export type CreatePlaylistInput = z.infer<typeof createPlaylistSchema>;

export const updatePlaylistSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  syncEnabled: z.boolean().optional(),
  scheduleMinutes: z.number().int().min(5).max(10_080).nullable().optional(),
  dedupeMode: z.enum(['strict', 'loose']).optional(),
  guardPercent: z.number().int().min(1).max(100).optional(),
});
export type UpdatePlaylistInput = z.infer<typeof updatePlaylistSchema>;

export const updateLinkSchema = z.object({
  direction: z.enum(['both', 'pull', 'push']),
});

export const syncRequestSchema = z.object({
  dryRun: z.boolean().default(false),
  /** Bypass the mass-deletion guard for this one run. */
  overrideGuard: z.boolean().default(false),
});
export type SyncRequestInput = z.infer<typeof syncRequestSchema>;

export const resolveReviewSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), providerTrackId: z.string().min(1) }),
  z.object({ action: z.literal('url'), url: z.string().trim().min(1) }),
  z.object({ action: z.literal('ignore') }),
  z.object({ action: z.literal('done') }),
]);
export type ResolveReviewInput = z.infer<typeof resolveReviewSchema>;

export const restoreEntrySchema = z.object({
  entryId: z.string(),
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(['read', 'write'])).min(1).default(['read']),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const createWebhookSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  active: z.boolean().optional(),
});

export const instanceSettingsSchema = z.object({
  defaultScheduleMinutes: z.number().int().min(5).max(10_080).optional(),
  guardPercent: z.number().int().min(1).max(100).optional(),
  autoAcceptScore: z.number().min(0.5).max(1).optional(),
  reviewScore: z.number().min(0.3).max(1).optional(),
  dedupeMode: z.enum(['strict', 'loose']).optional(),
});
export type InstanceSettingsInput = z.infer<typeof instanceSettingsSchema>;

export const runsQuerySchema = z.object({
  playlistId: z.string().optional(),
  status: z.enum(['queued', 'running', 'success', 'partial', 'failed', 'guarded']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

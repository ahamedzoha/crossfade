import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  type CreatePlaylistInput,
  createPlaylistSchema,
  type CreateWebhookInput,
  createWebhookSchema,
  type InstanceSettingsInput,
  instanceSettingsSchema,
  type LinkTargetInput,
  linkTargetSchema,
  type ResolveReviewInput,
  resolveReviewSchema,
  runsQuerySchema,
  type SyncRequestInput,
  syncRequestSchema,
  type UpdatePlaylistInput,
  updateLinkSchema,
  updatePlaylistSchema,
  updateWebhookSchema,
} from '@crossfade/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminOnly, CurrentUser, SessionOnly } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { EXPORT_TYPES, type ExportFormat, renderExport } from '../export/export.js';
import { OverviewService } from '../overview/overview.service.js';
import { ReviewService } from '../review/review.service.js';
import { RunsService } from '../runs/runs.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SyncService } from '../sync/sync.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PlaylistsService } from './playlists.service.js';
import { TracksService } from './tracks.service.js';
import { NotFoundException } from '@nestjs/common';

const exportQuery = z.object({ format: z.enum(['json', 'csv', 'jspf', 'm3u']).default('json') });

@Controller('v1')
export class V1Controller {
  constructor(
    private readonly playlists: PlaylistsService,
    private readonly sync: SyncService,
    private readonly runs: RunsService,
    private readonly review: ReviewService,
    private readonly overview: OverviewService,
    private readonly settings: SettingsService,
    private readonly webhooks: WebhooksService,
    private readonly tracks: TracksService,
  ) {}

  @Get('overview')
  getOverview(@CurrentUser() me: AuthContext) {
    return this.overview.get(me.userId);
  }

  // ----------------------------------------------------------------- playlists

  @Get('playlists')
  listPlaylists(@CurrentUser() me: AuthContext) {
    return this.playlists.list(me.userId);
  }

  @Post('playlists')
  createPlaylist(@CurrentUser() me: AuthContext, @Body(new ZodPipe(createPlaylistSchema)) body: CreatePlaylistInput) {
    return this.playlists.create(me.userId, body);
  }

  @Get('playlists/:id')
  getPlaylist(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    return this.playlists.detail(me.userId, id);
  }

  @Patch('playlists/:id')
  updatePlaylist(@CurrentUser() me: AuthContext, @Param('id') id: string, @Body(new ZodPipe(updatePlaylistSchema)) body: UpdatePlaylistInput) {
    return this.playlists.update(me.userId, id, body);
  }

  @Delete('playlists/:id')
  @HttpCode(204)
  deletePlaylist(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    this.playlists.remove(me.userId, id);
  }

  @Post('playlists/:id/sync')
  @HttpCode(202)
  syncPlaylist(@CurrentUser() me: AuthContext, @Param('id') id: string, @Body(new ZodPipe(syncRequestSchema)) body: SyncRequestInput) {
    return this.sync.request(me.userId, id, me.via === 'key' ? 'api' : 'manual', body);
  }

  @Post('sync')
  @HttpCode(202)
  syncAll(@CurrentUser() me: AuthContext) {
    return this.playlists
      .list(me.userId)
      .filter((p) => p.syncEnabled && p.links.length)
      .map((p) => this.sync.request(me.userId, p.id, me.via === 'key' ? 'api' : 'manual'));
  }

  @Post('playlists/:id/links')
  addLink(@CurrentUser() me: AuthContext, @Param('id') id: string, @Body(new ZodPipe(linkTargetSchema)) body: LinkTargetInput) {
    return this.playlists.addLink(me.userId, id, body);
  }

  @Patch('playlists/:id/links/:linkId')
  updateLink(
    @CurrentUser() me: AuthContext,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body(new ZodPipe(updateLinkSchema)) body: { direction: 'both' | 'pull' | 'push' },
  ) {
    return this.playlists.updateLink(me.userId, id, linkId, body.direction);
  }

  @Delete('playlists/:id/links/:linkId')
  @HttpCode(204)
  removeLink(@CurrentUser() me: AuthContext, @Param('id') id: string, @Param('linkId') linkId: string) {
    this.playlists.removeLink(me.userId, id, linkId);
  }

  @Delete('playlists/:id/entries/:entryId')
  @HttpCode(204)
  removeEntry(@CurrentUser() me: AuthContext, @Param('id') id: string, @Param('entryId') entryId: string) {
    this.playlists.removeEntry(me.userId, id, entryId);
  }

  @Post('playlists/:id/entries/:entryId/restore')
  @HttpCode(204)
  restoreEntry(@CurrentUser() me: AuthContext, @Param('id') id: string, @Param('entryId') entryId: string) {
    this.playlists.restoreEntry(me.userId, id, entryId);
  }

  @Get('playlists/:id/export')
  exportPlaylist(
    @CurrentUser() me: AuthContext,
    @Param('id') id: string,
    @Query(new ZodPipe(exportQuery)) q: { format: ExportFormat },
    @Res() res: Response,
  ) {
    const detail = this.playlists.detail(me.userId, id);
    const type = EXPORT_TYPES[q.format];
    const filename = `${detail.name.replace(/[^\w\- ]+/g, '').trim() || 'playlist'}.${type.ext}`;
    res.setHeader('content-type', type.mime);
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.send(renderExport(detail, q.format));
  }

  // ----------------------------------------------------------------- tracks

  @Get('tracks/:id')
  getTrack(@Param('id') id: string) {
    const row = this.tracks.get(id);
    if (!row) throw new NotFoundException('Track not found');
    return this.tracks.toDto(row);
  }

  // ----------------------------------------------------------------- runs

  @Get('runs')
  listRuns(@CurrentUser() me: AuthContext, @Query(new ZodPipe(runsQuerySchema)) q: z.infer<typeof runsQuerySchema>) {
    return this.runs.list(me.userId, q);
  }

  @Get('runs/:id')
  getRun(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    return this.runs.detail(me.userId, id);
  }

  // ----------------------------------------------------------------- review

  @Get('review')
  listReview(@CurrentUser() me: AuthContext, @Query('playlistId') playlistId?: string) {
    return this.review.list(me.userId, playlistId);
  }

  @Post('review/:id')
  @HttpCode(200)
  resolveReview(@CurrentUser() me: AuthContext, @Param('id') id: string, @Body(new ZodPipe(resolveReviewSchema)) body: ResolveReviewInput) {
    return this.review.resolve(me.userId, id, body);
  }

  @Post('review/:id/refresh')
  @HttpCode(200)
  refreshReview(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    return this.review.refresh(me.userId, id);
  }

  // ----------------------------------------------------------------- settings

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @AdminOnly()
  @SessionOnly()
  @Patch('settings')
  updateSettings(@Body(new ZodPipe(instanceSettingsSchema)) body: InstanceSettingsInput) {
    return this.settings.update(body);
  }

  // ----------------------------------------------------------------- webhooks

  @SessionOnly()
  @Get('webhooks')
  listWebhooks(@CurrentUser() me: AuthContext) {
    return this.webhooks.list(me.userId);
  }

  @SessionOnly()
  @Post('webhooks')
  createWebhook(@CurrentUser() me: AuthContext, @Body(new ZodPipe(createWebhookSchema)) body: CreateWebhookInput) {
    return this.webhooks.create(me.userId, body);
  }

  @SessionOnly()
  @Patch('webhooks/:id')
  updateWebhook(@CurrentUser() me: AuthContext, @Param('id') id: string, @Body(new ZodPipe(updateWebhookSchema)) body: z.infer<typeof updateWebhookSchema>) {
    return this.webhooks.update(me.userId, id, body);
  }

  @SessionOnly()
  @Delete('webhooks/:id')
  @HttpCode(204)
  deleteWebhook(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    this.webhooks.remove(me.userId, id);
  }

  @SessionOnly()
  @Post('webhooks/:id/test')
  @HttpCode(202)
  testWebhook(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    this.webhooks.test(me.userId, id);
    return { queued: true };
  }
}

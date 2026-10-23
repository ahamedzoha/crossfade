import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  appleConnectSchema,
  appleWebConnectSchema,
  isProviderId,
  oauthCompleteSchema,
  providerConfigSchema,
  ytmusicConnectSchema,
  type ProviderConfigInput,
} from '@crossfade/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminOnly, CurrentUser, Public, SessionOnly } from '../auth/decorators.js';
import { errorMessage } from '../common/errors.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { appleDeveloperToken } from '../providers/apple/apple.client.js';
import { ProvidersService } from '../providers/providers.service.js';
import { ConnectionsService } from './connections.service.js';

@SessionOnly()
@Controller()
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly providers: ProvidersService,
  ) {}

  // ----------------------------------------------------------------- instance provider setup

  @Get('providers')
  setups(@CurrentUser() me: AuthContext) {
    return this.providers.allSetups(me.role === 'admin');
  }

  @AdminOnly()
  @Put('providers/:provider')
  saveSetup(@Param('provider') provider: string, @Body(new ZodPipe(providerConfigSchema)) body: ProviderConfigInput) {
    if (!isProviderId(provider)) throw new BadRequestException('Unknown provider');
    this.providers.saveConfig(provider, body);
    return this.providers.setup(provider, true);
  }

  @AdminOnly()
  @Delete('providers/:provider')
  @HttpCode(204)
  clearSetup(@Param('provider') provider: string) {
    if (!isProviderId(provider)) throw new BadRequestException('Unknown provider');
    this.providers.clearConfig(provider);
  }

  @Get('providers/apple/developer-token')
  async appleToken() {
    if (!this.providers.isConfigured('apple')) throw new BadRequestException('Apple Music is not set up yet');
    try {
      return { token: await appleDeveloperToken(this.providers.appleApp()) };
    } catch (err) {
      throw new BadRequestException(`Could not sign an Apple developer token. Check the key: ${errorMessage(err)}`);
    }
  }

  // ----------------------------------------------------------------- user connections

  @Get('connections')
  list(@CurrentUser() me: AuthContext) {
    return this.connections.list(me.userId);
  }

  @Delete('connections/:id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    this.connections.remove(me.userId, id);
  }

  @Post('connections/:id/check')
  @HttpCode(200)
  check(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    return this.connections.check(me.userId, id);
  }

  @Get('connections/:id/playlists')
  playlists(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    return this.connections.remotePlaylists(me.userId, id);
  }

  @Post('connections/spotify/authorize')
  @HttpCode(200)
  spotifyAuthorize(@CurrentUser() me: AuthContext) {
    return this.connections.spotifyAuthorize(me.userId);
  }

  /** Spotify redirects the browser here. Identified by `state`, so no session is needed. */
  @Public()
  @Get('connections/spotify/callback')
  async spotifyCallback(
    @Query(new ZodPipe(z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() })))
    q: { code?: string; state?: string; error?: string },
    @Res() res: Response,
  ) {
    const base = `${this.connections.appUrl()}/connections`;
    try {
      await this.connections.spotifyComplete(q);
      res.redirect(`${base}?connected=spotify`);
    } catch (err) {
      res.redirect(`${base}?error=${encodeURIComponent(errorMessage(err))}`);
    }
  }

  @Post('connections/spotify/complete')
  @HttpCode(200)
  spotifyPaste(@CurrentUser() me: AuthContext, @Body(new ZodPipe(oauthCompleteSchema)) body: { url: string }) {
    return this.connections.spotifyComplete(this.connections.parsePasted(body.url), me.userId);
  }

  @Post('connections/ytmusic')
  @HttpCode(200)
  ytmusic(@CurrentUser() me: AuthContext, @Body(new ZodPipe(ytmusicConnectSchema)) body: { cookie: string }) {
    return this.connections.connectYtMusic(me.userId, body.cookie);
  }

  @Post('connections/apple-web')
  @HttpCode(200)
  appleWeb(@CurrentUser() me: AuthContext, @Body(new ZodPipe(appleWebConnectSchema)) body: { mediaUserToken: string }) {
    return this.connections.connectAppleWeb(me.userId, body.mediaUserToken);
  }

  @Post('connections/apple')
  @HttpCode(200)
  apple(@CurrentUser() me: AuthContext, @Body(new ZodPipe(appleConnectSchema)) body: { musicUserToken: string }) {
    return this.connections.connectApple(me.userId, body.musicUserToken);
  }
}

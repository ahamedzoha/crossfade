import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Connection, PROVIDER_META, type ProviderId, type RemotePlaylist } from '@crossfade/shared';
import { and, eq } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CryptoService } from '../common/crypto.service.js';
import { AuthExpiredError, errorMessage } from '../common/errors.js';
import { newId, randomToken } from '../common/ids.js';
import { DB, type Db } from '../db/db.js';
import { connections, oauthStates, playlistLinks } from '../db/schema.js';
import { appleStorefront, type AppleCredentials } from '../providers/apple/apple.client.js';
import { LIKED_ID, type AccountIdentity } from '../providers/provider.types.js';
import { ProvidersService } from '../providers/providers.service.js';
import { exchangeSpotifyCode, spotifyAuthorizeUrl } from '../providers/spotify/spotify.client.js';
import { openYtMusicSession, YtMusicClient, type YtMusicCredentials } from '../providers/ytmusic/ytmusic.client.js';

type ConnectionRow = typeof connections.$inferSelect;

const SIX_MONTHS = 182 * 24 * 3600 * 1000;

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly providers: ProvidersService,
  ) {}

  list(userId: string): Connection[] {
    return this.db
      .select()
      .from(connections)
      .where(eq(connections.userId, userId))
      .orderBy(connections.createdAt)
      .all()
      .map((r) => this.providers.toDto(r));
  }

  get(userId: string, id: string): ConnectionRow {
    const row = this.db.select().from(connections).where(and(eq(connections.id, id), eq(connections.userId, userId))).get();
    if (!row) throw new NotFoundException('Connection not found');
    return row;
  }

  remove(userId: string, id: string) {
    this.get(userId, id);
    this.db.delete(connections).where(eq(connections.id, id)).run();
  }

  async check(userId: string, id: string): Promise<Connection> {
    const row = this.get(userId, id);
    try {
      const who = await this.providers.clientFor(row).whoami();
      this.db
        .update(connections)
        .set({ displayName: who.displayName, status: row.status === 'expiring' ? 'expiring' : 'active', statusMessage: row.status === 'expiring' ? row.statusMessage : null, updatedAt: Date.now() })
        .where(eq(connections.id, id))
        .run();
    } catch (err) {
      this.providers.markStatus(id, err instanceof AuthExpiredError ? 'expired' : 'error', errorMessage(err));
    }
    return this.providers.toDto(this.get(userId, id));
  }

  async remotePlaylists(userId: string, id: string): Promise<RemotePlaylist[]> {
    const row = this.get(userId, id);
    let items;
    try {
      items = await this.providers.clientFor(row).listPlaylists();
    } catch (err) {
      if (err instanceof AuthExpiredError) this.providers.markStatus(id, 'expired', err.message);
      throw new BadRequestException(errorMessage(err));
    }
    const links = new Map(
      this.db
        .select({ pid: playlistLinks.providerPlaylistId, playlistId: playlistLinks.playlistId })
        .from(playlistLinks)
        .where(eq(playlistLinks.connectionId, id))
        .all()
        .map((l) => [l.pid, l.playlistId]),
    );
    const meta = PROVIDER_META[row.provider as ProviderId];
    // The account's Liked / Favorites collection always comes first: it's where quick finds land.
    const liked: RemotePlaylist[] = meta.capabilities.likedRead
      ? [{ id: LIKED_ID, kind: 'liked', name: meta.likedLabel, trackCount: null, editable: true, url: null, imageUrl: null, linkedPlaylistId: links.get(LIKED_ID) ?? null }]
      : [];
    return [
      ...liked,
      ...items
        .map((p) => ({ ...p, kind: 'playlist' as const, linkedPlaylistId: links.get(p.id) ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }

  // ----------------------------------------------------------------- Spotify

  spotifyAuthorize(userId: string): { url: string; manual: boolean; redirectUri: string } {
    if (!this.providers.isConfigured('spotify')) {
      throw new BadRequestException('Spotify is not set up yet. An admin needs to add the Spotify app credentials.');
    }
    const state = randomToken(18);
    const verifier = randomToken(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.db.insert(oauthStates).values({ state, userId, provider: 'spotify', verifier, createdAt: Date.now() }).run();
    const { uri, manual } = this.providers.spotifyRedirect();
    return { url: spotifyAuthorizeUrl(this.providers.spotifyApp(), uri, state, challenge), manual, redirectUri: uri };
  }

  /** Accepts either the callback query or a pasted redirect URL. */
  async spotifyComplete(params: { code?: string | null; state?: string | null; error?: string | null }, userId?: string) {
    if (params.error) throw new BadRequestException(`Spotify said: ${params.error}`);
    if (!params.code || !params.state) throw new BadRequestException('That URL has no authorization code in it');
    const pending = this.db.select().from(oauthStates).where(eq(oauthStates.state, params.state)).get();
    if (!pending || pending.provider !== 'spotify' || (userId && pending.userId !== userId)) {
      throw new BadRequestException('This sign-in link expired or was already used. Start again.');
    }
    this.db.delete(oauthStates).where(eq(oauthStates.state, params.state)).run();
    if (Date.now() - pending.createdAt > 3600_000) throw new BadRequestException('Sign-in took too long. Start again.');

    const { uri } = this.providers.spotifyRedirect();
    const creds = await exchangeSpotifyCode(this.providers.spotifyApp(), params.code, uri, pending.verifier ?? '');
    const row = this.upsert(pending.userId, 'spotify', { externalUserId: creds.userId, displayName: creds.userId }, creds, creds.authorizedAt + SIX_MONTHS);
    // Fill in the human display name.
    return this.check(pending.userId, row.id);
  }

  parsePasted(input: string): { code: string | null; state: string | null; error: string | null } {
    try {
      const url = new URL(input.trim());
      return { code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error') };
    } catch {
      throw new BadRequestException('Paste the full address from your browser bar, starting with http');
    }
  }

  // ----------------------------------------------------------------- YouTube Music

  async connectYtMusic(userId: string, cookie: string): Promise<Connection> {
    const clean = cookie
      .replace(/^cookie:\s*/i, '')
      .replace(/[\r\n]+/g, '')
      .trim();
    if (clean.includes('\u2026')) {
      throw new BadRequestException(
        'That cookie was cut short: it contains "…" where your browser hid part of a long value. ' +
          'In Firefox, turn on the Raw toggle next to Request Headers and copy from there (or right-click the Cookie line → Copy Value). ' +
          'In Chrome, right-click the request → Copy → Copy request headers, and take the cookie: line.',
      );
    }
    if (/[^\x20-\x7e]/.test(clean)) {
      throw new BadRequestException('That cookie contains characters a cookie never has. Copy the raw Cookie header value again.');
    }
    if (!/SAPISID|__Secure-3PAPISID/.test(clean)) {
      throw new BadRequestException('That cookie is missing SAPISID. Copy the whole Cookie header from a signed-in music.youtube.com request.');
    }
    let who: AccountIdentity;
    try {
      await openYtMusicSession(clean);
      const creds: YtMusicCredentials = { cookie: clean, connectedAt: Date.now() };
      who = await new YtMusicClient({ connectionId: 'probe', credentials: creds, save: () => {} }).whoami();
    } catch (err) {
      throw new BadRequestException(`YouTube didn't accept that cookie: ${errorMessage(err)}`);
    }
    const row = this.upsert(userId, 'ytmusic', who, { cookie: clean, connectedAt: Date.now() }, null);
    return this.providers.toDto(row);
  }

  // ----------------------------------------------------------------- Apple Music

  async connectApple(userId: string, musicUserToken: string): Promise<Connection> {
    if (!this.providers.isConfigured('apple')) {
      throw new BadRequestException('Apple Music is not set up yet. An admin needs to add a MusicKit key.');
    }
    let storefront: string;
    try {
      storefront = await appleStorefront({ mode: 'key', app: this.providers.appleApp() }, musicUserToken);
    } catch (err) {
      throw new BadRequestException(`Apple Music rejected the sign-in: ${errorMessage(err)}`);
    }
    const creds: AppleCredentials = { mode: 'key', musicUserToken, storefront, connectedAt: Date.now() };
    const who = {
      externalUserId: `apple-${createHash('sha256').update(userId).digest('hex').slice(0, 10)}`,
      displayName: `Apple Music · ${storefront.toUpperCase()}`,
    };
    const row = this.upsert(userId, 'apple', who, creds, Date.now() + SIX_MONTHS);
    return this.providers.toDto(row);
  }

  /** No developer account: the web player's own token plus the user's media-user-token cookie. */
  async connectAppleWeb(userId: string, mediaUserToken: string): Promise<Connection> {
    const token = mediaUserToken.replace(/^media-user-token\s*[=:]\s*/i, '').replace(/\s+/g, '').trim();
    if (token.includes('\u2026')) {
      throw new BadRequestException('That value was cut short (it contains "…"). Copy the full media-user-token value again.');
    }
    if (token.length < 100 || /[^\x21-\x7e]/.test(token)) {
      throw new BadRequestException("That doesn't look like a media-user-token. Copy the value of the media-user-token cookie for music.apple.com.");
    }
    let storefront: string;
    try {
      storefront = await appleStorefront({ mode: 'web' }, token);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        throw new BadRequestException('Apple Music didn’t accept that token. Make sure you’re signed in at music.apple.com and copy it again.');
      }
      throw new BadRequestException(`Couldn't reach Apple Music: ${errorMessage(err)}`);
    }
    const creds: AppleCredentials = { mode: 'web', musicUserToken: token, storefront, connectedAt: Date.now() };
    const who = {
      externalUserId: `apple-${createHash('sha256').update(userId).digest('hex').slice(0, 10)}`,
      displayName: `Apple Music · ${storefront.toUpperCase()} (web session)`,
    };
    // Apple sessions last about six months.
    const row = this.upsert(userId, 'apple', who, creds, Date.now() + SIX_MONTHS);
    return this.providers.toDto(row);
  }

  // -----------------------------------------------------------------

  private upsert(userId: string, provider: ProviderId, who: AccountIdentity, credentials: unknown, expiresAt: number | null): ConnectionRow {
    const now = Date.now();
    const existing = this.db
      .select()
      .from(connections)
      .where(and(eq(connections.userId, userId), eq(connections.provider, provider), eq(connections.externalUserId, who.externalUserId)))
      .get();
    const enc = this.crypto.encryptJson(credentials);
    if (existing) {
      this.db
        .update(connections)
        .set({ credentialsEnc: enc, displayName: who.displayName, status: 'active', statusMessage: null, expiresAt, updatedAt: now })
        .where(eq(connections.id, existing.id))
        .run();
      return this.get(userId, existing.id);
    }
    const row: ConnectionRow = {
      id: newId('cn'),
      userId,
      provider,
      externalUserId: who.externalUserId,
      displayName: who.displayName,
      credentialsEnc: enc,
      status: 'active',
      statusMessage: null,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };
    this.db.insert(connections).values(row).run();
    return row;
  }

  appUrl() {
    return this.config.appUrl;
  }
}

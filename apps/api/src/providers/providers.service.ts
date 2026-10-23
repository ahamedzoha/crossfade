import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Connection,
  type ConnectionStatus,
  PROVIDERS,
  type ProviderField,
  type ProviderId,
  type ProviderSetup,
} from '@crossfade/shared';
import { eq } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CryptoService } from '../common/crypto.service.js';
import { DB, type Db } from '../db/db.js';
import { connections, providerConfigs } from '../db/schema.js';
import { AppleClient, type AppleAppConfig, type AppleCredentials } from './apple/apple.client.js';
import type { ProviderClient } from './provider.types.js';
import { SpotifyClient, type SpotifyAppConfig, type SpotifyCredentials } from './spotify/spotify.client.js';
import { YtMusicClient, type YtMusicCredentials } from './ytmusic/ytmusic.client.js';

type ConnectionRow = typeof connections.$inferSelect;

const DEFAULT_MANUAL_REDIRECT = 'http://127.0.0.1:8888/callback';

const FIELDS: Record<ProviderId, ProviderField[]> = {
  spotify: [
    { key: 'clientId', label: 'Client ID', kind: 'text', required: true },
    { key: 'clientSecret', label: 'Client secret', kind: 'secret', required: true },
    {
      key: 'manualRedirectUri',
      label: 'Paste-back redirect URI',
      kind: 'text',
      required: false,
      placeholder: DEFAULT_MANUAL_REDIRECT,
      help: 'Only used when Crossfade is not served over HTTPS. Spotify accepts http only for 127.0.0.1.',
    },
  ],
  ytmusic: [],
  apple: [
    { key: 'teamId', label: 'Team ID', kind: 'text', required: true, placeholder: 'ABCDE12345' },
    { key: 'keyId', label: 'MusicKit key ID', kind: 'text', required: true, placeholder: 'XYZ9876543' },
    {
      key: 'privateKey',
      label: 'Private key (.p8 contents)',
      kind: 'textarea',
      required: true,
      placeholder: '-----BEGIN PRIVATE KEY-----',
    },
  ],
};

const ENV_KEYS: Record<ProviderId, Record<string, keyof AppConfig['env']>> = {
  spotify: { clientId: 'spotifyClientId', clientSecret: 'spotifyClientSecret' },
  ytmusic: {},
  apple: { teamId: 'appleTeamId', keyId: 'appleKeyId', privateKey: 'applePrivateKey' },
};

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
  ) {}

  /** Stored config merged with environment overrides (env wins). */
  getConfig(provider: ProviderId): Record<string, string> {
    const row = this.db.select().from(providerConfigs).where(eq(providerConfigs.provider, provider)).get();
    const stored = row ? this.crypto.decryptJson<Record<string, string>>(row.configEnc) : {};
    const merged: Record<string, string> = { ...stored };
    for (const [field, envKey] of Object.entries(ENV_KEYS[provider])) {
      const v = this.config.env[envKey];
      if (v) merged[field] = v;
    }
    return merged;
  }

  isConfigured(provider: ProviderId): boolean {
    const cfg = this.getConfig(provider);
    return FIELDS[provider].filter((f) => f.required).every((f) => !!cfg[f.key]);
  }

  saveConfig(provider: ProviderId, input: Record<string, string>) {
    const allowed = new Set(FIELDS[provider].map((f) => f.key));
    const row = this.db.select().from(providerConfigs).where(eq(providerConfigs.provider, provider)).get();
    const current = row ? this.crypto.decryptJson<Record<string, string>>(row.configEnc) : {};
    const next = { ...current };
    for (const [k, v] of Object.entries(input)) {
      if (!allowed.has(k)) continue;
      // Secrets come back masked from the UI; an empty or masked value keeps the stored one.
      if (v === '' || v === '••••••••') continue;
      next[k] = v.trim();
    }
    const enc = this.crypto.encryptJson(next);
    this.db
      .insert(providerConfigs)
      .values({ provider, configEnc: enc, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: providerConfigs.provider, set: { configEnc: enc, updatedAt: Date.now() } })
      .run();
  }

  clearConfig(provider: ProviderId) {
    this.db.delete(providerConfigs).where(eq(providerConfigs.provider, provider)).run();
  }

  /** Where Spotify should send the user back to, and whether that needs the paste-back flow. */
  spotifyRedirect(): { uri: string; manual: boolean } {
    const url = new URL(this.config.appUrl);
    const callback = '/api/connections/spotify/callback';
    if (url.protocol === 'https:') return { uri: `${this.config.appUrl}${callback}`, manual: false };
    if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
      return { uri: `${this.config.appUrl}${callback}`, manual: false };
    }
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
      return { uri: `${url.origin}${callback}`, manual: false };
    }
    const manual = this.getConfig('spotify').manualRedirectUri || DEFAULT_MANUAL_REDIRECT;
    return { uri: manual, manual: true };
  }

  setup(provider: ProviderId, includeValues: boolean): ProviderSetup {
    const cfg = this.getConfig(provider);
    const envLocked = Object.entries(ENV_KEYS[provider])
      .filter(([, envKey]) => !!this.config.env[envKey])
      .map(([field]) => field);
    const values: Record<string, string> = {};
    if (includeValues) {
      for (const f of FIELDS[provider]) {
        const v = cfg[f.key];
        if (!v) continue;
        values[f.key] = f.kind === 'text' ? v : '••••••••';
      }
    }
    const redirect = provider === 'spotify' ? this.spotifyRedirect() : null;
    return {
      provider,
      configured: provider === 'ytmusic' ? true : this.isConfigured(provider),
      fields: FIELDS[provider],
      values,
      envLocked,
      redirectUri: redirect?.uri ?? null,
      manualRedirect: redirect?.manual ?? false,
      instructions: this.instructions(provider, redirect?.uri ?? null),
    };
  }

  allSetups(includeValues: boolean): ProviderSetup[] {
    return PROVIDERS.map((p) => this.setup(p, includeValues));
  }

  private instructions(provider: ProviderId, redirectUri: string | null): string[] {
    switch (provider) {
      case 'spotify':
        return [
          'The Spotify account that creates the app needs Premium; the people who connect to it can be on free accounts.',
          'Open developer.spotify.com/dashboard and create an app (Web API).',
          `Add this redirect URI to the app exactly: ${redirectUri}`,
          'Under User Management, add the Spotify account email of everyone who will connect (max 5).',
          'Copy the Client ID and Client secret here.',
        ];
      case 'apple':
        return [
          'Optional: people can connect Apple Music with a web session instead, with no developer account. This key is only for the official, add-only route.',
          'In your Apple Developer account, open Certificates, Identifiers & Profiles → Keys.',
          'Create a key with MusicKit enabled and download the .p8 file (it can be downloaded once).',
          'Paste your Team ID, the key ID and the .p8 contents here.',
          'Apple sign-in works best when Crossfade is served over HTTPS.',
        ];
      case 'ytmusic':
        return [
          'No app setup needed. Each user pastes a browser cookie from music.youtube.com.',
        ];
    }
  }

  // -------------------------------------------------------------------------

  clientFor(row: ConnectionRow): ProviderClient {
    const provider = row.provider as ProviderId;
    const save = (creds: unknown, expiresAt?: number | null) => {
      this.db
        .update(connections)
        .set({
          credentialsEnc: this.crypto.encryptJson(creds),
          updatedAt: Date.now(),
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        })
        .where(eq(connections.id, row.id))
        .run();
    };
    switch (provider) {
      case 'spotify': {
        const cfg = this.getConfig('spotify');
        const app: SpotifyAppConfig = { clientId: cfg.clientId ?? '', clientSecret: cfg.clientSecret ?? '' };
        return new SpotifyClient(app, {
          connectionId: row.id,
          credentials: this.crypto.decryptJson<SpotifyCredentials>(row.credentialsEnc),
          save,
        });
      }
      case 'apple': {
        const credentials = this.crypto.decryptJson<AppleCredentials>(row.credentialsEnc);
        return new AppleClient(credentials.mode === 'web' ? { mode: 'web' } : { mode: 'key', app: this.appleApp() }, {
          connectionId: row.id,
          credentials,
          save,
        });
      }
      case 'ytmusic':
        return new YtMusicClient({
          connectionId: row.id,
          credentials: this.crypto.decryptJson<YtMusicCredentials>(row.credentialsEnc),
          save,
        });
      default:
        throw new Error(`Unknown provider ${row.provider}`);
    }
  }

  appleApp(): AppleAppConfig {
    const cfg = this.getConfig('apple');
    return { teamId: cfg.teamId ?? '', keyId: cfg.keyId ?? '', privateKey: cfg.privateKey ?? '' };
  }

  spotifyApp(): SpotifyAppConfig {
    const cfg = this.getConfig('spotify');
    return { clientId: cfg.clientId ?? '', clientSecret: cfg.clientSecret ?? '' };
  }

  markStatus(connectionId: string, status: ConnectionStatus, message: string | null) {
    this.db
      .update(connections)
      .set({ status, statusMessage: message, updatedAt: Date.now() })
      .where(eq(connections.id, connectionId))
      .run();
    if (status === 'expired' || status === 'error') this.logger.warn(`Connection ${connectionId}: ${message}`);
  }

  touch(connectionId: string) {
    this.db.update(connections).set({ lastUsedAt: Date.now() }).where(eq(connections.id, connectionId)).run();
  }

  toDto(row: ConnectionRow): Connection {
    let authMode: Connection['authMode'] = null;
    if (row.provider === 'apple') {
      try {
        authMode = this.crypto.decryptJson<AppleCredentials>(row.credentialsEnc).mode === 'web' ? 'web' : 'key';
      } catch {
        authMode = 'key';
      }
    }
    return {
      id: row.id,
      provider: row.provider as ProviderId,
      authMode,
      displayName: row.displayName,
      externalUserId: row.externalUserId,
      status: row.status,
      statusMessage: row.statusMessage,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    };
  }
}

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppConfig {
  version: string;
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  /** Public URL users reach the app at; used to build OAuth redirect URIs. */
  appUrl: string;
  secretKey: string | null;
  trustedHeader: string | null;
  sessionDays: number;
  workerConcurrency: number;
  logLevel: 'error' | 'warn' | 'log' | 'debug' | 'verbose';
  env: {
    spotifyClientId?: string;
    spotifyClientSecret?: string;
    appleTeamId?: string;
    appleKeyId?: string;
    applePrivateKey?: string;
  };
}

/** Reads `NAME`, falling back to the contents of the file at `NAME_FILE` (Docker secrets). */
function env(name: string): string | undefined {
  const direct = process.env[name];
  if (direct !== undefined && direct !== '') return direct;
  const file = process.env[`${name}_FILE`];
  if (file && existsSync(file)) return readFileSync(file, 'utf8').trim();
  return undefined;
}

function int(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

let envLoaded = false;

/** Local development reads the repo-root .env; containers pass real environment variables. */
function loadDotEnv() {
  if (envLoaded) return;
  envLoaded = true;
  for (const file of ['.env', '../../.env']) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

export function loadConfig(): AppConfig {
  loadDotEnv();
  const dataDir = resolve(env('DATA_DIR') ?? './data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const appUrl = (env('APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  const level = (env('LOG_LEVEL') ?? 'log') as AppConfig['logLevel'];

  return {
    version: env('APP_VERSION') ?? readVersion(),
    host: env('API_HOST') ?? '127.0.0.1',
    port: int('API_PORT', 4000),
    dataDir,
    dbPath: resolve(dataDir, 'crossfade.db'),
    appUrl,
    secretKey: env('SECRET_KEY') ?? null,
    trustedHeader: env('TRUSTED_HEADER')?.toLowerCase() ?? null,
    sessionDays: int('SESSION_DAYS', 30),
    workerConcurrency: Math.max(1, int('WORKER_CONCURRENCY', 2)),
    logLevel: ['error', 'warn', 'log', 'debug', 'verbose'].includes(level) ? level : 'log',
    env: {
      spotifyClientId: env('SPOTIFY_CLIENT_ID'),
      spotifyClientSecret: env('SPOTIFY_CLIENT_SECRET'),
      appleTeamId: env('APPLE_TEAM_ID'),
      appleKeyId: env('APPLE_KEY_ID'),
      applePrivateKey: env('APPLE_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

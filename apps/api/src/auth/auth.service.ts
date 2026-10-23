import { hash, verify } from '@node-rs/argon2';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { ApiKey, ApiKeyCreated, ApiScope, Me, Role } from '@crossfade/shared';
import { and, eq, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { newId, randomToken, sha256 } from '../common/ids.js';
import { DB, type Db } from '../db/db.js';
import { apiKeys, sessions, users } from '../db/schema.js';
import type { AuthContext } from './auth.types.js';

type UserRow = typeof users.$inferSelect;

export const SESSION_COOKIE = 'cf_session';
const KEY_PREFIX = 'cf_';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  userCount(): number {
    return this.db.select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0;
  }

  async createUser(input: { username: string; displayName?: string; password?: string; role: Role }): Promise<UserRow> {
    const username = input.username.toLowerCase();
    if (this.db.select().from(users).where(eq(users.username, username)).get()) {
      throw new ConflictException('That username is taken');
    }
    const row: UserRow = {
      id: newId('usr'),
      username,
      displayName: input.displayName || input.username,
      passwordHash: input.password ? await hash(input.password) : null,
      role: input.role,
      createdAt: Date.now(),
    };
    this.db.insert(users).values(row).run();
    return row;
  }

  async verifyPassword(username: string, password: string): Promise<UserRow | null> {
    const user = this.db.select().from(users).where(eq(users.username, username.toLowerCase())).get();
    if (!user?.passwordHash) {
      // Spend comparable time so usernames can't be probed by timing.
      await hash(password);
      return null;
    }
    return (await verify(user.passwordHash, password)) ? user : null;
  }

  async setPassword(userId: string, password: string) {
    this.db.update(users).set({ passwordHash: await hash(password) }).where(eq(users.id, userId)).run();
  }

  async changePassword(userId: string, current: string | undefined, next: string) {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new BadRequestException('Unknown user');
    if (user.passwordHash && !(current && (await verify(user.passwordHash, current)))) {
      throw new ForbiddenException('Current password is wrong');
    }
    await this.setPassword(userId, next);
  }

  // -------------------------------------------------------------------- sessions

  createSession(userId: string, userAgent?: string): { token: string; maxAgeMs: number } {
    const token = randomToken(32);
    const now = Date.now();
    const maxAgeMs = this.config.sessionDays * 24 * 3600 * 1000;
    this.db
      .insert(sessions)
      .values({ id: sha256(token), userId, createdAt: now, expiresAt: now + maxAgeMs, lastSeenAt: now, userAgent: userAgent?.slice(0, 200) ?? null })
      .run();
    return { token, maxAgeMs };
  }

  destroySession(token: string) {
    this.db.delete(sessions).where(eq(sessions.id, sha256(token))).run();
  }

  fromSession(token: string): AuthContext | null {
    const row = this.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sha256(token)))
      .get();
    if (!row || row.s.expiresAt < Date.now()) return null;
    if (Date.now() - row.s.lastSeenAt > 60_000) {
      this.db.update(sessions).set({ lastSeenAt: Date.now() }).where(eq(sessions.id, row.s.id)).run();
    }
    return { ...this.ctx(row.u), via: 'session', scopes: ['read', 'write'], sessionId: row.s.id };
  }

  cookieOptions(maxAgeMs?: number) {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.appUrl.startsWith('https://'),
      path: '/',
      ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
    };
  }

  // -------------------------------------------------------------------- trusted header

  async fromTrustedHeader(username: string): Promise<AuthContext> {
    const name = username.trim().toLowerCase();
    let user = this.db.select().from(users).where(eq(users.username, name)).get();
    if (!user) {
      user = await this.createUser({ username: name, role: this.userCount() === 0 ? 'admin' : 'member' });
    }
    return { ...this.ctx(user), via: 'header', scopes: ['read', 'write'] };
  }

  // -------------------------------------------------------------------- API keys

  listKeys(userId: string): ApiKey[] {
    return this.db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).all().map(keyDto);
  }

  createKey(userId: string, name: string, scopes: ApiScope[]): ApiKeyCreated {
    const token = `${KEY_PREFIX}${randomToken(30)}`;
    const row = {
      id: newId('key'),
      userId,
      name,
      prefix: token.slice(0, 10),
      keyHash: sha256(token),
      scopes: [...new Set<ApiScope>(scopes.includes('write') ? ['read', 'write'] : scopes)],
      createdAt: Date.now(),
      lastUsedAt: null,
    };
    this.db.insert(apiKeys).values(row).run();
    return { ...keyDto(row), token };
  }

  revokeKey(userId: string, id: string) {
    this.db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId))).run();
  }

  fromApiKey(token: string): AuthContext | null {
    if (!token.startsWith(KEY_PREFIX)) return null;
    const row = this.db
      .select({ k: apiKeys, u: users })
      .from(apiKeys)
      .innerJoin(users, eq(apiKeys.userId, users.id))
      .where(eq(apiKeys.keyHash, sha256(token)))
      .get();
    if (!row) return null;
    if (!row.k.lastUsedAt || Date.now() - row.k.lastUsedAt > 60_000) {
      this.db.update(apiKeys).set({ lastUsedAt: Date.now() }).where(eq(apiKeys.id, row.k.id)).run();
    }
    return { ...this.ctx(row.u), via: 'key', scopes: row.k.scopes, keyId: row.k.id };
  }

  toMe(user: Pick<UserRow, 'id' | 'username' | 'displayName' | 'role'>): Me {
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  }

  private ctx(u: UserRow) {
    return { userId: u.id, username: u.username, displayName: u.displayName, role: u.role };
  }
}

function keyDto(r: typeof apiKeys.$inferSelect): ApiKey {
  return { id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt };
}

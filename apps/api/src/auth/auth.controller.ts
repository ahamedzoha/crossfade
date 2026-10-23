import { Body, Controller, ForbiddenException, Get, HttpCode, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import {
  type LoginInput,
  loginSchema,
  type SessionStatus,
  type SetupInput,
  setupSchema,
  type UpdateMeInput,
  updateMeSchema,
} from '@crossfade/shared';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, type Db } from '../db/db.js';
import { users } from '../db/schema.js';
import { readCookie } from './auth.guard.js';
import { AuthService, SESSION_COOKIE } from './auth.service.js';
import type { AuthContext } from './auth.types.js';
import { CurrentUser, Public, SessionOnly } from './decorators.js';

const attempts = new Map<string, { n: number; until: number }>();

function throttle(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 10) {
    throw new UnauthorizedException('Too many attempts. Try again in a few minutes.');
  }
  attempts.set(key, a && a.until > now ? { n: a.n + 1, until: a.until } : { n: 1, until: now + 15 * 60_000 });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('session')
  session(@Req() req: Request): SessionStatus {
    return {
      needsSetup: this.auth.userCount() === 0 && !this.config.trustedHeader,
      authenticated: !!req.auth,
      user: req.auth
        ? this.auth.toMe({ id: req.auth.userId, username: req.auth.username, displayName: req.auth.displayName, role: req.auth.role })
        : null,
      trustedHeader: !!this.config.trustedHeader,
    };
  }

  @Public()
  @Post('setup')
  async setup(@Body(new ZodPipe(setupSchema)) body: SetupInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (this.auth.userCount() > 0) throw new ForbiddenException('Setup is already complete');
    const user = await this.auth.createUser({ ...body, role: 'admin' });
    const { token, maxAgeMs } = this.auth.createSession(user.id, req.headers['user-agent']);
    res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions(maxAgeMs));
    return this.auth.toMe(user);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    throttle(`${req.ip}:${body.username.toLowerCase()}`);
    const user = await this.auth.verifyPassword(body.username, body.password);
    if (!user) throw new UnauthorizedException('Wrong username or password');
    attempts.delete(`${req.ip}:${body.username.toLowerCase()}`);
    const { token, maxAgeMs } = this.auth.createSession(user.id, req.headers['user-agent']);
    res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions(maxAgeMs));
    return this.auth.toMe(user);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) this.auth.destroySession(token);
    res.clearCookie(SESSION_COOKIE, this.auth.cookieOptions());
  }

  @SessionOnly()
  @Patch('me')
  async updateMe(@CurrentUser() me: AuthContext, @Body(new ZodPipe(updateMeSchema)) body: UpdateMeInput) {
    if (body.displayName) this.db.update(users).set({ displayName: body.displayName }).where(eq(users.id, me.userId)).run();
    if (body.newPassword) await this.auth.changePassword(me.userId, body.currentPassword, body.newPassword);
    const row = this.db.select().from(users).where(eq(users.id, me.userId)).get()!;
    return this.auth.toMe(row);
  }
}

import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AuthService, SESSION_COOKIE } from './auth.service.js';
import { IS_ADMIN, IS_PUBLIC, SESSION_ONLY } from './decorators.js';

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard. Accepts, in order: `Authorization: Bearer cf_…` API keys,
 * the session cookie, or the trusted reverse-proxy header when configured.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);

    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (bearer) {
      req.auth = this.auth.fromApiKey(bearer.trim()) ?? undefined;
      if (!req.auth && !isPublic) throw new UnauthorizedException('Invalid API key');
    }
    if (!req.auth) {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) req.auth = this.auth.fromSession(token) ?? undefined;
    }
    if (!req.auth && this.config.trustedHeader) {
      const value = req.headers[this.config.trustedHeader];
      const username = Array.isArray(value) ? value[0] : value;
      if (username) req.auth = await this.auth.fromTrustedHeader(username);
    }

    if (isPublic) return true;
    if (!req.auth) throw new UnauthorizedException('Sign in required');

    if (req.auth.via === 'key') {
      if (this.reflector.getAllAndOverride<boolean>(SESSION_ONLY, targets)) {
        throw new ForbiddenException('This endpoint is not available to API keys');
      }
      const needs = SAFE.has(req.method) ? 'read' : 'write';
      if (!req.auth.scopes.includes(needs)) throw new ForbiddenException(`API key lacks the "${needs}" scope`);
    } else if (!SAFE.has(req.method) && req.headers['x-requested-with'] !== 'crossfade') {
      // Cookie-authenticated writes must come from our own frontend (blocks CSRF).
      throw new ForbiddenException('Missing X-Requested-With header');
    }

    if (this.reflector.getAllAndOverride<boolean>(IS_ADMIN, targets) && req.auth.role !== 'admin') {
      throw new ForbiddenException('Admins only');
    }
    return true;
  }
}

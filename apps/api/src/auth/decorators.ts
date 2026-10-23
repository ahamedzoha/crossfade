import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from './auth.types.js';

export const IS_PUBLIC = 'cf:public';
export const IS_ADMIN = 'cf:admin';
export const SESSION_ONLY = 'cf:session-only';

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Instance admins only. */
export const AdminOnly = () => SetMetadata(IS_ADMIN, true);
/** Not reachable with an API key (account management, key creation). */
export const SessionOnly = () => SetMetadata(SESSION_ONLY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) throw new Error('CurrentUser used on an unauthenticated route');
  return req.auth;
});

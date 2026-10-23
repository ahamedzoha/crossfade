import type { ApiScope, Role } from '@crossfade/shared';

export interface AuthContext {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  via: 'session' | 'key' | 'header';
  scopes: ApiScope[];
  sessionId?: string;
  keyId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

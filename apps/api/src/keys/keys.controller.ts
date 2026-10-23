import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { type CreateApiKeyInput, createApiKeySchema } from '@crossfade/shared';
import { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentUser, SessionOnly } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';

@SessionOnly()
@Controller('v1/keys')
export class KeysController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list(@CurrentUser() me: AuthContext) {
    return this.auth.listKeys(me.userId);
  }

  @Post()
  create(@CurrentUser() me: AuthContext, @Body(new ZodPipe(createApiKeySchema)) body: CreateApiKeyInput) {
    return this.auth.createKey(me.userId, body.name, body.scopes);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    this.auth.revokeKey(me.userId, id);
  }
}

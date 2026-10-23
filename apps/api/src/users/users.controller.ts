import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { type CreateUserInput, createUserSchema, type UserSummary } from '@crossfade/shared';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminOnly, CurrentUser, SessionOnly } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DB, type Db } from '../db/db.js';
import { connections, playlists, users } from '../db/schema.js';

const patchUserSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  password: z.string().min(8).max(200).optional(),
});

@AdminOnly()
@SessionOnly()
@Controller('users')
export class UsersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(): UserSummary[] {
    const conn = new Map(
      this.db.select({ u: connections.userId, n: sql<number>`count(*)` }).from(connections).groupBy(connections.userId).all().map((r) => [r.u, r.n]),
    );
    const pls = new Map(
      this.db.select({ u: playlists.userId, n: sql<number>`count(*)` }).from(playlists).groupBy(playlists.userId).all().map((r) => [r.u, r.n]),
    );
    return this.db
      .select()
      .from(users)
      .orderBy(users.createdAt)
      .all()
      .map((u) => ({ ...this.auth.toMe(u), createdAt: u.createdAt, connectionCount: conn.get(u.id) ?? 0, playlistCount: pls.get(u.id) ?? 0 }));
  }

  @Post()
  async create(@Body(new ZodPipe(createUserSchema)) body: CreateUserInput) {
    return this.auth.toMe(await this.auth.createUser(body));
  }

  @Patch(':id')
  async update(@CurrentUser() me: AuthContext, @Param('id') id: string, @Body(new ZodPipe(patchUserSchema)) body: z.infer<typeof patchUserSchema>) {
    const user = this.db.select().from(users).where(eq(users.id, id)).get();
    if (!user) throw new NotFoundException('User not found');
    if (body.role && id === me.userId && body.role !== 'admin') throw new BadRequestException("You can't demote yourself");
    if (body.role) this.db.update(users).set({ role: body.role }).where(eq(users.id, id)).run();
    if (body.password) await this.auth.setPassword(id, body.password);
    return this.auth.toMe(this.db.select().from(users).where(eq(users.id, id)).get()!);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthContext, @Param('id') id: string) {
    if (id === me.userId) throw new BadRequestException("You can't delete yourself");
    this.db.delete(users).where(eq(users.id, id)).run();
  }
}

import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      const first = result.error.issues[0];
      const where = first?.path.length ? `${first.path.join('.')}: ` : '';
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: `${where}${first?.message ?? 'Invalid input'}`,
        details: result.error.issues,
      });
    }
    return result.data;
  }
}

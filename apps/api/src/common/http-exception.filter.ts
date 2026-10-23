import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AuthExpiredError, errorMessage, ProviderHttpError } from './errors.js';

/** Every error leaves as `{ statusCode, error, message, details? }`. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload: Record<string, unknown> =
        typeof body === 'string'
          ? { statusCode: status, error: exception.name, message: body }
          : { statusCode: status, error: exception.name, ...(body as object) };
      if (Array.isArray(payload.message)) payload.message = (payload.message as string[]).join('; ');
      res.status(status).json(payload);
      return;
    }
    if (exception instanceof AuthExpiredError) {
      res.status(409).json({ statusCode: 409, error: 'ConnectionExpired', message: exception.message });
      return;
    }
    if (exception instanceof ProviderHttpError) {
      res.status(502).json({ statusCode: 502, error: 'ProviderError', message: exception.message });
      return;
    }
    this.logger.error(errorMessage(exception), exception instanceof Error ? exception.stack : undefined);
    res.status(500).json({ statusCode: 500, error: 'InternalServerError', message: 'Something went wrong. Check the server log.' });
  }
}

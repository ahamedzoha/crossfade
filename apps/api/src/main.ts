import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: (['error', 'warn', 'log', 'debug', 'verbose'] as const).slice(
      0,
      ['error', 'warn', 'log', 'debug', 'verbose'].indexOf(config.logLevel) + 1,
    ),
  });
  app.setGlobalPrefix('api');
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  Logger.log(`Crossfade API ${config.version} on http://${config.host}:${config.port} · public URL ${config.appUrl} · data in ${config.dataDir}`, 'Bootstrap');
}

await bootstrap();

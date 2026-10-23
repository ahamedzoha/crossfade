import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/**
 * AES-256-GCM for provider credentials and webhook secrets at rest.
 * The key comes from SECRET_KEY, or is generated once into the data volume.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly logger = new Logger(CryptoService.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    let secret = config.secretKey;
    if (!secret) {
      const file = join(config.dataDir, '.secret-key');
      if (existsSync(file)) {
        secret = readFileSync(file, 'utf8').trim();
      } else {
        secret = randomBytes(32).toString('base64url');
        writeFileSync(file, secret, { mode: 0o600 });
        this.logger.log(`Generated encryption key at ${file}. Back it up with your database.`);
      }
    }
    this.key = createHash('sha256').update(secret).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${data.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }
}

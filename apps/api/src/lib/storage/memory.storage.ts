import { createHmac } from 'node:crypto';
import type { PinoLogger } from 'nestjs-pino';
import type { ObjectMetadata, ObjectStorage } from './storage.types';

interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * S3 kimlik bilgileri yapılandırılmamışsa devreye giren bellek-içi depolama.
 *
 * Yerel geliştirme ve testler için. Ürettiği "imzalı URL" gerçek bir HTTP
 * adresi DEĞİLDİR; `/api/v1/uploads/local/...` yoluna işaret eder ve aynı
 * süreç tarafından karşılanır. Böylece presign → PUT → confirm akışının
 * tamamı MinIO olmadan da uçtan uca sınanabiliyor.
 */
export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  private readonly secret = 'klinara-local-storage';

  constructor(private readonly logger?: PinoLogger) {}

  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    this.logger?.debug({ key, contentType }, 'Yerel depolama: PUT URL üretildi');
    return Promise.resolve(this.sign('put', key, expiresInSeconds));
  }

  presignGet(key: string, expiresInSeconds: number): Promise<string> {
    return Promise.resolve(this.sign('get', key, expiresInSeconds));
  }

  head(key: string): Promise<ObjectMetadata | undefined> {
    const object = this.objects.get(key);
    if (object === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      sizeBytes: object.body.byteLength,
      contentType: object.contentType,
      etag: null,
    });
  }

  get(key: string): Promise<Buffer | undefined> {
    return Promise.resolve(this.objects.get(key)?.body);
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  private sign(action: string, key: string, expiresInSeconds: number): string {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const signature = createHmac('sha256', this.secret)
      .update(`${action}:${key}:${expiresAt}`)
      .digest('hex');
    const params = new URLSearchParams({ key, expires: String(expiresAt), signature });
    return `/api/v1/uploads/local/${action}?${params.toString()}`;
  }

  verify(action: string, key: string, expires: string, signature: string): boolean {
    if (Number(expires) < Date.now()) return false;
    const expected = createHmac('sha256', this.secret)
      .update(`${action}:${key}:${expires}`)
      .digest('hex');
    return expected === signature;
  }
}

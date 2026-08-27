import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { MemoryObjectStorage } from './memory.storage';
import { S3ObjectStorage } from './s3.storage';
import { OBJECT_STORAGE, type ObjectStorage } from './storage.types';

/**
 * Depolama sağlayıcısı seçimi tek yerde yapılır — `SmsModule` ile aynı kalıp.
 *
 * Kimlik bilgileri EKSİKSE gerçek S3 istemcisi hiç kurulmaz: yanlış
 * yapılandırılmış bir ortamda her yüklemenin anlaşılmaz bir SDK hatasıyla
 * düşmesindense, bellek-içi depolama çok daha kullanışlı bir varsayılan.
 */
function createStorage(
  config: ConfigService<EnvironmentVariables, true>,
  logger: PinoLogger,
): ObjectStorage {
  const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
  const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });

  if (
    accessKeyId === undefined ||
    accessKeyId === '' ||
    secretAccessKey === undefined ||
    secretAccessKey === ''
  ) {
    logger.warn('S3 kimlik bilgileri tanımsız — bellek-içi depolama kullanılıyor');
    return new MemoryObjectStorage(logger);
  }

  return new S3ObjectStorage({
    endpoint: config.get('S3_ENDPOINT', { infer: true }),
    region: config.get('S3_REGION', { infer: true }),
    bucket: config.get('S3_BUCKET', { infer: true }),
    accessKeyId,
    secretAccessKey,
  });
}

@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, inject: [ConfigService, PinoLogger], useFactory: createStorage }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}

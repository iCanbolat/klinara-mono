import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { Public } from '../../common/decorators/auth.decorators';
import { MemoryObjectStorage } from '../../lib/storage/memory.storage';
import { OBJECT_STORAGE, type ObjectStorage } from '../../lib/storage/storage.types';

/**
 * Bellek-içi depolamanın "S3"ü.
 *
 * S3 kimlik bilgileri yapılandırılmadığında `presign` gerçek bir S3 adresi
 * üretemez; bunun yerine bu yola imzalı bir bağlantı verir. Böylece
 * presign → PUT → confirm akışının TAMAMI MinIO olmadan da çalışır ve
 * testlerde uçtan uca sınanabilir.
 *
 * Gerçek S3 yapılandırıldığında bu uçlar `404` döner — yanlışlıkla üretimde
 * açık kalmış bir yükleme kapısı olmasın.
 */
@ApiExcludeController()
@Controller('uploads/local')
export class LocalUploadController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Put('put')
  @Public()
  async put(
    @Query('key') key: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Headers('content-type') contentType: string,
    @Req() request: Request,
  ): Promise<{ ok: true }> {
    const storage = this.local();
    if (!storage.verify('put', key, expires, signature)) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, 'İmza geçersiz veya süresi dolmuş');
    }
    await storage.put(key, await readBody(request), contentType || 'application/octet-stream');
    return { ok: true };
  }

  @Get('get')
  @Public()
  async get(
    @Query('key') key: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ): Promise<void> {
    const storage = this.local();
    if (!storage.verify('get', key, expires, signature)) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, 'İmza geçersiz veya süresi dolmuş');
    }
    const body = await storage.get(key);
    if (body === undefined) throw new NotFoundException();
    response.send(body);
  }

  private local(): MemoryObjectStorage {
    if (!(this.storage instanceof MemoryObjectStorage)) throw new NotFoundException();
    return this.storage;
  }
}

/** Gövde ham okunur: içerik herhangi bir ikili dosya olabilir. */
async function readBody(request: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

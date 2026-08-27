import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES, PERMISSIONS } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { RequestContextService } from '../../common/request-context';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../lib/storage/storage.types';
import { hasPermission, type Principal } from '../identity/principal';
import * as crmRepo from '../crm/crm.repository';
import * as repo from './files.repository';
import {
  ALLOWED_MIME_TYPES,
  type ConfirmFileDto,
  type CreateFileGroupDto,
  type CustomerFileResponseDto,
  type DownloadUrlResponseDto,
  type FileGroupResponseDto,
  type PresignUploadDto,
  type PresignUploadResponseDto,
} from './dto/file.dto';

/** İsteğin izi — erişim kaydına yazılır. */
export interface AccessMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly queue: QueueService,
    private readonly requestContext: RequestContextService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * İmzalı yükleme adresi üretir. Veritabanına HİÇBİR ŞEY yazmaz.
   *
   * Sebebi: yükleme yarıda kalırsa geriye asılı bir "pending" satır kalmasın.
   * Kayıt `confirm` adımında, nesnenin gerçekten var olduğu doğrulandıktan
   * sonra açılıyor.
   */
  async presign(
    principal: Principal,
    input: PresignUploadDto,
  ): Promise<PresignUploadResponseDto> {
    FilesService.assertCanWriteKind(principal, input.kind);
    FilesService.assertMime(input.contentType);
    this.assertSize(input.sizeBytes);

    await this.tx.run((tx) => FilesService.assertCustomer(tx, input.customerId));

    const ttl = this.config.get('S3_PRESIGN_TTL_SECONDS', { infer: true });
    // Anahtar sunucuda üretilir: istemciye bırakılsaydı başka bir kiracının
    // yoluna yazmayı deneyebilirdi.
    const storageKey = `${this.tx.tenantId}/${input.customerId}/${randomUUID()}`;
    const uploadUrl = await this.storage.presignPut(storageKey, input.contentType, ttl);

    return {
      storageKey,
      uploadUrl,
      contentType: input.contentType,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /**
   * Yüklemeyi doğrular ve kaydı açar.
   *
   * Doğrulama sunucuda yapılır — istemcinin bildirdiği boyut/tip beyandır.
   * `HeadObject` nesnenin gerçekten var olduğunu, boyutunu ve tipini söylüyor.
   */
  async confirm(
    principal: Principal,
    customerId: string,
    input: ConfirmFileDto,
  ): Promise<CustomerFileResponseDto> {
    FilesService.assertCanWriteKind(principal, input.kind);

    if (!input.storageKey.startsWith(`${this.tx.tenantId}/${customerId}/`)) {
      throw AppError.forbidden('Bu anahtar bu müşteriye ait değil');
    }

    const meta = await this.storage.head(input.storageKey);
    if (meta === undefined) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Yüklenen dosya bulunamadı',
        { detail: 'Önce imzalı adrese yükleme yapılmalı.' },
      );
    }
    this.assertSize(meta.sizeBytes);
    FilesService.assertMime(meta.contentType ?? '');

    const row = await this.tx
      .run(async (tx) => {
        await FilesService.assertCustomer(tx, customerId);
        const existing = await repo.findFileByStorageKey(tx, input.storageKey);
        if (existing !== undefined) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu dosya zaten kaydedilmiş');
        }

        const created = await repo.insertFile(tx, {
          tenantId: this.tx.tenantId,
          customerId,
          kind: input.kind,
          position: input.position ?? 'other',
          groupId: input.groupId ?? null,
          storageKey: input.storageKey,
          mimeType: meta.contentType ?? 'application/octet-stream',
          sizeBytes: meta.sizeBytes,
          sha256: input.sha256 ?? null,
          takenAt: input.takenAt === undefined ? null : new Date(input.takenAt),
          uploadedBy: principal.userId,
          status: 'ready',
        });

        // Küçük görsel işi AYNI transaction'da kuyruğa giriyor: kayıt rollback
        // olursa iş de olmaz (mimari karar 4.6).
        if (created.kind === 'photo') {
          await this.queue.send(tx, QUEUES.CUSTOMER_FILE_THUMBNAIL, {
            fileId: created.id,
            tenantId: this.tx.tenantId,
          });
        }
        return created;
      })
      .catch((error: unknown) => {
        throw FilesService.translate(error);
      });

    return FilesService.toResponse(row);
  }

  async list(principal: Principal, customerId: string): Promise<CustomerFileResponseDto[]> {
    const canSeePhotos = FilesService.canReadMedical(principal);
    const rows = await this.tx.run(async (tx) => {
      await FilesService.assertCustomer(tx, customerId);
      return repo.listFiles(tx, customerId);
    });

    // Klinik fotoğrafı SAĞLIK VERİSİDİR (KVKK m.6): resepsiyon görmemeli.
    // Kimlik fotokopisi değildir — ayrım `kind` üzerinden.
    return rows
      .filter((row) => canSeePhotos || row.kind !== 'photo')
      .map((row) => FilesService.toResponse(row));
  }

  async groups(principal: Principal, customerId: string): Promise<FileGroupResponseDto[]> {
    const canSeePhotos = FilesService.canReadMedical(principal);
    const payload = await this.tx.run(async (tx) => {
      await FilesService.assertCustomer(tx, customerId);
      const rows = await repo.listGroups(tx, customerId);
      return { rows, files: await repo.listFilesForGroups(tx, rows.map((r) => r.id)) };
    });

    return payload.rows.map((group) => ({
      id: group.id,
      title: group.title,
      bodyArea: group.bodyArea,
      serviceId: group.serviceId,
      createdAt: group.createdAt.toISOString(),
      files: (payload.files.get(group.id) ?? [])
        .filter((row) => canSeePhotos || row.kind !== 'photo')
        .map((row) => FilesService.toResponse(row)),
    }));
  }

  async createGroup(
    customerId: string,
    input: CreateFileGroupDto,
  ): Promise<FileGroupResponseDto> {
    const row = await this.tx
      .run(async (tx) => {
        await FilesService.assertCustomer(tx, customerId);
        return repo.insertGroup(tx, {
          tenantId: this.tx.tenantId,
          customerId,
          title: input.title.trim(),
          bodyArea: input.bodyArea ?? null,
          serviceId: input.serviceId ?? null,
        });
      })
      .catch((error: unknown) => {
        throw FilesService.translate(error);
      });

    return {
      id: row.id,
      title: row.title,
      bodyArea: row.bodyArea,
      serviceId: row.serviceId,
      files: [],
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Süreli indirme adresi. HER çağrı erişim kaydına düşer.
   *
   * Kayıt, URL üretilmeden ÖNCE ve aynı transaction'da yazılıyor: log yazımı
   * başarısız olursa bağlantı da üretilmemeli.
   */
  async downloadUrl(
    principal: Principal,
    id: string,
    meta: AccessMeta,
  ): Promise<DownloadUrlResponseDto> {
    const canSeePhotos = FilesService.canReadMedical(principal);
    const ttl = this.config.get('S3_PRESIGN_TTL_SECONDS', { infer: true });

    const row = await this.tx.run(async (tx) => {
      const file = await repo.findFileById(tx, id);
      if (file === undefined) return undefined;
      // Göremeyeceği dosya 404 döner, 403 değil.
      if (file.kind === 'photo' && !canSeePhotos) return undefined;

      await repo.insertAccessLog(tx, {
        tenantId: this.tx.tenantId,
        customerId: file.customerId,
        actorUserId: principal.userId,
        resourceType: 'file',
        resourceId: file.id,
        action: 'download',
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: this.requestContext.get()?.requestId ?? null,
      });
      return file;
    });

    if (row === undefined) throw AppError.notFound('Dosya bulunamadı');

    return {
      url: await this.storage.presignGet(row.storageKey, ttl),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  async remove(principal: Principal, id: string): Promise<void> {
    const canSeePhotos = FilesService.canReadMedical(principal);
    const removed = await this.tx.run(async (tx) => {
      const file = await repo.findFileById(tx, id);
      if (file === undefined) return undefined;
      if (file.kind === 'photo' && !canSeePhotos) return undefined;
      FilesService.assertCanWriteKind(principal, file.kind);
      return repo.softDeleteFile(tx, id);
    });
    if (removed === undefined) throw AppError.notFound('Dosya bulunamadı');
    // Nesne S3'ten SİLİNMEZ: soft delete geri alınabilir olmalı ve saklama
    // yükümlülükleri (Faz 7.4) kalıcı silmeyi ayrı bir akışa bağlıyor.
  }

  // ---------------------------------------------------------------------------

  private static canReadMedical(principal: Principal): boolean {
    return hasPermission(principal, PERMISSIONS.CUSTOMER_MEDICAL_READ);
  }

  /** Klinik fotoğrafı yazmak `customer.medical:write` ister; belge yazmak yetmez. */
  private static assertCanWriteKind(principal: Principal, kind: string): void {
    if (kind !== 'photo') return;
    if (!hasPermission(principal, PERMISSIONS.CUSTOMER_MEDICAL_WRITE)) {
      throw AppError.forbidden('Klinik fotoğrafı yükleme yetkiniz yok');
    }
  }

  private static assertMime(contentType: string): void {
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(contentType)) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Bu dosya tipi kabul edilmiyor', {
        extra: { errors: [{ path: 'contentType', message: contentType }] },
      });
    }
  }

  private assertSize(sizeBytes: number): void {
    const max = this.config.get('UPLOAD_MAX_BYTES', { infer: true });
    if (sizeBytes > max) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Dosya çok büyük', {
        detail: `Üst sınır ${String(Math.floor(max / 1024 / 1024))} MB.`,
      });
    }
  }

  private static async assertCustomer(tx: Tx, customerId: string): Promise<void> {
    const customer = await crmRepo.findCustomerById(tx, customerId);
    if (customer === undefined) throw AppError.notFound('Müşteri bulunamadı');
  }

  private static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Bu dosya zaten kaydedilmiş');
    }
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return AppError.notFound('Müşteri, grup veya hizmet bulunamadı');
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Kayıt bu kiracıya ait olmalı');
    }
    return error;
  }

  private static toResponse(row: repo.CustomerFileRow): CustomerFileResponseDto {
    return {
      id: row.id,
      customerId: row.customerId,
      groupId: row.groupId,
      kind: row.kind,
      position: row.position,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      hasThumbnail: row.thumbnailKey !== null,
      takenAt: row.takenAt?.toISOString() ?? null,
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

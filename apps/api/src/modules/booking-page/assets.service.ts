import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { RequestContextService } from '../../common/request-context';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { TenantAssetPurpose } from '../../database/schema';
import { TenantTxService } from '../../database/tenant-tx.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../lib/storage/storage.types';
import * as repo from './assets.repository';
import { ASSET_MIME_TYPES, type AssetDto, type ConfirmAssetDto, type PresignAssetDto } from './dto/asset.dto';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * Randevu sayfasının marka ve galeri görselleri.
 *
 * `customer_files` akışından AYRI ve bilerek öyle: o taraf tıbben hassas,
 * imzalı ve kısa TTL'li; burası pazarlama içeriği, imzasız ve bir yıl
 * cache'lenebilir. İkisini tek serviste toplamak, iki güvenlik duruşunu tek
 * kod yolunda tutmak demekti.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly requestContext: RequestContextService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async list(purpose: TenantAssetPurpose | undefined): Promise<AssetDto[]> {
    const rows = await this.tx.run((tx) => repo.listAssets(tx, purpose));
    return rows.map((row) => this.present(row));
  }

  /**
   * İmzalı yükleme adresi üretir; veritabanına HİÇBİR ŞEY yazmaz.
   *
   * `FilesService.presign` ile aynı gerekçe: yükleme yarıda kalırsa geriye
   * asılı bir `pending` satır kalmasın. Kayıt `confirm`de, nesnenin gerçekten
   * var olduğu doğrulandıktan sonra açılıyor.
   */
  async presign(input: PresignAssetDto): Promise<{
    assetId: string;
    uploadUrl: string;
    storageKey: string;
    expiresAt: string;
  }> {
    this.assertSize(input.sizeBytes);

    const assetId = randomUUID();
    // Anahtar SUNUCUDA üretilir ve `public/` öneki taşır: istemciye
    // bırakılsaydı başka bir kiracının yoluna ya da imzalı-özel alana yazmayı
    // deneyebilirdi.
    const storageKey = this.storageKeyFor(assetId, input.contentType);
    const ttl = this.config.get('S3_PRESIGN_TTL_SECONDS', { infer: true });
    const uploadUrl = await this.storage.presignPut(storageKey, input.contentType, ttl);

    return {
      assetId,
      uploadUrl,
      storageKey,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /**
   * Yüklemeyi doğrular ve kaydı açar.
   *
   * Boyut ve tip SUNUCUDA `head` ile okunuyor; istemcinin `presign`de
   * bildirdiği değerler yalnız beyandı.
   */
  async confirm(input: ConfirmAssetDto): Promise<AssetDto> {
    const tenantId = this.tx.tenantId;
    const prefix = `${this.config.get('S3_PUBLIC_PREFIX', { infer: true })}/${tenantId}/`;
    if (!input.storageKey.startsWith(prefix)) {
      throw AppError.forbidden('Bu anahtar bu kiracıya ait değil');
    }

    const meta = await this.storage.head(input.storageKey);
    if (meta === undefined) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Yüklenen görsel bulunamadı', {
        detail: 'Önce imzalı adrese yükleme yapılmalı.',
      });
    }
    this.assertSize(meta.sizeBytes);

    const contentType = meta.contentType ?? '';
    if (!(ASSET_MIME_TYPES as readonly string[]).includes(contentType)) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Desteklenmeyen görsel tipi', {
        detail: `İzin verilenler: ${ASSET_MIME_TYPES.join(', ')}`,
      });
    }

    const row = await this.tx.run(async (tx) => {
      const existing = await repo.findByStorageKey(tx, input.storageKey);
      if (existing !== undefined) {
        throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu görsel zaten kaydedilmiş');
      }
      return repo.insertAsset(tx, {
        tenantId,
        purpose: input.purpose,
        storageKey: input.storageKey,
        mimeType: contentType,
        sizeBytes: meta.sizeBytes,
        width: input.width ?? null,
        height: input.height ?? null,
        sha256: input.sha256 ?? null,
        altText: input.altText ?? null,
        status: 'ready',
        createdBy: this.requestContext.get()?.userId ?? null,
      });
    });

    return this.present(row);
  }

  /**
   * Görseli YUMUŞAK siler.
   *
   * Sert silme yanlış olurdu: içerik sürümleri değişmez ve eski bir sürüm bu
   * kimliği anmaya devam ediyor. Geri alındığında görselin geri gelmesi
   * gerekiyor; nesnenin kendisi de bu yüzden depoda kalır.
   */
  async remove(assetId: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const row = await repo.findAsset(tx, assetId);
      if (row === undefined) throw AppError.notFound('Görsel bulunamadı');
      await repo.softDeleteAsset(tx, assetId);
    });
  }

  private storageKeyFor(assetId: string, contentType: string): string {
    const prefix = this.config.get('S3_PUBLIC_PREFIX', { infer: true });
    const extension = EXTENSIONS[contentType] ?? 'bin';
    // Anahtarda içerik ayrımı taşıyan kısa bir hash: logo değişince URL de
    // değişir, böylece CDN'e `immutable` diyebiliyoruz ve purge gerekmiyor.
    const fingerprint = createHash('sha256').update(assetId).digest('hex').slice(0, 8);
    return `${prefix}/${this.tx.tenantId}/${assetId}-${fingerprint}.${extension}`;
  }

  private assertSize(sizeBytes: number): void {
    const max = this.config.get('BOOKING_ASSET_MAX_BYTES', { infer: true });
    if (sizeBytes > max) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Görsel çok büyük', {
        detail: `Üst sınır ${Math.floor(max / 1024 / 1024)} MB.`,
      });
    }
  }

  private present(row: repo.TenantAssetRow): AssetDto {
    const base = this.config.get('PUBLIC_ASSET_BASE_URL', { infer: true }).replace(/\/$/, '');
    return {
      id: row.id,
      purpose: row.purpose,
      url: `${base}/${row.storageKey}`,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      altText: row.altText,
      status: row.status,
    };
  }
}


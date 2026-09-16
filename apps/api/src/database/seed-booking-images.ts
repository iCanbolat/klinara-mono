import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  TEMPLATE_IMAGES,
  readTemplateImage,
  type TemplateImageIds,
} from '../modules/booking-page/template/default-template';
import { S3ObjectStorage } from '../lib/storage/s3.storage';
import type { EnvironmentVariables } from '../config/env.validation';

/**
 * Demo randevu sayfasının görselleri.
 *
 * Görseller yeni kliniklerin hazır şablonuyla AYNI dosyalar
 * (`modules/booking-page/template`). Seed
 * onları uygulamanın kendi yükleme akışının bıraktığı hâle getiriyor: nesne
 * `public/{tenantId}/{assetId}-{parmakizi}.webp` anahtarında, `tenant_assets`
 * satırı `ready`. Editördeki görsel kütüphanesi bu satırları diğer
 * yüklemelerden ayırt etmez.
 *
 * İDEMPOTENT: kimlik dosya adından türetiliyor, yani ikinci çalıştırma aynı
 * anahtara aynı baytları yazar ve satırı `on conflict` ile günceller.
 */

export type SeedImageIds = TemplateImageIds;

/**
 * Görselleri depoya yükler ve kimliklerini döndürür.
 *
 * S3 kimlik bilgileri yoksa (bellek-içi depolama) boş döner: API süreci ayrı
 * olduğu için seed'in belleğine yazılan nesneyi hiçbir zaman göremezdi.
 * Sayfa o durumda görselsiz ama geçerli bir içerikle kurulur.
 */
export async function seedBookingImages(
  client: pg.Client,
  env: EnvironmentVariables,
  tenantId: string,
  ownerId: string | undefined,
): Promise<SeedImageIds> {
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    process.stdout.write('[seed] S3 tanımsız — randevu sayfası görselsiz kuruluyor\n');
    return {};
  }

  const storage = new S3ObjectStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });

  // `sharp` yalnız burada lazım; seed'in görselsiz yolunda yüklenmesin.
  const { default: sharp } = await import('sharp');
  const ids: SeedImageIds = {};

  for (const image of TEMPLATE_IMAGES) {
    const body = await readTemplateImage(image);
    const meta = await sharp(body).metadata();
    const assetId = stableUuid(`${tenantId}:seed-asset:${image.file}`);
    const fingerprint = createHash('sha256').update(assetId).digest('hex').slice(0, 8);
    const storageKey = `${env.S3_PUBLIC_PREFIX}/${tenantId}/${assetId}-${fingerprint}.webp`;

    try {
      await storage.put(storageKey, body, 'image/webp');
    } catch (error) {
      process.stderr.write(
        `[seed] ${image.file} yüklenemedi (MinIO çalışıyor mu?): ${String(error)}\n`,
      );
      return {};
    }

    await client.query(
      `insert into tenant_assets
         (id, tenant_id, purpose, storage_key, mime_type, size_bytes, width, height,
          sha256, alt_text, status, created_by)
       values ($1, $2, $3, $4, 'image/webp', $5, $6, $7, $8, $9, 'ready', $10)
       on conflict (id) do update
         set alt_text = excluded.alt_text,
             size_bytes = excluded.size_bytes,
             sha256 = excluded.sha256,
             deleted_at = null`,
      [
        assetId,
        tenantId,
        image.purpose,
        storageKey,
        body.length,
        meta.width ?? null,
        meta.height ?? null,
        createHash('sha256').update(body).digest('hex'),
        image.alt,
        ownerId ?? null,
      ],
    );
    ids[image.key] = assetId;
  }

  process.stdout.write(`[seed] ${TEMPLATE_IMAGES.length} randevu sayfası görseli yüklendi\n`);
  return ids;
}

/** Ad → sabit UUID (v4 biçiminde). Seed tekrarında kimlik değişmesin diye. */
function stableUuid(name: string): string {
  const hex = createHash('sha256').update(name).digest('hex');
  const variant = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

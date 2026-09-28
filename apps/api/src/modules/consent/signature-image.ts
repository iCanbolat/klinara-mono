import sharp, { type Metadata, type Sharp } from 'sharp';
import { CONSENT_LIMITS, ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';

const DATA_URL_PREFIX = /^data:image\/png;base64,/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_SIDE = 40;
const MAX_SIDE = 4_000;
/** Kanıtta saklanan görselin üst genişliği; tablet ekranı bunu nadiren aşar. */
const STORED_MAX_WIDTH = 1_200;

/**
 * İstemcinin gönderdiği imzayı doğrular ve NORMALİZE eder.
 *
 * Normalize etmek (yeniden PNG'ye kodlamak) iki iş görüyor: gömülü üstveri
 * (EXIF, metin parçaları) kanıta taşınmıyor ve PDF'e gömülen görsel her zaman
 * pdf-lib'in okuyabildiği sade bir PNG oluyor.
 *
 * "Boş imza" reddediliyor: istemci de kontrol ediyor ama bir onam kaydının
 * imzasız olabilmesi istemcinin dürüstlüğüne bırakılamaz.
 */
export async function normalizeSignaturePng(raw: string): Promise<Buffer> {
  const base64 = raw.trim().replace(DATA_URL_PREFIX, '').replace(/\s+/g, '');
  if (base64.length === 0 || !BASE64.test(base64)) {
    throw invalid('İmza PNG olarak base64 kodlanmış olmalı.');
  }

  const input = Buffer.from(base64, 'base64');
  if (input.length > CONSENT_LIMITS.signaturePngBytes) {
    throw invalid(`İmza görseli en fazla ${CONSENT_LIMITS.signaturePngBytes} bayt olabilir.`);
  }

  let image: Sharp;
  let metadata: Metadata;
  try {
    image = sharp(input, { failOn: 'error', limitInputPixels: MAX_SIDE * MAX_SIDE });
    metadata = await image.metadata();
  } catch {
    throw invalid('İmza görseli okunamadı.');
  }

  if (metadata.format !== 'png') throw invalid('İmza görseli PNG olmalı.');
  const { width = 0, height = 0 } = metadata;
  if (width < MIN_SIDE || height < MIN_SIDE || width > MAX_SIDE || height > MAX_SIDE) {
    throw invalid('İmza görselinin boyutları geçersiz.');
  }

  if (await isBlank(input)) {
    throw invalid('İmza alanı boş.');
  }

  return sharp(input)
    .resize({ width: STORED_MAX_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Görselde mürekkep var mı.
 *
 * Saydam arka planlı imzada alfa kanalına, opak arka planlıda en koyu
 * piksele bakılır: beyaz zemin üzerinde hiç koyu piksel yoksa imza yoktur.
 */
async function isBlank(input: Buffer): Promise<boolean> {
  const stats = await sharp(input).stats();
  const [red, green, blue, alpha] = stats.channels;
  if (alpha !== undefined && alpha.max === 0) return true;
  if (red === undefined) return true;

  const darkest = Math.min(red.min, green?.min ?? red.min, blue?.min ?? red.min);
  if (alpha !== undefined) {
    // Görünür (alfa > 0) piksel var; opak beyaz zeminli bir imza değilse bu
    // mürekkeptir. Opak beyaz zeminde de en az bir koyu piksel aranır.
    return stats.isOpaque && darkest > 200;
  }
  return darkest > 200;
}

function invalid(detail: string): AppError {
  return new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'İmza geçersiz', { detail });
}

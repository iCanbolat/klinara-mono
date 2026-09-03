import { CONTENT_LIMITS, type ContentBlockInput, type SeoInput } from '@klinara/shared';
import { BLOCK_FIELDS } from './block-schema';

/**
 * İstemci tarafı doğrulama — SUNUCUNUN KOPYASI DEĞİL, ÖN ELEMESİ.
 *
 * Otorite sunucudaki `class-validator`; buradaki kontrol yalnız kullanıcıyı
 * bir gidiş-dönüş beklemeden uyarmak için. Bu yüzden dönen şekil RFC 9457'nin
 * `errors[]` dizisiyle AYNI (`{path, message}`): arayüz istemci ve sunucu
 * hatalarını tek bir kod yolundan basıyor, iki ayrı gösterim yazmıyor.
 */
export interface FieldError {
  path: string;
  message: string;
}

export function validateSections(sections: readonly ContentBlockInput[]): FieldError[] {
  const errors: FieldError[] = [];

  if (sections.length > CONTENT_LIMITS.sections.max) {
    errors.push({
      path: 'sections',
      message: `En fazla ${String(CONTENT_LIMITS.sections.max)} blok ekleyebilirsiniz.`,
    });
  }

  sections.forEach((block, index) => {
    const fields = BLOCK_FIELDS[block.type] ?? [];
    for (const field of fields) {
      const value = (block as unknown as Record<string, unknown>)[field.key];
      const path = `sections[${String(index)}].${field.key}`;

      if (field.required === true && (value === undefined || value === '')) {
        errors.push({ path, message: 'Bu alan zorunlu.' });
        continue;
      }
      if (typeof value === 'string' && field.max !== undefined && value.length > field.max) {
        errors.push({ path, message: `En fazla ${String(field.max)} karakter.` });
      }
      if (Array.isArray(value) && field.maxItems !== undefined && value.length > field.maxItems) {
        errors.push({ path, message: `En fazla ${String(field.maxItems)} öge.` });
      }
      if (typeof value === 'number') {
        if (field.min !== undefined && value < field.min) {
          errors.push({ path, message: `En az ${String(field.min)} olmalı.` });
        }
        if (field.max !== undefined && value > field.max) {
          errors.push({ path, message: `En fazla ${String(field.max)} olmalı.` });
        }
      }
    }
  });

  return errors;
}

export function validateSeo(seo: SeoInput): FieldError[] {
  const errors: FieldError[] = [];
  if (seo.title !== undefined && seo.title.length > CONTENT_LIMITS.seo.title) {
    errors.push({ path: 'seo.title', message: `En fazla ${String(CONTENT_LIMITS.seo.title)} karakter.` });
  }
  if (seo.description !== undefined && seo.description.length > CONTENT_LIMITS.seo.description) {
    errors.push({
      path: 'seo.description',
      message: `En fazla ${String(CONTENT_LIMITS.seo.description)} karakter.`,
    });
  }
  return errors;
}

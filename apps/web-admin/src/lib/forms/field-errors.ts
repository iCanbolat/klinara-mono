import { ApiProblemError, SessionExpiredError } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';

/**
 * Sunucunun alan bazlı doğrulama hatalarını forma bağlayan köprü.
 *
 * ---------------------------------------------------------------------------
 * NEDEN İSTEMCİ TARAFI ŞEMA DOĞRULAMASI YOK
 * ---------------------------------------------------------------------------
 * Doğrulamanın otoritesi sunucudaki `class-validator` DTO'ları ve proje bunu
 * bir sözleşme testiyle `@klinara/shared`'a kilitliyor. `zod` eklemek her
 * kuralı İKİNCİ KEZ — ve senkron kalacağı hiçbir garanti olmadan — yazmak
 * demek. `MaxLength(2000)`in istemci kopyası 500 olduğunda kullanıcı sunucunun
 * kabul edeceği bir notu yazamaz ve kimse fark etmez.
 *
 * Panelin bugün sıfır istemci doğrulaması var ve bu tesadüf değil. Eksik olan
 * tek parça, sunucunun ZATEN döndüğü alan hatalarının forma ulaşması:
 * `describeProblem().fieldErrors` bugün hiçbir bileşenin okumadığı ölü bir
 * alan. Bu dosya onu canlandırıyor.
 *
 * ---------------------------------------------------------------------------
 * YOL BİÇİMİ
 * ---------------------------------------------------------------------------
 * `ValidationPipe` iç içe DTO'larda noktalı yol üretir:
 * `services.0.serviceId`, `branchOverrides.2.priceMinor`. Anahtar OLDUĞU GİBİ
 * korunuyor; form alanı da aynı yolu kullanıyor. Eşleme yapmaya çalışmak
 * (camelCase → alan adı) bir gün sessizce ıskalardı.
 */

export interface FormErrors {
  /** Forma bir bütün olarak ait mesaj; hiç alan hatası yoksa da dolu olabilir. */
  message: string | null;
  /** `services.0.serviceId` → mesaj. */
  fields: Record<string, string>;
  requestId: string | null;
}

const EMPTY: FormErrors = { message: null, fields: {}, requestId: null };

/**
 * Yakalanan hatayı forma bağlanabilir hâle getirir.
 *
 * `SessionExpiredError` **tamamen boş** döner: oturum bitişini
 * `SessionProvider` bir modalla ele alıyor ve aynı olayı formda kırmızı bir
 * satır olarak da göstermek, kullanıcıya iki ayrı sorun varmış gibi
 * görünürdü. (`lib/reports/errors.ts` aynı kararı veriyor.)
 */
export function toFormErrors(caught: unknown): FormErrors {
  if (caught instanceof SessionExpiredError) return EMPTY;

  if (caught instanceof ApiProblemError) {
    const described = describeProblem(caught.problem, caught.retryAfterSeconds);
    const fields: Record<string, string> = {};
    const orphans: string[] = [];

    for (const error of described.fieldErrors) {
      if (error.path === '') {
        orphans.push(error.message);
        continue;
      }
      // Aynı yola birden çok kural düşebilir (ör. hem `IsUUID` hem
      // `IsNotEmpty`). İlki korunuyor: kullanıcıya üst üste iki mesaj
      // basmak yerine ilk sebebi göstermek daha okunur.
      fields[error.path] ??= error.message;
    }

    return {
      // Eşleşmeyen (yolsuz) alan hataları genel mesaja KATILIYOR, sessizce
      // yutulmuyor. Yutulan bir alan hatası kullanıcı için "kaydet'e bastım,
      // hiçbir şey olmadı" demektir — panelin verebileceği en kötü yanıt.
      message: [described.message, ...orphans].join(' '),
      fields,
      requestId: described.requestId,
    };
  }

  return { ...EMPTY, message: networkError().message };
}

/**
 * Bir formun alan hatası taşıyıp taşımadığı — genel mesajın gösterilip
 * gösterilmeyeceğine karar vermek için.
 */
export function hasFieldErrors(errors: FormErrors): boolean {
  return Object.keys(errors.fields).length > 0;
}

/**
 * Dizi elemanı için yol kurar: `fieldPath('services', 0, 'serviceId')` →
 * `'services.0.serviceId'`.
 *
 * Elle dize birleştirmek yerine bunun kullanılması, sunucunun ürettiği yol
 * biçiminin TEK bir yerde yazılı olmasını sağlıyor; biçim değişirse tek
 * dosya değişir.
 */
export function fieldPath(...parts: (string | number)[]): string {
  return parts.join('.');
}

/**
 * Alan hatasını `Field`in `error` prop'una uygun hâle getirir.
 *
 * `undefined` dönüyor, boş dize değil: `Field` boş dizeyi de "hata var" sayıp
 * kırmızı bir boşluk çizerdi.
 */
export function errorFor(errors: FormErrors, path: string): string | undefined {
  return errors.fields[path];
}

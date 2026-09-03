/**
 * Proxy'nin başlık politikası ve 401 ayrıştırması — saf fonksiyonlar.
 *
 * Route Handler'ın kendisi ince bir tutkal katmanı; kararların hepsi burada,
 * çünkü ancak burada mock'suz test edilebilirler.
 */

import { ERROR_CODES, type ProblemDetails } from '@klinara/shared';

/**
 * Yukarı akışa iletilen istek başlıkları — beyaz liste.
 *
 * ⚠️ `authorization` BU LİSTEDE YOK ve olmamalı: onu cookie'den okuyup biz
 * ekliyoruz. İstemcinin gönderdiği bir `Authorization` başlığının geçmesi,
 * kullanıcının kendi oturumu yerine başka bir token'ı kullanabilmesi demekti —
 * proxy'yi bir token yeniden oynatma aracına çevirirdi.
 *
 * `cookie` de yok: yukarı akış API'si cookie okumuyor ve oturum
 * cookie'lerimizi ona göndermek, mühürlü sırları gereksiz bir yere taşımaktı.
 */
export const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'idempotency-key',
  // İyimser kilit token'ı — bugün yalnız randevu uçlarında var ama editörün
  // `If-Match` alacağı gün proxy'nin değişmesi gerekmesin.
  'if-match',
  'if-none-match',
] as const;

/** İstemciye geri verilen yanıt başlıkları — beyaz liste. */
export const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'etag',
  'retry-after',
  'content-disposition',
  'content-language',
  // web-booking'in listesinde YOK: hata paneli destek için `requestId`
  // gösteriyor ve gövdeden okunamadığı durumlarda (204, ağ hatası) başlık
  // tek kaynak.
  'x-request-id',
] as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Şube kapsamı başlığı.
 *
 * Biçim burada denetleniyor ama ÜYELİK denetlenmiyor — onu API'nin `AuthGuard`'ı
 * `BranchAccessService.assertInput` ile zaten yapıyor ve orası tek otorite.
 * Buradaki kontrol yalnız biçimsel çöpün yukarı akışa gitmesini engelliyor.
 */
export function sanitizeBranchId(value: string | null): string | null {
  if (value === null || value === '') return null;
  return UUID_PATTERN.test(value) ? value : null;
}

/** Proxy'nin 401 karşısındaki kararı. */
export type SessionSignal = 'refresh' | 'expired' | 'none';

/** İstemciye bu başlıkla söyleniyor; `client.ts` buna göre davranıyor. */
export const SESSION_SIGNAL_HEADER = 'x-klinara-session';

/**
 * 401'i ayrıştır.
 *
 * İki durumu ayırmak şart: erişim token'ının süresi dolduysa (`TOKEN_EXPIRED`)
 * sessizce yenileyip devam edilir; oturum gerçekten öldüyse (`TOKEN_INVALID` —
 * yeniden kullanım tespitinin, `logout-all`ın ve parola değişiminin indiği yer)
 * yenilemeyi DENEMEK bile yanlıştır: token zaten yanmış, bir kez daha göndermek
 * sunucu logunda ikinci bir "yeniden kullanım" kaydı üretir ve istemci sonsuz
 * bir yenile-başarısız ol döngüsüne girer.
 */
export function decideOn401(problem: unknown): SessionSignal {
  const code = readCode(problem);
  if (code === ERROR_CODES.TOKEN_EXPIRED) return 'refresh';
  if (code === ERROR_CODES.TOKEN_INVALID || code === ERROR_CODES.UNAUTHENTICATED) {
    return 'expired';
  }
  // Bilinmeyen bir 401 — yenilemeyi denemiyoruz. Yanlış tarafta hata yapmanın
  // ucuz yönü bu: kullanıcı bir kez daha giriş yapar, oturum ailesi yanmaz.
  return 'expired';
}

function readCode(problem: unknown): string | null {
  if (typeof problem !== 'object' || problem === null) return null;
  const code = (problem as Partial<ProblemDetails>).code;
  return typeof code === 'string' ? code : null;
}

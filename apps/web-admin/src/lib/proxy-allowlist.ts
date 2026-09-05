/**
 * Yönetim proxy'sinin yol beyaz listesi — bu dosyanın tek işi HAYIR demek.
 *
 * `apps/web-booking/src/lib/proxy-allowlist.ts` ile aynı felsefe, ama BURADA
 * RİSK DAHA BÜYÜK: public proxy yukarı akışa `public/` önekini kendisi
 * ekliyordu, yani en kötü ihtimalde public yüzeye açılıyordu. Bu proxy ise
 * isteğe kullanıcının OTURUM TOKEN'INI ekleyip `/api/v1`'in köküne gönderiyor.
 * Buradaki bir açık, kimliği doğrulanmış bir kullanıcının tarayıcısından
 * API'nin TAMAMINA açılan bir tünel demektir.
 *
 * Bu yüzden izin veren liste var, yasaklayan değil: yeni bir uç eklendiğinde
 * buraya yazılmadıkça proxy'den geçmez — ve bu, güvenli yönde başarısız olmaktır.
 *
 * DIŞARIDA BIRAKILANLAR VE GEREKÇELERİ
 *
 * - **Token üreten/tüketen uçlar** (`auth/login`, `auth/tenant`, `auth/refresh`,
 *   `auth/logout`, `auth/2fa/verify|setup|enable`, `auth/passkey/*` TEKİL,
 *   `auth/password/forgot|reset`, `invitations/token/*`): bunların yanıtı
 *   cookie yazmayı gerektiriyor, genel proxy ise gövdeyi olduğu gibi geçiriyor.
 *   Buradan geçselerdi token tarayıcıya inerdi — yani BFF'in tek amacı çöpe
 *   giderdi. Hepsinin `app/api/session/*` altında kendi handler'ı var.
 * - **`internal/*`, `platform/*`, `webhooks/*`, `metrics`**: kiracı
 *   kullanıcısının yüzeyi değil. `internal/booking-domains/authorize` kenar
 *   proxy'sinin sertifika sorusudur, `platform/*` kiracı-üstüdür.
 * - **`public/*`**: bu uygulamanın public yüzeyi okumak için hiçbir sebebi yok;
 *   taslak önizlemenin yetkili karşılığı `booking-page/preview`.
 * - **Klinik operasyonunun TAMAMI** (`appointments`, `calendar`, `customers`,
 *   `payments`, `charges`, `cash`, `packages`, `staff`, `services`, …): Faz 11
 *   kapsamı dışında (iOS'ta kalıyor). Dışarıda tutmak bedava ve "şuraya bir
 *   müşteri sayfası ekleyiverelim"i güvenlik açısından kritik bir dosyada
 *   GÖRÜNÜR BİR DIFF hâline getiriyor.
 *
 * RAPORLAR (10.1) — yukarıdaki kuralın İSTİSNASI DEĞİL, TANIMININ DIŞI
 *
 * `reports/*` listede ve olması gerekiyor. Klinik operasyonunu dışarıda tutma
 * gerekçesi "yazma yüzeyini ve müşteri kaydını panele açmayalım"dı; rapor
 * uçları ikisini de yapmıyor:
 *
 * - Hepsi SALT OKUNUR. `POST .../export`in gövdesi bir kayıt değil bir filtre;
 *   sunucuda hiçbir şey yazmıyor (dinamik `:name` yolu da yok, her rapor kendi
 *   statik iznini taşıyor).
 * - Yanıtlar TOPLU. Müşteri kimliği, telefonu, notu dönmüyor; retention raporu
 *   bunu bir testle sabitliyor.
 * - Daraltma sunucuda: şube üyeliği ve `report.performance:read.own` kilidi
 *   `report-scope.ts`te, proxy'nin bileceği bir şey değil.
 *
 * Yani buradaki satırlar bir müşteri sayfasına giden kapıyı aralamıyor. Tek
 * tek yazılmalarının sebebi de bu: `reports/` önekine joker vermek, yarın
 * eklenecek bir `reports/customers/:id` ucunu sessizce açardı.
 *
 * TEK İSTİSNA: `GET service-categories`
 *
 * `serviceList` bloğu kategori kimlikleriyle süzülüyor ve editörün o kimlikleri
 * bir ADLA eşleştirmesi gerekiyor — aksi hâlde kullanıcıdan UUID yazması
 * istenirdi. İstisna dar tutuldu ve öyle kalmalı: YALNIZ `GET`, YALNIZ
 * kategoriler; `services` (fiyat, süre, personel yetkinliği) listede DEĞİL,
 * çünkü blok hizmetleri değil kategorileri süzüyor. Uç `service:read` istiyor;
 * bu izni taşımayan kullanıcı 403 alır ve editör mevcut seçimi salt okunur
 * gösterir — kategori listesini görememek, seçimi SİLMEK demek değildir.
 */

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

interface Rule {
  methods: readonly string[];
  pattern: RegExp;
}

const RULES: readonly Rule[] = [
  // --- Kimlik: yalnız oturum AÇILDIKTAN sonraki, token üretmeyen uçlar ---
  { methods: ['GET', 'PATCH'], pattern: /^me$/ },
  { methods: ['GET'], pattern: /^branches$/ },
  { methods: ['GET'], pattern: /^auth\/sessions$/ },
  { methods: ['DELETE'], pattern: new RegExp(`^auth/sessions/${UUID}$`) },
  { methods: ['POST'], pattern: /^auth\/logout-all$/ },
  { methods: ['POST'], pattern: /^auth\/password\/change$/ },

  // 2FA yönetimi — `verify`, `setup` ve `enable` BURADA YOK (challenge token'ı
  // Bearer olarak kabul ediyorlar, yani cookie'den okunmaları gerekiyor).
  { methods: ['GET', 'DELETE'], pattern: /^auth\/2fa$/ },
  { methods: ['POST'], pattern: /^auth\/2fa\/backup-codes$/ },

  // Passkey KAYDI (çoğul `passkeys`) — oturum açıkken yapılır, token üretmez.
  // Passkey ile GİRİŞ (tekil `passkey`) bilerek dışarıda.
  { methods: ['POST'], pattern: /^auth\/passkeys\/register\/options$/ },
  { methods: ['POST'], pattern: /^auth\/passkeys\/register$/ },
  { methods: ['GET'], pattern: /^auth\/passkeys$/ },
  { methods: ['PATCH', 'DELETE'], pattern: new RegExp(`^auth/passkeys/${UUID}$`) },

  // --- Davetler (yönetim tarafı; token ile kabul akışı dışarıda) ---
  { methods: ['GET', 'POST'], pattern: /^invitations$/ },
  { methods: ['DELETE'], pattern: new RegExp(`^invitations/${UUID}$`) },

  // --- Katalog: yalnız kategori ADLARI (yukarıdaki tek istisna) ---
  { methods: ['GET'], pattern: /^service-categories$/ },

  // --- Raporlar (10.1): salt okunur, toplu veri ---
  // Şube seçici `GET branches`i kullanıyor; o zaten listede.
  {
    methods: ['GET'],
    pattern: /^reports\/(occupancy|revenue|staff-performance|no-show|retention)$/,
  },
  { methods: ['GET'], pattern: /^reports\/packages\/(outstanding|expiring|usage)$/ },
  // CSV indirme. `POST` ama yazmıyor — gövde filtre taşıyor, kayıt değil.
  {
    methods: ['POST'],
    pattern: /^reports\/(occupancy|revenue|staff-performance|no-show|retention)\/export$/,
  },

  // --- Randevu sayfası: Faz 11.5 ve 11.6'nın tüm yüzeyi ---
  { methods: ['GET', 'PUT'], pattern: /^booking-page$/ },
  { methods: ['GET', 'PUT'], pattern: /^booking-page\/content$/ },
  { methods: ['GET'], pattern: /^booking-page\/content\/revisions$/ },
  { methods: ['POST'], pattern: new RegExp(`^booking-page/content/rollback/${UUID}$`) },
  { methods: ['GET'], pattern: /^booking-page\/preview$/ },
  { methods: ['POST'], pattern: /^booking-page\/(publish|unpublish)$/ },

  { methods: ['GET'], pattern: /^booking-page\/assets$/ },
  { methods: ['POST'], pattern: /^booking-page\/assets\/(presign|confirm)$/ },
  { methods: ['DELETE'], pattern: new RegExp(`^booking-page/assets/${UUID}$`) },

  { methods: ['GET', 'POST'], pattern: /^booking-page\/domains$/ },
  { methods: ['DELETE'], pattern: new RegExp(`^booking-page/domains/${UUID}$`) },
  { methods: ['POST'], pattern: new RegExp(`^booking-page/domains/${UUID}/(verify|primary)$`) },
];

/**
 * Verilen yol + metot proxy'den geçebilir mi?
 *
 * `path` `/api/a/` önekinden SONRAKİ kısımdır ve API'nin `/api/v1` önekini
 * İÇERMEZ — onu proxy ekler.
 */
export function isAllowedProxyPath(path: string, method: string): boolean {
  // Yol geçişi, çift eğik çizgi, kodlanmış ayraç: hepsi burada ölür.
  // Normalize edip doğrulamak yerine reddediyoruz — normalize edilmiş bir yolu
  // doğrulamak, doğrulanmış bir yolu normalize etmekten daha kırılgan.
  // (`apps/web-booking/src/lib/proxy-allowlist.ts` ile birebir aynı savunma.)
  if (path.includes('..') || path.includes('//') || path.includes('\\')) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  if (/%2f|%5c|%2e/i.test(path)) return false;
  if (path.length > 4096) return false;

  const upperMethod = method.toUpperCase();
  return RULES.some((rule) => rule.methods.includes(upperMethod) && rule.pattern.test(path));
}

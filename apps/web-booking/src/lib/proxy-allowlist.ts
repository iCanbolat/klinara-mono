/**
 * Proxy'nin yol beyaz listesi — bu dosyanın tek işi HAYIR demek.
 *
 * `/api/b/[...path]` yakalayıcı bir rota: gelen parçaları düşünmeden birleştirip
 * yukarı akışa göndermek, kimlik doğrulaması olmayan bir uçtan `/api/v1`'in
 * TAMAMINA (platform yönetimi, kiracı verisi, iç kenar ucu) açılan bir tünel
 * demekti. Bu yüzden izin veren bir liste var, yasaklayan değil: yeni bir public
 * uç eklendiğinde buraya yazılmadıkça proxy'den geçmez — ve bu, güvenli
 * yönde başarısız olmaktır.
 *
 * Yalnız `@Public()` işaretli ve ziyaretçiye ait uçlar listede. `/internal/*`,
 * `/auth/*`, `/booking-page/*` ve platform uçları KASITLI olarak yok.
 */

const SLUG = '[a-z0-9][a-z0-9-]{0,62}';
/** Opak token'lar: slot/hold/manage — base64url ya da hex. */
const TOKEN = '[A-Za-z0-9._~-]{8,2048}';

interface Rule {
  methods: readonly string[];
  pattern: RegExp;
}

const RULES: readonly Rule[] = [
  // Konak adı → slug çözümlemesi (middleware sunucudan çağırır ama istemci de
  // önizleme sırasında kullanabilsin).
  { methods: ['GET'], pattern: new RegExp(`^resolve$`) },

  // Katalog ve uygunluk — okuma.
  { methods: ['GET'], pattern: new RegExp(`^sites/${SLUG}/(branches|services|staff|availability)$`) },
  { methods: ['GET'], pattern: new RegExp(`^sites/${SLUG}$`) },

  // Slot tutma ve OTP.
  { methods: ['POST'], pattern: new RegExp(`^sites/${SLUG}/holds$`) },
  { methods: ['DELETE'], pattern: new RegExp(`^sites/${SLUG}/holds/${TOKEN}$`) },
  { methods: ['POST'], pattern: new RegExp(`^sites/${SLUG}/holds/${TOKEN}/otp$`) },
  { methods: ['POST'], pattern: new RegExp(`^sites/${SLUG}/holds/${TOKEN}/otp/verify$`) },

  // Randevu oluşturma.
  { methods: ['POST'], pattern: new RegExp(`^sites/${SLUG}/appointments$`) },

  // Self-servis — token kapsamlı.
  { methods: ['GET'], pattern: new RegExp(`^sites/${SLUG}/appointments/${TOKEN}$`) },
  { methods: ['GET'], pattern: new RegExp(`^sites/${SLUG}/appointments/${TOKEN}/ics$`) },
  { methods: ['POST'], pattern: new RegExp(`^sites/${SLUG}/appointments/${TOKEN}/(cancel|reschedule)$`) },
];

/**
 * Verilen yol+metot proxy'den geçebilir mi?
 *
 * `path` `/api/b/` önekinden SONRAKİ kısımdır ve `public/` öneki İÇERMEZ —
 * onu proxy ekler, böylece istemci `public/` dışına adres yazamaz.
 */
export function isAllowedProxyPath(path: string, method: string): boolean {
  // Yol geçişi, çift eğik çizgi, kodlanmış ayraç ve sorgu kaçağı: hepsi burada
  // ölür. Normalizasyona güvenmek yerine reddediyoruz — normalize edilmiş bir
  // yolu doğrulamak, doğrulanmış bir yolu normalize etmekten daha kırılgan.
  if (path.includes('..') || path.includes('//') || path.includes('\\')) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  if (/%2f|%5c|%2e/i.test(path)) return false;
  if (path.length > 4096) return false;

  const upperMethod = method.toUpperCase();
  return RULES.some((rule) => rule.methods.includes(upperMethod) && rule.pattern.test(path));
}

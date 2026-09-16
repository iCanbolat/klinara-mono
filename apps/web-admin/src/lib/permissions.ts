/**
 * İzin kontrolü ve izne göre navigasyon — saf.
 *
 * ⚠️ BU BİR YETKİ KAPISI DEĞİL, BİR KULLANILABİLİRLİK KATMANIDIR.
 *
 * Yetkinin tek otoritesi sunucudaki `PermissionsGuard`; buradaki liste
 * `GET /me`'den geliyor ve amacı kullanıcıya kaydedemeyeceği bir formu
 * göstermemek. "Doğrudan URL ile de giremez" kabul kriterinin gerçek cevabı
 * API'nin 403'üdür — menüyü gizlemek onun yerine geçmez, onu tamamlar.
 */

import { PERMISSIONS } from '@klinara/shared';

/**
 * `manage`, `read`'i KAPSAMAZ.
 *
 * `packages/shared/src/permissions.ts` bunu bilerek böyle kuruyor ve bu, gerçek
 * ve ulaşılabilir bir durum yaratıyor: yalnız `booking_page:manage` taşıyan bir
 * rol, içeriği KAYDEDEBİLİR ama OKUYAMAZ. Editör bu kullanıcıya boş bir sayfa
 * göstermemeli — üzerine yazacağı şeyi görmeden kaydetmesi, sessiz veri kaybının
 * ta kendisi. Bu yüzden `bookingPageAccess` üç durum döndürüyor, iki değil.
 */
export type BookingPageAccess = 'none' | 'read-only' | 'full' | 'misconfigured';

export function can(permissions: readonly string[], ...required: string[]): boolean {
  return required.every((permission) => permissions.includes(permission));
}

export function canAny(permissions: readonly string[], ...required: string[]): boolean {
  return required.some((permission) => permissions.includes(permission));
}

export function bookingPageAccess(permissions: readonly string[]): BookingPageAccess {
  const read = permissions.includes(PERMISSIONS.BOOKING_PAGE_READ);
  const manage = permissions.includes(PERMISSIONS.BOOKING_PAGE_MANAGE);
  if (read && manage) return 'full';
  if (read) return 'read-only';
  // Yazabilir ama okuyamaz — rol yapılandırması hatalı. Kullanıcıya "yetkiniz
  // yok" demek yanlış olurdu (var), boş editör göstermek daha da yanlış.
  if (manage) return 'misconfigured';
  return 'none';
}

export interface NavItem {
  /** Rota — `href` olarak kullanılıyor. */
  path: string;
  labelKey: string;
  /** Menüde görünmesi için GEREKEN izinlerin hepsi (VE). */
  requires: readonly string[];
  /**
   * Bunlardan EN AZ BİRİ de gerekiyor (VEYA).
   *
   * Raporlar için eklendi: ciroyu `report.revenue:read`, doluluk ve no-show'u
   * `appointment:read.all` açıyor ve bir rolün ikisine birden sahip olması
   * şart değil. Yalnız VE ile ifade etmek, muhasebeciyi (takvim izni yok) ya
   * da resepsiyonu (ciro izni yok) menüden tamamen düşürürdü.
   */
  requiresAny?: readonly string[] | undefined;
}

/**
 * Panelin tüm gezinme ağacı.
 *
 * Kapsam kararı gereği burada klinik operasyonu (takvim, müşteri, finans) YOK;
 * eklenmek istenirse `proxy-allowlist.ts`'e de kural eklemek gerekiyor ve bu
 * bilinçli bir sürtünme.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  // Karşılama sayfası izin istemiyor: içindeki her bölüm kendi iznine bakıyor
  // (`components/dashboard/use-dashboard.ts`) ve izni hiç olmayan bir rol en
  // azından hızlı erişim kartlarını görüyor.
  { path: '/dashboard', labelKey: 'nav.dashboard', requires: [] },
  // --- Klinik operasyonu (Faz 12) ---
  // Takvim menünün BAŞINDA: resepsiyonun günlük işi bu, randevu sayfası
  // editörü değil. Sıra kullanım sıklığına göre.
  //
  // `requiresAny` şart: uygulayıcı `appointment:read.all` TAŞIMAZ, yalnız
  // `read.own` taşır. `requires` ile yazılsaydı takvimi hiç göremezdi.
  // Muhasebeci ise ikisini de taşımıyor ve menüde takvim GÖRMÜYOR — boş bir
  // ızgara göstermek, "bugün randevu yok" demek olurdu.
  {
    path: '/takvim',
    labelKey: 'nav.calendar',
    requires: [],
    requiresAny: [PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN],
  },
  { path: '/musteriler', labelKey: 'nav.customers', requires: [PERMISSIONS.CUSTOMER_READ] },
  { path: '/katalog', labelKey: 'nav.catalog', requires: [PERMISSIONS.SERVICE_READ] },
  // "Şube ve Personel". Kapı `staff:read`: `branch:read` HER rolde var ve
  // kapı olsaydı muhasebeci yalnız şube listesinden ibaret bir ekran görürdü.
  // Sekmeler kendi içinde ayrıca süzülüyor (`branch:write`, `user:invite`).
  { path: '/personel', labelKey: 'nav.staff', requires: [PERMISSIONS.STAFF_READ] },
  {
    path: '/calisma-saatleri',
    labelKey: 'nav.schedule',
    requires: [PERMISSIONS.SCHEDULE_READ],
  },

  { path: '/sayfa', labelKey: 'nav.page', requires: [PERMISSIONS.BOOKING_PAGE_READ] },
  { path: '/icerik', labelKey: 'nav.content', requires: [PERMISSIONS.BOOKING_PAGE_READ] },
  { path: '/alan-adlari', labelKey: 'nav.domains', requires: [PERMISSIONS.BOOKING_PAGE_READ] },
  // Onam metni randevu sayfasının ALTINDA ama ayrı: sayfa ayarı değil,
  // sürümlü ve yayınlandıktan sonra değişmeyen bir belge (Faz 7).
  { path: '/onam', labelKey: 'nav.consent', requires: [PERMISSIONS.CONSENT_READ] },
  {
    path: '/raporlar',
    labelKey: 'nav.reports',
    requires: [],
    requiresAny: [
      PERMISSIONS.REPORT_REVENUE_READ,
      PERMISSIONS.APPOINTMENT_READ_ALL,
      PERMISSIONS.REPORT_PERFORMANCE_READ_OWN,
    ],
  },
  { path: '/hesap', labelKey: 'nav.account', requires: [] },
];

/**
 * Görünecek menü ögeleri.
 *
 * İzni olmayan öge DÖNMÜYOR — CSS ile gizlenmiyor. Gizlenmiş bir menü DOM'da
 * durur, ekran okuyucuya okunur ve "neden tıklayamıyorum" sorusu üretir.
 */
export function visibleNav(permissions: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => allows(permissions, item));
}

/** Bir menü ögesinin iki koşulu: hepsi (`requires`) ve en az biri (`requiresAny`). */
function allows(permissions: readonly string[], item: NavItem): boolean {
  if (!can(permissions, ...item.requires)) return false;
  if (item.requiresAny === undefined) return true;
  return canAny(permissions, ...item.requiresAny);
}

/** Bir rota bu izinlerle açılabilir mi (doğrudan URL kontrolü). */
export function canOpenPath(permissions: readonly string[], path: string): boolean {
  // En uzun eşleşen önek kazanır: `/icerik/surumler`, `/icerik` kuralına tabi.
  const match = [...NAV_ITEMS]
    .filter((item) => path === item.path || path.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (match === undefined) return true;
  return allows(permissions, match);
}

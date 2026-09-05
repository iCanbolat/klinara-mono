/**
 * Roller ve izinler — kimlik modelinin sözleşmesi.
 *
 * Yetki kontrolü DAİMA izin üzerinden yapılır (`appointment:write`), rol adına
 * göre değil. Rol yalnızca bir izin demetidir; yeni bir rol eklemek mevcut
 * kontrolleri değiştirmez.
 *
 * Bu dosya tek gerçek kaynaktır: `0006_identity.sql` aynı satırları veritabanına
 * yazar ve bir entegrasyon testi ikisinin birebir aynı olduğunu doğrular
 * (drift olduğunda test kırmızıya döner).
 */

export const PERMISSIONS = {
  // --- Kiracı ve şube ---
  TENANT_READ: 'tenant:read',
  TENANT_WRITE: 'tenant:write',
  BRANCH_READ: 'branch:read',
  BRANCH_WRITE: 'branch:write',

  // --- Kullanıcı ve yetkilendirme ---
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  USER_INVITE: 'user:invite',

  // --- Takvim ---
  APPOINTMENT_READ_OWN: 'appointment:read.own',
  APPOINTMENT_READ_ALL: 'appointment:read.all',
  APPOINTMENT_WRITE: 'appointment:write',
  APPOINTMENT_REOPEN: 'appointment:reopen',

  // --- Katalog ve kaynaklar ---
  SERVICE_READ: 'service:read',
  SERVICE_WRITE: 'service:write',
  STAFF_READ: 'staff:read',
  STAFF_WRITE: 'staff:write',
  SCHEDULE_READ: 'schedule:read',
  SCHEDULE_WRITE: 'schedule:write',
  // Eski kapsamdan kalan anahtarlar. Yeni uçlar STAFF/SCHEDULE kullanır.
  RESOURCE_READ: 'resource:read',
  RESOURCE_WRITE: 'resource:write',

  // --- Müşteri ---
  CUSTOMER_READ: 'customer:read',
  CUSTOMER_WRITE: 'customer:write',
  // Birleştirme FK taşıyan ve geri alınması pahalı bir işlemdir; yazma izniyle
  // birlikte resepsiyona açmak orantısız olurdu.
  CUSTOMER_MERGE: 'customer:merge',
  CUSTOMER_MEDICAL_READ: 'customer.medical:read',
  CUSTOMER_MEDICAL_WRITE: 'customer.medical:write',

  // --- Paket ---
  PACKAGE_READ: 'package:read',
  PACKAGE_WRITE: 'package:write',
  // İade ve devir `package:write` üzerine BİNMEZ. Gerekçe `customer:merge`
  // ile aynı: geri alınması pahalı, paraya dokunan işlemlerin resepsiyonun
  // günlük yazma iznine binmesi yetkisiz iade demektir.
  PACKAGE_REFUND: 'package:refund',
  PACKAGE_TRANSFER: 'package:transfer',

  // --- Finans ---
  FINANCE_PAYMENT_READ: 'finance.payment:read',
  FINANCE_PAYMENT_WRITE: 'finance.payment:write',
  // Katalog fiyatının dışına çıkma. `finance.payment:write` üzerine BİNMEZ:
  // gerekçe `package:refund` ile aynı — resepsiyonun günlük tahsilat iznine
  // binen bir fiyat override'ı, yetkisiz indirim demektir.
  FINANCE_PRICE_OVERRIDE: 'finance.price:override',
  FINANCE_COMMISSION_READ: 'finance.commission:read',
  // Prim kuralı yazmak ve dönem kapatmak. `:read` yalnız okuma sözleşmesidir;
  // muhasebe primi GÖRÜR ama kuralını değiştiremez.
  FINANCE_COMMISSION_WRITE: 'finance.commission:write',
  REPORT_REVENUE_READ: 'report.revenue:read',
  /**
   * Uygulayıcının YALNIZ KENDİ performans raporunu görmesi (10.1).
   *
   * `report.revenue:read` üzerine BİNMEZ ve onun dar bir hâli DEĞİLDİR: bu izin
   * tek başına hiçbir şubenin cirosunu açmaz, yalnız taşıyıcının kendi
   * satırını açar. Daraltmayı istemci değil sunucu yapar — principal
   * `staff_profiles.user_id` üzerinden çözülür ve sorgu zorla kendi
   * `staff_profile_id`'sine kilitlenir.
   */
  REPORT_PERFORMANCE_READ_OWN: 'report.performance:read.own',

  // --- Onam / KVKK ---
  CONSENT_READ: 'consent:read',
  CONSENT_MANAGE: 'consent:manage',

  // --- İletişim ve denetim ---
  NOTIFICATION_SEND: 'notification:send',
  /** Mesaj kaydı ve gelen kutusu okuma. */
  NOTIFICATION_READ: 'notification:read',
  /**
   * Şablon, tercih ve WhatsApp entegrasyonu yönetimi.
   *
   * `notification:send` üzerine BİNMEZ: resepsiyon tek tek mesaj gönderebilir
   * ama kiracının TÜM müşterilerine giden şablonu değiştiremez. Bir şablon
   * hatası binlerce yanlış mesaj demektir, tek bir yanlış mesaj değil.
   */
  NOTIFICATION_MANAGE: 'notification:manage',

  // --- Online randevu sayfası (Faz 9) ---
  BOOKING_PAGE_READ: 'booking_page:read',
  /**
   * Sayfa ayarları, içerik/tema sürümleri, görseller ve ALAN ADLARI.
   *
   * `booking_page:read` üzerine binmez ve resepsiyona verilmez: yayınla
   * düğmesi kiracının dışarıya görünen yüzünü değiştirir, alan adı kaydı ise
   * platform genelinde tekil bir kaynağı tüketir.
   */
  BOOKING_PAGE_MANAGE: 'booking_page:manage',

  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  OWNER: 'owner',
  MANAGER: 'manager',
  RECEPTIONIST: 'receptionist',
  PRACTITIONER: 'practitioner',
  ACCOUNTANT: 'accountant',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

/** Rolün nereye bağlandığı: platform, kiracı geneli veya tek bir şube. */
export type RoleScope = 'platform' | 'tenant' | 'branch';

export interface RoleDefinition {
  key: RoleKey;
  scope: RoleScope;
  name: string;
  /**
   * Yetki genişliği sıralaması. Davet akışında kullanılır: kimse KENDİNDEN
   * yüksek rank'li bir rolü davet edemez (yetki yükseltme koruması).
   */
  rank: number;
  permissions: Permission[];
}

const P = PERMISSIONS;

/** Kiracı yönetimi dışındaki günlük operasyon izinleri. */
const OPERATIONS: Permission[] = [
  P.APPOINTMENT_READ_ALL,
  P.APPOINTMENT_WRITE,
  P.CUSTOMER_READ,
  P.CUSTOMER_WRITE,
  P.SERVICE_READ,
  P.STAFF_READ,
  P.SCHEDULE_READ,
  P.PACKAGE_READ,
  P.CONSENT_READ,
  P.NOTIFICATION_READ,
];

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: ROLES.PLATFORM_ADMIN,
    scope: 'platform',
    name: 'Platform Yöneticisi',
    rank: 100,
    // Platform yöneticisinin yetkisi kiracı izinlerinden GELMEZ; ayrı bir
    // kanaldan (PLATFORM_ADMIN_TOKEN) doğrulanır ve yalnız /platform/* uçlarını
    // kapsar. Rol satırı tamlık için vardır, kiracı verisine izin vermez.
    permissions: [],
  },
  {
    key: ROLES.OWNER,
    scope: 'tenant',
    name: 'İşletme Sahibi',
    rank: 80,
    permissions: ALL_PERMISSIONS.filter((p) => p !== P.APPOINTMENT_READ_OWN),
  },
  {
    key: ROLES.MANAGER,
    scope: 'branch',
    name: 'Şube Yöneticisi',
    rank: 60,
    permissions: [
      P.TENANT_READ,
      P.BRANCH_READ,
      P.USER_READ,
      P.USER_INVITE,
      ...OPERATIONS,
      P.APPOINTMENT_REOPEN,
      P.SERVICE_WRITE,
      P.STAFF_WRITE,
      P.SCHEDULE_WRITE,
      P.CUSTOMER_MEDICAL_READ,
      P.CUSTOMER_MERGE,
      P.PACKAGE_WRITE,
      P.PACKAGE_REFUND,
      P.PACKAGE_TRANSFER,
      P.FINANCE_PAYMENT_READ,
      P.FINANCE_PAYMENT_WRITE,
      P.FINANCE_PRICE_OVERRIDE,
      P.FINANCE_COMMISSION_READ,
      P.FINANCE_COMMISSION_WRITE,
      P.REPORT_REVENUE_READ,
      P.CONSENT_MANAGE,
      P.NOTIFICATION_SEND,
      P.NOTIFICATION_MANAGE,
      P.BOOKING_PAGE_READ,
      P.BOOKING_PAGE_MANAGE,
      P.AUDIT_READ,
    ],
  },
  {
    key: ROLES.ACCOUNTANT,
    scope: 'tenant',
    name: 'Muhasebe',
    rank: 40,
    // Tıbbi kayıt YOK. Muhasebenin sağlık verisine erişmesi için bir gerekçe
    // olmadığı gibi, KVKK m.6 açısından erişimin dar tutulması yükümlülüktür.
    permissions: [
      P.TENANT_READ,
      P.BRANCH_READ,
      P.CUSTOMER_READ,
      P.PACKAGE_READ,
      P.PACKAGE_REFUND,
      P.FINANCE_PAYMENT_READ,
      P.FINANCE_PAYMENT_WRITE,
      P.FINANCE_COMMISSION_READ,
      P.REPORT_REVENUE_READ,
    ],
  },
  {
    key: ROLES.RECEPTIONIST,
    scope: 'branch',
    name: 'Resepsiyon',
    rank: 30,
    // Tıbbi kayıt ve ciro raporu YOK.
    permissions: [
      P.BRANCH_READ,
      ...OPERATIONS,
      P.PACKAGE_WRITE,
      P.FINANCE_PAYMENT_READ,
      P.FINANCE_PAYMENT_WRITE,
      P.CONSENT_MANAGE,
      P.NOTIFICATION_SEND,
      P.BOOKING_PAGE_READ,
    ],
  },
  {
    key: ROLES.PRACTITIONER,
    scope: 'branch',
    name: 'Uygulayıcı',
    rank: 20,
    // Varsayılan olarak YALNIZ kendi randevularını görür. Tüm takvimi görmesi
    // `appointment:read.all` izniyle açılır (kiracı isterse rolü genişletir).
    permissions: [
      P.BRANCH_READ,
      P.APPOINTMENT_READ_OWN,
      P.APPOINTMENT_WRITE,
      P.CUSTOMER_READ,
      P.CUSTOMER_MEDICAL_READ,
      P.CUSTOMER_MEDICAL_WRITE,
      P.SERVICE_READ,
      P.STAFF_READ,
      P.SCHEDULE_READ,
      P.PACKAGE_READ,
      P.CONSENT_READ,
      P.NOTIFICATION_READ,
      // Kendi işlem sayısı, cirosu, primi ve doluluğu. Ciro raporunun tamamı
      // DEĞİL — `report.revenue:read` bu rolde bilerek yok.
      P.REPORT_PERFORMANCE_READ_OWN,
    ],
  },
];

export const ROLE_BY_KEY: Record<RoleKey, RoleDefinition> = Object.fromEntries(
  ROLE_DEFINITIONS.map((role) => [role.key, role]),
) as Record<RoleKey, RoleDefinition>;

/** Kiracı içinde atanabilen roller (platform rolü davet edilemez). */
export const ASSIGNABLE_ROLES: RoleKey[] = ROLE_DEFINITIONS.filter(
  (role) => role.scope !== 'platform',
).map((role) => role.key);

export function isRoleKey(value: string): value is RoleKey {
  return Object.hasOwn(ROLE_BY_KEY, value);
}

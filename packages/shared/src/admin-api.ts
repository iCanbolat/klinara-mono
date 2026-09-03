/**
 * Yönetim (yazma tarafı) API'sinin sözleşmesi — `apps/web-admin`'in tek
 * buluşma noktası.
 *
 * `booking-api.ts` public randevu sayfasının OKUMA sözleşmesini tarif ediyor;
 * bu dosya yönetim panelinin okuyup YAZDIĞI yüzeyi. İkisi bilerek ayrı: public
 * tipler ziyaretçiye giden dar bir beyaz listedir ve oradaki bir alan sızıntısı
 * KVKK meselesidir, buradakiler ise zaten yetkili bir kullanıcının gördüğü şey.
 *
 * Bu tipler `apps/api/src/modules/booking-page/dto/*` içindeki DTO sınıflarının
 * aynadaki karşılığıdır. Kopya DEĞİLLER: sunucuda DTO doğrulamayı da tarif eder
 * (`class-validator`), burada aynı şekil istemcinin girdisi olarak durur ve
 * `apps/api/test/unit/admin-api-contract.test.ts` ikisinin ayrışmasını DERLEME
 * ZAMANINDA yakalar. Alan eklenip buraya yazılmazsa `pnpm typecheck` kırılır.
 *
 * ⚠️ Bu paket sıfır çalışma zamanı bağımlılığı taşır — Next uygulaması sınırları
 * öğrenmek için `reflect-metadata` ve `class-validator` çekmek zorunda kalmasın.
 */

import type { ContentBlockInput, SeoInput, ThemeInput } from './booking-content.js';

// ---------------------------------------------------------------------------
// Randevu sayfası — ayarlar
// ---------------------------------------------------------------------------

export const BOOKING_SITE_STATUSES = ['draft', 'published', 'unpublished'] as const;
export type BookingSiteStatus = (typeof BOOKING_SITE_STATUSES)[number];

export const OTP_CHANNELS = ['whatsapp', 'sms'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

/**
 * Randevu anında gösterilen onam metni.
 *
 * Metin burada duruyor çünkü Faz 7 (versiyonlu onam şablonları) bu fazdan SONRA
 * geliyor; Batch 7.2 bu alanı şablon referansına çevirecek.
 */
export interface ConsentText {
  kind: string;
  text: string;
  required?: boolean;
}

/** Çözülmüş (etkin) ayarlar — override ?? kiracı varsayılanı. */
export interface BookingSiteSettings {
  minLeadMinutes: number;
  maxAdvanceDays: number;
  cancelWindowHours: number;
  /** Yukarıdaki üç değer kiracı ayarından mı geliyor. */
  usesTenantDefaults: boolean;
  holdTtlMinutes: number;
  showStaffSelection: boolean;
  showPrices: boolean;
  allowReschedule: boolean;
  requireOtp: boolean;
  otpChannel: OtpChannel;
  consentTexts: ConsentText[];
  locales: string[];
  contactEmail: string | null;
}

export interface BookingPage {
  id: string;
  /** `tenants.slug` ile senkron tutulur; buradan DEĞİŞTİRİLEMEZ. */
  slug: string;
  status: BookingSiteStatus;
  defaultBranchId: string | null;
  publishedAt: string | null;
  /** Kiracının kanonik adresi (birincil konak adı). Yoksa boş dize. */
  canonicalUrl: string;
  hasUnpublishedChanges: boolean;
  settings: BookingSiteSettings;
}

/**
 * Ayar güncellemesi.
 *
 * ⚠️ `*Override` alanlarında ÜÇ durum var ve ikisi kolayca karıştırılır:
 * alan gönderilmezse mevcut değer KORUNUR, `null` gönderilirse kiracı
 * varsayılanına DÜŞÜLÜR, sayı gönderilirse override yazılır. Editör formunun
 * "varsayılanı kullan" onay kutusu `null` göndermeli, alanı atlamamalı.
 */
export interface UpdateBookingPageInput {
  defaultBranchId?: string | null;
  minLeadMinutesOverride?: number | null;
  maxAdvanceDaysOverride?: number | null;
  cancelWindowHoursOverride?: number | null;
  holdTtlMinutes?: number;
  showStaffSelection?: boolean;
  showPrices?: boolean;
  allowReschedule?: boolean;
  requireOtp?: boolean;
  otpChannel?: OtpChannel;
  consentTexts?: ConsentText[];
  contactEmail?: string | null;
}

/** `UpdateBookingPageInput`'un sayısal alan sınırları — form doğrulaması için. */
export const SETTINGS_LIMITS = {
  minLeadMinutes: { min: 0, max: 43_200 },
  maxAdvanceDays: { min: 1, max: 730 },
  cancelWindowHours: { min: 0, max: 720 },
  holdTtlMinutes: { min: 1, max: 60 },
  consentTexts: { maxItems: 10, kind: 60, text: 8_000 },
} as const;

// ---------------------------------------------------------------------------
// İçerik ve sürümler
// ---------------------------------------------------------------------------

/** Her kayıt yeni bir DEĞİŞMEZ revizyon yazar; hiçbir şey üzerine yazılmaz. */
export interface RevisionSummary {
  id: string;
  revisionNumber: number;
  contentHash: string;
  createdAt: string;
  createdBy: string | null;
  isPublished: boolean;
}

export interface BookingPageContent {
  draft: RevisionSummary | null;
  published: RevisionSummary | null;
  theme: ThemeInput;
  sections: ContentBlockInput[];
  seo: SeoInput;
}

export interface UpdateBookingPageContentInput {
  theme?: ThemeInput;
  sections: ContentBlockInput[];
  seo?: SeoInput;
}

/** `GET /booking-page/content/revisions` bundan fazlasını döndürmez. */
export const REVISION_HISTORY_LIMIT = 50;

// ---------------------------------------------------------------------------
// Görsel varlıklar
// ---------------------------------------------------------------------------

export const ASSET_PURPOSES = [
  'booking_logo',
  'booking_hero',
  'booking_gallery',
  'service_image',
  'favicon',
  'og_image',
] as const;
export type AssetPurpose = (typeof ASSET_PURPOSES)[number];

/**
 * İzin verilen içerik tipleri — beyaz liste.
 *
 * `image/svg+xml` YOK ve eklenmeyecek: kendi alan adımızdan servis edilen bir
 * SVG script taşıyabildiği için saklı XSS'tir. İstemci bunu ÖNDEN denetlemeli;
 * kullanıcıya "sunucu reddetti" demek yerine dosya seçerken söylemek gerek.
 */
export const ASSET_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type AssetMimeType = (typeof ASSET_MIME_TYPES)[number];

/** Sunucunun `BOOKING_ASSET_MAX_BYTES` varsayılanı — sözleşme testi eşitliği doğruluyor. */
export const ASSET_MAX_BYTES = 5_242_880;

export const ASSET_LIMITS = {
  maxBytes: ASSET_MAX_BYTES,
  mimeTypes: ASSET_MIME_TYPES,
  altText: 200,
} as const;

export type AssetStatus = 'pending' | 'ready';

export interface Asset {
  id: string;
  purpose: AssetPurpose;
  /** İmzasız ve DEĞİŞMEZ adres — anahtar içerik hash'i taşıdığı için bir yıl cache'lenir. */
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  status: AssetStatus;
}

export interface PresignAssetInput {
  purpose: AssetPurpose;
  contentType: AssetMimeType;
  sizeBytes: number;
}

export interface PresignAssetResponse {
  assetId: string;
  /** İstemcinin doğrudan PUT edeceği imzalı adres. Gövde proxy'den GEÇMEZ. */
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

export interface ConfirmAssetInput {
  storageKey: string;
  purpose: AssetPurpose;
  altText?: string;
  width?: number;
  height?: number;
  /** İstemcinin hesapladığı sha256 — opsiyonel bütünlük kaydı. */
  sha256?: string;
}

// ---------------------------------------------------------------------------
// Alan adları
// ---------------------------------------------------------------------------

export const DOMAIN_KINDS = ['platform_subdomain', 'custom'] as const;
export type DomainKind = (typeof DOMAIN_KINDS)[number];

/**
 * Durum makinesi.
 *
 * `dns_verified` ile `active` arasındaki fark önemli: DNS doğrulaması geçmiş
 * olmak yeterli değildir, `active`'e terfi kenar proxy'sinin GERÇEK sertifika
 * talebinde olur. Arayüz ikisini ayrı rozetle göstermeli — kullanıcı "DNS
 * tamam ama sayfa hâlâ açılmıyor" durumunu ancak böyle anlar.
 */
export const DOMAIN_VERIFICATION_STATUSES = [
  'pending',
  'dns_verified',
  'active',
  'failed',
  'disabled',
] as const;
export type DomainVerificationStatus = (typeof DOMAIN_VERIFICATION_STATUSES)[number];

/**
 * DNS sağlayıcısına girilecek kayıtlar.
 *
 * Kullanıcı bu değerleri elle YAZMAMALI — arayüz her alan için ayrı bir
 * kopyalama düğmesi vermek zorunda (Batch 11.6 kabul kriteri). TXT ya da CNAME,
 * ikisinden BİRİ eşleşirse doğrulama geçer.
 */
export interface DnsInstructions {
  txtName: string;
  txtValue: string;
  cnameName: string;
  cnameValue: string;
}

export interface Domain {
  id: string;
  host: string;
  kind: DomainKind;
  verificationStatus: DomainVerificationStatus;
  isPrimary: boolean;
  failureReason: string | null;
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  /** Yalnız doğrulanmamış ÖZEL alan adlarında dolu. */
  dnsInstructions: DnsInstructions | null;
}

export interface CreateDomainInput {
  /** Ham konak adı; normalizasyon (küçük harf, punycode) SUNUCUDA yapılır. */
  host: string;
  /** ⚠️ Sunucu bunu ekleme anında UYGULAMAZ — terfi yalnız doğrulama sonrası `/primary` ile. */
  makePrimary?: boolean;
}

export const DOMAIN_LIMITS = { host: 253 } as const;

// ---------------------------------------------------------------------------
// Kimlik — `web-admin`'in BFF katmanının okuduğu şekiller
// ---------------------------------------------------------------------------

export interface Membership {
  id: string;
  branchId: string | null;
  roleKey: string;
  roleName: string;
}

export interface MeUser {
  id: string;
  email: string;
  fullName: string;
  locale: string;
  isActive: boolean;
  phone: string | null;
  phoneVerified: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  memberships: Membership[];
}

/**
 * `GET /me` yanıtı.
 *
 * `permissions` YALNIZCA arayüz içindir — menüyü süzmek ve devre dışı düğme
 * göstermek için. Yetkinin otoritesi her zaman sunucudaki `PermissionsGuard`;
 * istemci listesi bir kolaylık, bir kapı değil.
 */
export interface Me {
  user: MeUser;
  tenantId: string;
  roles: string[];
  permissions: string[];
  branchIds: string[];
  tenantWide: boolean;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  authMethod: 'password' | 'passkey' | 'invitation' | 'password_reset';
  mfaMethod: string | null;
  deviceLabel: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface PasskeyInfo {
  id: string;
  deviceLabel: string | null;
  backedUp: boolean;
  transports: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export interface TotpStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

export interface TenantOption {
  id: string;
  slug: string;
  name: string;
  roles: string[];
}

export interface Branch {
  id: string;
  name: string;
  timezone: string;
}

/**
 * Hizmet kategorisi — `serviceList` bloğunun süzgeç seçenekleri.
 *
 * `Branch` gibi bu da katalog DTO'sunun DAR bir dilimi (`tenantId`, `createdAt`
 * yok): editörün ihtiyacı bir ad ve bir kimlik. Sözleşme testinin kapsamında
 * değil çünkü kaynağı `booking-page` modülü değil, katalog — orada bir alan
 * değişirse editörün seçim kutusu etkilenmez.
 */
export interface ServiceCategory {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Oturum adımları — BFF'in TARAYICIYA döndüğü şekil
// ---------------------------------------------------------------------------

/**
 * ⚠️ Bu tip API'nin `LoginResponseDto`'su DEĞİLDİR ve olmamalıdır.
 *
 * `web-admin` BFF mimarisinde token'lar ve `challengeToken` mühürlü httpOnly
 * cookie'de kalır; tarayıcıya yalnız akışı sürdürmek için gereken SIRRA AİT
 * OLMAYAN veri iner. Bu ayrımı tipe yazmak, bir gün birinin yukarı akış
 * yanıtını olduğu gibi geçirmesini derleme zamanında engelliyor.
 */
export type SessionStep =
  | { step: 'authenticated'; expiresIn: number }
  | { step: 'tenant'; tenants: TenantOption[] }
  | { step: 'mfa'; configured: boolean; methods: string[] }
  /** Mevcut hesaba yalnız üyelik eklendi; parola değişmedi → girişe yönlendir. */
  | { step: 'membership_added' };
